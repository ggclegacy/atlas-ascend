import { type Coordinate, bearingDegrees, distanceMeters } from "@/map/types";
import type { AtlasRoute } from "@/routing/types";
import {
  type EngineState,
  type StepBoundary,
  advance,
  initialState,
  stepBoundaries,
} from "./engine";
import type { NavigationSample } from "./sample";

/**
 * GPS TRACE SIMULATOR.
 *
 * Generates timestamped fixes along a route and replays them through the real
 * engine. Not a model of the engine — the same `advance` the product calls.
 * A test that exercises a parallel implementation proves only that the
 * parallel implementation works.
 *
 * This exists because the alternative way to test wrong-turn detection is to
 * drive a car through a wrong turn, and to do it again for every threshold
 * change. Noise, tunnels and stationary jitter are all trivially reproducible
 * here and nearly impossible to reproduce on demand in the world.
 *
 * DEV AND TEST ONLY. Nothing it produces may reach a product surface without
 * being marked simulated — see `src/lib/provenance.ts`.
 */

/**
 * Deterministic pseudo-random source.
 *
 * Seeded so a failing trace can be reproduced exactly. `Math.random()` would
 * make the noise tests flaky in a way that teaches nobody anything.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

const METERS_PER_DEGREE_LAT = 111_320;

/** Offsets a coordinate by metres east and north. */
export function offsetMeters(
  point: Coordinate,
  eastMeters: number,
  northMeters: number,
): Coordinate {
  const latitude = point.latitude + northMeters / METERS_PER_DEGREE_LAT;
  const lonScale =
    METERS_PER_DEGREE_LAT * Math.cos((point.latitude * Math.PI) / 180);
  return {
    latitude,
    longitude: point.longitude + eastMeters / (lonScale || 1),
  };
}

/**
 * Walks the route geometry, emitting a position every `stepMeters`.
 *
 * The truth track, before any noise or fault is applied.
 */
export function walkRoute(
  route: AtlasRoute,
  stepMeters: number,
): { point: Coordinate; alongMeters: number; bearing: number }[] {
  const out: { point: Coordinate; alongMeters: number; bearing: number }[] = [];
  const { geometry, cumulative } = route;
  if (geometry.length < 2) return out;

  const total = cumulative[cumulative.length - 1] ?? 0;
  let index = 0;

  for (let along = 0; along <= total; along += stepMeters) {
    while (index + 2 < geometry.length && (cumulative[index + 1] ?? 0) < along) {
      index++;
    }
    const a = geometry[index]!;
    const b = geometry[index + 1] ?? a;
    const start = cumulative[index] ?? 0;
    const span = (cumulative[index + 1] ?? start) - start;
    const t = span > 0 ? Math.min(1, Math.max(0, (along - start) / span)) : 0;

    out.push({
      point: {
        latitude: a.latitude + (b.latitude - a.latitude) * t,
        longitude: a.longitude + (b.longitude - a.longitude) * t,
      },
      alongMeters: along,
      bearing: bearingDegrees(a, b),
    });
  }

  return out;
}

export interface TraceOptions {
  /** Metres between consecutive truth positions. ~14 m/s at 1Hz is city speed. */
  readonly stepMeters?: number;
  /** Milliseconds between fixes. Consumer GPS is roughly 1Hz. */
  readonly intervalMs?: number;
  /** Peak lateral/longitudinal error in metres. */
  readonly noiseMeters?: number;
  /** What the device claims its accuracy is. */
  readonly accuracyMeters?: number;
  /** Whether the device reports heading and speed at all. */
  readonly reportHeading?: boolean;
  readonly reportSpeed?: boolean;
  readonly seed?: number;
  readonly startAt?: number;
}

const DEFAULTS = {
  stepMeters: 14,
  intervalMs: 1000,
  noiseMeters: 0,
  accuracyMeters: 6,
  reportHeading: true,
  reportSpeed: true,
  seed: 12345,
  startAt: 1_700_000_000_000,
};

