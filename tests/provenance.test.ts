import { describe, expect, it } from "vitest";
import {
  EM_DASH,
  anySimulated,
  formatReading,
  isAvailable,
  isSimulated,
  live,
  mapReading,
  placeholder,
  reasonLabel,
  simulated,
  unavailable,
  userEntered,
  valueOf,
} from "@/lib/provenance";

/**
 * These tests enforce the honesty standard mechanically rather than by
 * discipline. Each one corresponds to a way the product could quietly start
 * lying to the user.
 */
describe("provenance", () => {
  it("renders an unavailable reading as an em-dash, never a number", () => {
    const noFix = unavailable<number>("position-unavailable");
    expect(formatReading(noFix, String)).toBe(EM_DASH);
    expect(formatReading(noFix, String)).not.toBe("0");
  });

  it("renders a genuine zero as zero", () => {
    // The counterpart to the rule above: a real reading of 0 must display as
    // 0, or "stopped" becomes indistinguishable from "unknown" in the other
    // direction.
    expect(formatReading(live(0), String)).toBe("0");
  });

  it("carries no value on an unavailable reading", () => {
    const reading = unavailable<number>("permission-denied");
    expect(valueOf(reading)).toBeUndefined();
    expect(isAvailable(reading)).toBe(false);
  });

  it("preserves the unavailable case through mapReading", () => {
    // Unit conversion must not resurrect a missing value as NaN or 0.
    const converted = mapReading(unavailable<number>("timeout"), (v) => v * 2);
    expect(converted.status).toBe("unavailable");
    expect(formatReading(converted, String)).toBe(EM_DASH);
  });

  it("transforms an available reading while keeping its provenance", () => {
    const converted = mapReading(live(10), (v) => v * 2);
    expect(valueOf(converted)).toBe(20);
    expect(isAvailable(converted) && converted.provenance).toBe("live");
  });

  it("flags simulated and placeholder data as requiring disclosure", () => {
    expect(isSimulated(simulated(42))).toBe(true);
    expect(isSimulated(placeholder(42))).toBe(true);
  });

  it("does not flag real data as requiring disclosure", () => {
    expect(isSimulated(live(42))).toBe(false);
    expect(isSimulated(userEntered(42))).toBe(false);
    // An unavailable reading is honest by construction — there is nothing to
    // disclose because there is no value being shown.
    expect(isSimulated(unavailable<number>("acquiring"))).toBe(false);
  });

  it("detects a single simulated value inside an otherwise-live set", () => {
    expect(anySimulated([live(1), live(2), simulated(3)])).toBe(true);
    expect(anySimulated([live(1), userEntered(2)])).toBe(false);
  });

  it("gives every unavailable reason a distinct human label", () => {
    const reasons = [
      "not-requested",
      "permission-denied",
      "unsupported",
      "acquiring",
      "position-unavailable",
      "timeout",
      "not-configured",
      "error",
    ] as const;

    const labels = reasons.map(reasonLabel);
    expect(new Set(labels).size).toBe(reasons.length);
    expect(labels.every((label) => label.length > 0)).toBe(true);
  });
});
