import type { Coordinate } from "@/map/types";
import { distanceMeters } from "@/map/types";
import { decodePolyline } from "./polyline";
import type {
  AtlasRoute,
  AtlasRouteBounds,
  AtlasRouteLeg,
} from "./types";

/**
 * THE WIRE FORMAT for `/api/route`.
 *
 * Identical to `AtlasRoute` except that geometry travels as the encoded
 * polyline it arrived as, and `cumulative` is not sent at all.
 *
 * Both omissions are the same decision. A 50km route at full overview is a few
 * thousand vertices; expanded to JSON coordinate objects that is ~180KB, and
 * as an encoded polyline it is ~24KB. `cumulative` would add another array the
 * same length again. The browser can rebuild both in under a millisecond from
 * data it already has, and it is doing so at the exact moment the driver is
 * waiting to see their route — and again on every reroute, on cellular.
 *
 * So the server sends what the provider gave it, and `hydrateRoute` below
 * turns it into the type the rest of the application actually uses. Nothing
 * outside this file and `/api/route` ever sees the wire shape.
 */

export interface RouteWireStepManeuver {
  readonly kind: string;
  readonly direction: string | null;
  readonly coordinate: Coordinate;
  readonly bearingBefore: number;
  readonly bearingAfter: number;
  readonly roundaboutExit: number | null;
  readonly exitNumber: string | null;
}

export interface RouteWireStep {
  readonly maneuver: RouteWireStepManeuver;
  readonly roadName: string | null;
  readonly roadRef: string | null;
  readonly towards: string | null;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly voice: readonly {
    readonly atRemainingMeters: number;
    readonly text: string;
    readonly ssml: string | null;
  }[];
  readonly banner: readonly {
    readonly atRemainingMeters: number;
    readonly primary: string;
    readonly secondary: string | null;
    readonly detail: string | null;
  }[];
  readonly geometryStart: number;
  readonly geometryEnd: number;
  readonly instruction: string;
}

export interface RouteWireLeg {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly steps: readonly RouteWireStep[];
}

export interface RouteWire {
  readonly id: string;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly typicalDurationSeconds: number | null;
  /** Encoded polyline, precision 6. */
  readonly polyline: string;
  readonly legs: readonly RouteWireLeg[];
  readonly bounds: AtlasRouteBounds;
  readonly voiceLocale: string | null;
  readonly provider: string;
  readonly requestedAt: number;
}

/** What `/api/route` returns. Mirrors `RouteOutcome`, minus hydration. */
export type RouteWireResponse =
  | { readonly ok: true; readonly routes: readonly RouteWire[] }
  | {
      readonly ok: false;
      readonly failure: string;
      readonly status?: number | null;
      readonly detail?: string;
    };

/**
 * Distance from the route start to each vertex.
 *
 * Computed once per route, because progress tracking runs on every GPS fix and
 * an O(n) walk over a few thousand vertices several times a second is exactly
 * the kind of cost that shows up as a stuttering camera on a phone.
 */
export function cumulativeDistances(
  geometry: readonly Coordinate[],
): number[] {
  const cumulative = new Array<number>(geometry.length);
  let running = 0;

  for (let i = 0; i < geometry.length; i++) {
    if (i > 0) running += distanceMeters(geometry[i - 1]!, geometry[i]!);
    cumulative[i] = running;
  }

  return cumulative;
}

/**
 * Turns a wire route into the type the application uses.
 *
 * Throws if the geometry cannot be decoded — see `decodePolyline` for why a
 * partially-decoded route is more dangerous than no route at all.
 */
export function hydrateRoute(wire: RouteWire): AtlasRoute {
  const geometry = decodePolyline(wire.polyline);
  const cumulative = cumulativeDistances(geometry);

  const legs: AtlasRouteLeg[] = wire.legs.map((leg) => ({
    distanceMeters: leg.distanceMeters,
    durationSeconds: leg.durationSeconds,
    steps: leg.steps.map((step) => ({
      maneuver: {
        // The wire carries these as strings because JSON has no enums. They
        // were produced by the mapper from its own closed vocabulary, so the
        // assertion is narrowing a round trip, not trusting a vendor.
        kind: step.maneuver.kind as AtlasRoute["legs"][number]["steps"][number]["maneuver"]["kind"],
        direction: step.maneuver
          .direction as AtlasRoute["legs"][number]["steps"][number]["maneuver"]["direction"],
        coordinate: step.maneuver.coordinate,
        bearingBefore: step.maneuver.bearingBefore,
        bearingAfter: step.maneuver.bearingAfter,
        roundaboutExit: step.maneuver.roundaboutExit,
        exitNumber: step.maneuver.exitNumber,
      },
      roadName: step.roadName,
      roadRef: step.roadRef,
      towards: step.towards,
      distanceMeters: step.distanceMeters,
      durationSeconds: step.durationSeconds,
      voice: step.voice,
      banner: step.banner,
      geometryStart: step.geometryStart,
      geometryEnd: step.geometryEnd,
      instruction: step.instruction,
    })),
  }));

  return {
    id: wire.id,
    distanceMeters: wire.distanceMeters,
    durationSeconds: wire.durationSeconds,
    typicalDurationSeconds: wire.typicalDurationSeconds,
    geometry,
    cumulative,
    legs,
    bounds: wire.bounds,
    voiceLocale: wire.voiceLocale,
    provider: wire.provider,
    requestedAt: wire.requestedAt,
  };
}
