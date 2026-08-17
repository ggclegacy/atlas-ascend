import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapDirectionsRoutes } from "@/routing/mapbox/directions";
import { hydrateRoute } from "@/routing/wire";
import type { AtlasRoute } from "@/routing/types";
import { distanceMeters } from "@/map/types";
import {
  advance,
  advanceStep,
  corridorFor,
  initialState,
  matchToRoute,
  offRouteConfidence,
  remainingSeconds,
  shouldConsiderReroute,
  stepBoundaries,
  tick,
} from "@/navigation/engine";
import { bearingDifference, projectOntoSegment } from "@/navigation/geometry";
import {
  cleanTrace,
  excursionTrace,
  gpsJumpTrace,
  parallelRoadTrace,
  replay,
  stationaryTrace,
  tunnelTrace,
  walkRoute,
  wrongTurnTrace,
} from "@/navigation/simulator";
import * as T from "@/navigation/thresholds";

/**
 * THE NAVIGATION ENGINE.
 *
 * Every scenario below replays timestamped fixes through the real `advance`,
 * not a model of it. The routes are the real captured Mapbox responses from
 * Sub-phase 1.
 *
 * The assertions that matter most are the negative ones. Detecting a wrong
 * turn is straightforward; *not* detecting one while a driver crawls through
 * an urban canyon going exactly the right way is the hard part, and it is the
 * failure that destroys trust fastest — it is wrong precisely when the driver
 * is most certain they are right.
 */

const FIXTURES = join(new URL("..", import.meta.url).pathname, "tests/fixtures/directions");

function loadRoute(name: string, index = 0): AtlasRoute {
  const raw = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));
  return hydrateRoute(mapDirectionsRoutes(raw, "test", 1_700_000_000_000)[index]!);
}

const CITY = loadRoute("austin-two-alternatives");
const HIGHWAY = loadRoute("highway-ramps");

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

describe("segment projection", () => {
  const a = { latitude: 30.0, longitude: -97.0 };
  const b = { latitude: 30.0, longitude: -96.999 };

  it("projects onto the segment, not to the nearest vertex", () => {
    // THE REASON THIS EXISTS. Motorway vertices can be 200m apart, so the
    // nearest *vertex* to a car mid-segment may be 100m away while the car is
    // exactly on the line. Nearest-vertex logic reroutes a driver going
    // precisely the right way.
    const midway = { latitude: 30.0, longitude: -96.9995 };
    const projection = projectOntoSegment(midway, a, b);
    expect(projection.t).toBeCloseTo(0.5, 2);
    expect(projection.distanceMeters).toBeLessThan(1);
  });

  it("measures perpendicular distance", () => {
    const offset = { latitude: 30.0009, longitude: -96.9995 }; // ~100m north
    const projection = projectOntoSegment(offset, a, b);
    expect(projection.distanceMeters).toBeGreaterThan(80);
    expect(projection.distanceMeters).toBeLessThan(120);
  });

  it("clamps to the segment ends", () => {
    const before = { latitude: 30.0, longitude: -97.001 };
    expect(projectOntoSegment(before, a, b).t).toBe(0);
    const after = { latitude: 30.0, longitude: -96.998 };
    expect(projectOntoSegment(after, a, b).t).toBe(1);
  });

  it("survives the zero-length segments real routes contain", () => {
    // Consecutive steps share their boundary vertex, so duplicate points are
    // ordinary. A naive projection divides by zero here.
    const projection = projectOntoSegment({ latitude: 30.001, longitude: -97 }, a, a);
    expect(Number.isFinite(projection.distanceMeters)).toBe(true);
    expect(projection.t).toBe(0);
  });
});

describe("bearing difference", () => {
  it("wraps around north", () => {
    // Naive subtraction calls these 340 apart, which reads as driving the
    // wrong way every time a route crosses due north.
    expect(bearingDifference(350, 10)).toBe(20);
    expect(bearingDifference(10, 350)).toBe(20);
  });

  it("never exceeds 180", () => {
    for (const [a, b] of [[0, 180], [0, 181], [90, 270], [359, 1]]) {
      expect(bearingDifference(a!, b!)).toBeLessThanOrEqual(180);
    }
  });
});

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

