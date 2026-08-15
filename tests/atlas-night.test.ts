import { describe, expect, it } from "vitest";
import { atlasNightStyle } from "@/map/mapbox/atlas-night";

/**
 * The map style is product identity, so its design discipline is asserted
 * rather than trusted. These tests fail loudly if someone paints the road
 * network gold or lets POI noise back in.
 */

interface Layer {
  id: string;
  type: string;
  minzoom?: number;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

function build(overrides?: { buildings3D?: boolean; terrain?: boolean }) {
  const style = atlasNightStyle({
    buildings3D: overrides?.buildings3D ?? true,
    terrain: overrides?.terrain ?? false,
  });
  return style as unknown as {
    version: number;
    layers: Layer[];
    sources: Record<string, unknown>;
    fog?: Record<string, unknown>;
    terrain?: unknown;
    sprite?: string;
  };
}

/** Any hex that reads as gold: red high, green mid, blue low. */
function isGoldish(hex: string): boolean {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return false;
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return r > 120 && g > 80 && b < 90 && r - b > 60;
}

describe("atlasNight style", () => {
  it("is a valid style spec version 8 with a vector source", () => {
    const style = build();
    expect(style.version).toBe(8);
    expect(Object.keys(style.sources).length).toBeGreaterThan(0);
  });

  it("has a unique id for every layer", () => {
    const ids = build().layers.map((layer) => layer.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("paints the ground obsidian, not grey", () => {
    const background = build().layers.find((layer) => layer.id === "background");
    expect(background).toBeDefined();
    const color = background?.paint?.["background-color"] as string;
    // Every channel must be very dark — this is the obsidian rule.
    const value = parseInt(color.slice(1), 16);
    expect((value >> 16) & 0xff).toBeLessThan(24);
    expect((value >> 8) & 0xff).toBeLessThan(24);
    expect(value & 0xff).toBeLessThan(32);
  });

  it("never paints a road gold", () => {
    // Brand-color scarcity: gold is reserved for the active route and
    // precision information, added at runtime. Baking it into the road
    // network would spend the accent on permanent chrome.
    const roads = build().layers.filter((layer) => layer.id.startsWith("road-"));
    expect(roads.length).toBeGreaterThan(0);

    for (const road of roads) {
      const color = road.paint?.["line-color"];
      if (typeof color === "string") {
        expect(isGoldish(color), `${road.id} is gold`).toBe(false);
      }
    }
  });

  it("brightens the road ladder with importance", () => {
    const layers = build().layers;
    const luminance = (id: string): number => {
      const layer = layers.find((candidate) => candidate.id === id);
      const color = layer?.paint?.["line-color"] as string;
      const value = parseInt(color.slice(1), 16);
      return ((value >> 16) & 0xff) + ((value >> 8) & 0xff) + (value & 0xff);
    };

    // Hierarchy must be readable at a glance while driving.
    const ladder = [
      "road-service",
      "road-street",
      "road-tertiary",
      "road-secondary",
      "road-primary",
      "road-trunk",
      "road-motorway",
    ];

    for (let i = 1; i < ladder.length; i++) {
      expect(
        luminance(ladder[i] as string),
        `${ladder[i]} must be brighter than ${ladder[i - 1]}`,
      ).toBeGreaterThan(luminance(ladder[i - 1] as string));
    }
  });

  it("keeps POI labels aggressively filtered and high-zoom only", () => {
    const poi = build().layers.find((layer) => layer.id === "label-poi");
    expect(poi).toBeDefined();
    expect(poi?.minzoom).toBeGreaterThanOrEqual(15);
  });

  it("declares no sprite, since POI icons are intentionally omitted", () => {
    expect(build().sprite).toBeUndefined();
  });

  it("includes atmospheric fog for depth", () => {
    expect(build().fog).toBeDefined();
  });

  it("omits 3D building extrusions when the device cannot afford them", () => {
    const without = build({ buildings3D: false });
    expect(without.layers.some((layer) => layer.type === "fill-extrusion")).toBe(
      false,
    );

    const with3D = build({ buildings3D: true });
    expect(with3D.layers.some((layer) => layer.type === "fill-extrusion")).toBe(
      true,
    );
  });

  it("adds the terrain source only when terrain is requested", () => {
    expect(build({ terrain: false }).terrain).toBeUndefined();
    const withTerrain = build({ terrain: true });
    expect(withTerrain.terrain).toBeDefined();
    expect(withTerrain.sources["atlas-dem"]).toBeDefined();
  });

  it("returns a fresh object each call", () => {
    // Mapbox mutates the style it is handed; sharing one instance between
    // maps causes subtle, miserable bugs.
    expect(build()).not.toBe(build());
  });
});
