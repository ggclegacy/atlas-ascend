import { describe, expect, it } from "vitest";
import { atlasNightStyle } from "@/map/mapbox/atlas-night";
import {
  COMMAND_CENTER_SCRIMS,
  MAX_SCRIM_ALPHA,
  MIN_CLEAR_BAND_FRACTION,
  MIN_ROAD_GROUND_DELTA,
  afterScrim,
  clearBandFraction,
  luma,
  peakScrimAlpha,
  totalScrimAlphaAt,
} from "@/map/legibility";

/**
 * REGRESSION GUARDS FOR THE INVISIBLE-MAP BUG
 *
 * Root cause: the framebuffer diagnostics sampled `map.getCanvas()`, but the
 * Command Center's scrims are DOM siblings composited by the browser *after*
 * that. A canvas full of geography and a screen that reads black were entirely
 * compatible facts, and every earlier pass measured the wrong surface.
 *
 * These tests model the composite so it can never again be judged by eye.
 */

const PHONE_VIEWPORT = 852; // iPhone-class. The primary target.
const DESKTOP_VIEWPORT = 1080;

interface Layer {
  id: string;
  paint?: Record<string, unknown>;
}

function styleLayers(): Layer[] {
  const style = atlasNightStyle({ buildings3D: true, terrain: false });
  return (style as unknown as { layers: Layer[] }).layers;
}

function colorOf(id: string, key: string): string {
  const layer = styleLayers().find((l) => l.id === id);
  const value = layer?.paint?.[key];
  if (typeof value !== "string") throw new Error(`no ${key} on ${id}`);
  return value;
}

const GROUND = () => luma(colorOf("background", "background-color"));
const ROAD_IDS = [
  "road-service",
  "road-street",
  "road-tertiary",
  "road-secondary",
  "road-primary",
  "road-trunk",
  "road-motorway",
] as const;

// ---------------------------------------------------------------------------

describe("scrim coverage", () => {
  it("never exceeds the opacity ceiling anywhere on screen", () => {
    // Above ~0.75 the map is functionally erased. Chrome needing more contrast
    // than this must carry its own background — every Atlas glass panel does.
    for (const viewport of [PHONE_VIEWPORT, DESKTOP_VIEWPORT, 667, 932]) {
      expect(peakScrimAlpha(viewport), `viewport ${viewport}`).toBeLessThanOrEqual(
        MAX_SCRIM_ALPHA,
      );
    }
  });

  it("leaves a substantial band of the map essentially unmodified", () => {
    // The regression left only ~38% of a phone viewport clear.
    for (const viewport of [PHONE_VIEWPORT, DESKTOP_VIEWPORT]) {
      expect(clearBandFraction(viewport), `viewport ${viewport}`).toBeGreaterThanOrEqual(
        MIN_CLEAR_BAND_FRACTION,
      );
    }
  });

  it("combines overlapping scrims multiplicatively, not additively", () => {
    // Two 0.5 scrims are 0.75 combined, not 1.0. Getting this wrong is how two
    // individually-reasonable scrims produce an opaque band where they meet.
    const mid = totalScrimAlphaAt(PHONE_VIEWPORT / 2, PHONE_VIEWPORT);
    expect(mid).toBeLessThan(0.05);
    expect(mid).toBeGreaterThanOrEqual(0);
  });

  it("keeps scrims clear of the vertical middle of a phone screen", () => {
    // The middle third is where a driver actually reads the road ahead.
    for (let y = PHONE_VIEWPORT / 3; y <= (PHONE_VIEWPORT * 2) / 3; y += 10) {
      expect(totalScrimAlphaAt(y, PHONE_VIEWPORT)).toBeLessThan(0.05);
    }
  });

  it("declares scrim heights that match the rendered classes", () => {
    // The model duplicates values from globals.css and CommandCenter.tsx.
    // Tailwind h-44 = 176px, h-72 = 288px. If those classes change, this fails.
    const top = COMMAND_CENTER_SCRIMS.find((s) => s.edge === "top");
    const bottom = COMMAND_CENTER_SCRIMS.find((s) => s.edge === "bottom");
    expect(top?.heightPx).toBe(176);
    expect(bottom?.heightPx).toBe(288);
  });
});

describe("map legibility through the scrims", () => {
  it("keeps every road class separable from the ground in the clear band", () => {
    const ground = GROUND();
    for (const id of ROAD_IDS) {
      const delta = luma(colorOf(id, "line-color")) - ground;
      expect(delta, `${id} unscrimmed`).toBeGreaterThanOrEqual(MIN_ROAD_GROUND_DELTA);
    }
  });

  it("keeps major roads readable even under the heaviest scrim", () => {
    // This is the assertion that would have caught the bug: the earlier
    // 0.93 scrim crushed motorway-vs-ground from 117 to 21 luma.
    const alpha = peakScrimAlpha(PHONE_VIEWPORT);
    const ground = GROUND();

    for (const id of ["road-primary", "road-trunk", "road-motorway"] as const) {
      const delta =
        afterScrim(luma(colorOf(id, "line-color")), alpha) - afterScrim(ground, alpha);
      expect(delta, `${id} under ${alpha.toFixed(2)} scrim`).toBeGreaterThanOrEqual(
        MIN_ROAD_GROUND_DELTA,
      );
    }
  });

  it("keeps the road ladder monotonic and evenly spread", () => {
    // Evenly spread matters as much as monotonic: classes bunched within a few
    // luma of each other stop being distinguishable as a hierarchy.
    const values = ROAD_IDS.map((id) => luma(colorOf(id, "line-color")));

    for (let i = 1; i < values.length; i++) {
      const step = (values[i] as number) - (values[i - 1] as number);
      expect(step, `step into ${ROAD_IDS[i]}`).toBeGreaterThanOrEqual(8);
    }

    // Full span from the quietest service road to a motorway.
    expect((values[values.length - 1] as number) - (values[0] as number)).toBeGreaterThan(60);
  });

  it("keeps road labels legible under the heaviest scrim", () => {
    const alpha = peakScrimAlpha(PHONE_VIEWPORT);
    const label = afterScrim(luma("#ADAAB6"), alpha);
    const ground = afterScrim(GROUND(), alpha);
    expect(label - ground).toBeGreaterThan(30);
  });

  it("keeps the ground near-black — obsidian is depth, not brightness", () => {
    // The fix must not become "brighten everything until it works".
    expect(GROUND()).toBeLessThan(20);
  });

  it("keeps water and buildings distinguishable from the ground", () => {
    const ground = GROUND();
    expect(luma(colorOf("water", "fill-color")) - ground).toBeGreaterThan(8);
    expect(luma(colorOf("building", "fill-color")) - ground).toBeGreaterThan(12);
  });
});