/** A clean drive along the whole route. */
export function cleanTrace(
  route: AtlasRoute,
  options: TraceOptions = {},
): NavigationSample[] {
  const o = { ...DEFAULTS, ...options };
  const random = seededRandom(o.seed);
  const truth = walkRoute(route, o.stepMeters);

  return truth.map((t, i) => {
    const jitterEast = (random() - 0.5) * 2 * o.noiseMeters;
    const jitterNorth = (random() - 0.5) * 2 * o.noiseMeters;
    return {
      coordinate: offsetMeters(t.point, jitterEast, jitterNorth),
      timestamp: o.startAt + i * o.intervalMs,
      accuracyMeters: o.accuracyMeters,
      headingDegrees: o.reportHeading ? t.bearing : null,
      speedMps: o.reportSpeed ? o.stepMeters / (o.intervalMs / 1000) : null,
    };
  });
}

/** Sits still at one point on the route while GPS wanders around it. */
export function stationaryTrace(
  route: AtlasRoute,
  options: TraceOptions & { atMeters?: number; samples?: number } = {},
): NavigationSample[] {
  const o = { ...DEFAULTS, noiseMeters: 15, ...options };
  const random = seededRandom(o.seed);
  const truth = walkRoute(route, 5);
  const at = truth.find((t) => t.alongMeters >= (options.atMeters ?? 200)) ?? truth[0]!;
  const count = options.samples ?? 40;

  return Array.from({ length: count }, (_, i) => ({
    coordinate: offsetMeters(
      at.point,
      (random() - 0.5) * 2 * o.noiseMeters,
      (random() - 0.5) * 2 * o.noiseMeters,
    ),
    timestamp: o.startAt + i * o.intervalMs,
    accuracyMeters: o.accuracyMeters,
    // A parked phone still reports a heading — whatever the last jitter
    // pointed at — which is exactly why heading is speed-gated.
    headingDegrees: o.reportHeading ? random() * 360 : null,
    speedMps: o.reportSpeed ? 0 : null,
  }));
}

/** A clean drive with a stretch of missing fixes in the middle. */
export function tunnelTrace(
  route: AtlasRoute,
  options: TraceOptions & { gapStartMeters?: number; gapMeters?: number } = {},
): NavigationSample[] {
  const o = { ...DEFAULTS, ...options };
  const gapStart = options.gapStartMeters ?? 300;
  const gapLength = options.gapMeters ?? 400;

  return cleanTrace(route, o).filter(
    (_, i) =>
      !(
        i * o.stepMeters >= gapStart &&
        i * o.stepMeters <= gapStart + gapLength
      ),
  );
}

/**
 * Drives the route, then turns off it and keeps going.
 *
 * The departure is perpendicular to the route bearing at the turn — a real
 * wrong turn at a junction, not a drift.
 */
export function wrongTurnTrace(
  route: AtlasRoute,
  options: TraceOptions & { turnAtMeters?: number; departMeters?: number } = {},
): NavigationSample[] {
  const o = { ...DEFAULTS, ...options };
  const random = seededRandom(o.seed);
  const truth = walkRoute(route, o.stepMeters);
  const turnAt = options.turnAtMeters ?? 300;
  const depart = options.departMeters ?? 250;

  const onRoute = truth.filter((t) => t.alongMeters <= turnAt);
  const pivot = onRoute[onRoute.length - 1] ?? truth[0]!;
  const away = (pivot.bearing + 90) % 360;
  const rad = (away * Math.PI) / 180;

  const samples: NavigationSample[] = onRoute.map((t, i) => ({
    coordinate: offsetMeters(
      t.point,
      (random() - 0.5) * 2 * o.noiseMeters,
      (random() - 0.5) * 2 * o.noiseMeters,
    ),
    timestamp: o.startAt + i * o.intervalMs,
    accuracyMeters: o.accuracyMeters,
    headingDegrees: o.reportHeading ? t.bearing : null,
    speedMps: o.reportSpeed ? o.stepMeters / (o.intervalMs / 1000) : null,
  }));

  const departureSteps = Math.ceil(depart / o.stepMeters);
  for (let i = 1; i <= departureSteps; i++) {
    const metres = i * o.stepMeters;
    samples.push({
      coordinate: offsetMeters(
        pivot.point,
        Math.sin(rad) * metres,
        Math.cos(rad) * metres,
      ),
      timestamp: o.startAt + (onRoute.length + i - 1) * o.intervalMs,
      accuracyMeters: o.accuracyMeters,
      headingDegrees: o.reportHeading ? away : null,
      speedMps: o.reportSpeed ? o.stepMeters / (o.intervalMs / 1000) : null,
    });
  }

  return samples;
}

