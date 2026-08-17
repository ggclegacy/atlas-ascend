import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mapDirectionsRoutes } from "@/routing/mapbox/directions";
import { hydrateRoute } from "@/routing/wire";
import type { AtlasRoute, AtlasManeuver, AtlasManeuverKind } from "@/routing/types";
import {
  CAMERA,
  cameraChanged,
  courseBearing,
  followCamera,
  followPadding,
  navigationPitch,
  navigationZoom,
  remainingRouteBounds,
} from "@/navigation/camera";
import {
  formatManeuverDistance,
  isManeuverImminent,
  maneuverIcon,
  presentFollowing,
  presentManeuver,
} from "@/navigation/maneuver";
import {
  INITIAL_NAVIGATION_STATE,
  type NavigationEvent,
  type NavigationState,
  isGuiding,
  navigationReducer,
  sessionOf,
  showsRoute,
} from "@/navigation/machine";
import { createWakeLock, isWakeLockSupported } from "@/navigation/wakeLock";
import { stepBoundaries } from "@/navigation/engine";
import { cleanTrace, replay, stationaryTrace, walkRoute } from "@/navigation/simulator";
import { bearingDifference } from "@/navigation/geometry";
import type { Destination } from "@/destinations/types";

/**
 * ACTIVE NAVIGATION.
 *
 * The camera and the maneuver card are the two things a driver looks at, and
 * neither can be judged from a screenshot alone — a camera that is stable in
 * one frame may be spinning across ten. So the camera tests replay real traces
 * and assert on the *sequence*.
 */

const FIXTURES = join(new URL("..", import.meta.url).pathname, "tests/fixtures/directions");
const load = (n: string): AtlasRoute =>
  hydrateRoute(mapDirectionsRoutes(JSON.parse(readFileSync(join(FIXTURES, `${n}.json`), "utf8")), "t", 1_700_000_000_000)[0]!);

const CITY = load("austin-two-alternatives");
const HIGHWAY = load("highway-ramps");
const VIEWPORT = { width: 390, height: 844 };
const SAFE = { top: 59, bottom: 34, left: 0, right: 0 };

// ---------------------------------------------------------------------------
// Maneuver icons
// ---------------------------------------------------------------------------

function maneuver(over: Partial<AtlasManeuver> = {}): AtlasManeuver {
  return {
    kind: "turn",
    direction: "left",
    coordinate: { latitude: 30, longitude: -97 },
    bearingBefore: 0,
    bearingAfter: 90,
    roundaboutExit: null,
    exitNumber: null,
    ...over,
  };
}

describe("maneuver icons", () => {
  it("resolves every maneuver kind to something drawable", () => {
    // An unmapped kind renders nothing at all, which on a driving screen is
    // the largest graphic simply missing.
    const kinds: AtlasManeuverKind[] = [
      "depart", "turn", "continue", "merge", "fork", "on-ramp", "off-ramp",
      "roundabout", "roundabout-exit", "u-turn", "arrive", "unknown",
    ];
    for (const kind of kinds) {
      expect(maneuverIcon(maneuver({ kind })), kind).toBeTruthy();
    }
  });

  it("distinguishes every direction", () => {
    const seen = new Set(
      (["left", "right", "slight-left", "slight-right", "sharp-left", "sharp-right"] as const)
        .map((direction) => maneuverIcon(maneuver({ kind: "turn", direction }))),
    );
    expect(seen.size).toBe(6);
  });

  it("sides merges, forks and ramps correctly", () => {
    expect(maneuverIcon(maneuver({ kind: "merge", direction: "slight-left" }))).toBe("merge-left");
    expect(maneuverIcon(maneuver({ kind: "merge", direction: "slight-right" }))).toBe("merge-right");
    expect(maneuverIcon(maneuver({ kind: "fork", direction: "left" }))).toBe("fork-left");
    expect(maneuverIcon(maneuver({ kind: "off-ramp", direction: "right" }))).toBe("ramp-right");
  });

  it("keeps a u-turn distinct from a sharp turn", () => {
    // Confusing these puts a driver across oncoming traffic.
    expect(maneuverIcon(maneuver({ kind: "u-turn" }))).toBe("u-turn");
    expect(maneuverIcon(maneuver({ kind: "turn", direction: "sharp-left" }))).toBe("sharp-left");
  });

  it("falls back rather than failing on a directionless turn", () => {
    expect(maneuverIcon(maneuver({ kind: "turn", direction: null }))).toBe("straight");
  });
});

