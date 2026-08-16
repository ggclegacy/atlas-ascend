/**
 * OBJECTIVE RENDER DETECTION
 *
 * The whole investigation has been stuck on one ambiguous question: is the map
 * broken, or is it rendering something so dark it looks broken? Eyeballing a
 * screenshot cannot separate those. Sampling the actual framebuffer can.
 *
 * Requires the map to be constructed with `preserveDrawingBuffer: true`, which
 * is why this only runs in the debug harness — the flag costs real performance
 * and has no place in the product.
 */

export interface PixelStats {
  /** Mean perceptual luminance, 0–255. */
  readonly meanLuminance: number;
  /** Distinct quantized colors in the sample. 1 means a flat fill. */
  readonly distinctColors: number;
  /** Share of pixels brighter than near-black. */
  readonly nonBlackFraction: number;
  /** Brightest pixel found. */
  readonly maxLuminance: number;
}

export type RenderVerdict = "rendered" | "flat" | "blank" | "unreadable";

/**
 * Samples the map's framebuffer.
 *
 * Downscales to 64×64 first: the question is "is there structure here", and a
 * thumbnail answers it just as well as four million pixels for a fraction of
 * the cost.
 */
export function sampleCanvas(canvas: HTMLCanvasElement): PixelStats | null {
  try {
    const size = 64;
    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;

    const ctx = off.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(canvas, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const seen = new Set<number>();
    let total = 0;
    let max = 0;
    let nonBlack = 0;
    const pixels = size * size;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;

      // Rec. 601 luma — close enough to perceptual for a yes/no question.
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      total += luma;
      if (luma > max) max = luma;
      if (luma > 12) nonBlack++;

      // Quantize to 5 bits/channel so imperceptible gradient noise does not
      // inflate the distinct-color count into a false "rendered".
      seen.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
    }

    return {
      meanLuminance: total / pixels,
      distinctColors: seen.size,
      nonBlackFraction: nonBlack / pixels,
      maxLuminance: max,
    };
  } catch {
    // Tainted canvas or a lost context.
    return null;
  }
}

/**
 * Turns pixel statistics into a verdict.
 *
 * `flat` is the important one: a single uniform color means the style applied
 * its background and nothing else drew — the signature of tiles that never
 * arrived. That is a completely different bug from `blank` (no framebuffer at
 * all) and from `unreadable` (real structure, too dark to see), and conflating
 * them is what made this take three passes.
 */
export function verdictFor(stats: PixelStats | null): RenderVerdict {
  if (stats === null) return "blank";
  if (stats.distinctColors <= 2) return "flat";
  if (stats.maxLuminance < 24 || stats.nonBlackFraction < 0.01) return "unreadable";
  return "rendered";
}

export function describeVerdict(verdict: RenderVerdict): string {
  switch (verdict) {
    case "rendered":
      return "real geography drawn";
    case "flat":
      return "single flat color — tiles never drew";
    case "blank":
      return "no framebuffer could be read";
    case "unreadable":
      return "structure present but too dark to see";
  }
}
