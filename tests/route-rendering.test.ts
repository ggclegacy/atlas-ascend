import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error - CJS style-spec bundle ships without a mapped types path
import { validate } from "mapbox-gl/dist/style-spec/index.cjs";
import { atlasNightStyle } from "@/map/mapbox/atlas-night";
import {
  ROUTE_COLORS,
  ROUTE_INSERT_BEFORE,
  ROUTE_LAYER_IDS,
  ROUTE_SOURCE_ALTERNATES,
  ROUTE_SOURCE_IDS,
  ROUTE_SOURCE_PRIMARY,
  emptyFeatureCollection,
  featureCollectionFor,
  lineStringFor,
  routeLayerSpecs,
  routeSourceSpec,
} from "@/map/mapbox/route-layers";
import { isDrawableRoute } from "@/map/mapbox/MapboxMapProvider";
import { MIN_ROAD_GROUND_DELTA, afterScrim, luma, peakScrimAlpha } from "@/map/legibility";
import type { AtlasRoute } from "@/routing/types";
import type { Coordinate } from "@/map/types";

/**
 * The Atlas gold route.
 *
 * Gold has been reserved for the active route since the beginning of this
 * project. These tests hold the two things that make it work: it must be
 * *visible* — through the Command Center's scrims, on a phone, in daylight —
 * and it must not destroy the map hierarchy it sits inside.
 */

function route(geometry: readonly Coordinate[], id = "r1"): AtlasRoute {
  return {
    id,
    distanceMeters: 1000,
    durationSeconds: 120,
    typicalDurationSeconds: null,
    geometry,
    cumulative: geometry.map((_, i) => i * 10),
    legs: [],
    bounds: {
      southwest: { latitude: 30, longitude: -98 },
      northeast: { latitude: 31, longitude: -97 },
    },
    voiceLocale: "en-US",
    provider: "test",
    requestedAt: 0,
  };
}

const LINE: readonly Coordinate[] = [
  { latitude: 30.2672, longitude: -97.7431 },
  { latitude: 30.2712, longitude: -97.7421 },
  { latitude: 30.2772, longitude: -97.7401 },
];

// ---------------------------------------------------------------------------
// Style validity — proven against Mapbox's validator, not asserted
// ---------------------------------------------------------------------------

