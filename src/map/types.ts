/**
 * ATLAS MAP — vendor-neutral types.
 *
 * Ported from the Swift foundation's `AtlasMap`. Feature code speaks in these
 * types and never imports anything from `mapbox-gl`. That boundary is the only
 * thing that makes the map vendor replaceable later, and it costs almost
 * nothing to maintain if it is respected from the start.
 *
 * Rule: no file outside `src/map/mapbox/` may import `mapbox-gl`.
 */

/** A geographic coordinate. */
export interface Coordinate {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Camera state.
 *
 * `pitch` is a first-class member rather than an afterthought, because the
 * product identity depends on the map being spatial. A flat top-down camera is
 * the wrong default for Atlas Ascend.
 */
export interface MapCamera {
  readonly center: Coordinate;
  /** Mapbox-convention zoom, roughly 0 (world) to 22 (building). */
  readonly zoom: number;
  /** Degrees from vertical. 0 is top-down; the navigation default is ~60. */
  readonly pitch: number;
  /** Degrees clockwise from true north. */
  readonly bearing: number;
}

/** How the camera should move to a new state. */
export type CameraTransition =
  /** No animation. For continuous location following, where animating each
   *  update fights the incoming stream and looks like drift. */
  | "immediate"
  /** Standard eased move for user-initiated recentering. */
  | "standard"
  /** Long, watchable flight. Reserved for context changes big enough to
   *  deserve one: starting a route, jumping to a saved destination. */
  | "cinematic";

/** Map presentation modes. */
export type MapPerspective = "driving" | "oriented" | "overview";

export const PERSPECTIVES: readonly MapPerspective[] = [
  "driving",
  "oriented",
  "overview",
] as const;

export function pitchFor(perspective: MapPerspective): number {
  switch (perspective) {
    case "driving":
      return 62;
    case "oriented":
      return 45;
    case "overview":
      return 0;
  }
}

export function perspectiveLabel(perspective: MapPerspective): string {
  switch (perspective) {
    case "driving":
      return "Driving";
    case "oriented":
      return "Oriented";
    case "overview":
      return "Overview";
  }
}

/**
 * Identifies a map style.
 *
 * `atlasNight` is authored in this repository as a full Mapbox style
 * specification (see `src/map/styles/atlas-night.ts`) rather than referenced as
 * a Mapbox Studio URL. Keeping it in version control means the map's visual
 * identity is reviewable, diffable, and cannot drift out from under the app.
 */
export type MapStyleId = "atlasNight";

/** Something drawn on the map. */
export type AnnotationKind =
  | { readonly type: "user-location"; readonly heading: number | null }
  | { readonly type: "destination" }
  | { readonly type: "waypoint"; readonly index: number }
  | { readonly type: "saved-place"; readonly icon: string };

export interface MapAnnotation {
  readonly id: string;
  readonly coordinate: Coordinate;
  readonly kind: AnnotationKind;
}

/** Everything a provider needs to render a frame. */
export interface MapConfiguration {
  readonly camera: MapCamera;
  readonly style: MapStyleId;
  readonly perspective: MapPerspective;
  readonly annotations: readonly MapAnnotation[];
}

// ---------------------------------------------------------------------------
// Geometry helpers — pure, testable, no vendor involved
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in meters (haversine). */
export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in degrees (0–360) from `a` to `b`. */
export function bearingDegrees(a: Coordinate, b: Coordinate): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLon = toRadians(b.longitude - a.longitude);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/**
 * The neutral default camera.
 *
 * Used on first load, before — and regardless of whether — location permission
 * is granted. Map rendering must never depend on geolocation: a user who denies
 * location still gets a real, useful map, and the camera only moves once a
 * genuine fix arrives.
 *
 * Austin is a deliberate choice: densely mapped, unambiguous at this zoom, and
 * obviously not a claim about where the user is.
 */
export const DEFAULT_CAMERA: MapCamera = {
  center: { latitude: 30.2672, longitude: -97.7431 },
  zoom: 15.5,
  pitch: 62,
  bearing: 0,
};

/** True when a camera is renderable — finite, in range, and not degenerate. */
export function isValidCamera(camera: MapCamera): boolean {
  return (
    isValidCoordinate(camera.center) &&
    Number.isFinite(camera.zoom) &&
    camera.zoom >= 0 &&
    camera.zoom <= 22 &&
    Number.isFinite(camera.pitch) &&
    camera.pitch >= 0 &&
    // Mapbox GL JS caps pitch at 85; this app caps it lower still.
    camera.pitch <= 85 &&
    Number.isFinite(camera.bearing) &&
    camera.bearing >= -360 &&
    camera.bearing <= 360
  );
}

export function isValidCoordinate(c: Coordinate): boolean {
  return (
    Number.isFinite(c.latitude) &&
    Number.isFinite(c.longitude) &&
    c.latitude >= -90 &&
    c.latitude <= 90 &&
    c.longitude >= -180 &&
    c.longitude <= 180
  );
}

// ---------------------------------------------------------------------------
// Unit formatting
// ---------------------------------------------------------------------------

const METERS_PER_MILE = 1609.344;

export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

/** Speed in m/s to whole mph. */
export function metersPerSecondToMph(mps: number): number {
  return Math.round(mps * 2.236936);
}

/** Distance for display: sub-mile in tenths, above that whole numbers. */
export function formatMiles(meters: number): string {
  const miles = metersToMiles(meters);
  if (miles < 10) return miles.toFixed(1);
  return Math.round(miles).toLocaleString("en-US");
}