// ---------------------------------------------------------------------------
// Maneuver text
// ---------------------------------------------------------------------------

describe("maneuver distance", () => {
  it("uses feet close in, where miles are unreadable", () => {
    // "0.03 mi" is not a distance anyone can judge from a driving seat.
    expect(formatManeuverDistance(60)).toBe("200 ft");
    expect(formatManeuverDistance(150)).toBe("500 ft");
  });

  it("says Now when the maneuver is upon you", () => {
    expect(formatManeuverDistance(20)).toBe("Now");
  });

  it("switches to miles further out", () => {
    expect(formatManeuverDistance(1_609)).toBe("1.0 mi");
    expect(formatManeuverDistance(32_186)).toBe("20 mi");
  });

  it("rounds hard, so the number is not a flickering counter", () => {
    // Consecutive fixes a few metres apart must not produce a new number each
    // time; a value that changes every second is harder to read than one that
    // changes every few.
    const values = new Set(
      [200, 205, 210, 215, 220].map((m) => formatManeuverDistance(m)),
    );
    expect(values.size).toBeLessThanOrEqual(2);
  });

  it("marks an imminent maneuver", () => {
    expect(isManeuverImminent(60)).toBe(true);
    expect(isManeuverImminent(400)).toBe(false);
  });

  it("never renders a negative or broken distance", () => {
    expect(formatManeuverDistance(-5)).toBe("—");
    expect(formatManeuverDistance(Number.NaN)).toBe("—");
  });
});

describe("maneuver presentation", () => {
  const steps = CITY.legs.flatMap((l) => l.steps);

  it("prefers the provider's banner over anything assembled here", () => {
    // The banner is written for a windscreen. A template over raw fields is
    // not, and re-deriving it would lose the phrasing that makes it readable.
    const step = steps.find((s) => s.banner.length > 0)!;
    const presented = presentManeuver(step, steps[1] ?? null, 300);
    expect(presented.primary).toBe(step.banner[0]!.primary);
  });

  it("never leaves the primary line empty", () => {
    for (let i = 0; i < steps.length; i++) {
      const presented = presentManeuver(steps[i]!, steps[i + 1] ?? null, 200);
      expect(presented.primary.length).toBeGreaterThan(0);
    }
  });

  it("surfaces exit numbers and roundabout exits when present", () => {
    const highway = HIGHWAY.legs.flatMap((l) => l.steps);
    const withExit = highway.find((s) => s.maneuver.exitNumber !== null);
    if (withExit) {
      const index = highway.indexOf(withExit);
      const presented = presentManeuver(highway[index - 1] ?? withExit, withExit, 500);
      expect(presented.exit).toMatch(/^Exit /);
    }

    const roundabout = presentManeuver(
      steps[0]!,
      { ...steps[0]!, maneuver: maneuver({ kind: "roundabout", roundaboutExit: 3 }) },
      200,
    );
    expect(roundabout.roundaboutExit).toBe("3rd exit");
  });

  it("supplies the following maneuver for the then-line", () => {
    expect(presentFollowing(null)).toBeNull();
    const following = presentFollowing(steps[2] ?? steps[0]!);
    expect(following?.icon).toBeTruthy();
  });

  it("omits a then-line that just repeats the line above it", () => {
    // Observed on a real route: "0.3 mi · Barton Springs Road / THEN Barton
    // Springs Road", because the step after the turn is still on the road you
    // just turned onto. A driver reading that at speed learns nothing.
    const step = steps.find((s) => s.roadName !== null)!;
    expect(presentFollowing(step, step.roadName!)).toBeNull();
    expect(presentFollowing(step, "Somewhere else")).not.toBeNull();
  });

  it("says Arrive rather than naming the road again", () => {
    const arrive = steps[steps.length - 1]!;
    expect(arrive.maneuver.kind).toBe("arrive");
    expect(presentFollowing(arrive)?.text).toBe("Arrive");
  });
});

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

