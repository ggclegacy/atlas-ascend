import { describe, expect, it } from "vitest";
import {
  describeVerdict,
  type PixelStats,
  type RenderVerdict,
  verdictFor,
} from "@/features/debug/pixels";

/**
 * The render verdict is the instrument that finally separates the two failures
 * this investigation kept conflating:
 *
 *   "nothing drew"  vs  "everything drew but it is too dark to see"
 *
 * Both look like a black rectangle. They have completely different fixes, so
 * the classification boundaries are worth pinning down.
 */

function stats(partial: Partial<PixelStats>): PixelStats {
  return {
    meanLuminance: 0,
    distinctColors: 1,
    nonBlackFraction: 0,
    maxLuminance: 0,
    ...partial,
  };
}

describe("render verdict", () => {
  it("reports blank when no framebuffer could be read", () => {
    expect(verdictFor(null)).toBe("blank");
  });

  it("reports flat for a single uniform fill", () => {
    // The signature of a style whose background applied but whose tiles never
    // arrived — distinct from a map that simply looks dark.
    expect(
      verdictFor(stats({ distinctColors: 1, meanLuminance: 6, maxLuminance: 10 })),
    ).toBe("flat");
    expect(verdictFor(stats({ distinctColors: 2, maxLuminance: 10 }))).toBe("flat");
  });

  it("reports unreadable when structure exists but nothing clears the visible threshold", () => {
    // This is exactly what the pre-fix atlasNight would have produced: many
    // distinct colors, all of them nearly black.
    expect(
      verdictFor(
        stats({
          distinctColors: 40,
          meanLuminance: 7,
          maxLuminance: 20,
          nonBlackFraction: 0.002,
        }),
      ),
    ).toBe("unreadable");
  });

  it("reports rendered for a genuine map", () => {
    expect(
      verdictFor(
        stats({
          distinctColors: 180,
          meanLuminance: 34,
          maxLuminance: 140,
          nonBlackFraction: 0.62,
        }),
      ),
    ).toBe("rendered");
  });

  it("does not call a dark-but-legible map unreadable", () => {
    // The corrected atlasNight: obsidian ground, roads up to #78788C. It is
    // dark by design and must still pass.
    expect(
      verdictFor(
        stats({
          distinctColors: 90,
          meanLuminance: 18,
          maxLuminance: 140,
          nonBlackFraction: 0.08,
        }),
      ),
    ).toBe("rendered");
  });

  it("treats a bright pixel count below one percent as unreadable", () => {
    // Boundary: structure present, but so little of it lit that a human sees
    // black. Distinct from `rendered`.
    expect(
      verdictFor(
        stats({
          distinctColors: 60,
          meanLuminance: 9,
          maxLuminance: 200,
          nonBlackFraction: 0.005,
        }),
      ),
    ).toBe("unreadable");
  });

  it("gives every verdict a distinct, non-empty description", () => {
    const verdicts: RenderVerdict[] = ["rendered", "flat", "blank", "unreadable"];
    const described = verdicts.map(describeVerdict);
    expect(new Set(described).size).toBe(verdicts.length);
    for (const text of described) expect(text.length).toBeGreaterThan(0);
  });
});