describe("route layers are a valid Mapbox style", () => {
  it("validates when added to atlasNight", () => {
    // The route layers are added at runtime, so they are never seen by the
    // style-spec validation that covers atlasNight itself. Composing them here
    // is the only way that check happens before a deploy.
    const style = atlasNightStyle({ buildings3D: true, terrain: false }) as unknown as {
      sources: Record<string, unknown>;
      layers: unknown[];
    };

    for (const id of ROUTE_SOURCE_IDS) style.sources[id] = routeSourceSpec();
    style.layers.push(...routeLayerSpecs());

    const errors = validate(style) as Array<{ message: string }>;
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  it("declares lineMetrics, which line-gradient requires", () => {
    // Progress dimming in a later sub-phase needs this. Adding it afterwards
    // means recreating the source and every layer bound to it — mid-drive.
    expect((routeSourceSpec() as { lineMetrics?: boolean }).lineMetrics).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Placement in the hierarchy
// ---------------------------------------------------------------------------

describe("route placement", () => {
  it("inserts beneath the first label layer of atlasNight", () => {
    const style = atlasNightStyle({ buildings3D: true, terrain: false }) as unknown as {
      layers: { id: string; type: string }[];
    };

    const target = style.layers.findIndex((l) => l.id === ROUTE_INSERT_BEFORE);
    expect(target, `${ROUTE_INSERT_BEFORE} must exist in atlasNight`).toBeGreaterThan(-1);

    // Every label must be at or after the insertion point, so labels stay on
    // top of the route. A gold line over "Congress Ave" removes the one word
    // the driver needed.
    const symbols = style.layers
      .map((l, i) => ({ ...l, i }))
      .filter((l) => l.type === "symbol");
    expect(symbols.length).toBeGreaterThan(0);
    for (const symbol of symbols) {
      expect(symbol.i, `${symbol.id} must render above the route`).toBeGreaterThanOrEqual(
        target,
      );
    }

    // And every road and building must be before it, so the route is never
    // hidden underneath geometry.
    const occluders = style.layers
      .map((l, i) => ({ ...l, i }))
      .filter((l) => /^road-|^building/.test(l.id));
    expect(occluders.length).toBeGreaterThan(0);
    for (const occluder of occluders) {
      expect(occluder.i, `${occluder.id} must render below the route`).toBeLessThan(target);
    }
  });

  it("stacks alternates entirely beneath the primary", () => {
    // Alternates share the first and last mile with the primary almost always.
    // If any alternate layer sat above a primary one it would interrupt the
    // gold exactly where the two overlap.
    const ids = routeLayerSpecs().map((l) => l.id);
    const lastAlternate = Math.max(...ids.map((id, i) => (id.includes("-alt") ? i : -1)));
    const firstPrimary = Math.min(
      ...ids.map((id, i) => (id.includes("-alt") ? Number.MAX_SAFE_INTEGER : i)),
    );
    expect(lastAlternate).toBeLessThan(firstPrimary);
  });

  it("orders the gold stack casing → core → specular", () => {
    const ids = routeLayerSpecs().map((l) => l.id);
    expect(ids.indexOf("atlas-route-glow")).toBeLessThan(ids.indexOf("atlas-route-casing"));
    expect(ids.indexOf("atlas-route-casing")).toBeLessThan(ids.indexOf("atlas-route-core"));
    expect(ids.indexOf("atlas-route-core")).toBeLessThan(
      ids.indexOf("atlas-route-specular"),
    );
  });

  it("lists every layer it creates, so teardown can be exhaustive", () => {
    // A layer added but missing from ROUTE_LAYER_IDS leaks on every reroute.
    expect(routeLayerSpecs().map((l) => l.id).sort()).toEqual([...ROUTE_LAYER_IDS].sort());
  });
});

// ---------------------------------------------------------------------------
// Visibility — the invariant that matters
// ---------------------------------------------------------------------------

describe("the gold route survives the Command Center", () => {
  const GROUND = "#05050A"; // atlasNight obsidian
  const BRIGHTEST_ROAD = "#7C7C91"; // motorway, the hardest thing to beat

  it("separates from the ground by more than the road ladder does", () => {
    // The route is the single most important thing on screen. If it is no
    // more visible than an ordinary road, the hierarchy has failed.
    const delta = luma(ROUTE_COLORS.gold) - luma(GROUND);
    expect(delta).toBeGreaterThan(MIN_ROAD_GROUND_DELTA * 2);
  });

  it("stays visible under the worst scrim on a phone viewport", () => {
    // 852px is the iPhone-class viewport the scrim model is tuned against.
    // This is the exact measurement that the black-map incident proved nobody
    // can make by eye.
    const alpha = peakScrimAlpha(852);
    const route = afterScrim(luma(ROUTE_COLORS.gold), alpha);
    const ground = afterScrim(luma(GROUND), alpha);
    expect(route - ground).toBeGreaterThan(MIN_ROAD_GROUND_DELTA);
  });

  it("reads distinctly against the brightest road it can cross", () => {
    // Gold over a motorway fill is the worst case for the core; the casing is
    // what guarantees the edge, so both are checked.
    expect(
      Math.abs(luma(ROUTE_COLORS.gold) - luma(BRIGHTEST_ROAD)),
    ).toBeGreaterThan(10);
    expect(luma(ROUTE_COLORS.casing)).toBeLessThan(luma(BRIGHTEST_ROAD) - 40);
  });

  it("keeps alternates clearly subordinate but not invisible", () => {
    const gold = luma(ROUTE_COLORS.gold);
    const alt = luma(ROUTE_COLORS.alternate);
    const ground = luma(GROUND);

    // Present...
    expect(alt - ground).toBeGreaterThan(MIN_ROAD_GROUND_DELTA);
    // ...but never competing with the accent, and never brighter than the
    // brightest road, which would invert the hierarchy.
    expect(alt).toBeLessThan(gold);
    expect(alt).toBeLessThan(luma(BRIGHTEST_ROAD));
  });

  it("distinguishes alternates from the road network by hue, not just value", () => {
    // THE FAILURE FOUND ON SCREEN. A neutral grey alternate is invisible as a
    // *route* on this map: the road ladder is itself a cool grey ramp, so a
    // grey line reads as another road. The whole road ladder is cool
    // (blue >= red); an alternate must be warm to read as a route at all.
    const hex = (c: string) => {
      const v = parseInt(c.replace("#", ""), 16);
      return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
    };

    const alt = hex(ROUTE_COLORS.alternate);
    expect(alt.r, "alternate must be warm").toBeGreaterThan(alt.b);

    // Every road in the atlasNight ladder is cool or neutral, which is what
    // makes warmth a reliable signal.
    for (const road of ["#2E2E38", "#545463", "#7C7C91"]) {
      const c = hex(road);
      expect(c.b, `${road} is part of the cool road ladder`).toBeGreaterThanOrEqual(c.r);
    }
  });

  it("spends gold only on the primary route", () => {
    // The accent is reserved. An alternate rendered in gold would destroy the
    // signal that gold carries.
    const alternateLayers = routeLayerSpecs().filter((l) => l.id.includes("-alt"));
    const paints = JSON.stringify(alternateLayers);
    for (const goldish of [ROUTE_COLORS.gold, ROUTE_COLORS.goldBright, ROUTE_COLORS.specular]) {
      expect(paints.toUpperCase()).not.toContain(goldish.toUpperCase());
    }
  });
});

// ---------------------------------------------------------------------------
// Geometry validation
// ---------------------------------------------------------------------------

describe("route geometry is validated once, at the boundary", () => {
  it("accepts a real line", () => {
    expect(isDrawableRoute(route(LINE))).toBe(true);
  });

  it("rejects empty and single-point geometry", () => {
    expect(isDrawableRoute(route([]))).toBe(false);
    expect(isDrawableRoute(route([LINE[0]!]))).toBe(false);
  });

  it("rejects a degenerate line of repeated points", () => {
    // Renders nothing while still reporting as "a route" — the worst of both.
    expect(isDrawableRoute(route([LINE[0]!, LINE[0]!, LINE[0]!]))).toBe(false);
  });

  it("tolerates the duplicate boundary vertices steps legitimately share", () => {
    const withDuplicates = [LINE[0]!, LINE[0]!, LINE[1]!, LINE[1]!, LINE[2]!];
    expect(isDrawableRoute(route(withDuplicates))).toBe(true);
  });

  it("rejects an out-of-range coordinate", () => {
    // One bad vertex does not fail — it stretches the line across the world
    // and drags the camera framing with it.
    expect(
      isDrawableRoute(route([LINE[0]!, { latitude: 91, longitude: -97.7 }])),
    ).toBe(false);
    expect(
      isDrawableRoute(route([LINE[0]!, { latitude: 30.2, longitude: NaN }])),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GeoJSON construction
// ---------------------------------------------------------------------------

describe("GeoJSON construction", () => {
  it("emits longitude-first coordinates, as GeoJSON requires", () => {
    // Reversed, the route draws in the Indian Ocean.
    const feature = lineStringFor(LINE) as {
      geometry: { coordinates: number[][] };
    };
    expect(feature.geometry.coordinates[0]).toEqual([-97.7431, 30.2672]);
  });

  it("collects alternates into one feature collection", () => {
    const collection = featureCollectionFor([LINE, LINE]) as { features: unknown[] };
    expect(collection.features).toHaveLength(2);
    expect((emptyFeatureCollection() as { features: unknown[] }).features).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle — no orphaned layers or sources
// ---------------------------------------------------------------------------

/**
 * A Mapbox map stub that records source and layer bookkeeping.
 *
 * Deliberately strict: `addSource`/`addLayer` throw on a duplicate id, exactly
 * as Mapbox does. That is what makes "added exactly once across repeated
 * updates" a real assertion rather than a hopeful one.
 */
function fakeMap() {
  const sources = new Map<string, { data: unknown }>();
  const layers: string[] = [];
  const handlers = new Map<string, Array<(p?: unknown) => void>>();
  const styleLayers = [{ id: ROUTE_INSERT_BEFORE, type: "symbol" }];

  return {
    sources,
    layers,
    addedBefore: [] as (string | undefined)[],
    removed: false,

    on(event: string, handler: (p?: unknown) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    once(event: string, handler: (p?: unknown) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    emit(event: string, payload?: unknown) {
      for (const h of handlers.get(event) ?? []) h(payload);
    },

    isStyleLoaded: () => true,
    loaded: () => true,
    getStyle: () => ({ layers: styleLayers, sources: {} }),
    getCanvas: () => undefined,
    getCenter: () => ({ lat: 30, lng: -97 }),
    getZoom: () => 15,
    getPitch: () => 60,
    getBearing: () => 0,
    resize() {},
    remove() {
      this.removed = true;
    },

    getSource(id: string) {
      const entry = sources.get(id);
      return entry
        ? { setData: (d: unknown) => sources.set(id, { data: d }) }
        : undefined;
    },
    addSource(id: string, spec: unknown) {
      if (sources.has(id)) throw new Error(`duplicate source ${id}`);
      sources.set(id, { data: (spec as { data: unknown }).data });
    },
    removeSource(id: string) {
      sources.delete(id);
    },
    getLayer(id: string) {
      return layers.includes(id) || id === ROUTE_INSERT_BEFORE ? { id } : undefined;
    },
    addLayer(layer: { id: string }, before?: string) {
      if (layers.includes(layer.id)) throw new Error(`duplicate layer ${layer.id}`);
      layers.push(layer.id);
      this.addedBefore.push(before);
    },
    removeLayer(id: string) {
      const i = layers.indexOf(id);
      if (i >= 0) layers.splice(i, 1);
    },
  };
}

/**
 * The origin marker builds a real DOM node. The suite runs in `node`, so a
 * minimal document stands in — enough for `createElement`/`setAttribute`/
 * `style`/`appendChild`, which is all the marker touches.
 */
function stubDocument() {
  const node = () => ({
    setAttribute() {},
    style: {},
    appendChild() {},
    append() {},
    querySelector: () => null,
  });
  vi.stubGlobal("document", {
    createElement: node,
    // The destination marker is an inline SVG.
    createElementNS: node,
  });
}

class FakeMarker {
  setLngLat() {
    return this;
  }
  addTo() {
    return this;
  }
  remove() {}
}

const CONFIG = {
  camera: {
    center: { latitude: 30, longitude: -97 },
    zoom: 15,
    pitch: 60,
    bearing: 0,
  },
  style: "atlasNight" as const,
  perspective: "driving" as const,
  annotations: [],
};

async function makeHandle(map: ReturnType<typeof fakeMap>) {
  const { MapboxHandle } = await import("@/map/mapbox/MapboxMapProvider");
  const handle = new MapboxHandle(
    map as never,
    { Marker: FakeMarker } as never,
    CONFIG,
    { getBoundingClientRect: () => ({ width: 390, height: 844 }) } as never,
  );
  // Layers may only be attached after `style.load`, exactly as on a real map.
  map.emit("style.load");
  return handle;
}

describe("route lifecycle leaves nothing orphaned", () => {
  beforeEach(stubDocument);
  afterEach(() => vi.unstubAllGlobals());

  it("adds each source and layer exactly once across repeated updates", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = fakeMap();
    const handle = await makeHandle(map);

    // A reroute is a replacement, and happens repeatedly during one drive.
    handle.setRoutes([route(LINE, "a")], "a");
    handle.setRoutes([route(LINE, "b"), route(LINE, "c")], "b");
    handle.setRoutes([route(LINE, "d")], "d");

    expect(map.layers).toHaveLength(ROUTE_LAYER_IDS.length);
    expect(new Set(map.layers).size).toBe(ROUTE_LAYER_IDS.length);
    expect([...map.sources.keys()].sort()).toEqual([...ROUTE_SOURCE_IDS].sort());

    // Every layer inserted beneath the labels.
    expect(new Set(map.addedBefore)).toEqual(new Set([ROUTE_INSERT_BEFORE]));

    handle.destroy();
    expect(map.layers).toHaveLength(0);
    expect(map.sources.size).toBe(0);
    vi.restoreAllMocks();
  });

  it("clears geometry without tearing down the layer stack", async () => {
        const map = fakeMap();
    const handle = await makeHandle(map);

    handle.setRoutes([route(LINE, "a")], "a");
    handle.clearRoutes();

    // Removing and re-adding six layers on every reroute costs a style
    // recompilation and can drop a frame at the worst possible moment.
    expect(map.layers).toHaveLength(ROUTE_LAYER_IDS.length);
    const primary = map.sources.get(ROUTE_SOURCE_PRIMARY)!.data as { features?: unknown[] };
    const alternates = map.sources.get(ROUTE_SOURCE_ALTERNATES)!.data as {
      features?: unknown[];
    };
    expect(primary.features).toHaveLength(0);
    expect(alternates.features).toHaveLength(0);

    handle.destroy();
  });

  it("promotes an unknown primary id rather than drawing nothing", async () => {
        const map = fakeMap();
    const handle = await makeHandle(map);

    // Emphasis on the wrong route is recoverable. Drawing no route is not.
    handle.setRoutes([route(LINE, "a"), route(LINE, "b")], "does-not-exist");
    expect(handle.inspect().route.primaryRouteId).toBe("a");
    expect(handle.inspect().route.alternativeCount).toBe(1);

    handle.selectRoute("b");
    expect(handle.inspect().route.primaryRouteId).toBe("b");

    // Unknown ids are ignored rather than clearing the route.
    handle.selectRoute("nope");
    expect(handle.inspect().route.primaryRouteId).toBe("b");

    handle.destroy();
  });

  it("attaches layers for a route set before the style was ready", async () => {
    // THE RACE, observed in the browser. `setRoutes` landing before the style
    // is ready must not silently attach nothing: the preview sheet showed a
    // correct 163-vertex route while the map had zero route layers, and there
    // was no error anywhere because every individual step had "succeeded".
    const { MapboxHandle } = await import("@/map/mapbox/MapboxMapProvider");
    const map = fakeMap();
    const handle = new MapboxHandle(
      map as never,
      { Marker: FakeMarker } as never,
      CONFIG,
      { getBoundingClientRect: () => ({ width: 390, height: 844 }) } as never,
    );

    // No style.load yet — the map is still starting up.
    handle.setRoutes([route(LINE, "early")], "early");
    expect(map.layers, "nothing may be attached before style.load").toHaveLength(0);
    expect(handle.inspect().route.primaryRouteId).toBe("early");

    // The style arrives; the pending route must be drawn without being re-set.
    map.emit("style.load");
    expect(map.layers).toHaveLength(ROUTE_LAYER_IDS.length);
    const primary = map.sources.get(ROUTE_SOURCE_PRIMARY)!.data as {
      geometry?: { coordinates: unknown[] };
    };
    expect(primary.geometry?.coordinates.length).toBe(LINE.length);

    handle.destroy();
  });

  it("does not gate attachment on tiles still loading", async () => {
    // `isStyleLoaded()` reports false while tiles arrive — including during
    // the camera flight that frames a new route. Gating on it was the bug.
    const map = fakeMap();
    map.isStyleLoaded = () => false;
    const handle = await makeHandle(map);

    handle.setRoutes([route(LINE, "a")], "a");
    expect(map.layers).toHaveLength(ROUTE_LAYER_IDS.length);
    expect(handle.inspect().route.layerCount).toBe(ROUTE_LAYER_IDS.length);

    handle.destroy();
  });

  it("skips undrawable routes instead of drawing them partially", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = fakeMap();
    const handle = await makeHandle(map);

    handle.setRoutes([route([], "bad"), route(LINE, "good")], "bad");
    expect(handle.inspect().route.primaryRouteId).toBe("good");

    handle.setRoutes([route([], "all-bad")], "all-bad");
    expect(handle.inspect().route.primaryRouteId).toBeNull();

    handle.destroy();
    vi.restoreAllMocks();
  });
});