describe("route matching", () => {
  it("finds a point on the route with near-zero offset", () => {
    const truth = walkRoute(CITY, 25);
    const target = truth[6]!;
    const match = matchToRoute(CITY, target.point, null)!;
    expect(match.distanceMeters).toBeLessThan(2);
    expect(match.progressMeters).toBeGreaterThan(target.alongMeters - 30);
    expect(match.progressMeters).toBeLessThan(target.alongMeters + 30);
  });

  it("agrees with a full scan when using the local window", () => {
    const truth = walkRoute(CITY, 25);
    for (const point of truth.slice(2, 12)) {
      const windowed = matchToRoute(CITY, point.point, point.alongMeters)!;
      const global = matchToRoute(CITY, point.point, null)!;
      expect(windowed.progressMeters).toBeCloseTo(global.progressMeters, 0);
    }
  });

  it("escapes a stale window rather than reporting a false distance", () => {
    // If the window is wrong the best match inside it is poor, and believing
    // it would report a driver on the route as hundreds of metres off it.
    const truth = walkRoute(CITY, 25);
    const late = truth[truth.length - 3]!;
    const match = matchToRoute(CITY, late.point, 0)!;
    expect(match.distanceMeters).toBeLessThan(5);
  });
});

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

describe("step advancement", () => {
  const boundaries = stepBoundaries(CITY);

  it("covers the whole route contiguously", () => {
    expect(boundaries[0]!.startMeters).toBe(0);
    for (let i = 1; i < boundaries.length; i++) {
      expect(boundaries[i]!.startMeters).toBeCloseTo(boundaries[i - 1]!.endMeters, 3);
    }
  });

  it("never gives a step back", () => {
    // A maneuver card that flips back to the turn you already made is worse
    // than one that is briefly early.
    let index = 0;
    for (const progress of [0, 100, 400, 380, 900, 850, 1500]) {
      const next = advanceStep(boundaries, progress, index);
      expect(next).toBeGreaterThanOrEqual(index);
      index = next;
    }
  });

  it("steps over zero-length steps instead of settling in one", () => {
    const withEmpty = [
      { stepIndex: 0, startMeters: 0, endMeters: 100 },
      { stepIndex: 1, startMeters: 100, endMeters: 100 },
      { stepIndex: 2, startMeters: 100, endMeters: 400 },
    ];
    expect(advanceStep(withEmpty, 150, 0)).toBe(2);
  });

  it("advances on progress along the route, not straight-line distance", () => {
    // A hairpin brings the car physically close to a later maneuver long
    // before it reaches it along the road.
    const trace = cleanTrace(CITY, { stepMeters: 12 });
    const { states } = replay(CITY, trace);
    let previous = 0;
    for (const state of states) {
      expect(state.progress.stepIndex).toBeGreaterThanOrEqual(previous);
      previous = state.progress.stepIndex;
    }
  });
});

// ---------------------------------------------------------------------------
// A · Clean drive
// ---------------------------------------------------------------------------

describe("A — a clean drive", () => {
  const { states, final } = replay(CITY, cleanTrace(CITY));

  it("advances progress monotonically to the end", () => {
    let previous = -1;
    for (const state of states) {
      expect(state.progress.progressMeters).toBeGreaterThanOrEqual(previous - 0.001);
      previous = state.progress.progressMeters;
    }
    expect(final.progress.progressFraction).toBeGreaterThan(0.97);
    expect(final.progress.remainingMeters).toBeLessThan(T.ARRIVAL_RADIUS_M + 20);
  });

  it("never leaves the route", () => {
    for (const state of states) {
      expect(state.progress.offRoute).toBe("on-route");
      expect(state.progress.offRouteConfidence).toBe(0);
    }
  });

  it("works through to the final maneuver", () => {
    // Not `length - 1`: the last step is "arrive", which is zero-length at the
    // very end of the line, and no fix ever lands exactly on the destination.
    const steps = stepBoundaries(CITY).length;
    expect(final.progress.stepIndex).toBeGreaterThanOrEqual(steps - 2);
    expect(final.progress.stepIndex).toBeLessThan(steps);
  });

  it("reports arrival at the end", () => {
    expect(final.progress.status).toBe("arrived");
  });

  it("counts down remaining time monotonically", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const state of states) {
      expect(state.progress.remainingSeconds).toBeLessThanOrEqual(previous + 0.001);
      previous = state.progress.remainingSeconds;
    }
    expect(final.progress.remainingSeconds).toBeLessThan(30);
  });

  it("keeps distance-to-maneuver inside the current step", () => {
    const boundaries = stepBoundaries(CITY);
    for (const state of states) {
      const boundary = boundaries[state.progress.stepIndex]!;
      const span = boundary.endMeters - boundary.startMeters;
      expect(state.progress.distanceToManeuverMeters).toBeGreaterThanOrEqual(0);
      expect(state.progress.distanceToManeuverMeters).toBeLessThanOrEqual(span + 1);
    }
  });
});

