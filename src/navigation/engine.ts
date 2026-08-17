import { type Coordinate, bearingDegrees, distanceMeters } from "@/map/types";
import type { AtlasRoute } from "@/routing/types";
import { bearingDifference, lowerBound, projectOntoSegment } from "./geometry";
import {
  type NavigationSample,
  type SampleRejection,
  isUsableCoordinate,
} from "./sample";
import * as T from "./thresholds";

/**
 * THE NAVIGATION ENGINE.
 *
 * Feed it a route and a stream of GPS fixes; get back where the driver is on
 * that route and how much to trust it. Pure and deterministic: no React, no
 * Mapbox, no DOM, no clock of its own. Every input arrives as an argument,
 * which is the only reason a wrong-turn detector can be tested at all — the
 * real thing takes a car and a wrong turn.
 *
 * The design principle throughout: **never report more certainty than the
 * signal supports.** A consumer GPS fix is a probability cloud, and most of
 * the difficulty in navigation is not computing a position but deciding
 * whether a surprising one means the driver turned or the phone guessed.
 */

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type LocationFreshness = "fresh" | "stale" | "lost";

export type OffRouteState =
  | "on-route"
  | "uncertain"
  | "likely-off-route"
  | "off-route";

export type NavigationStatus =
  /** Moving along the route with a usable fix. */
  | "navigating"
  /** A usable fix, but the car is not moving. Progress is frozen. */
  | "stationary"
  /** No usable fix recently. Last known state is held, not extrapolated. */
  | "degraded"
  /** No usable fix for long enough that the held state is not worth trusting. */
  | "lost"
  /** Remaining distance is inside the arrival radius. */
  | "arrived";

/** Where the remaining-time figure comes from. Never silently conflated. */
export type EtaSource =
  /** The provider's per-step durations, which included traffic when requested. */
  | "route"
  /** The same, but old enough that it should be labelled as such. */
  | "route-stale";

export interface NavigationProgress {
  readonly status: NavigationStatus;
  /** The fix snapped onto the route line. */
  readonly snapped: Coordinate;
  readonly distanceFromRouteMeters: number;
  readonly progressMeters: number;
  readonly remainingMeters: number;
  /** 0–1. */
  readonly progressFraction: number;
  /** Index of the geometry segment the driver is on. */
  readonly segmentIndex: number;
  /**
   * The step being driven. The maneuver to perform is at the END of it — see
   * `distanceToManeuverMeters` and `maneuverStepIndex`.
   */
  readonly stepIndex: number;
  /** Index of the step whose maneuver is next, or `null` at the last step. */
  readonly maneuverStepIndex: number | null;
  readonly distanceToManeuverMeters: number;
  readonly remainingSeconds: number;
  readonly etaEpochMs: number;
  readonly etaSource: EtaSource;
  readonly offRoute: OffRouteState;
  /** 0–1. Reaches 1 only when the evidence is genuinely conclusive. */
  readonly offRouteConfidence: number;
  readonly freshness: LocationFreshness;
  /** Timestamp of the last accepted fix, or `null` before the first. */
  readonly lastAcceptedAt: number | null;
  /** Why the most recent fix was not fully trusted. */
  readonly lastRejection: SampleRejection | null;
  /** Accuracy of the last accepted fix, for diagnostics. */
  readonly accuracyMeters: number | null;
  /** The corridor half-width in force, which scales with accuracy. */
  readonly corridorMeters: number;
}

/**
 * Engine memory.
 *
 * Deliberately separate from the reported progress: consumers read the
 * progress, and nothing outside this module should depend on how the
 * conclusions were reached.
 */
export interface EngineMemory {
  readonly initialised: boolean;
  readonly progressMeters: number;
  readonly stepIndex: number;
  readonly lastSample: NavigationSample | null;
  /** Recent accepted fixes, oldest first, for the stationary test. */
  readonly recent: readonly NavigationSample[];
  readonly divergentSamples: number;
  readonly divergentSinceMs: number | null;
  readonly lastDistanceFromRoute: number;
  readonly confidence: number;
}

