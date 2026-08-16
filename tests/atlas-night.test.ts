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

  it("keeps every road class legible against the obsidian ground", () => {
    // The 2026-08-15 regression: roads topped out at #525263 on #05050A, which
    // is a working map that reads as a black rectangle on a phone in daylight.
    // "Obsidian" means depth, not invisibility — the network must clear the
    // ground by a real margin at every level of the hierarchy.
    const layers = build().layers;
    const channelSum = (hex: string): number => {
      const v = parseInt(hex.slice(1), 16);
      return ((v >> 16) & 0xff) + ((v >> 8) & 0xff) + (v & 0xff);
    };

    const background = layers.find((l) => l.id === "background");
    const ground = channelSum(background?.paint?.["background-color"] as string);

    // The casing is deliberately *darker* than the ground — it is the cut
    // channel the road fill sits in, not a visible surface of its own.
    const roads = layers.filter(
      (l) => l.id.startsWith("road-") && l.id !== "road-casing",
    );
    for (const road of roads) {
      const color = road.paint?.["line-color"];
      if (typeof color !== "string") continue;
      expect(
        channelSum(color) - ground,
        `${road.id} is too close to the ground to see`,
      ).toBeGreaterThanOrEqual(100);
    }

    // The most important class must be unmistakable.
    const motorway = layers.find((l) => l.id === "road-motorway");
    expect(
      channelSum(motorway?.paint?.["line-color"] as string) - ground,
    ).toBeGreaterThanOrEqual(300);
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

  it("compares boolean tile fields to booleans, not strings", () => {
    // `maritime` is a Boolean in mapbox-streets-v8. Comparing it to the string
    // "false" is a well-formed expression that is never true, so it silently
    // suppresses every admin boundary — invisible to the style validator.
    const admin = build().layers.filter((layer) => layer.id.startsWith("admin-"));
    expect(admin.length).toBeGreaterThan(0);

    for (const layer of admin) {
      const filter = JSON.stringify(
        (layer as unknown as { filter?: unknown }).filter ?? [],
      );
      expect(filter, `${layer.id} compares maritime to a string`).not.toContain(
        '"maritime"],"false"',
      );
    }
  });

  it("returns a fresh object each call", () => {
    // Mapbox mutates the style it is handed; sharing one instance between
    // maps causes subtle, miserable bugs.
    expect(build()).not.toBe(build());
  });
});
