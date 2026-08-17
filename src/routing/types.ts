import type { Coordinate } from "@/map/types";
import type { Destination } from "@/destinations/types";

/**
 * ATLAS ROUTING — vendor-neutral types.
 *
 * The same boundary discipline as `src/map/types.ts`, for the same reason:
 * feature code speaks these types and never sees a Mapbox Directions payload.
 * Only `src/routing/mapbox/` may know what the vendor's JSON looks like.
 *
 * Rule: no file outside `src/routing/mapbox/` may reference Mapbox Directions
 * field names (`bannerInstructions`, `voiceInstructions`, `maneuver.modifier`,
 * …). If a feature needs something the Atlas types cannot express, the fix is
 * to widen these types — not to reach through them.
 */

// ---------------------------------------------------------------------------
// Maneuvers
// ---------------------------------------------------------------------------

/**
 * What the driver has to do.
 *
 * Deliberately a closed Atlas vocabulary rather than a passthrough of the
 * provider's strings. A provider that invents a new maneuver type must map it
 * to something this app can actually draw an icon for, and `"unknown"` is the
 * honest landing place — an unrecognised maneuver still renders a legible card
 * with the road name and distance rather than a blank.
 */
export type AtlasManeuverKind =
  | "depart"
  | "turn"
  | "continue"
  | "merge"
  | "fork"
  | "on-ramp"
  | "off-ramp"
  | "roundabout"
  | "roundabout-exit"
  | "u-turn"
  | "arrive"
  | "unknown";

/** Which way, for the maneuvers that have a direction. */
export type AtlasManeuverDirection =
  | "left"
  | "slight-left"
  | "sharp-left"
  | "straight"
  | "right"
  | "slight-right"
  | "sharp-right"
  | "u-turn";

export interface AtlasManeuver {
  readonly kind: AtlasManeuverKind;
  /** `null` where the maneuver has no direction (depart, continue, arrive). */
  readonly direction: AtlasManeuverDirection | null;
  /** Where the maneuver happens. */
  readonly coordinate: Coordinate;
  /** Degrees from true north on approach and on exit. */
  readonly bearingBefore: number;
  readonly bearingAfter: number;
  /** Which exit to take, for roundabouts. `null` otherwise. */
  readonly roundaboutExit: number | null;
  /** Motorway exit number where the provider supplied one. */
  readonly exitNumber: string | null;
}

// ---------------------------------------------------------------------------
// Steps, legs, routes
// ---------------------------------------------------------------------------

export interface AtlasRouteStep {
  readonly maneuver: AtlasManeuver;
  /** The road being driven for this step. `null` for unnamed roads. */
  readonly roadName: string | null;
  /** Where this step leads — the sign you would read. `null` when unknown. */
  readonly towards: string | null;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  /**
   * Half-open index range into `AtlasRoute.geometry` covering this step.
   *
   * Indices rather than a copy of the coordinates: the geometry of a long
   * route is thousands of points, and duplicating slices per step would triple
   * the memory for no benefit. Progress tracking needs the indices anyway.
   */
  readonly geometryStart: number;
  readonly geometryEnd: number;
  /** Provider-authored instruction text. Display fallback, never parsed. */
  readonly instruction: string;
}

export interface AtlasRouteLeg {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly steps: readonly AtlasRouteStep[];
}

export interface AtlasRouteBounds {
  readonly southwest: Coordinate;
  readonly northeast: Coordinate;
}

export interface AtlasRoute {
  readonly id: string;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  /**
   * Duration with live traffic, when the provider supplied one. Kept separate
   * from `durationSeconds` so the UI can tell "45 minutes" from "45 minutes,
   * currently 58 because of traffic" instead of silently conflating them.
   */
  readonly durationInTrafficSeconds: number | null;
  /** The full decoded line, origin first. */
  readonly geometry: readonly Coordinate[];
  /**
   * Distance in meters from the route start to each geometry vertex.
   *
   * Precomputed once at construction because progress tracking runs on every
   * GPS fix. Recomputing it per fix turns an O(window) lookup into an O(n)
   * walk over thousands of points, several times a second, on a phone.
   *
   * Invariant: `cumulative.length === geometry.length`, monotonically
   * non-decreasing, `cumulative[0] === 0`.
   */
  readonly cumulative: readonly number[];
  readonly legs: readonly AtlasRouteLeg[];
  readonly bounds: AtlasRouteBounds;
  /** Provider id that produced this route, for diagnostics. */
  readonly provider: string;
  /** Epoch ms the route was requested. Traffic estimates go stale. */
  readonly requestedAt: number;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface RouteRequest {
  readonly origin: Coordinate;
  /**
   * The full destination, not a bare coordinate.
   *
   * Rerouting must preserve *what the user chose*, not just where it is — the
   * name is what the arrival card says and what Atlas will later speak.
   */
  readonly destination: Destination;
  /** Ask for alternates. Off during rerouting, where speed matters more. */
  readonly alternatives?: boolean;
  /** Course over ground in degrees, when known. Stops the provider routing
   *  the driver back the way they are already facing away from. */
  readonly headingDegrees?: number | null;
  readonly signal?: AbortSignal;
}

/**
 * Why a route could not be produced.
 *
 * Mirrors the search and map taxonomies: each value implies a different
 * recovery, and none of them is allowed to name a Mapbox account setting
 * unless the provider's response actually proved it.
 */
export type RouteFailure =
  /** No token in this build. */
  | "not-configured"
  /** The credential was refused — 401. Cause not knowable from status alone. */
  | "unauthorized"
  /** Accepted but refused — 403. Cause not knowable from status alone. */
  | "forbidden"
  /** The provider ran but found no route between these points. */
  | "no-route"
  /** Origin or destination could not be snapped to a road. */
  | "unroutable-point"
  | "rate-limited"
  | "network"
  | "timeout"
  /** The response arrived but did not match the provider's contract. */
  | "malformed-response"
  | "error";

export type RouteOutcome =
  | { readonly ok: true; readonly routes: readonly AtlasRoute[] }
  | {
      readonly ok: false;
      readonly failure: RouteFailure;
      /** HTTP status, when there was one. */
      readonly status?: number | null;
      /** What the provider actually said. Never a guess. */
      readonly detail?: string;
    };

/**
 * The routing vendor boundary.
 *
 * An interface for the same reason `PlaceSearchProvider` is one: routing,
 * geocoding, and map rendering are three separable vendor relationships, and
 * binding them together is expensive to undo. The first implementation is
 * Mapbox Directions; nothing above this line will know that.
 */
export interface RoutingProvider {
  readonly id: string;
  route(request: RouteRequest): Promise<RouteOutcome>;
}
