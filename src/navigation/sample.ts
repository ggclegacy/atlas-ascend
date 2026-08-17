import type { Coordinate } from "@/map/types";

/**
 * A single position fix, as Atlas models it.
 *
 * `heading` and `speed` are `null` far more often than not — the Geolocation
 * API reports them only when the device is confident, which on most phones
 * means only while genuinely moving, and on desktop essentially never. They
 * are optional signals that strengthen a conclusion, never inputs the engine
 * requires. Nothing here is ever fabricated: an absent heading stays absent
 * rather than being derived and presented as measured.
 */
export interface NavigationSample {
  readonly coordinate: Coordinate;
  /** Epoch ms, from the fix itself rather than from when it was handled. */
  readonly timestamp: number;
  /** Horizontal accuracy in metres — the radius, not a guess. */
  readonly accuracyMeters: number;
  /** Degrees from true north, when the device reported one. */
  readonly headingDegrees: number | null;
  /** Metres per second, when the device reported one. */
  readonly speedMps: number | null;
}

/** How much a fix can be trusted, before the route is consulted at all. */
export type SampleQuality =
  /** Good enough to move progress and to accumulate off-route evidence. */
  | "good"
  /** Usable for progress, but too vague to argue the driver has left the route. */
  | "degraded"
  /** Not used at all. */
  | "rejected";

/** Why a fix was not fully trusted. `null` when it was. */
export type SampleRejection =
  | "accuracy"
  | "implausible-jump"
  | "out-of-order"
  | "malformed";

export interface SampleVerdict {
  readonly quality: SampleQuality;
  readonly rejection: SampleRejection | null;
}

/** Coordinates that would poison every downstream calculation. */
export function isUsableCoordinate(c: Coordinate): boolean {
  return (
    Number.isFinite(c.latitude) &&
    Number.isFinite(c.longitude) &&
    Math.abs(c.latitude) <= 90 &&
    Math.abs(c.longitude) <= 180
  );
}
