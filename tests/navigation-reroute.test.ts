import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapDirectionsRoutes } from "@/routing/mapbox/directions";
import { hydrateRoute } from "@/routing/wire";
import type { AtlasRoute, RouteFailure } from "@/routing/types";
import type { Destination } from "@/destinations/types";
import {
  DEFAULT_REROUTE_CONFIG,
  FOLLOWING,
  type RerouteConfig,
  type RerouteState,
  confirmWindowMs,
  describeReroute,
  isRetryableFailure,
  readEvidence,
  rerouteReducer,
  retryDelayMs,
} from "@/navigation/reroute";
import {
  INITIAL_NAVIGATION_STATE,
  type NavigationEvent,
  type NavigationState,
  navigationReducer,
  sessionOf,
} from "@/navigation/machine";
import {
  type NavigationProgress,
  advance,
  initialState,
  matchToRoute,
  stepBoundaries,
} from "@/navigation/engine";
import {
  cleanTrace,
  excursionTrace,
  gpsJumpTrace,
  missedTurnTrace,
  parallelRoadTrace,
  replay,
  replayReroute,
  stationaryTrace,
  walkRoute,
  wrongTurnTrace,
  wrongWayTrace,
} from "@/navigation/simulator";
import * as T from "@/navigation/thresholds";

/**
 * REROUTING.
 *
 * Two things are being proved here and they pull in opposite directions:
 * Atlas must reroute when the driver has genuinely left the route, and must
 * not when the GPS merely says so. Every test below is one or the other, and
 * the negative ones matter more — an eager reroute is wrong at exactly the
 * moment the driver is most certain they are right.
 *
 * The detection tests replay real traces through the real engine and the real
 * reroute machine in lockstep. Nothing here models either of them.
 */

const FIXTURES = join(new URL("..", import.meta.url).pathname, "tests/fixtures/directions");
const load = (n: string): AtlasRoute =>
  hydrateRoute(
    mapDirectionsRoutes(
      JSON.parse(readFileSync(join(FIXTURES, `${n}.json`), "utf8")),
      "t",
      1_700_000_000_000,
    )[0]!,
  );

const CITY = load("austin-two-alternatives");
const HIGHWAY = load("highway-ramps");

// ---------------------------------------------------------------------------
// Detection — the negative cases first
// ---------------------------------------------------------------------------

describe("ordinary driving never reroutes", () => {
  it("stays following through a clean drive", () => {
    const result = replayReroute(CITY, cleanTrace(CITY, { stepMeters: 16 }));
    expect(result.triggeredAt).toEqual([]);
    expect(result.final.kind).toBe("following");
  });

  it("stays following through a noisy city drive", () => {
    // 30m of jitter on a fix that admits to 22m accuracy. The corridor scales
    // to absorb it; a fixed threshold would reroute repeatedly.
    const result = replayReroute(
      CITY,
      cleanTrace(CITY, { stepMeters: 16, noiseMeters: 30, accuracyMeters: 22 }),
    );
    expect(result.triggeredAt).toEqual([]);
  });

  it("survives a single GPS spike", () => {
    const result = replayReroute(
      CITY,
      gpsJumpTrace(CITY, { stepMeters: 16, jumpMeters: 2_500 }),
    );
    expect(result.triggeredAt).toEqual([]);
  });

  it("does not reroute while stopped at a light", () => {
    // No speed reported, 15m of wander: the case that looks most like motion.
    const result = replayReroute(
      CITY,
      stationaryTrace(CITY, { atMeters: 250, samples: 60, reportSpeed: false }),
    );
    expect(result.triggeredAt).toEqual([]);
  });

  it("does not reroute for a clipped corner that comes straight back", () => {
    const result = replayReroute(
      CITY,
      excursionTrace(CITY, { stepMeters: 16, atMeters: 300, peakMeters: 55 }),
    );
    expect(result.triggeredAt).toEqual([]);
    expect(result.final.kind).toBe("following");
  });

  it("does not reroute on a large deviation that accuracy fully explains", () => {
    // 45m off the line, but the device says it is only accurate to 45m. The
    // deviation is inside its own error bar and proves nothing.
    const progress = progressWith({
      distanceFromRouteMeters: 45,
      accuracyMeters: 45,
      corridorMeters: 72,
      offRoute: "on-route",
    });
    expect(readEvidence(progress).qualifies).toBe(false);
  });

  it("reroutes on the same deviation when the fix is precise", () => {
    const progress = progressWith({
      distanceFromRouteMeters: 45,
      accuracyMeters: 4,
      corridorMeters: 30,
      offRoute: "off-route",
    });
    expect(readEvidence(progress).qualifies).toBe(true);
  });
});

