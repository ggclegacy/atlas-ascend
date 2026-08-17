import type { Coordinate, MapCamera } from "@/map/types";
import type { AtlasRoute } from "@/routing/types";
import type { EdgePadding, SafeAreaInsets, Viewport } from "./framing";
import { bearingDifference } from "./geometry";
import { bearingDegrees } from "@/map/types";
import type { NavigationProgress } from "./engine";

/**
 * THE DRIVING CAMERA.
 *
 * Pure: it computes where the camera should be and returns it. Mapbox moves
 * the camera, but nothing about *what makes a good driving view* belongs to a
 * map vendor, and none of the decisions below can be tested through one.
 *
 * The governing problem is that a GPS fix arrives roughly once a second and is
 * wrong by several metres each time. A camera that faithfully follows every
 * fix shakes; a camera that ignores them lags. Everything here is about
 * spending the gap between those two well.
 */

export type NavigationCameraMode =
  /** Locked to the driver, course-up. The default while moving. */
  | "following"
  /** The driver panned the map. Automatic movement is suspended entirely. */
  | "exploring"
  /** One animated move back to following. */
  | "recentering"
  /** The remaining route, flat and north-up. */
  | "overview";

/**
 * Camera tuning, in one place.
 *
 * Scattering these through the controller makes it impossible to answer "why
 * does it zoom out on the motorway" without reading all of it, and impossible
 * to change one without discovering the three it interacts with.
 */
export const CAMERA = {
  /** Cruising. Close enough to read street names, wide enough to see a junction. */
  CRUISE_ZOOM: 16.3,
  /** Approaching a maneuver: the junction becomes the subject. */
  MANEUVER_ZOOM: 17.2,
  /** Nothing to do for a long way: more road, less detail. */
  OPEN_ROAD_ZOOM: 15.5,

  /** Distance to the maneuver at which the camera starts closing in. */
  MANEUVER_ZOOM_AT_M: 300,
  /** Beyond this with no maneuver, the view opens up. */
  OPEN_ROAD_AT_M: 1_500,

  /** Driving pitch. Spatial, and shows the road ahead rather than a plan. */
  DRIVE_PITCH: 60,
  /** Flattened slightly at a junction: less foreshortening, clearer geometry. */
  MANEUVER_PITCH: 50,

  /**
   * Fraction of the usable map height the driver sits below centre.
   *
   * The point of a driving camera is the road *ahead*. Centring the car wastes
   * half the screen on where it has already been.
   */
  FORWARD_LEAD: 0.22,

  /** Below this, a bearing change is noise and is ignored entirely. */
  BEARING_DEADBAND_DEG: 3,
  /**
   * Most the camera may rotate in one update.
   *
   * Without a cap, a heading that flips 180° — which a stopped phone does
   * constantly — spins the whole map in one frame and is genuinely
   * disorienting while driving.
   */
  BEARING_MAX_STEP_DEG: 22,

  /** Camera animation length. Matched to the ~1Hz fix rate so moves join up. */
  FOLLOW_DURATION_MS: 950,

  /** Zoom/pitch changes smaller than these are not worth an animation. */
  ZOOM_DEADBAND: 0.05,
  PITCH_DEADBAND_DEG: 1.5,
} as const;

export interface CameraTarget {
  readonly center: Coordinate;
  readonly zoom: number;
  readonly pitch: number;
  readonly bearing: number;
  /**
   * Where in the viewport `center` is placed.
   *
   * This is what puts the driver low on the screen and leaves the top for the
   * maneuver card — done with padding rather than by offsetting the centre
   * coordinate, because an offset centre has to be recomputed for every zoom
   * and pitch, and padding does not.
   */
  readonly padding: EdgePadding;
}

/**
 * Which way the camera should face.
 *
 * Device heading is preferred but only above a speed floor: a stationary phone
 * reports whatever direction its last jitter pointed, and following that spins
 * the map while the driver sits at a light. Below the floor — or with no
 * heading at all — the route's own bearing at the driver's position is used,
 * which is both stable and, while on route, correct.
 */
export function courseBearing(input: {
  route: AtlasRoute;
  progress: NavigationProgress;
  headingDegrees: number | null;
  speedMps: number | null;
  previousBearing: number;
  minSpeedMps: number;
}): number {
  const { route, progress, headingDegrees, speedMps, previousBearing } = input;

  const headingTrusted =
    headingDegrees !== null &&
    Number.isFinite(headingDegrees) &&
    (speedMps === null || speedMps >= input.minSpeedMps);

  let desired: number | null = headingTrusted ? headingDegrees : null;

  if (desired === null) {
    const a = route.geometry[progress.segmentIndex];
    const b = route.geometry[progress.segmentIndex + 1];
    if (a && b) desired = bearingDegrees(a, b);
  }

  // Nothing trustworthy: hold the last orientation rather than snapping north.
  if (desired === null) return previousBearing;

  const change = bearingDifference(desired, previousBearing);
  if (change < CAMERA.BEARING_DEADBAND_DEG) return previousBearing;

  if (change <= CAMERA.BEARING_MAX_STEP_DEG) return desired;

  // Rotate the short way round, capped.
  const clockwise = (desired - previousBearing + 360) % 360 < 180;
  const step = clockwise ? CAMERA.BEARING_MAX_STEP_DEG : -CAMERA.BEARING_MAX_STEP_DEG;
  return (previousBearing + step + 360) % 360;
}

