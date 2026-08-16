/**
 * LEGIBILITY MODEL
 *
 * The blank-map incident survived four passes because every diagnostic measured
 * the wrong surface. The framebuffer sampler reads `map.getCanvas()` — the
 * WebGL output — but the Command Center's scrims are DOM elements that
 * composite *on top* of that canvas in the browser. A canvas full of geography
 * and a screen that looks black are entirely compatible facts.
 *
 * This module models the composite analytically so it can be asserted in tests
 * instead of judged by eye. It is the "explicit design guard" the map has been
 * missing: nobody should be able to darken a scrim, or flatten the road ladder,
 * without a test failing.
 *
 * Pure and dependency-free — no DOM, no Mapbox.
 */

// ---------------------------------------------------------------------------
// Luminance
// ---------------------------------------------------------------------------

/** Rec. 601 luma, 0–255. Close enough to perceptual for a legibility floor. */
export function luma(hex: string): number {
  const value = parseInt(hex.replace("#", ""), 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Luminance after compositing black at `alpha` over it.
 *
 * Every Atlas scrim is pure black with a varying alpha, so this is the whole
 * compositing model: `result = source × (1 − alpha)`.
 */
export function afterScrim(sourceLuma: number, alpha: number): number {
  return sourceLuma * (1 - alpha);
}

// ---------------------------------------------------------------------------
// Scrim model — mirrors globals.css
// ---------------------------------------------------------------------------

export interface ScrimStop {
  /** Position within the scrim, 0 = its own start edge, 1 = its end. */
  readonly at: number;
  readonly alpha: number;
}

export interface Scrim {
  readonly id: string;
  readonly edge: "top" | "bottom";
  /** CSS pixels. Must match the Tailwind height class in CommandCenter. */
  readonly heightPx: number;
  readonly stops: readonly ScrimStop[];
}

/**
 * The Command Center's scrims, as actually rendered.
 *
 * **These values are duplicated from `globals.css` and `CommandCenter.tsx` and
 * must be kept in sync.** A test asserts the heights against the Tailwind
 * classes so the duplication cannot drift silently.
 */
export const COMMAND_CENTER_SCRIMS: readonly Scrim[] = [
  {
    id: "atlas-scrim-top",
    edge: "top",
    heightPx: 176, // h-44
    stops: [
      { at: 0, alpha: 0.55 },
      { at: 0.45, alpha: 0.2 },
      { at: 1, alpha: 0 },
    ],
  },
  {
    id: "atlas-scrim-bottom",
    edge: "bottom",
    heightPx: 288, // h-72
    stops: [
      { at: 0, alpha: 0 },
      { at: 0.45, alpha: 0.28 },
      { at: 1, alpha: 0.7 },
    ],
  },
] as const;

/** Linearly interpolated alpha at a normalized position within one scrim. */
function alphaWithin(scrim: Scrim, t: number): number {
  if (t <= 0) return scrim.stops[0]?.alpha ?? 0;
  const last = scrim.stops[scrim.stops.length - 1];
  if (t >= 1) return last?.alpha ?? 0;

  for (let i = 1; i < scrim.stops.length; i++) {
    const a = scrim.stops[i - 1];
    const b = scrim.stops[i];
    if (!a || !b) continue;
    if (t <= b.at) {
      const span = b.at - a.at;
      const local = span === 0 ? 0 : (t - a.at) / span;
      return a.alpha + (b.alpha - a.alpha) * local;
    }
  }
  return last?.alpha ?? 0;
}

/** Alpha contributed by one scrim at absolute viewport y. */
export function scrimAlphaAt(scrim: Scrim, y: number, viewportHeight: number): number {
  if (scrim.edge === "top") {
    if (y >= scrim.heightPx) return 0;
    return alphaWithin(scrim, y / scrim.heightPx);
  }
  const start = viewportHeight - scrim.heightPx;
  if (y <= start) return 0;
  return alphaWithin(scrim, (y - start) / scrim.heightPx);
}

/**
 * Combined alpha of every scrim at absolute viewport y.
 *
 * Overlapping translucent blacks combine as `1 − Π(1 − αᵢ)`, not by addition —
 * getting this wrong is how two "reasonable" scrims quietly produce an opaque
 * band where they meet.
 */
export function totalScrimAlphaAt(y: number, viewportHeight: number): number {
  let transmitted = 1;
  for (const scrim of COMMAND_CENTER_SCRIMS) {
    transmitted *= 1 - scrimAlphaAt(scrim, y, viewportHeight);
  }
  return 1 - transmitted;
}

/** Peak combined scrim alpha anywhere in the viewport. */
export function peakScrimAlpha(viewportHeight: number): number {
  let peak = 0;
  for (let y = 0; y <= viewportHeight; y++) {
    peak = Math.max(peak, totalScrimAlphaAt(y, viewportHeight));
  }
  return peak;
}

/**
 * Fraction of the viewport where scrim coverage is below `threshold` — the
 * band in which the map is seen essentially unmodified.
 */
export function clearBandFraction(viewportHeight: number, threshold = 0.05): number {
  let clear = 0;
  for (let y = 0; y <= viewportHeight; y++) {
    if (totalScrimAlphaAt(y, viewportHeight) < threshold) clear++;
  }
  return clear / (viewportHeight + 1);
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Minimum luminance separation between a road class and the ground it sits on,
 * measured *after* scrim compositing, for the map to read at a glance.
 *
 * 18 is not a WCAG figure — map lines are not body text. It is the empirical
 * floor below which a dark line on a dark ground stops resolving on a phone in
 * daylight.
 */
export const MIN_ROAD_GROUND_DELTA = 18;

/**
 * Ceiling on scrim coverage anywhere on screen.
 *
 * Above roughly 0.75 the map is functionally erased. Chrome that needs more
 * contrast than this must carry its own background (all Atlas glass panels do)
 * rather than darkening the whole map to get it.
 */
export const MAX_SCRIM_ALPHA = 0.75;

/** The map must be seen essentially unmodified across at least this much of the screen. */
export const MIN_CLEAR_BAND_FRACTION = 0.4;
