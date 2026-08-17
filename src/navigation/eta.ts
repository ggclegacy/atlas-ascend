import type { AtlasRoute } from "@/routing/types";

/**
 * ARRIVAL ESTIMATES.
 *
 * Pure, so the one rule that matters can be stated once and tested rather than
 * re-derived at each call site.
 *
 * THE RULE: **ETA is always `now + durationSeconds`.**
 *
 * Atlas requests the `driving-traffic` profile, on which `duration` already
 * accounts for live conditions. `typicalDurationSeconds` is the baseline for
 * this time of day and must never drive an ETA — measured on a real response,
 * live was 582s against a typical 509s, so using the baseline would have put
 * arrival a minute early precisely when traffic made it matter.
 *
 * `now` is passed in rather than read from the clock, because an estimate that
 * cannot be tested at a fixed instant cannot be trusted at any instant.
 */

/** Below this, "slower than usual" is noise rather than information. */
const DELAY_SIGNIFICANT_SECONDS = 60;
const DELAY_SIGNIFICANT_RATIO = 0.1;

export interface ArrivalEstimate {
  /** Epoch ms the driver is expected to arrive. */
  readonly etaEpochMs: number;
  /** Seconds of travel, live-traffic aware. */
  readonly durationSeconds: number;
  /**
   * How much slower than usual, in seconds — `null` when there is no baseline
   * or the difference is not worth mentioning.
   */
  readonly delayVersusTypicalSeconds: number | null;
}

export function estimateArrival(route: AtlasRoute, now: number): ArrivalEstimate {
  const durationSeconds = Math.max(0, route.durationSeconds);
  const typical = route.typicalDurationSeconds;

  let delay: number | null = null;
  if (typical !== null && Number.isFinite(typical) && typical > 0) {
    const difference = durationSeconds - typical;
    // Both an absolute and a proportional floor: 90 seconds over on a 12-hour
    // drive is not traffic, and 90 seconds over on a 4-minute drive is.
    if (
      difference >= DELAY_SIGNIFICANT_SECONDS &&
      difference / typical >= DELAY_SIGNIFICANT_RATIO
    ) {
      delay = Math.round(difference);
    }
  }

  return {
    etaEpochMs: now + durationSeconds * 1000,
    durationSeconds,
    delayVersusTypicalSeconds: delay,
  };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * Travel time, at the precision a driver can act on.
 *
 * Never seconds. A route is an estimate with minutes of uncertainty, and
 * rendering "23 min 41 sec" claims an accuracy that does not exist — the kind
 * of false precision this project treats as a form of dishonesty.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";

  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 1) return "< 1 min";
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

/**
 * Clock time of arrival, in the viewer's own locale and timezone.
 *
 * Deliberately not "in 23 minutes" — that is the duration, shown separately.
 * The arrival clock is the number a driver compares against an appointment.
 */
export function formatArrivalClock(etaEpochMs: number, locale?: string): string {
  if (!Number.isFinite(etaEpochMs)) return "—";
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(etaEpochMs));
}

/**
 * Route distance for display.
 *
 * Tenths below ten miles, whole numbers above — the same ladder the rest of
 * the product uses, so a distance never changes precision between surfaces.
 */
export function formatRouteDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "—";
  const miles = meters / 1609.344;
  if (miles < 0.1) return "< 0.1 mi";
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles).toLocaleString("en-US")} mi`;
}

/** "6 min slower than usual", or `null` when there is nothing to say. */
export function describeDelay(estimate: ArrivalEstimate): string | null {
  if (estimate.delayVersusTypicalSeconds === null) return null;
  const minutes = Math.round(estimate.delayVersusTypicalSeconds / 60);
  if (minutes < 1) return null;
  return `${minutes} min slower than usual`;
}

/**
 * How this route compares to the fastest on offer.
 *
 * Alternates are only worth showing if the driver can see the trade instantly.
 * "+4 min" is that; a table of durations is not.
 */
export function compareToFastest(
  route: AtlasRoute,
  routes: readonly AtlasRoute[],
): string {
  const fastest = Math.min(...routes.map((r) => r.durationSeconds));
  const difference = Math.round((route.durationSeconds - fastest) / 60);
  if (difference <= 0) return "Fastest";
  return `+${difference} min`;
}