describe("navigation camera", () => {
  it("closes in on a maneuver and opens up on an empty road", () => {
    expect(navigationZoom(100)).toBe(CAMERA.MANEUVER_ZOOM);
    expect(navigationZoom(800)).toBe(CAMERA.CRUISE_ZOOM);
    expect(navigationZoom(5_000)).toBe(CAMERA.OPEN_ROAD_ZOOM);
    expect(navigationZoom(100)).toBeGreaterThan(navigationZoom(5_000));
  });

  it("flattens slightly at a junction", () => {
    // Less foreshortening where the geometry actually matters.
    expect(navigationPitch(100)).toBeLessThan(navigationPitch(1_000));
  });

  it("seats the driver low with the road ahead above", () => {
    // The point of a driving camera is where you are going. Centring the car
    // spends half the screen on where it has been.
    const padding = followPadding(VIEWPORT, 168, 148, SAFE);
    expect(padding.top).toBeGreaterThan(padding.bottom);
    expect(padding.top + padding.bottom).toBeLessThan(VIEWPORT.height);
  });

  it("never demands more padding than the screen has", () => {
    const padding = followPadding({ width: 320, height: 480 }, 300, 300, SAFE);
    expect(padding.top + padding.bottom).toBeLessThan(480);
  });
});

describe("course-up bearing", () => {
  const progress = { segmentIndex: 0 } as never;

  const call = (over: Partial<Parameters<typeof courseBearing>[0]>) =>
    courseBearing({
      route: CITY,
      progress,
      headingDegrees: null,
      speedMps: null,
      previousBearing: 0,
      minSpeedMps: 2.5,
      ...over,
    });

  it("uses a trusted heading when moving", () => {
    // A change above the deadband and within one rotation step is adopted
    // exactly — the deadband case is covered separately below.
    expect(call({ headingDegrees: 90, speedMps: 12, previousBearing: 72 })).toBe(90);
  });

  it("ignores heading from a crawling device", () => {
    // A stopped phone reports whatever its last jitter pointed at. Following
    // that spins the entire map while the driver sits at a light.
    const held = call({ headingDegrees: 270, speedMps: 0.2, previousBearing: 10 });
    expect(bearingDifference(held, 270)).toBeGreaterThan(60);
  });

  it("falls back to the route's own bearing when heading is absent", () => {
    const routeBearing = call({ headingDegrees: null, speedMps: 12, previousBearing: 180 });
    expect(Number.isFinite(routeBearing)).toBe(true);
  });

  it("ignores changes below the deadband", () => {
    const previous = 100;
    expect(call({ headingDegrees: 101, speedMps: 12, previousBearing: previous })).toBe(previous);
  });

  it("caps how far it can rotate in one update", () => {
    // Without a cap a heading flip spins the map 180 degrees in one frame,
    // which is genuinely disorienting at speed.
    const next = call({ headingDegrees: 190, speedMps: 12, previousBearing: 0 });
    expect(bearingDifference(next, 0)).toBeLessThanOrEqual(CAMERA.BEARING_MAX_STEP_DEG + 0.001);
  });

  it("rotates the short way around north", () => {
    const next = call({ headingDegrees: 10, speedMps: 12, previousBearing: 350 });
    expect(bearingDifference(next, 350)).toBeLessThanOrEqual(CAMERA.BEARING_MAX_STEP_DEG + 0.001);
    // Must not go the long way round through 180.
    expect(next > 340 || next < 40).toBe(true);
  });

  it("holds the last orientation when nothing is trustworthy", () => {
    const empty: AtlasRoute = { ...CITY, geometry: [] };
    expect(
      courseBearing({
        route: empty,
        progress,
        headingDegrees: null,
        speedMps: null,
        previousBearing: 123,
        minSpeedMps: 2.5,
      }),
    ).toBe(123);
  });
});