export interface EngineState {
  readonly progress: NavigationProgress;
  readonly memory: EngineMemory;
}

// ---------------------------------------------------------------------------
// Step boundaries, precomputed once
// ---------------------------------------------------------------------------

export interface StepBoundary {
  readonly stepIndex: number;
  readonly startMeters: number;
  readonly endMeters: number;
}

/**
 * Distance-along-route boundaries for every step.
 *
 * Sub-phase 1 established that steps tile the geometry contiguously and share
 * their boundary vertices, so these can be read straight off the cumulative
 * table. Zero-length steps are kept rather than filtered: dropping them would
 * shift every index after them out of step with the route's own step array.
 */
export function stepBoundaries(route: AtlasRoute): StepBoundary[] {
  const steps = route.legs.flatMap((leg) => leg.steps);
  const last = route.cumulative.length - 1;

  return steps.map((step, stepIndex) => ({
    stepIndex,
    startMeters: route.cumulative[Math.min(step.geometryStart, last)] ?? 0,
    endMeters: route.cumulative[Math.min(step.geometryEnd, last)] ?? 0,
  }));
}

export function routeSteps(route: AtlasRoute) {
  return route.legs.flatMap((leg) => leg.steps);
}

// ---------------------------------------------------------------------------
// Projection onto the route
// ---------------------------------------------------------------------------

export interface RouteMatch {
  readonly segmentIndex: number;
  readonly snapped: Coordinate;
  readonly distanceMeters: number;
  readonly progressMeters: number;
}

/**
 * Finds the point on the route nearest a coordinate.
 *
 * Searches a window around the last known progress rather than the whole line,
 * because the alternative is scanning thousands of vertices several times a
 * second on a phone. The window is expressed in **metres**, not vertices:
 * vertex density varies by an order of magnitude between a straight motorway
 * and a roundabout, so a fixed vertex count is a different search on every
 * road.
 *
 * `fromMeters` of `null` searches the whole route — correct for the first fix,
 * and after a gap long enough that the car could be anywhere.
 */
export function matchToRoute(
  route: AtlasRoute,
  point: Coordinate,
  fromMeters: number | null,
): RouteMatch | null {
  const { geometry, cumulative } = route;
  if (geometry.length < 2) return null;

  let first = 0;
  let last = geometry.length - 2;

  if (fromMeters !== null) {
    first = lowerBound(cumulative, fromMeters - T.SEARCH_BEHIND_M);
    last = Math.min(
      geometry.length - 2,
      lowerBound(cumulative, fromMeters + T.SEARCH_AHEAD_M),
    );
    if (last < first) last = first;
  }

  const windowed = scanSegments(route, point, first, last);

  // A poor best match inside the window usually means the window is wrong —
  // the driver may have rejoined the route somewhere else entirely — so the
  // conclusion is checked against the whole line before it is believed.
  if (
    fromMeters !== null &&
    (windowed === null || windowed.distanceMeters > T.WINDOW_ESCAPE_M)
  ) {
    const global = scanSegments(route, point, 0, geometry.length - 2);
    if (global !== null && (windowed === null || global.distanceMeters < windowed.distanceMeters)) {
      return global;
    }
  }

  return windowed;
}

function scanSegments(
  route: AtlasRoute,
  point: Coordinate,
  first: number,
  last: number,
): RouteMatch | null {
  const { geometry, cumulative } = route;
  let best: RouteMatch | null = null;

  for (let i = first; i <= last; i++) {
    const a = geometry[i];
    const b = geometry[i + 1];
    if (!a || !b) continue;

    const projection = projectOntoSegment(point, a, b);
    if (best !== null && projection.distanceMeters >= best.distanceMeters) continue;

    const segmentStart = cumulative[i] ?? 0;
    const segmentEnd = cumulative[i + 1] ?? segmentStart;

    best = {
      segmentIndex: i,
      snapped: projection.point,
      distanceMeters: projection.distanceMeters,
      progressMeters: segmentStart + (segmentEnd - segmentStart) * projection.t,
    };
  }

  return best;
}