// ---------------------------------------------------------------------------
// B · Urban noise
// ---------------------------------------------------------------------------

describe("B — 30–60m urban GPS noise", () => {
  it("never falsely declares off-route", () => {
    // THE ASSERTION THAT MATTERS MOST. This is a driver going exactly the
    // right way through a canyon of tall buildings.
    for (const seed of [1, 7, 42, 999, 31337]) {
      const trace = cleanTrace(CITY, {
        noiseMeters: 30,
        accuracyMeters: 22,
        seed,
      });
      const { states } = replay(CITY, trace);
      for (const state of states) {
        expect(state.progress.offRoute, `seed ${seed}`).not.toBe("off-route");
      }
      expect(shouldConsiderReroute(states[states.length - 1]!.progress)).toBe(false);
    }
  });

  it("still finishes the route with sane progress", () => {
    const { states, final } = replay(
      CITY,
      cleanTrace(CITY, { noiseMeters: 30, accuracyMeters: 22, seed: 7 }),
    );
    expect(final.progress.progressFraction).toBeGreaterThan(0.9);

    // Progress must not lurch: with a 14m step, noise should never produce a
    // jump several times the real distance travelled.
    for (let i = 1; i < states.length; i++) {
      const delta =
        states[i]!.progress.progressMeters - states[i - 1]!.progress.progressMeters;
      expect(delta).toBeLessThan(80);
    }
  });

  it("keeps maneuver advancement sane under noise", () => {
    const { states } = replay(
      CITY,
      cleanTrace(CITY, { noiseMeters: 40, accuracyMeters: 28, seed: 3 }),
    );
    let previous = 0;
    for (const state of states) {
      expect(state.progress.stepIndex - previous).toBeLessThanOrEqual(2);
      previous = state.progress.stepIndex;
    }
  });

  it("widens the corridor as accuracy degrades", () => {
    expect(corridorFor(3)).toBe(T.CORRIDOR_MIN_M);
    expect(corridorFor(30)).toBeGreaterThan(T.CORRIDOR_MIN_M);
    expect(corridorFor(200)).toBe(T.CORRIDOR_MAX_M);
  });

  it("rejects fixes too vague to mean anything", () => {
    const trace = cleanTrace(CITY, { accuracyMeters: T.MAX_USABLE_ACCURACY_M + 20 });
    const { final } = replay(CITY, trace);
    expect(final.progress.lastRejection).toBe("accuracy");
    expect(final.progress.progressMeters).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C · Stationary jitter
// ---------------------------------------------------------------------------

describe("C — stopped at a light with GPS wandering", () => {
  it("does not invent progress", () => {
    // The ratchet: each wander looks like 30 km/h, and a one-sided backward
    // tolerance keeps the forward half. Over a long light that is hundreds of
    // phantom metres.
    const { states, final } = replay(
      CITY,
      stationaryTrace(CITY, { atMeters: 300, samples: 60, noiseMeters: 15, reportSpeed: false }),
    );
    const first = states[3]!.progress.progressMeters;
    expect(Math.abs(final.progress.progressMeters - first)).toBeLessThan(25);
  });

  it("does not advance the maneuver", () => {
    const { states, final } = replay(
      CITY,
      stationaryTrace(CITY, { atMeters: 300, samples: 60, reportSpeed: false }),
    );
    expect(final.progress.stepIndex).toBe(states[3]!.progress.stepIndex);
  });

  it("does not go off-route", () => {
    const { states } = replay(
      CITY,
      stationaryTrace(CITY, { atMeters: 300, samples: 60, noiseMeters: 20, reportSpeed: false }),
    );
    for (const state of states) {
      expect(state.progress.offRoute).not.toBe("off-route");
    }
  });

  it("reports the stationary status when speed is available", () => {
    const { final } = replay(
      CITY,
      stationaryTrace(CITY, { atMeters: 300, samples: 20, reportSpeed: true }),
    );
    expect(final.progress.status).toBe("stationary");
  });

  it("ignores heading from a parked device", () => {
    // A stationary phone reports whatever direction the last jitter pointed.
    const { states } = replay(
      CITY,
      stationaryTrace(CITY, {
        atMeters: 300,
        samples: 40,
        reportSpeed: true,
        reportHeading: true,
      }),
    );
    for (const state of states) {
      expect(state.progress.offRouteConfidence).toBeLessThan(T.OFF_ROUTE_LIKELY_AT);
    }
  });
});

// ---------------------------------------------------------------------------
// D · Tunnel
// ---------------------------------------------------------------------------

describe("D — a tunnel", () => {
  it("degrades honestly rather than extrapolating", () => {
    const route = CITY;
    const boundaries = stepBoundaries(route);
    const trace = cleanTrace(route, { stepMeters: 14 });
    const cut = trace[10]!;

    let state = initialState(route, cut.timestamp);
    for (const sample of trace.slice(0, 11)) {
      state = advance(route, boundaries, state, sample, sample.timestamp);
    }
    const beforeTunnel = state.progress.progressMeters;

    // 30 seconds of silence.
    state = tick(state, cut.timestamp + 30_000);
    expect(state.progress.freshness).toBe("lost");
    expect(state.progress.progressMeters).toBe(beforeTunnel);
    expect(shouldConsiderReroute(state.progress)).toBe(false);
  });

  it("recovers cleanly when the signal returns", () => {
    const { states, final } = replay(CITY, tunnelTrace(CITY, { gapStartMeters: 200, gapMeters: 400 }));

    // The fix after the gap must not be read as a teleport, and must not put
    // the driver off-route.
    for (const state of states) {
      expect(state.progress.offRoute).not.toBe("off-route");
    }
    expect(final.progress.progressFraction).toBeGreaterThan(0.9);
  });

  it("passes through stale before lost", () => {
    const route = CITY;
    const boundaries = stepBoundaries(route);
    const trace = cleanTrace(route);

    let state = initialState(route, trace[0]!.timestamp);
    for (const sample of trace.slice(0, 5)) {
      state = advance(route, boundaries, state, sample, sample.timestamp);
    }
    const at = trace[4]!.timestamp;

    expect(tick(state, at + 1_000).progress.freshness).toBe("fresh");
    expect(tick(state, at + T.STALE_AFTER_MS + 1_000).progress.freshness).toBe("stale");
    expect(tick(state, at + T.LOST_AFTER_MS + 1_000).progress.freshness).toBe("lost");
  });
});

// ---------------------------------------------------------------------------
// E · Wrong turn
// ---------------------------------------------------------------------------

describe("E — a genuine wrong turn", () => {
  const trace = wrongTurnTrace(CITY, { turnAtMeters: 300, departMeters: 250 });
  const { states, final } = replay(CITY, trace);

  it("is detected reliably", () => {
    expect(final.progress.offRoute).toBe("off-route");
    expect(final.progress.offRouteConfidence).toBe(1);
    expect(shouldConsiderReroute(final.progress)).toBe(true);
  });

  it("is not declared on the first divergent sample", () => {
    // One swerve, one bad fix, or one lane change must never be enough.
    const firstOff = states.findIndex((s) => s.progress.offRoute === "off-route");
    const firstDivergent = states.findIndex(
      (s) => s.progress.distanceFromRouteMeters > s.progress.corridorMeters,
    );
    expect(firstOff).toBeGreaterThan(firstDivergent);
    expect(firstOff - firstDivergent).toBeGreaterThanOrEqual(
      T.OFF_ROUTE_MIN_SAMPLES - 1,
    );
  });

  it("is detected fast enough to be useful", () => {
    const firstOff = states.findIndex((s) => s.progress.offRoute === "off-route");
    const firstDivergent = states.findIndex(
      (s) => s.progress.distanceFromRouteMeters > s.progress.corridorMeters,
    );
    const elapsed =
      states[firstOff]!.progress.lastAcceptedAt! -
      states[firstDivergent]!.progress.lastAcceptedAt!;
    // A driver who has to be told promptly, but not so promptly that noise
    // qualifies. Ten seconds is roughly one city block at 30mph.
    expect(elapsed).toBeLessThanOrEqual(12_000);
  });

  it("escalates through the intermediate states", () => {
    const seen = new Set(states.map((s) => s.progress.offRoute));
    expect(seen.has("uncertain") || seen.has("likely-off-route")).toBe(true);
  });

  it("still detects it without heading or speed", () => {
    const bare = wrongTurnTrace(CITY, {
      turnAtMeters: 300,
      departMeters: 300,
      reportHeading: false,
      reportSpeed: false,
    });
    expect(replay(CITY, bare).final.progress.offRoute).toBe("off-route");
  });
});

// ---------------------------------------------------------------------------
// F · Excursion and return
// ---------------------------------------------------------------------------

describe("F — leaving the corridor and coming straight back", () => {
  const { states, final } = replay(CITY, excursionTrace(CITY, { atMeters: 300, peakMeters: 55 }));

  it("does not reroute for a clipped corner", () => {
    for (const state of states) {
      expect(state.progress.offRoute).not.toBe("off-route");
    }
  });

  it("clears the accumulated suspicion once back on the line", () => {
    expect(final.progress.offRoute).toBe("on-route");
    expect(final.progress.offRouteConfidence).toBe(0);
  });

  it("recovers faster than it accumulates", () => {
    // A driver who comes straight back should not carry the doubt for long.
    const peak = Math.max(...states.map((s) => s.progress.offRouteConfidence));
    const afterPeak = states.slice(states.findIndex((s) => s.progress.offRouteConfidence === peak));
    const settled = afterPeak.findIndex((s) => s.progress.offRouteConfidence === 0);
    expect(settled).toBeGreaterThan(0);
    expect(settled).toBeLessThan(8);
  });
});

// ---------------------------------------------------------------------------
// G · Parallel road
// ---------------------------------------------------------------------------

describe("G — a road running parallel to the route", () => {
  it("does not instantly snap or instantly reroute", () => {
    // The genuinely ambiguous case: a frontage road or the opposite
    // carriageway. Position disagrees consistently; heading agrees perfectly.
    const { states } = replay(CITY, parallelRoadTrace(CITY, { offsetMeters: 35 }));
    const firstOff = states.findIndex((s) => s.progress.offRoute === "off-route");
    expect(firstOff === -1 || firstOff > T.OFF_ROUTE_MIN_SAMPLES).toBe(true);
  });

  it("keeps progress advancing along the route rather than stalling", () => {
    const { states, final } = replay(CITY, parallelRoadTrace(CITY, { offsetMeters: 30 }));
    expect(final.progress.progressMeters).toBeGreaterThan(
      states[2]!.progress.progressMeters,
    );
  });

  it("treats a close parallel road as on-route, which is the honest answer", () => {
    // At 20m the two roads are inside GPS error of each other. Claiming to
    // know which one the car is on would be invention.
    const { states } = replay(CITY, parallelRoadTrace(CITY, { offsetMeters: 20 }));
    for (const state of states) {
      expect(state.progress.offRoute).toBe("on-route");
    }
  });
});

// ---------------------------------------------------------------------------
// H · One-off GPS jump
// ---------------------------------------------------------------------------

describe("H — a single wild fix", () => {
  const { states, final } = replay(CITY, gpsJumpTrace(CITY, { jumpMeters: 3_000 }));

  it("is rejected rather than believed", () => {
    const rejected = states.filter((s) => s.progress.lastRejection === "implausible-jump");
    expect(rejected.length).toBeGreaterThan(0);
  });

  it("does not drag progress with it", () => {
    for (let i = 1; i < states.length; i++) {
      const delta =
        states[i]!.progress.progressMeters - states[i - 1]!.progress.progressMeters;
      expect(delta).toBeLessThan(100);
    }
  });

  it("does not trigger off-route", () => {
    for (const state of states) {
      expect(state.progress.offRoute).not.toBe("off-route");
    }
    expect(final.progress.progressFraction).toBeGreaterThan(0.9);
  });

  it("rejects fixes that arrive out of order", () => {
    const trace = cleanTrace(CITY);
    const shuffled = [...trace.slice(0, 5), trace[1]!];
    const { final: out } = replay(CITY, shuffled);
    expect(out.progress.lastRejection).toBe("out-of-order");
  });
});

// ---------------------------------------------------------------------------
// Backward movement
// ---------------------------------------------------------------------------

describe("backward movement", () => {
  const boundaries = stepBoundaries(CITY);

  /** Drives forward a little, then feeds one fix that projects behind. */
  function backUpBy(metres: number) {
    const truth = walkRoute(CITY, 10);
    const start = 1_700_000_000_000;

    let state = initialState(CITY, start);
    for (let i = 0; i < 12; i++) {
      const t = truth[i]!;
      state = advance(
        CITY,
        boundaries,
        state,
        {
          coordinate: t.point,
          timestamp: start + i * 1000,
          accuracyMeters: 5,
          headingDegrees: t.bearing,
          speedMps: 10,
        },
        start + i * 1000,
      );
    }
    const before = state.progress.progressMeters;

    // A point genuinely behind the current position, still on the line.
    const behindAlong = Math.max(0, before - metres);
    const behind = walkRoute(CITY, 1).find((t) => t.alongMeters >= behindAlong)!;

    state = advance(
      CITY,
      boundaries,
      state,
      {
        coordinate: behind.point,
        timestamp: start + 12_000,
        accuracyMeters: 5,
        headingDegrees: behind.bearing,
        speedMps: 10,
      },
      start + 12_000,
    );

    return { before, after: state.progress.progressMeters };
  }

  it("honours a small genuine correction backwards", () => {
    // Progress must be able to move back. Refusing all backward movement
    // makes it ratchet forward on noise and never settle — the maneuver
    // distance then only ever shrinks, including while stopped.
    const { before, after } = backUpBy(8);
    expect(after).toBeLessThan(before);
    expect(before - after).toBeGreaterThan(3);
  });

  it("clamps a large backward jump to the tolerance", () => {
    // 200m backwards in one second is a projection artefact or a driver who
    // has left the route; the off-route logic owns the latter.
    const { before, after } = backUpBy(200);
    expect(before - after).toBeLessThanOrEqual(T.BACKWARD_TOLERANCE_M + 1);
    expect(before - after).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Weak evidence
// ---------------------------------------------------------------------------

describe("degraded fixes cannot declare a wrong turn on their own", () => {
  it("stays short of off-route when accuracy is poor, however far off it looks", () => {
    // A fix accurate to ±40m that lands 90m off the line is not evidence of a
    // wrong turn; it is evidence of a bad fix. Rerouting on it is how a driver
    // going exactly the right way through a canyon gets sent round the block.
    const trace = wrongTurnTrace(CITY, {
      turnAtMeters: 300,
      departMeters: 400,
      accuracyMeters: T.DEGRADED_ACCURACY_M + 15,
      noiseMeters: 10,
    });
    const { states } = replay(CITY, trace);
    for (const state of states) {
      expect(state.progress.offRoute).not.toBe("off-route");
      expect(shouldConsiderReroute(state.progress)).toBe(false);
    }
  });

  it("detects the same wrong turn once the fixes are good", () => {
    // The control: identical geometry, credible accuracy.
    const trace = wrongTurnTrace(CITY, {
      turnAtMeters: 300,
      departMeters: 400,
      accuracyMeters: 6,
      noiseMeters: 10,
    });
    expect(replay(CITY, trace).final.progress.offRoute).toBe("off-route");
  });
});

// ---------------------------------------------------------------------------
// ETA
// ---------------------------------------------------------------------------

describe("remaining time", () => {
  const boundaries = stepBoundaries(CITY);

  it("is the provider's own step durations, not a proportion of the route", () => {
    // Scaling the whole-route duration by remaining distance is visibly wrong
    // on any route with a motorway in it: the last mile of surface streets
    // takes far longer per metre than the thirty before it.
    const atStart = remainingSeconds(CITY, boundaries, 0, 0);
    expect(atStart).toBeCloseTo(CITY.durationSeconds, 0);
  });

  it("falls to zero at the end", () => {
    const last = boundaries.length - 1;
    expect(
      remainingSeconds(CITY, boundaries, CITY.distanceMeters, last),
    ).toBeLessThan(1);
  });

  it("decreases monotonically along the route", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let m = 0; m <= CITY.distanceMeters; m += 50) {
      const index = advanceStep(boundaries, m, 0);
      const seconds = remainingSeconds(CITY, boundaries, m, index);
      expect(seconds).toBeLessThanOrEqual(previous + 0.001);
      previous = seconds;
    }
  });

  it("labels an old route's estimate as stale rather than presenting it as current", () => {
    const { final } = replay(CITY, cleanTrace(CITY));
    expect(final.progress.etaSource).toBe("route");

    const old: AtlasRoute = { ...CITY, requestedAt: 0 };
    const { final: stale } = replay(old, cleanTrace(old));
    expect(stale.progress.etaSource).toBe("route-stale");
  });
});

// ---------------------------------------------------------------------------
// Confidence model
// ---------------------------------------------------------------------------

describe("off-route confidence", () => {
  const base = {
    samples: 1,
    durationMs: 0,
    distance: 40,
    previousDistance: 40,
    corridor: 30,
    headingPenalty: false,
  };

  it("is never conclusive from a single sample", () => {
    expect(offRouteConfidence(base)).toBeLessThan(T.OFF_ROUTE_CERTAIN_AT);
  });

  it("needs both enough samples and enough time", () => {
    // A 5Hz device reaches three samples in 600ms — one swerve, not a turn.
    const manySamplesNoTime = offRouteConfidence({ ...base, samples: 10, durationMs: 200 });
    expect(manySamplesNoTime).toBeLessThan(T.OFF_ROUTE_CERTAIN_AT);
  });

  it("strengthens when the driver is getting further away", () => {
    const steady = offRouteConfidence({ ...base, samples: 2, durationMs: 2000 });
    const leaving = offRouteConfidence({
      ...base,
      samples: 2,
      durationMs: 2000,
      distance: 90,
      previousDistance: 40,
    });
    expect(leaving).toBeGreaterThan(steady);
  });

  it("strengthens when the heading disagrees with the route", () => {
    const agreeing = offRouteConfidence({ ...base, samples: 2, durationMs: 2000 });
    const disagreeing = offRouteConfidence({
      ...base,
      samples: 2,
      durationMs: 2000,
      headingPenalty: true,
    });
    expect(disagreeing).toBeGreaterThan(agreeing);
  });

  it("stays within 0 and 1", () => {
    const extreme = offRouteConfidence({
      samples: 100,
      durationMs: 600_000,
      distance: 5_000,
      previousDistance: 10,
      corridor: 30,
      headingPenalty: true,
    });
    expect(extreme).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe("performance on a long route", () => {
  it("stays far inside a 1Hz budget", () => {
    // The engine runs on every fix on a phone that is also rendering a map at
    // 60fps. The local-window search is what makes this cheap; a full scan per
    // fix would be O(vertices) several times a second.
    const trace = cleanTrace(HIGHWAY, { stepMeters: 20 });
    const { elapsedMs, states } = replay(HIGHWAY, trace);
    const perSample = elapsedMs / Math.max(1, states.length);

    expect(HIGHWAY.geometry.length).toBeGreaterThan(400);
    expect(states.length).toBeGreaterThan(100);
    // Generous by three orders of magnitude, so this fails only on a genuine
    // algorithmic regression rather than on a slow CI machine.
    expect(perSample).toBeLessThan(5);
  });

  it("completes a long route correctly, not just quickly", () => {
    const { final } = replay(HIGHWAY, cleanTrace(HIGHWAY, { stepMeters: 20 }));
    expect(final.progress.progressFraction).toBeGreaterThan(0.97);
    expect(final.progress.offRoute).toBe("on-route");
  });
});

// ---------------------------------------------------------------------------
// Degenerate input
// ---------------------------------------------------------------------------

describe("degenerate input", () => {
  it("refuses a malformed coordinate", () => {
    const trace = cleanTrace(CITY).slice(0, 3);
    trace[1] = { ...trace[1]!, coordinate: { latitude: Number.NaN, longitude: -97 } };
    const { states } = replay(CITY, trace);
    expect(states[1]!.progress.lastRejection).toBe("malformed");
  });

  it("survives a route with no usable geometry", () => {
    const empty: AtlasRoute = { ...CITY, geometry: [], cumulative: [] };
    expect(() => replay(empty, cleanTrace(CITY).slice(0, 3))).not.toThrow();
  });

  it("starts from a sane state before any fix arrives", () => {
    const state = initialState(CITY, 1_000);
    expect(state.progress.freshness).toBe("lost");
    expect(state.progress.progressMeters).toBe(0);
    expect(state.progress.remainingMeters).toBe(CITY.distanceMeters);
    expect(shouldConsiderReroute(state.progress)).toBe(false);
  });

  it("keeps the snapped point on the route line", () => {
    const { states } = replay(CITY, cleanTrace(CITY, { noiseMeters: 25, seed: 5 }));
    for (const state of states.slice(1)) {
      const match = matchToRoute(CITY, state.progress.snapped, null)!;
      expect(match.distanceMeters).toBeLessThan(2);
    }
  });
});