describe("camera update suppression", () => {
  const target = {
    center: { latitude: 30, longitude: -97 },
    zoom: 16.3,
    pitch: 60,
    bearing: 90,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  };

  it("always moves when there is no previous camera", () => {
    expect(cameraChanged(null, target)).toBe(true);
  });

  it("skips a move that would change nothing", () => {
    // Re-issuing a near-identical animation at 1Hz is what makes a map look
    // like it is vibrating rather than tracking.
    expect(
      cameraChanged(
        { center: { latitude: 30, longitude: -97 }, zoom: 16.3, pitch: 60, bearing: 90 },
        target,
      ),
    ).toBe(false);
  });

  it("moves for a real change in any axis", () => {
    const base = { center: { latitude: 30, longitude: -97 }, zoom: 16.3, pitch: 60, bearing: 90 };
    expect(cameraChanged({ ...base, bearing: 60 }, target)).toBe(true);
    expect(cameraChanged({ ...base, zoom: 15 }, target)).toBe(true);
    expect(cameraChanged({ ...base, pitch: 40 }, target)).toBe(true);
    expect(cameraChanged({ ...base, center: { latitude: 30.01, longitude: -97 } }, target)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Camera stability across a real trace
// ---------------------------------------------------------------------------

describe("camera stability", () => {
  const boundaries = stepBoundaries(CITY);

  /** Runs the camera over a whole replay, as the app does. */
  function driveCamera(samples: ReturnType<typeof cleanTrace>) {
    const { states } = replay(CITY, samples, boundaries);
    let bearing = 0;
    const bearings: number[] = [];
    const zooms: number[] = [];

    for (const [i, state] of states.entries()) {
      const sample = samples[i]!;
      const target = followCamera({
        route: CITY,
        progress: state.progress,
        headingDegrees: sample.headingDegrees,
        speedMps: sample.speedMps,
        previousBearing: bearing,
        minSpeedMps: 2.5,
        viewport: VIEWPORT,
        hudHeight: 168,
        controlsHeight: 148,
        safeArea: SAFE,
      });
      bearing = target.bearing;
      bearings.push(target.bearing);
      zooms.push(target.zoom);
    }
    return { bearings, zooms };
  }

  it("never spins on a clean drive", () => {
    const { bearings } = driveCamera(cleanTrace(CITY, { stepMeters: 14 }));
    for (let i = 1; i < bearings.length; i++) {
      expect(bearingDifference(bearings[i]!, bearings[i - 1]!)).toBeLessThanOrEqual(
        CAMERA.BEARING_MAX_STEP_DEG + 0.001,
      );
    }
  });

  it("stays steady through 30–60m GPS noise", () => {
    const { bearings } = driveCamera(
      cleanTrace(CITY, { stepMeters: 14, noiseMeters: 35, accuracyMeters: 22, seed: 9 }),
    );
    for (let i = 1; i < bearings.length; i++) {
      expect(bearingDifference(bearings[i]!, bearings[i - 1]!)).toBeLessThanOrEqual(
        CAMERA.BEARING_MAX_STEP_DEG + 0.001,
      );
    }
  });

  it("does not spin while parked with a wandering heading", () => {
    // THE ASSERTION THAT MATTERS AT A TRAFFIC LIGHT. The device reports a
    // random heading every second; the map must not follow it.
    const samples = stationaryTrace(CITY, {
      atMeters: 250,
      samples: 40,
      reportSpeed: true,
      reportHeading: true,
    });
    const { bearings } = driveCamera(samples as never);
    const total = bearings.reduce(
      (sum, b, i) => (i === 0 ? 0 : sum + bearingDifference(b, bearings[i - 1]!)),
      0,
    );
    // Essentially no net rotation across forty fixes.
    expect(total).toBeLessThan(CAMERA.BEARING_MAX_STEP_DEG);
  });

  it("does not thrash zoom on a long straight road", () => {
    const { zooms } = driveCamera(cleanTrace(HIGHWAY, { stepMeters: 25 }) as never);
    let changes = 0;
    for (let i = 1; i < zooms.length; i++) {
      if (zooms[i] !== zooms[i - 1]) changes++;
    }
    // Three regimes, so a handful of transitions across a whole route — not a
    // continuously varying zoom that never settles.
    expect(changes).toBeLessThan(zooms.length / 4);
  });

  it("frames only the remaining route in overview", () => {
    // A driver forty minutes in does not need to see where they started, and
    // including it shrinks the part they care about.
    const { states } = replay(CITY, cleanTrace(CITY, { stepMeters: 14 }), boundaries);
    const late = states[Math.floor(states.length * 0.8)]!;
    const bounds = remainingRouteBounds(CITY, late.progress);

    const start = CITY.geometry[0]!;
    const spansStart =
      start.latitude >= bounds.southwest.latitude &&
      start.latitude <= bounds.northeast.latitude &&
      start.longitude >= bounds.southwest.longitude &&
      start.longitude <= bounds.northeast.longitude;
    expect(spansStart).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

const DEST: Destination = {
  id: "d1", origin: "search", name: "Zilker Park", address: null,
  coordinate: { latitude: 30.2672, longitude: -97.7431 }, icon: "pin",
};

function drive(): NavigationState {
  const events: NavigationEvent[] = [
    { type: "DESTINATION_SELECTED", destination: DEST },
    { type: "ROUTE_REQUESTED", requestId: 1 },
    { type: "ROUTE_SUCCEEDED", requestId: 1, routes: [CITY] },
    { type: "START_DRIVE", at: 1, origin: { latitude: 30, longitude: -97 } },
    { type: "NAVIGATION_READY" },
  ];
  return events.reduce(navigationReducer, INITIAL_NAVIGATION_STATE);
}

describe("active navigation transitions", () => {
  it("only begins guiding once located", () => {
    // Guidance before a position is a maneuver distance measured from a guess.
    const events: NavigationEvent[] = [
      { type: "DESTINATION_SELECTED", destination: DEST },
      { type: "ROUTE_REQUESTED", requestId: 1 },
      { type: "ROUTE_SUCCEEDED", requestId: 1, routes: [CITY] },
      { type: "START_DRIVE", at: 1, origin: { latitude: 30, longitude: -97 } },
    ];
    const starting = events.reduce(navigationReducer, INITIAL_NAVIGATION_STATE);

    expect(starting.phase).toBe("navigationStarting");
    expect(navigationReducer(starting, { type: "NAVIGATION_READY" }).phase).toBe("navigating");
  });

  it("suspends follow when the driver pans, and never overrides it", () => {
    let state = drive();
    state = navigationReducer(state, { type: "MAP_EXPLORED" });
    expect(state.phase === "navigating" && state.camera).toBe("exploring");

    // A subsequent gesture must not bounce it back.
    state = navigationReducer(state, { type: "MAP_EXPLORED" });
    expect(state.phase === "navigating" && state.camera).toBe("exploring");
  });

  it("returns to following through recentering", () => {
    let state = navigationReducer(drive(), { type: "MAP_EXPLORED" });
    state = navigationReducer(state, { type: "RECENTER" });
    expect(state.phase === "navigating" && state.camera).toBe("recentering");
    state = navigationReducer(state, { type: "RECENTER_SETTLED" });
    expect(state.phase === "navigating" && state.camera).toBe("following");
  });

  it("supports overview without ending guidance", () => {
    const state = navigationReducer(drive(), { type: "SHOW_OVERVIEW" });
    expect(state.phase).toBe("navigating");
    expect(state.phase === "navigating" && state.camera).toBe("overview");
    expect(isGuiding(state)).toBe(true);
    expect(showsRoute(state)).toBe(true);
  });

  it("keeps the session and route through every camera mode", () => {
    for (const event of [
      { type: "MAP_EXPLORED" },
      { type: "SHOW_OVERVIEW" },
      { type: "RECENTER" },
    ] as NavigationEvent[]) {
      const state = navigationReducer(drive(), event);
      expect(sessionOf(state)?.route.id).toBe(CITY.id);
    }
  });

  it("preserves the session on failure rather than discarding the drive", () => {
    const state = navigationReducer(drive(), {
      type: "NAVIGATION_FAILED",
      failure: "network",
    });
    expect(state.phase).toBe("navigationFailed");
    expect(sessionOf(state)?.destination.id).toBe("d1");
    expect(showsRoute(state)).toBe(true);
  });

  it("ends cleanly, leaving no route, session or camera mode behind", () => {
    for (const event of [
      { type: "MAP_EXPLORED" },
      { type: "SHOW_OVERVIEW" },
    ] as NavigationEvent[]) {
      const ended = navigationReducer(
        navigationReducer(drive(), event),
        { type: "CANCEL" },
      );
      expect(ended.phase).toBe("idle");
      expect(sessionOf(ended)).toBeNull();
      expect(showsRoute(ended)).toBe(false);
      expect(isGuiding(ended)).toBe(false);
    }
  });

  it("ignores camera events outside a drive", () => {
    for (const event of [
      { type: "MAP_EXPLORED" },
      { type: "RECENTER" },
      { type: "SHOW_OVERVIEW" },
      { type: "NAVIGATION_READY" },
    ] as NavigationEvent[]) {
      expect(navigationReducer(INITIAL_NAVIGATION_STATE, event).phase).toBe("idle");
    }
  });
});

// ---------------------------------------------------------------------------
// Wake lock
// ---------------------------------------------------------------------------

describe("wake lock", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports unsupported without failing", () => {
    // Navigation must be identical without it. It is an enhancement.
    vi.stubGlobal("navigator", {});
    expect(isWakeLockSupported()).toBe(false);
  });

  it("acquires and reports active", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      wakeLock: { request: vi.fn().mockResolvedValue({ release, addEventListener: vi.fn() }) },
    });
    vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });

    const seen: string[] = [];
    const lock = createWakeLock((s) => seen.push(s));
    expect(await lock.acquire()).toBe("active");
    expect(seen).toContain("active");

    await lock.release();
    expect(release).toHaveBeenCalled();
    expect(lock.status()).toBe("released");
  });

  it("survives a refusal", async () => {
    vi.stubGlobal("navigator", {
      wakeLock: { request: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });

    const lock = createWakeLock();
    expect(await lock.acquire()).toBe("unavailable");
    // Releasing something never held must not throw.
    await expect(lock.release()).resolves.toBeUndefined();
  });

  it("listens for visibility so it can be re-acquired", async () => {
    // The lock is dropped whenever the page hides; without re-acquiring, one
    // glance at a notification ends the protection for the rest of the drive.
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("navigator", {
      wakeLock: { request: vi.fn().mockResolvedValue({ release: vi.fn(), addEventListener: vi.fn() }) },
    });
    vi.stubGlobal("document", { addEventListener, removeEventListener, visibilityState: "visible" });

    const lock = createWakeLock();
    await lock.acquire();
    expect(addEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

    await lock.release();
    expect(removeEventListener).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The simulator drives the same engine the UI reads
// ---------------------------------------------------------------------------

describe("simulated drive feeds the real pipeline", () => {
  it("produces the maneuver card values the UI renders", () => {
    const boundaries = stepBoundaries(CITY);
    const { states } = replay(CITY, cleanTrace(CITY, { stepMeters: 16 }), boundaries);
    const steps = CITY.legs.flatMap((l) => l.steps);

    let rendered = 0;
    for (const state of states) {
      const step = steps[state.progress.stepIndex];
      if (!step) continue;
      const next =
        state.progress.maneuverStepIndex !== null
          ? steps[state.progress.maneuverStepIndex] ?? null
          : null;

      const card = presentManeuver(step, next, state.progress.distanceToManeuverMeters);
      expect(card.primary.length).toBeGreaterThan(0);
      expect(card.distance).not.toBe("—");
      expect(card.icon).toBeTruthy();
      rendered++;
    }
    expect(rendered).toBeGreaterThan(50);
  });

  it("walks a route that the trace and the engine agree on", () => {
    const truth = walkRoute(CITY, 20);
    expect(truth.length).toBeGreaterThan(5);
    const { final } = replay(CITY, cleanTrace(CITY, { stepMeters: 20 }));
    expect(final.progress.progressFraction).toBeGreaterThan(0.95);
  });
});