// ---------------------------------------------------------------------------
// Remaining time
// ---------------------------------------------------------------------------

/**
 * Remaining travel time from the provider's own per-step durations.
 *
 * The current step is counted pro-rata by how much of it is left; every later
 * step is counted whole. Scaling the *whole route* duration by the remaining
 * fraction would be visibly wrong near the end of any route with a motorway in
 * it, because the last mile of surface streets takes far longer per metre than
 * the thirty before it.
 *
 * LIMIT, stated plainly: this is route-derived. The durations included traffic
 * at the moment the route was requested and are not updated from observed
 * speed. Observed speed over a short window is dominated by traffic lights,
 * and a figure that swings by ten minutes at every junction is worse than a
 * slightly stale one. Sub-phase 6's rerouting is what refreshes it.
 */
export function remainingSeconds(
  route: AtlasRoute,
  boundaries: readonly StepBoundary[],
  progressMeters: number,
  stepIndex: number,
): number {
  const steps = routeSteps(route);
  if (steps.length === 0) {
    // No step breakdown: fall back to the whole-route proportion, which is the
    // best available and is at least monotonic.
    const fraction =
      route.distanceMeters > 0
        ? Math.max(0, 1 - progressMeters / route.distanceMeters)
        : 0;
    return route.durationSeconds * fraction;
  }

  const index = Math.min(stepIndex, steps.length - 1);
  const boundary = boundaries[index];
  const step = steps[index];
  let total = 0;

  if (boundary && step) {
    const span = boundary.endMeters - boundary.startMeters;
    const remainingInStep = Math.max(0, boundary.endMeters - progressMeters);
    const fraction = span > 0 ? Math.min(1, remainingInStep / span) : 0;
    total += step.durationSeconds * fraction;
  }

  for (let i = index + 1; i < steps.length; i++) {
    total += steps[i]!.durationSeconds;
  }

  return total;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export function initialState(route: AtlasRoute, now: number): EngineState {
  const boundaries = stepBoundaries(route);
  return {
    memory: {
      initialised: false,
      progressMeters: 0,
      stepIndex: 0,
      lastSample: null,
      recent: [],
      divergentSamples: 0,
      divergentSinceMs: null,
      lastDistanceFromRoute: 0,
      confidence: 0,
    },
    progress: {
      status: "lost",
      snapped: route.geometry[0] ?? { latitude: 0, longitude: 0 },
      distanceFromRouteMeters: 0,
      progressMeters: 0,
      remainingMeters: route.distanceMeters,
      progressFraction: 0,
      segmentIndex: 0,
      stepIndex: 0,
      maneuverStepIndex: routeSteps(route).length > 1 ? 1 : null,
      distanceToManeuverMeters: boundaries[0]?.endMeters ?? 0,
      remainingSeconds: route.durationSeconds,
      etaEpochMs: now + route.durationSeconds * 1000,
      etaSource: "route",
      offRoute: "on-route",
      offRouteConfidence: 0,
      freshness: "lost",
      lastAcceptedAt: null,
      lastRejection: null,
      accuracyMeters: null,
      corridorMeters: T.CORRIDOR_MIN_M,
    },
  };
}

/**
 * Advances the engine by one fix.
 *
 * `now` is passed rather than read so that a whole drive can be replayed
 * deterministically. `boundaries` is passed so the caller can compute it once
 * per route instead of once per fix.
 */
export function advance(
  route: AtlasRoute,
  boundaries: readonly StepBoundary[],
  state: EngineState,
  sample: NavigationSample,
  now: number,
): EngineState {
  const { memory } = state;

  // --- acceptance ---------------------------------------------------------
  const rejection = judge(sample, memory);
  if (rejection !== null) {
    return {
      memory,
      progress: {
        ...state.progress,
        ...freshnessOf(memory.lastSample?.timestamp ?? null, now),
        lastRejection: rejection,
      },
    };
  }

  const degraded = sample.accuracyMeters > T.DEGRADED_ACCURACY_M;

  // --- projection ---------------------------------------------------------
  const gapMs =
    memory.lastSample === null
      ? Number.POSITIVE_INFINITY
      : sample.timestamp - memory.lastSample.timestamp;

  const searchFrom =
    memory.initialised && gapMs <= T.GAP_FULL_RESEARCH_MS
      ? memory.progressMeters
      : null;

  const match = matchToRoute(route, sample.coordinate, searchFrom);
  if (match === null) {
    return {
      memory,
      progress: { ...state.progress, lastRejection: "malformed" },
    };
  }

  // --- stationary ---------------------------------------------------------
  const recent = [...memory.recent, sample].filter(
    (s) => sample.timestamp - s.timestamp <= T.STATIONARY_WINDOW_MS,
  );
  const stationary = isStationary(sample, recent);

  // --- progress -----------------------------------------------------------
  //
  // Frozen while stationary. Without this, GPS wander at a traffic light adds
  // a few metres of "progress" per fix that the backward tolerance will not
  // give back, and the route ratchets forward while the car sits still.
  let progressMeters = memory.progressMeters;
  if (!memory.initialised) {
    progressMeters = match.progressMeters;
  } else if (!stationary) {
    // Backward movement is allowed, but only as far as the tolerance: real
    // noise moves progress back a few metres, and refusing all of it makes
    // progress ratchet forward on jitter alone. Anything beyond the tolerance
    // is a projection artefact or a driver who has left the route, and the
    // off-route logic below is what handles the latter.
    progressMeters = Math.max(
      match.progressMeters,
      memory.progressMeters - T.BACKWARD_TOLERANCE_M,
    );
  }

  // --- steps --------------------------------------------------------------
  const stepIndex = advanceStep(boundaries, progressMeters, memory.stepIndex);

  // --- off route ----------------------------------------------------------
  const corridor = corridorFor(sample.accuracyMeters);
  const divergent = match.distanceMeters > corridor;

  // Evidence is only accumulated from fixes that can actually support the
  // claim: a vague fix, or one taken while parked, proves nothing about
  // whether the driver has left the route.
  const canAccumulate = divergent && !degraded && !stationary;

  const divergentSamples = canAccumulate ? memory.divergentSamples + 1 : 0;
  const divergentSinceMs = canAccumulate
    ? (memory.divergentSinceMs ?? sample.timestamp)
    : null;

  const confidence = canAccumulate
    ? offRouteConfidence({
        samples: divergentSamples,
        durationMs: sample.timestamp - (divergentSinceMs ?? sample.timestamp),
        distance: match.distanceMeters,
        previousDistance: memory.lastDistanceFromRoute,
        corridor,
        headingPenalty: headingDisagrees(route, match, sample),
      })
    : memory.confidence * T.OFF_ROUTE_RECOVERY_FACTOR;

  // --- assembly -----------------------------------------------------------
  const remainingMeters = Math.max(0, route.distanceMeters - progressMeters);
  const seconds = remainingSeconds(route, boundaries, progressMeters, stepIndex);
  const boundary = boundaries[stepIndex];
  const steps = routeSteps(route);

  const status: NavigationStatus =
    remainingMeters <= T.ARRIVAL_RADIUS_M
      ? "arrived"
      : stationary
        ? "stationary"
        : "navigating";

  return {
    memory: {
      initialised: true,
      progressMeters,
      stepIndex,
      lastSample: sample,
      recent,
      divergentSamples,
      divergentSinceMs,
      lastDistanceFromRoute: match.distanceMeters,
      confidence: confidence < 0.01 ? 0 : Math.min(1, confidence),
    },
    progress: {
      status,
      snapped: match.snapped,
      distanceFromRouteMeters: match.distanceMeters,
      progressMeters,
      remainingMeters,
      progressFraction:
        route.distanceMeters > 0
          ? Math.min(1, progressMeters / route.distanceMeters)
          : 0,
      segmentIndex: match.segmentIndex,
      stepIndex,
      maneuverStepIndex: stepIndex + 1 < steps.length ? stepIndex + 1 : null,
      distanceToManeuverMeters: Math.max(
        0,
        (boundary?.endMeters ?? route.distanceMeters) - progressMeters,
      ),
      remainingSeconds: seconds,
      etaEpochMs: now + seconds * 1000,
      etaSource:
        now - route.requestedAt > T.ETA_STALE_AFTER_MS ? "route-stale" : "route",
      offRoute: offRouteStateFor(Math.min(1, confidence)),
      offRouteConfidence: Math.min(1, confidence),
      freshness: freshnessOf(sample.timestamp, now).freshness,
      lastAcceptedAt: sample.timestamp,
      lastRejection: null,
      accuracyMeters: sample.accuracyMeters,
      corridorMeters: corridor,
    },
  };
}

/**
 * Re-evaluates freshness without a new fix.
 *
 * Called on a timer so a tunnel degrades honestly rather than the interface
 * showing a confident position frozen from thirty seconds ago. Nothing is
 * extrapolated — the last known state is held and labelled.
 */
export function tick(state: EngineState, now: number): EngineState {
  const { freshness, status } = freshnessOf(
    state.memory.lastSample?.timestamp ?? null,
    now,
  );
  if (freshness === state.progress.freshness) return state;

  return {
    memory: state.memory,
    progress: {
      ...state.progress,
      freshness,
      status: state.progress.status === "arrived" ? "arrived" : status,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function judge(
  sample: NavigationSample,
  memory: EngineMemory,
): SampleRejection | null {
  if (
    !isUsableCoordinate(sample.coordinate) ||
    !Number.isFinite(sample.timestamp) ||
    !Number.isFinite(sample.accuracyMeters)
  ) {
    return "malformed";
  }
  if (sample.accuracyMeters > T.MAX_USABLE_ACCURACY_M) return "accuracy";

  const previous = memory.lastSample;
  if (previous !== null) {
    if (sample.timestamp < previous.timestamp) return "out-of-order";

    // A fix implying a speed no car reaches is a GPS teleport. Rejecting it is
    // what stops one wild sample dragging progress down the route — and the
    // budget scales with elapsed time, so a genuine tunnel exit after 30s of
    // silence is not mistaken for one.
    const seconds = (sample.timestamp - previous.timestamp) / 1000;
    const travelled = distanceMeters(previous.coordinate, sample.coordinate);
    const budget =
      T.MAX_PLAUSIBLE_SPEED_MPS * seconds +
      T.PLAUSIBILITY_SLACK_M +
      sample.accuracyMeters +
      previous.accuracyMeters;
    if (travelled > budget) return "implausible-jump";
  }

  return null;
}

function freshnessOf(
  lastAt: number | null,
  now: number,
): { freshness: LocationFreshness; status: NavigationStatus } {
  if (lastAt === null) return { freshness: "lost", status: "lost" };
  const age = now - lastAt;
  if (age > T.LOST_AFTER_MS) return { freshness: "lost", status: "lost" };
  if (age > T.STALE_AFTER_MS) return { freshness: "stale", status: "degraded" };
  return { freshness: "fresh", status: "navigating" };
}

/**
 * Whether the car is stopped.
 *
 * Reported speed is believed when present. Otherwise the test is *net*
 * displacement across a window, which is the only thing that separates a car
 * at a light — GPS wandering 15m per fix, net displacement near zero — from a
 * car in traffic actually creeping forward. Instantaneous displacement calls
 * both of them movement.
 */
export function isStationary(
  sample: NavigationSample,
  recent: readonly NavigationSample[],
): boolean {
  if (sample.speedMps !== null && Number.isFinite(sample.speedMps)) {
    return sample.speedMps < T.STATIONARY_SPEED_MPS;
  }

  const oldest = recent[0];
  if (!oldest || recent.length < 3) return false;
  if (sample.timestamp - oldest.timestamp < T.STATIONARY_WINDOW_MS / 2) return false;

  return (
    distanceMeters(oldest.coordinate, sample.coordinate) <
    T.STATIONARY_NET_DISPLACEMENT_M
  );
}

/**
 * The step being driven, given progress along the route.
 *
 * Monotonic: a step is never given back, because a maneuver card that flips
 * back to the turn you already made is worse than one that is briefly early.
 * Zero-length steps are stepped over rather than becoming permanent homes.
 */
export function advanceStep(
  boundaries: readonly StepBoundary[],
  progressMeters: number,
  currentIndex: number,
): number {
  let index = Math.min(currentIndex, Math.max(0, boundaries.length - 1));

  while (index + 1 < boundaries.length) {
    const current = boundaries[index]!;
    const spent = progressMeters >= current.endMeters;
    const empty = current.endMeters <= current.startMeters;
    if (!spent && !empty) break;
    index++;
  }

  return index;
}

export function corridorFor(accuracyMeters: number): number {
  const scaled = accuracyMeters * T.CORRIDOR_ACCURACY_MULTIPLIER;
  return Math.min(T.CORRIDOR_MAX_M, Math.max(T.CORRIDOR_MIN_M, scaled));
}

/**
 * Whether the driver appears to be travelling in a direction the route does
 * not go.
 *
 * Only consulted above a speed floor: a stationary or crawling device reports
 * whatever direction its last jitter happened to point, and treating that as
 * evidence would make every traffic light look like a wrong turn.
 */
function headingDisagrees(
  route: AtlasRoute,
  match: RouteMatch,
  sample: NavigationSample,
): boolean {
  if (sample.headingDegrees === null || !Number.isFinite(sample.headingDegrees)) {
    return false;
  }
  if (sample.speedMps !== null && sample.speedMps < T.HEADING_MIN_SPEED_MPS) {
    return false;
  }

  const a = route.geometry[match.segmentIndex];
  const b = route.geometry[match.segmentIndex + 1];
  if (!a || !b) return false;

  return (
    bearingDifference(sample.headingDegrees, bearingDegrees(a, b)) >
    T.HEADING_DISAGREEMENT_DEG
  );
}

/**
 * How strongly the evidence says the driver has left the route.
 *
 * Deliberately multi-signal. A single distance threshold reroutes a driver who
 * is going exactly the right way through an urban canyon, and that is the
 * failure that destroys trust in a navigation product fastest — it is wrong at
 * the moment the driver is most sure they are right.
 *
 * Count and duration each carry half the base weight, so neither a burst of
 * fixes from a fast device nor a long slow drift alone is conclusive. Getting
 * further away, and pointing somewhere the route does not go, each add.
 */
export function offRouteConfidence(input: {
  samples: number;
  durationMs: number;
  distance: number;
  previousDistance: number;
  corridor: number;
  headingPenalty: boolean;
}): number {
  const bySamples = Math.min(1, input.samples / T.OFF_ROUTE_MIN_SAMPLES);
  const byDuration = Math.min(1, input.durationMs / T.OFF_ROUTE_MIN_DURATION_MS);

  let confidence = 0.5 * bySamples + 0.5 * byDuration;

  // Moving away is much stronger evidence than merely being outside.
  if (input.distance > input.previousDistance + 5) confidence += 0.2;
  // Well beyond the corridor is not a borderline call.
  if (input.distance > input.corridor * 2) confidence += 0.2;
  if (input.headingPenalty) confidence += 0.25;

  return Math.max(0, Math.min(1, confidence));
}

export function offRouteStateFor(confidence: number): OffRouteState {
  if (confidence >= T.OFF_ROUTE_CERTAIN_AT) return "off-route";
  if (confidence >= T.OFF_ROUTE_LIKELY_AT) return "likely-off-route";
  if (confidence >= T.OFF_ROUTE_UNCERTAIN_AT) return "uncertain";
  return "on-route";
}

/**
 * Whether Sub-phase 6 should consider requesting a new route.
 *
 * The engine decides *that* the driver has left the route; it never decides
 * what to do about it, and it never calls a routing API.
 */
export function shouldConsiderReroute(progress: NavigationProgress): boolean {
  return progress.offRoute === "off-route" && progress.freshness === "fresh";
}