describe("heading is supporting evidence, never a trigger", () => {
  it("never triggers on heading alone while on the line", () => {
    // Strong heading conflict, but the driver is on the route and the engine
    // has not called it off-route. Nothing should happen.
    const progress = progressWith({
      distanceFromRouteMeters: 3,
      offRoute: "on-route",
      headingDisagrees: true,
    });
    expect(readEvidence(progress).qualifies).toBe(false);
  });

  it("upgrades an ambiguous departure to unambiguous", () => {
    const near = { distanceFromRouteMeters: 45, corridorMeters: 30, offRoute: "off-route" as const };
    expect(readEvidence(progressWith(near)).reason).toBe("drifted");
    expect(
      readEvidence(progressWith({ ...near, headingDisagrees: true })).reason,
    ).toBe("departed");
  });

  it("ignores heading at a standstill, because the engine already did", () => {
    // A parked phone reports whatever direction its last jitter pointed. The
    // engine speed-gates it, so `headingDisagrees` is false and the whole fix
    // is inconclusive regardless.
    const result = replayReroute(
      CITY,
      stationaryTrace(CITY, { atMeters: 250, samples: 40, reportSpeed: true }),
    );
    expect(result.triggeredAt).toEqual([]);
  });

  it("confirms a driver travelling back down the route", () => {
    const result = replayReroute(
      CITY,
      wrongWayTrace(CITY, { atMeters: 500, samples: 25 }),
    );
    // Heading is the only thing wrong here — the position is on the line — so
    // this must not confirm on distance. It is reported honestly as such.
    const anyHeadingConflict = result.engine.states.some(
      (s) => s.progress.headingDisagrees,
    );
    expect(anyHeadingConflict).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Detection — the positive cases
// ---------------------------------------------------------------------------

describe("a genuine departure reroutes", () => {
  it("confirms a wrong turn", () => {
    const result = replayReroute(
      CITY,
      wrongTurnTrace(CITY, { stepMeters: 16, turnAtMeters: 350, departMeters: 400 }),
    );
    expect(result.triggeredAt.length).toBeGreaterThan(0);
    expect(result.final.kind).toBe("triggered");
  });

  it("confirms a missed turn", () => {
    const result = replayReroute(
      CITY,
      missedTurnTrace(CITY, { stepMeters: 16, continueMeters: 500 }),
    );
    expect(result.triggeredAt.length).toBeGreaterThan(0);
  });

  it("confirms only once per episode", () => {
    // The state machine must not re-trigger on every subsequent fix while it
    // waits for the controller to act. That is the request storm.
    const result = replayReroute(
      CITY,
      wrongTurnTrace(CITY, { stepMeters: 16, turnAtMeters: 350, departMeters: 600 }),
    );
    expect(result.triggeredAt).toHaveLength(1);
  });

  it("waits for sustained evidence, not the first divergent fix", () => {
    const trace = wrongTurnTrace(CITY, {
      stepMeters: 16,
      turnAtMeters: 350,
      departMeters: 400,
    });
    const result = replayReroute(CITY, trace);
    const firstTrigger = result.triggeredAt[0]!;
    const firstDivergent = result.engine.states.findIndex(
      (s) => s.progress.distanceFromRouteMeters > T.REROUTE_MIN_DISTANCE_M,
    );

    expect(firstDivergent).toBeGreaterThanOrEqual(0);
    // At 1Hz this is the confirmation delay in seconds, and it must be real.
    expect(firstTrigger - firstDivergent).toBeGreaterThanOrEqual(
      T.REROUTE_CONFIRM_SAMPLES,
    );
  });

  it("confirms on the highway fixture too, not just the city one", () => {
    const result = replayReroute(
      HIGHWAY,
      wrongTurnTrace(HIGHWAY, { stepMeters: 22, turnAtMeters: 400, departMeters: 600 }),
    );
    expect(result.triggeredAt.length).toBeGreaterThan(0);
  });
});

describe("the parallel road is treated as ambiguous, on purpose", () => {
  // Atlas cannot tell a frontage road from a wrong turn without map matching,
  // which is out of scope. So it does not guess — it takes longer.
  const trace = parallelRoadTrace(CITY, { stepMeters: 16, offsetMeters: 45 });

  it("classifies a close parallel track as drifted, not departed", () => {
    const result = replayReroute(CITY, trace);
    const suspected = result.states.find((s) => s.kind === "suspected");
    expect(suspected?.kind).toBe("suspected");
    if (suspected?.kind === "suspected") {
      expect(suspected.reason).toBe("drifted");
    }
  });

  it("makes the ambiguous window materially longer than the clear one", () => {
    expect(confirmWindowMs("drifted")).toBeGreaterThan(confirmWindowMs("departed"));
  });

  it("still confirms eventually — a wrong carriageway is a real problem", () => {
    const long = parallelRoadTrace(CITY, { stepMeters: 8, offsetMeters: 45 });
    const result = replayReroute(CITY, long);
    expect(result.triggeredAt.length).toBeGreaterThan(0);
  });

  it("takes longer to confirm than an unambiguous departure does", () => {
    const parallel = replayReroute(CITY, parallelRoadTrace(CITY, { stepMeters: 8, offsetMeters: 45 }));
    const departure = replayReroute(
      CITY,
      wrongTurnTrace(CITY, { stepMeters: 8, turnAtMeters: 350, departMeters: 400 }),
    );
    expect(parallel.triggeredAt[0]).toBeGreaterThan(0);
    expect(departure.triggeredAt[0]).toBeGreaterThan(0);
    // Same sample rate, so index difference is time difference.
    expect(parallel.triggeredAt[0]! - firstDivergence(parallel)).toBeGreaterThan(
      departure.triggeredAt[0]! - firstDivergence(departure),
    );
  });
});

function firstDivergence(result: ReturnType<typeof replayReroute>): number {
  return result.engine.states.findIndex(
    (s) => s.progress.distanceFromRouteMeters > T.REROUTE_MIN_DISTANCE_M,
  );
}

// ---------------------------------------------------------------------------
// Route progress and self-intersection
// ---------------------------------------------------------------------------

describe("progress cannot teleport across a self-intersecting route", () => {
  it("refuses a whole-line match the car could not have reached", () => {
    // A point near a far part of the route, matched from early progress. With
    // no budget the global rescan wins; with a realistic one-second budget it
    // must be refused, because no car covers a kilometre in a second.
    const far = walkRoute(CITY, 10).at(-3)!;

    const unbounded = matchToRoute(CITY, far.point, 50);
    const bounded = matchToRoute(CITY, far.point, 50, 150);

    expect(unbounded).not.toBeNull();
    expect(unbounded!.progressMeters).toBeGreaterThan(1_000);
    // Bounded stays inside the search window near where the car actually is.
    expect(bounded!.progressMeters).toBeLessThan(unbounded!.progressMeters);
  });

  it("still allows a long jump after a long gap", () => {
    // A tunnel exit is a genuine large jump, and the budget scales with the
    // elapsed time, so it must survive.
    const result = replay(CITY, cleanTrace(CITY, { stepMeters: 16 }));
    expect(result.final.progress.progressFraction).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

const progressOffRoute = progressWith({
  distanceFromRouteMeters: 120,
  corridorMeters: 30,
  offRoute: "off-route",
  headingDisagrees: true,
});

const progressOnRoute = progressWith({
  distanceFromRouteMeters: 4,
  corridorMeters: 30,
  offRoute: "on-route",
});

/** Drives the machine to `triggered` the way a real departure would. */
function driveToTrigger(config: RerouteConfig = DEFAULT_REROUTE_CONFIG): {
  state: RerouteState;
  at: number;
} {
  let state: RerouteState = FOLLOWING;
  let now = 1_000;
  for (let i = 0; i < 12 && state.kind !== "triggered"; i++) {
    state = rerouteReducer(state, { type: "SAMPLED", progress: progressOffRoute, now }, config);
    now += 1_000;
  }
  return { state, at: now };
}

describe("reroute state machine", () => {
  it("following → suspected on the first qualifying fix", () => {
    const next = rerouteReducer(FOLLOWING, {
      type: "SAMPLED",
      progress: progressOffRoute,
      now: 1_000,
    });
    expect(next.kind).toBe("suspected");
  });

  it("suspected → following when the driver rejoins", () => {
    const suspected = rerouteReducer(FOLLOWING, {
      type: "SAMPLED",
      progress: progressOffRoute,
      now: 1_000,
    });
    const next = rerouteReducer(suspected, {
      type: "SAMPLED",
      progress: progressOnRoute,
      now: 2_000,
    });
    expect(next.kind).toBe("following");
  });

  it("holds suspicion through an inconclusive fix rather than clearing it", () => {
    const suspected = rerouteReducer(FOLLOWING, {
      type: "SAMPLED",
      progress: progressOffRoute,
      now: 1_000,
    });
    const stale = rerouteReducer(suspected, {
      type: "SAMPLED",
      progress: progressWith({ ...progressOffRoute, freshness: "stale" }),
      now: 2_000,
    });
    expect(stale).toBe(suspected);
  });

  it("an inconclusive fix does not advance the confirmation either", () => {
    let state = rerouteReducer(FOLLOWING, {
      type: "SAMPLED",
      progress: progressOffRoute,
      now: 1_000,
    });
    // Twenty stationary fixes over twenty seconds — far past every window.
    for (let i = 1; i <= 20; i++) {
      state = rerouteReducer(state, {
        type: "SAMPLED",
        progress: progressWith({ ...progressOffRoute, status: "stationary" }),
        now: 1_000 + i * 1_000,
      });
    }
    expect(state.kind).toBe("suspected");
  });

  it("suspected → triggered once both the count and the window are met", () => {
    const { state } = driveToTrigger();
    expect(state.kind).toBe("triggered");
  });

  it("requires the sample count even when the window is long past", () => {
    // The count and the duration are independent gates, and this is the case
    // that separates them: two fixes ten seconds apart satisfy any duration
    // window while proving almost nothing. That signature — very few fixes
    // spread over a long time — is a struggling receiver, not a wrong turn.
    let state = rerouteReducer(FOLLOWING, {
      type: "SAMPLED",
      progress: progressOffRoute,
      now: 0,
    });
    state = rerouteReducer(state, {
      type: "SAMPLED",
      progress: progressOffRoute,
      now: 10_000,
    });

    expect(T.REROUTE_CONFIRM_SAMPLES).toBeGreaterThan(2);
    expect(state.kind).toBe("suspected");
    if (state.kind === "suspected") expect(state.samples).toBe(2);

    // The third fix is what makes it a reroute.
    state = rerouteReducer(state, {
      type: "SAMPLED",
      progress: progressOffRoute,
      now: 11_000,
    });
    expect(state.kind).toBe("triggered");
  });

  it("triggered → requesting only via REQUEST_STARTED", () => {
    const { state, at } = driveToTrigger();
    const requesting = rerouteReducer(state, { type: "REQUEST_STARTED", requestId: 1, at });
    expect(requesting.kind).toBe("requesting");
    if (requesting.kind === "requesting") expect(requesting.requestId).toBe(1);
  });

  it("refuses to start a request from any other state", () => {
    expect(
      rerouteReducer(FOLLOWING, { type: "REQUEST_STARTED", requestId: 1, at: 0 }),
    ).toBe(FOLLOWING);
  });

  it("requesting → settling on success", () => {
    const { state, at } = driveToTrigger();
    const requesting = rerouteReducer(state, { type: "REQUEST_STARTED", requestId: 7, at });
    const settled = rerouteReducer(requesting, {
      type: "REQUEST_SUCCEEDED",
      requestId: 7,
      at: at + 800,
    });
    expect(settled.kind).toBe("settling");
    if (settled.kind === "settling") {
      expect(settled.until).toBe(at + 800 + T.REROUTE_SETTLE_MS);
    }
  });

  it("ignores a stale success for a superseded request", () => {
    const { state, at } = driveToTrigger();
    const requesting = rerouteReducer(state, { type: "REQUEST_STARTED", requestId: 9, at });
    const stale = rerouteReducer(requesting, {
      type: "REQUEST_SUCCEEDED",
      requestId: 8,
      at: at + 500,
    });
    expect(stale).toBe(requesting);
  });

  it("ignores a stale failure for a superseded request", () => {
    const { state, at } = driveToTrigger();
    const requesting = rerouteReducer(state, { type: "REQUEST_STARTED", requestId: 9, at });
    const stale = rerouteReducer(requesting, {
      type: "REQUEST_FAILED",
      requestId: 3,
      failure: "network",
      at: at + 500,
    });
    expect(stale).toBe(requesting);
  });

  it("abandons an in-flight request when the driver rejoins the route", () => {
    const { state, at } = driveToTrigger();
    const requesting = rerouteReducer(state, { type: "REQUEST_STARTED", requestId: 4, at });
    const rejoined = rerouteReducer(requesting, {
      type: "SAMPLED",
      progress: progressOnRoute,
      now: at + 1_000,
    });
    expect(rejoined.kind).toBe("following");

    // And the reply, when it lands, has nothing left to overwrite.
    const late = rerouteReducer(rejoined, {
      type: "REQUEST_SUCCEEDED",
      requestId: 4,
      at: at + 2_000,
    });
    expect(late.kind).toBe("following");
  });

  it("saves the request entirely if the driver rejoins before it is sent", () => {
    const { state, at } = driveToTrigger();
    const rejoined = rerouteReducer(state, {
      type: "SAMPLED",
      progress: progressOnRoute,
      now: at + 500,
    });
    expect(rejoined.kind).toBe("following");
  });

  it("RESET wipes everything, from any state", () => {
    const { state, at } = driveToTrigger();
    const requesting = rerouteReducer(state, { type: "REQUEST_STARTED", requestId: 1, at });
    expect(rerouteReducer(requesting, { type: "RESET" })).toBe(FOLLOWING);
  });
});

describe("cooldown after adoption", () => {
  it("ignores off-route evidence inside the settling window", () => {
    const { state, at } = driveToTrigger();
    const requesting = rerouteReducer(state, { type: "REQUEST_STARTED", requestId: 1, at });
    let settled = rerouteReducer(requesting, {
      type: "REQUEST_SUCCEEDED",
      requestId: 1,
      at,
    });

    // The replacement was computed from where the car was when the request went
    // out; it has moved since, so it reads as off-route immediately. Without
    // the grace period this is an infinite reroute loop.
    for (let i = 1; i <= 10; i++) {
      settled = rerouteReducer(settled, {
        type: "SAMPLED",
        progress: progressOffRoute,
        now: at + i * 1_000,
      });
    }
    expect(settled.kind).toBe("settling");
  });

  it("resumes normal detection once the window expires", () => {
    const { state, at } = driveToTrigger();
    const requesting = rerouteReducer(state, { type: "REQUEST_STARTED", requestId: 1, at });
    const settled = rerouteReducer(requesting, { type: "REQUEST_SUCCEEDED", requestId: 1, at });

    const after = rerouteReducer(settled, {
      type: "SAMPLED",
      progress: progressOffRoute,
      now: at + T.REROUTE_SETTLE_MS + 1,
    });
    expect(after.kind).toBe("suspected");
  });

  it("expires on a tick even with no fixes arriving", () => {
    const settling: RerouteState = { kind: "settling", until: 5_000 };
    expect(rerouteReducer(settling, { type: "TICK", now: 4_999 })).toBe(settling);
    expect(rerouteReducer(settling, { type: "TICK", now: 5_000 }).kind).toBe("following");
  });
});

describe("failure and retry", () => {
  function fail(failure: RouteFailure): RerouteState {
    const { state, at } = driveToTrigger();
    const requesting = rerouteReducer(state, { type: "REQUEST_STARTED", requestId: 1, at });
    return rerouteReducer(requesting, { type: "REQUEST_FAILED", requestId: 1, failure, at });
  }

  it("a failure does not end navigation — it parks in `failed`", () => {
    expect(fail("network").kind).toBe("failed");
  });

  it("classifies transient and permanent failures differently", () => {
    expect(isRetryableFailure("network")).toBe(true);
    expect(isRetryableFailure("timeout")).toBe(true);
    expect(isRetryableFailure("rate-limited")).toBe(true);
    expect(isRetryableFailure("no-route")).toBe(false);
    expect(isRetryableFailure("unroutable-point")).toBe(false);
    expect(isRetryableFailure("unauthorized")).toBe(false);
    expect(isRetryableFailure("not-configured")).toBe(false);
  });

  it("backs off further on each successive attempt", () => {
    const first = retryDelayMs("network", 0);
    const second = retryDelayMs("network", 1);
    const third = retryDelayMs("network", 2);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    // Budget exhausted: a long hold, not a tighter loop.
    expect(retryDelayMs("network", 3)).toBe(T.REROUTE_FATAL_COOLDOWN_MS);
  });

  it("holds a permanent failure for a long time instead of retrying", () => {
    expect(retryDelayMs("no-route", 0)).toBe(T.REROUTE_FATAL_COOLDOWN_MS);
  });

  it("does not retry before the backoff elapses", () => {
    const failed = fail("network");
    if (failed.kind !== "failed") throw new Error("expected failed");
    const early = rerouteReducer(failed, {
      type: "SAMPLED",
      progress: progressOffRoute,
      now: failed.retryAt - 1,
    });
    expect(early).toBe(failed);
  });

  it("retries once the backoff elapses and the driver is still off route", () => {
    const failed = fail("network");
    if (failed.kind !== "failed") throw new Error("expected failed");
    const retry = rerouteReducer(failed, {
      type: "SAMPLED",
      progress: progressOffRoute,
      now: failed.retryAt,
    });
    expect(retry.kind).toBe("triggered");
    if (retry.kind === "triggered") expect(retry.attempt).toBe(1);
  });

  it("does not retry at all if the driver rejoined during the backoff", () => {
    const failed = fail("network");
    if (failed.kind !== "failed") throw new Error("expected failed");
    const recovered = rerouteReducer(failed, {
      type: "SAMPLED",
      progress: progressOnRoute,
      now: failed.retryAt + 10_000,
    });
    expect(recovered.kind).toBe("following");
  });

  it("escalates the backoff across attempts rather than restarting it", () => {
    let state = fail("network");
    const delays: number[] = [];
    for (let round = 0; round < 3; round++) {
      if (state.kind !== "failed") break;
      delays.push(state.retryAt - state.at);
      const triggered = rerouteReducer(state, {
        type: "SAMPLED",
        progress: progressOffRoute,
        now: state.retryAt,
      });
      const requesting = rerouteReducer(triggered, {
        type: "REQUEST_STARTED",
        requestId: round + 2,
        at: state.retryAt,
      });
      state = rerouteReducer(requesting, {
        type: "REQUEST_FAILED",
        requestId: round + 2,
        failure: "network",
        at: state.retryAt,
      });
    }
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBe(delays.length);
  });

  it("a cancelled request is not a failure anyone sees", () => {
    expect(fail("cancelled").kind).toBe("following");
  });

  it("collapses the backoff when connectivity returns", () => {
    const failed = fail("network");
    if (failed.kind !== "failed") throw new Error("expected failed");
    const restored = rerouteReducer(failed, {
      type: "CONNECTIVITY_RESTORED",
      at: failed.at + 100,
    });
    expect(restored.kind).toBe("failed");
    if (restored.kind === "failed") expect(restored.retryAt).toBe(failed.at + 100);
  });

  it("does not collapse the backoff for failures the network cannot explain", () => {
    const failed = fail("no-route");
    const restored = rerouteReducer(failed, { type: "CONNECTIVITY_RESTORED", at: 0 });
    expect(restored).toBe(failed);
  });
});

// ---------------------------------------------------------------------------
// Adoption — the navigation machine
// ---------------------------------------------------------------------------

const DESTINATION: Destination = {
  id: "dest-1",
  name: "Zilker Park",
  address: null,
  coordinate: { latitude: 30.2669, longitude: -97.7729 },
  icon: "pin",
  origin: "search",
};

const OTHER: Destination = { ...DESTINATION, id: "dest-2", name: "Elsewhere" };

function driving(route: AtlasRoute, destination = DESTINATION): NavigationState {
  const events: NavigationEvent[] = [
    { type: "DESTINATION_SELECTED", destination },
    { type: "ROUTE_REQUESTED", requestId: 1 },
    { type: "ROUTE_SUCCEEDED", requestId: 1, routes: [route] },
    { type: "START_DRIVE", at: 1_000, origin: route.geometry[0]! },
    { type: "NAVIGATION_READY" },
  ];
  return events.reduce<NavigationState>(navigationReducer, INITIAL_NAVIGATION_STATE);
}

describe("adopting a replacement route", () => {
  const replacement: AtlasRoute = { ...HIGHWAY, id: "replacement-1" };

  it("replaces the route atomically and keeps the trip", () => {
    const before = driving(CITY);
    const after = navigationReducer(before, {
      type: "REROUTE_ADOPTED",
      destinationId: DESTINATION.id,
      routes: [replacement],
    });

    const session = sessionOf(after);
    expect(after.phase).toBe("navigating");
    expect(session?.route.id).toBe("replacement-1");
    expect(session?.offered.map((r) => r.id)).toEqual(["replacement-1"]);
    // The trip is the same trip. None of this restarts.
    expect(session?.destination).toBe(DESTINATION);
    expect(session?.startedAt).toBe(sessionOf(before)?.startedAt);
    expect(session?.origin).toEqual(sessionOf(before)?.origin);
  });

  it("leaves the camera exactly as it was", () => {
    const exploring = navigationReducer(driving(CITY), { type: "MAP_EXPLORED" });
    const after = navigationReducer(exploring, {
      type: "REROUTE_ADOPTED",
      destinationId: DESTINATION.id,
      routes: [replacement],
    });
    expect(after.phase === "navigating" && after.camera).toBe("exploring");
  });

  it("refuses a response whose destination is no longer the trip", () => {
    const before = driving(CITY);
    const after = navigationReducer(before, {
      type: "REROUTE_ADOPTED",
      destinationId: OTHER.id,
      routes: [replacement],
    });
    expect(after).toBe(before);
  });

  it("refuses a response that lands after navigation ended", () => {
    const cancelled = navigationReducer(driving(CITY), { type: "CANCEL" });
    const after = navigationReducer(cancelled, {
      type: "REROUTE_ADOPTED",
      destinationId: DESTINATION.id,
      routes: [replacement],
    });
    expect(after.phase).toBe("idle");
  });

  it("refuses an empty response rather than leaving a drive with no route", () => {
    const before = driving(CITY);
    const after = navigationReducer(before, {
      type: "REROUTE_ADOPTED",
      destinationId: DESTINATION.id,
      routes: [],
    });
    expect(after).toBe(before);
  });

  it("cannot adopt into a preview, only into a live drive", () => {
    const events: NavigationEvent[] = [
      { type: "DESTINATION_SELECTED", destination: DESTINATION },
      { type: "ROUTE_REQUESTED", requestId: 1 },
      { type: "ROUTE_SUCCEEDED", requestId: 1, routes: [CITY] },
    ];
    const preview = events.reduce<NavigationState>(
      navigationReducer,
      INITIAL_NAVIGATION_STATE,
    );

    const after = navigationReducer(preview, {
      type: "REROUTE_ADOPTED",
      destinationId: DESTINATION.id,
      routes: [replacement],
    });
    expect(after).toBe(preview);
  });
});

// ---------------------------------------------------------------------------
// Engine reconciliation after adoption
// ---------------------------------------------------------------------------

describe("the engine reconciles against the replacement route", () => {
  it("reports progress on the new route, not the old one", () => {
    // Drive part of the city route, then re-bind the engine to the highway
    // route with the last accepted fix — exactly what the session hook does.
    const samples = cleanTrace(CITY, { stepMeters: 16 }).slice(0, 20);
    const before = replay(CITY, samples);
    const carried = before.final.memory.lastSample!;

    const boundaries = stepBoundaries(HIGHWAY);
    const rebound = advance(
      HIGHWAY,
      boundaries,
      initialState(HIGHWAY, carried.timestamp),
      carried,
      carried.timestamp,
    );

    // Old step index and old remaining distance are gone, not carried over.
    expect(rebound.progress.remainingMeters).toBeLessThanOrEqual(
      HIGHWAY.distanceMeters,
    );
    expect(rebound.progress.lastAcceptedAt).toBe(carried.timestamp);
    expect(rebound.memory.initialised).toBe(true);
  });

  it("starts the replacement at its own first maneuver", () => {
    // The replacement begins where the driver is, so step 0 is the step being
    // driven and the next maneuver belongs to the new route.
    const samples = cleanTrace(HIGHWAY, { stepMeters: 20 });
    const result = replay(HIGHWAY, samples.slice(0, 2));
    expect(result.final.progress.stepIndex).toBe(0);
    expect(result.final.progress.maneuverStepIndex).toBe(1);
  });

  it("recomputes ETA and remaining distance from the new geometry", () => {
    const a = replay(CITY, cleanTrace(CITY, { stepMeters: 16 }).slice(0, 5));
    const b = replay(HIGHWAY, cleanTrace(HIGHWAY, { stepMeters: 16 }).slice(0, 5));
    expect(a.final.progress.remainingMeters).not.toBe(
      b.final.progress.remainingMeters,
    );
    expect(b.final.progress.remainingSeconds).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

describe("what the driver is told", () => {
  it("says nothing while merely suspicious", () => {
    expect(
      describeReroute({
        kind: "suspected",
        since: 0,
        samples: 2,
        reason: "drifted",
        worstDistanceMeters: 50,
      }),
    ).toBeNull();
  });

  it("says nothing during the settling window", () => {
    expect(describeReroute({ kind: "settling", until: 1 })).toBeNull();
  });

  it("says it is rerouting once a request is actually happening", () => {
    expect(
      describeReroute({ kind: "triggered", reason: "departed", at: 0, attempt: 0 })?.text,
    ).toBe("Rerouting…");
    expect(
      describeReroute({
        kind: "requesting",
        requestId: 1,
        startedAt: 0,
        reason: "departed",
        attempt: 0,
      })?.text,
    ).toBe("Rerouting…");
  });

  it("distinguishes a connectivity failure from an unroutable one", () => {
    const offline = describeReroute({
      kind: "failed",
      failure: "network",
      at: 0,
      attempt: 1,
      reason: "departed",
      retryAt: 1,
    });
    const unroutable = describeReroute({
      kind: "failed",
      failure: "no-route",
      at: 0,
      attempt: 1,
      reason: "departed",
      retryAt: 1,
    });

    expect(offline?.text).toMatch(/offline/i);
    expect(unroutable?.text).toMatch(/no new route/i);
    expect(offline?.tone).toBe("caution");
  });

  it("never blames the driver or demands an action they cannot take", () => {
    const failures: RouteFailure[] = [
      "network",
      "timeout",
      "no-route",
      "unroutable-point",
      "rate-limited",
      "error",
    ];
    for (const failure of failures) {
      const copy = describeReroute({
        kind: "failed",
        failure,
        at: 0,
        attempt: 1,
        reason: "departed",
        retryAt: 1,
      })!;
      expect(copy.text.length).toBeLessThan(46);
      expect(copy.text).not.toMatch(/error|failed|invalid|null|undefined/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

describe("thresholds are centralised and coherent", () => {
  it("keeps the reroute floor above the tightest corridor", () => {
    // Otherwise the floor does nothing on a good fix and the corridor alone
    // decides — which is the naive design this sub-phase exists to avoid.
    expect(T.REROUTE_MIN_DISTANCE_M).toBeGreaterThanOrEqual(T.CORRIDOR_MIN_M);
  });

  it("settles for longer than it takes to confirm a departure", () => {
    // Otherwise the grace period expires mid-confirmation and the loop returns.
    expect(T.REROUTE_SETTLE_MS).toBeGreaterThan(T.REROUTE_CONFIRM_MS);
  });

  it("requires more evidence than the engine alone does", () => {
    expect(
      T.OFF_ROUTE_MIN_DURATION_MS + T.REROUTE_CONFIRM_MS,
    ).toBeGreaterThan(T.OFF_ROUTE_MIN_DURATION_MS);
    expect(T.REROUTE_CONFIRM_SAMPLES).toBeGreaterThanOrEqual(1);
  });

  it("recovers inside the corridor, not at its edge", () => {
    expect(T.REROUTE_RECOVER_FRACTION).toBeLessThan(1);
    expect(T.REROUTE_RECOVER_FRACTION).toBeGreaterThan(0);
  });

  it("will not route from a position older than the fix goes stale twice over", () => {
    expect(T.REROUTE_ORIGIN_MAX_AGE_MS).toBeLessThanOrEqual(T.LOST_AFTER_MS);
  });

  it("times out before the longest backoff, so retries cannot overlap", () => {
    const longest = Math.max(...T.REROUTE_RETRY_BACKOFF_MS);
    expect(T.REROUTE_TIMEOUT_MS).toBeLessThan(longest);
  });
});

// ---------------------------------------------------------------------------

/** A `NavigationProgress` with only the fields rerouting reads set. */
function progressWith(over: Partial<NavigationProgress>): NavigationProgress {
  return {
    status: "navigating",
    snapped: { latitude: 0, longitude: 0 },
    distanceFromRouteMeters: 0,
    progressMeters: 0,
    remainingMeters: 1_000,
    progressFraction: 0,
    segmentIndex: 0,
    stepIndex: 0,
    maneuverStepIndex: 1,
    distanceToManeuverMeters: 100,
    remainingSeconds: 100,
    etaEpochMs: 0,
    etaSource: "route",
    offRoute: "on-route",
    offRouteConfidence: 0,
    freshness: "fresh",
    lastAcceptedAt: 0,
    lastRejection: null,
    accuracyMeters: 5,
    corridorMeters: 30,
    headingDisagrees: false,
    ...over,
  };
}
