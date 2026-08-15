/**
 * DATA PROVENANCE
 *
 * Ported from the Swift foundation's `DataSource`. The rule it enforces:
 * **never make the product appear more functional than it actually is.**
 *
 * The design goal here is structural, not advisory. A developer should not have
 * to *remember* which values are real — the type system should make it hard to
 * display a value without having considered where it came from. So the core
 * type is not a raw value plus a loose label; it is a discriminated union in
 * which an unavailable value carries no data at all. You cannot read a number
 * off an `Unavailable` reading, because there isn't one.
 */

export type Provenance =
  /** Real sensor, service, or live API. */
  | "live"
  /** Entered by the user. Trustworthy, but not measured. */
  | "user"
  /** Computed from other values (e.g. distance from two coordinates). */
  | "derived"
  /** Previously live, now served from cache. May be stale. */
  | "cached"
  /** Intentionally fake, for development. Must be visible in the UI. */
  | "simulated"
  /** Structural placeholder — shape only, no meaning. */
  | "placeholder";

/**
 * Why a reading has no value. Distinguishing these matters: "you denied
 * permission" and "your device has no GPS" need different UI and different
 * recovery paths.
 */
export type UnavailableReason =
  | "not-requested"
  | "permission-denied"
  | "unsupported"
  | "acquiring"
  | "position-unavailable"
  | "timeout"
  | "not-configured"
  | "error";

export type Reading<T> =
  | { readonly status: "available"; readonly value: T; readonly provenance: Provenance; readonly at: number }
  | { readonly status: "unavailable"; readonly reason: UnavailableReason; readonly detail?: string };

/** A live sensor or API value. */
export function live<T>(value: T, at: number = Date.now()): Reading<T> {
  return { status: "available", value, provenance: "live", at };
}

/** A value the user entered themselves. */
export function userEntered<T>(value: T, at: number = Date.now()): Reading<T> {
  return { status: "available", value, provenance: "user", at };
}

/** A value computed from other readings. */
export function derived<T>(value: T, at: number = Date.now()): Reading<T> {
  return { status: "available", value, provenance: "derived", at };
}

/** A cached value. May be stale — the UI should be able to say so. */
export function cached<T>(value: T, at: number): Reading<T> {
  return { status: "available", value, provenance: "cached", at };
}

/**
 * A deliberately fake value for development.
 *
 * Anything built from this must surface as simulated in the UI. `isSimulated`
 * below is what the honesty badge reads.
 */
export function simulated<T>(value: T, at: number = Date.now()): Reading<T> {
  return { status: "available", value, provenance: "simulated", at };
}

/** Structural placeholder — has a shape, carries no meaning. */
export function placeholder<T>(value: T): Reading<T> {
  return { status: "available", value, provenance: "placeholder", at: 0 };
}

/** No value, with a reason. */
export function unavailable<T>(reason: UnavailableReason, detail?: string): Reading<T> {
  return detail === undefined
    ? { status: "unavailable", reason }
    : { status: "unavailable", reason, detail };
}

// ---------------------------------------------------------------------------
// Reading helpers
// ---------------------------------------------------------------------------

export function isAvailable<T>(
  r: Reading<T>,
): r is Extract<Reading<T>, { status: "available" }> {
  return r.status === "available";
}

/**
 * The value, or `undefined`. Note there is deliberately no `valueOr(default)`
 * helper: defaulting an unknown sensor reading to a plausible number is exactly
 * the failure this module exists to prevent. "0 mph" and "no GPS fix" are
 * different facts and must look different.
 */
export function valueOf<T>(r: Reading<T>): T | undefined {
  return r.status === "available" ? r.value : undefined;
}

export function mapReading<T, U>(r: Reading<T>, fn: (value: T) => U): Reading<U> {
  return r.status === "available" ? { ...r, value: fn(r.value) } : r;
}

/** Provenance that must be disclosed to the user when present. */
const DISCLOSED: ReadonlySet<Provenance> = new Set<Provenance>([
  "simulated",
  "placeholder",
]);

export function isSimulated<T>(r: Reading<T>): boolean {
  return r.status === "available" && DISCLOSED.has(r.provenance);
}

/** True if any reading in the set requires disclosure. */
export function anySimulated(readings: ReadonlyArray<Reading<unknown>>): boolean {
  return readings.some(isSimulated);
}

/**
 * The em-dash rule: an unavailable reading renders as `—`, never as `0` and
 * never as a plausible-looking number. Centralized so every surface in the app
 * fails the same, correct way.
 */
export const EM_DASH = "—";

export function formatReading<T>(
  r: Reading<T>,
  format: (value: T) => string,
): string {
  return r.status === "available" ? format(r.value) : EM_DASH;
}

/**
 * Short human label for an unavailable reason. Used as the legend above a
 * dashed-out metric, so the user knows *why* a value is missing.
 */
export function reasonLabel(reason: UnavailableReason): string {
  switch (reason) {
    case "not-requested":
      return "Not enabled";
    case "permission-denied":
      return "Denied";
    case "unsupported":
      return "Unsupported";
    case "acquiring":
      return "Acquiring";
    case "position-unavailable":
      return "No signal";
    case "timeout":
      return "Timed out";
    case "not-configured":
      return "Not configured";
    case "error":
      return "Error";
  }
}
