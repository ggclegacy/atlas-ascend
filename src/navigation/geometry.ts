import type { Coordinate } from "@/map/types";

/**
 * NAVIGATION GEOMETRY.
 *
 * Segment projection, not nearest-vertex. The difference matters constantly:
 * on a motorway the provider may place vertices 200m apart, so the nearest
 * *vertex* to a car mid-segment can be 100m away while the car is sitting
 * exactly on the line. Nearest-vertex logic would report that as 100m off
 * route and reroute a driver who is going exactly the right way.
 *
 * All of this works in a local planar frame rather than on the sphere.
 * Over a single route segment — tens of metres, occasionally a few hundred —
 * the error from treating latitude and longitude as a flat grid is far below
 * GPS accuracy, and it avoids trigonometry per segment on every fix.
 */

const METERS_PER_DEGREE_LAT = 111_320;

/** Metres per degree of longitude at a given latitude. */
function metersPerDegreeLon(latitudeDegrees: number): number {
  return METERS_PER_DEGREE_LAT * Math.cos((latitudeDegrees * Math.PI) / 180);
}

/** A point in a local metre grid centred on some origin latitude. */
interface Planar {
  readonly x: number;
  readonly y: number;
}

function toPlanar(point: Coordinate, originLat: number): Planar {
  return {
    x: point.longitude * metersPerDegreeLon(originLat),
    y: point.latitude * METERS_PER_DEGREE_LAT,
  };
}

export interface SegmentProjection {
  /** Where along the segment, 0 at `a` and 1 at `b`. */
  readonly t: number;
  /** The projected point, on the segment. */
  readonly point: Coordinate;
  /** Perpendicular distance from the input to the segment, in metres. */
  readonly distanceMeters: number;
}

/**
 * Projects a point onto the segment `a`–`b`, clamped to the segment.
 *
 * A zero-length segment — which real route geometry contains, because
 * consecutive steps share their boundary vertex — projects to `a` with `t = 0`
 * rather than dividing by zero.
 */
export function projectOntoSegment(
  point: Coordinate,
  a: Coordinate,
  b: Coordinate,
): SegmentProjection {
  const originLat = a.latitude;
  const p = toPlanar(point, originLat);
  const pa = toPlanar(a, originLat);
  const pb = toPlanar(b, originLat);

  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return {
      t: 0,
      point: a,
      distanceMeters: Math.hypot(p.x - pa.x, p.y - pa.y),
    };
  }

  const raw = ((p.x - pa.x) * dx + (p.y - pa.y) * dy) / lengthSquared;
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;

  const projected: Coordinate = {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };

  return {
    t,
    point: projected,
    distanceMeters: Math.hypot(p.x - (pa.x + dx * t), p.y - (pa.y + dy * t)),
  };
}

/**
 * Smallest absolute difference between two bearings, in degrees, 0–180.
 *
 * Wrap-around is the whole point: 350° and 10° are twenty degrees apart, and
 * naive subtraction calls them 340 apart — which would read as driving the
 * wrong way every time a route crosses due north.
 */
export function bearingDifference(a: number, b: number): number {
  const diff = Math.abs(((a - b) % 360) + 360) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Index of the last entry in a sorted array that is `<= value`.
 *
 * Binary search, because the cumulative distance table for a long route has
 * thousands of entries and this runs on every fix.
 */
export function lowerBound(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length - 1;
  let answer = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (sorted[mid]! <= value) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return answer;
}