/** Leaves the corridor briefly, then comes back — a clipped corner, not a turn. */
export function excursionTrace(
  route: AtlasRoute,
  options: TraceOptions & { atMeters?: number; peakMeters?: number } = {},
): NavigationSample[] {
  const o = { ...DEFAULTS, ...options };
  const at = options.atMeters ?? 300;
  const peak = options.peakMeters ?? 55;
  const truth = walkRoute(route, o.stepMeters);

  return truth.map((t, i) => {
    // A short triangular departure and return, spanning ~5 fixes.
    const distanceFromEvent = Math.abs(t.alongMeters - at);
    const span = o.stepMeters * 2.5;
    const amount = distanceFromEvent < span ? peak * (1 - distanceFromEvent / span) : 0;
    const rad = (((t.bearing + 90) % 360) * Math.PI) / 180;

    return {
      coordinate: offsetMeters(t.point, Math.sin(rad) * amount, Math.cos(rad) * amount),
      timestamp: o.startAt + i * o.intervalMs,
      accuracyMeters: o.accuracyMeters,
      headingDegrees: o.reportHeading ? t.bearing : null,
      speedMps: o.reportSpeed ? o.stepMeters / (o.intervalMs / 1000) : null,
    };
  });
}

/**
 * Drives a road running alongside the route at a constant offset.
 *
 * The genuinely ambiguous case: a frontage road, or the opposite carriageway.
 * The position is consistently wrong by more than noise but the heading agrees
 * perfectly, and a distance-only detector cannot tell it from a wrong turn.
 */
export function parallelRoadTrace(
  route: AtlasRoute,
  options: TraceOptions & { offsetMeters?: number } = {},
): NavigationSample[] {
  const o = { ...DEFAULTS, ...options };
  const lateral = options.offsetMeters ?? 35;
  const truth = walkRoute(route, o.stepMeters);

  return truth.map((t, i) => {
    const rad = (((t.bearing + 90) % 360) * Math.PI) / 180;
    return {
      coordinate: offsetMeters(t.point, Math.sin(rad) * lateral, Math.cos(rad) * lateral),
      timestamp: o.startAt + i * o.intervalMs,
      accuracyMeters: o.accuracyMeters,
      headingDegrees: o.reportHeading ? t.bearing : null,
      speedMps: o.reportSpeed ? o.stepMeters / (o.intervalMs / 1000) : null,
    };
  });
}

/** A clean drive with one wild fix in the middle. */
export function gpsJumpTrace(
  route: AtlasRoute,
  options: TraceOptions & { atIndex?: number; jumpMeters?: number } = {},
): NavigationSample[] {
  const samples = cleanTrace(route, options);
  const index = options.atIndex ?? Math.floor(samples.length / 2);
  const jump = options.jumpMeters ?? 3_000;
  const target = samples[index];
  if (!target) return samples;

  samples[index] = {
    ...target,
    coordinate: offsetMeters(target.coordinate, jump, jump),
  };
  return samples;
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface ReplayResult {
  readonly states: readonly EngineState[];
  readonly final: EngineState;
  /** Wall-clock milliseconds spent inside the engine. */
  readonly elapsedMs: number;
}

/**
 * Replays a trace through the real engine.
 *
 * `now` tracks the sample timestamps, so freshness and ETA behave as they
 * would live rather than as if every fix arrived instantly.
 */
export function replay(
  route: AtlasRoute,
  samples: readonly NavigationSample[],
  boundaries: readonly StepBoundary[] = stepBoundaries(route),
): ReplayResult {
  let state = initialState(route, samples[0]?.timestamp ?? 0);
  const states: EngineState[] = [];

  const started = performance.now();
  for (const sample of samples) {
    state = advance(route, boundaries, state, sample, sample.timestamp);
    states.push(state);
  }
  const elapsedMs = performance.now() - started;

  return { states, final: state, elapsedMs };
}