/**
 * Zoom for the road ahead.
 *
 * Three regimes rather than a continuous function of distance: a zoom that
 * changes on every fix is its own kind of instability, and the driver only
 * needs to know whether they are cruising, arriving at a junction, or on an
 * open road.
 */
export function navigationZoom(distanceToManeuverMeters: number): number {
  if (distanceToManeuverMeters <= CAMERA.MANEUVER_ZOOM_AT_M) {
    return CAMERA.MANEUVER_ZOOM;
  }
  if (distanceToManeuverMeters >= CAMERA.OPEN_ROAD_AT_M) {
    return CAMERA.OPEN_ROAD_ZOOM;
  }
  return CAMERA.CRUISE_ZOOM;
}

export function navigationPitch(distanceToManeuverMeters: number): number {
  return distanceToManeuverMeters <= CAMERA.MANEUVER_ZOOM_AT_M
    ? CAMERA.MANEUVER_PITCH
    : CAMERA.DRIVE_PITCH;
}

/**
 * Padding that seats the driver low on the screen with the road ahead above.
 *
 * `hudHeight` is the guidance card at the top; `controlsHeight` the metrics and
 * controls at the bottom. Both are excluded so the driver never sits underneath
 * their own interface.
 */
export function followPadding(
  viewport: Viewport,
  hudHeight: number,
  controlsHeight: number,
  safeArea: SafeAreaInsets,
): EdgePadding {
  const usable = Math.max(
    0,
    viewport.height - hudHeight - controlsHeight - safeArea.top - safeArea.bottom,
  );
  const lead = usable * CAMERA.FORWARD_LEAD;

  const top = safeArea.top + hudHeight + lead * 2;
  const bottom = safeArea.bottom + controlsHeight;

  // On a small screen the two can exceed the viewport; scale rather than
  // letting the camera resolve against a negative box.
  const total = top + bottom;
  const limit = viewport.height * 0.8;
  const scale = total > limit && total > 0 ? limit / total : 1;

  return {
    top: Math.round(top * scale),
    bottom: Math.round(bottom * scale),
    left: safeArea.left,
    right: safeArea.right,
  };
}

/** The complete follow-mode camera. */
export function followCamera(input: {
  route: AtlasRoute;
  progress: NavigationProgress;
  headingDegrees: number | null;
  speedMps: number | null;
  previousBearing: number;
  minSpeedMps: number;
  viewport: Viewport;
  hudHeight: number;
  controlsHeight: number;
  safeArea: SafeAreaInsets;
}): CameraTarget {
  return {
    center: input.progress.snapped,
    zoom: navigationZoom(input.progress.distanceToManeuverMeters),
    pitch: navigationPitch(input.progress.distanceToManeuverMeters),
    bearing: courseBearing(input),
    padding: followPadding(
      input.viewport,
      input.hudHeight,
      input.controlsHeight,
      input.safeArea,
    ),
  };
}

/**
 * Whether a new target is different enough to be worth animating.
 *
 * Every skipped update is an animation that does not interrupt the one already
 * running. Re-issuing a near-identical camera move at 1Hz is what makes a map
 * feel like it is vibrating rather than tracking.
 */
export function cameraChanged(
  previous: MapCamera | null,
  next: CameraTarget,
  minCenterShiftMeters = 2,
): boolean {
  if (previous === null) return true;

  if (bearingDifference(previous.bearing, next.bearing) >= CAMERA.BEARING_DEADBAND_DEG) {
    return true;
  }
  if (Math.abs(previous.zoom - next.zoom) >= CAMERA.ZOOM_DEADBAND) return true;
  if (Math.abs(previous.pitch - next.pitch) >= CAMERA.PITCH_DEADBAND_DEG) return true;

  // Rough metres — exact geodesy is not needed for a deadband.
  const dLat = (next.center.latitude - previous.center.latitude) * 111_320;
  const dLon =
    (next.center.longitude - previous.center.longitude) *
    111_320 *
    Math.cos((next.center.latitude * Math.PI) / 180);
  return Math.hypot(dLat, dLon) >= minCenterShiftMeters;
}

/**
 * The remaining route, for overview mode.
 *
 * Only what is left: a driver forty minutes into an hour's drive does not need
 * to see where they started, and including it shrinks the part they care about.
 */
export function remainingRouteBounds(
  route: AtlasRoute,
  progress: NavigationProgress,
): { southwest: Coordinate; northeast: Coordinate } {
  let south = 90;
  let west = 180;
  let north = -90;
  let east = -180;

  const from = Math.max(0, progress.segmentIndex);
  const points = [progress.snapped, ...route.geometry.slice(from + 1)];

  for (const point of points.length >= 2 ? points : route.geometry) {
    south = Math.min(south, point.latitude);
    west = Math.min(west, point.longitude);
    north = Math.max(north, point.latitude);
    east = Math.max(east, point.longitude);
  }

  return {
    southwest: { latitude: south, longitude: west },
    northeast: { latitude: north, longitude: east },
  };
}
