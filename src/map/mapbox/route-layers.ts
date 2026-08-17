import type { Coordinate } from "@/map/types";

/**
 * THE ATLAS GOLD ROUTE — style specification.
 *
 * Pure. Produces plain style-spec objects and imports nothing from `mapbox-gl`,
 * so the whole visual treatment can be validated against Mapbox's own
 * style-spec validator in CI — the same way `atlasNight` is — rather than only
 * being judged by eye after a deploy.
 *
 * DESIGN
 *
 * Gold has been reserved since the first line of this project for exactly one
 * thing: the active route. This is where it finally gets spent, and it has to
 * justify the wait. The brief is "illuminated through the obsidian world", not
 * "thick yellow line", and the difference is entirely in the layering:
 *
 *   1. glow      — wide, blurred, low-opacity gold. Light bleeding into the
 *                  ground around the route, so the route appears to *emit*
 *                  rather than to be painted on.
 *   2. casing    — near-black, slightly wider than the core. Reads as a cut
 *                  channel and guarantees an edge against any road colour
 *                  underneath, including the brightest motorway.
 *   3. core      — the canonical gold. The route itself.
 *   4. specular  — a narrow, much brighter centre line at partial opacity.
 *                  This is the one that makes it read as a machined metal
 *                  surface catching light rather than a flat fill, and it is
 *                  the same trick `.atlas-gold-metal` uses in CSS.
 *
 * Four thin line layers cost far less than one blurred layer with a large
 * blur radius, which matters because this runs on a phone while navigating.
 *
 * Alternates are deliberately NOT gold. Spending the accent on a route the
 * driver did not choose would destroy the signal — they are a cool desaturated
 * slate, clearly present, clearly secondary.
 */

// ---------------------------------------------------------------------------
// Identifiers — every id this module owns, so teardown can be exhaustive
// ---------------------------------------------------------------------------

export const ROUTE_SOURCE_PRIMARY = "atlas-route-primary";
export const ROUTE_SOURCE_ALTERNATES = "atlas-route-alternates";

/**
 * Layer ids, bottom to top. Teardown iterates this list, so a layer that is
 * added but not listed here would leak on every route replacement.
 */
export const ROUTE_LAYER_IDS = [
  "atlas-route-alt-casing",
  "atlas-route-alt",
  "atlas-route-glow",
  "atlas-route-casing",
  "atlas-route-core",
  "atlas-route-specular",
] as const;

export const ROUTE_SOURCE_IDS = [
  ROUTE_SOURCE_ALTERNATES,
  ROUTE_SOURCE_PRIMARY,
] as const;

/**
 * Where the route sits in `atlasNight`.
 *
 * Above every road, building and extrusion — a route hidden behind a tower is
 * a route the driver cannot follow, and this is the failure the brief calls
 * out explicitly. Below every label, because street and place names are the
 * context that makes the route *mean* something; a gold line painted over
 * "Congress Ave" removes the one word the driver needed.
 *
 * `label-road` is the first symbol layer in atlasNight. If it is ever renamed
 * the provider falls back to the first symbol layer it finds, and then to the
 * top of the stack — visible but above labels, which is the less bad failure.
 */
export const ROUTE_INSERT_BEFORE = "label-road";

// ---------------------------------------------------------------------------
// Palette — drawn from the established gold material, not invented
// ---------------------------------------------------------------------------

/** Canonical Ascend Gold. */
const GOLD = "#C4912F";
/** The lit face of the gold material. */
const GOLD_BRIGHT = "#DEB25E";
/** The specular band from `.atlas-gold-metal`. */
const GOLD_SPECULAR = "#F6E7BE";

/** Deeper than the road casing, so the route reads in front of the network. */
const ROUTE_CASING = "#08060F";

/**
 * Alternates: a dimmed, desaturated member of the gold family.
 *
 * The obvious choice is a neutral grey, which is what most navigation apps
 * use. On atlasNight it fails: the road ladder is already a cool grey ramp
 * topping out at `#7C7C91`, so a grey alternate reads as *another road* rather
 * than as another route. Verified on screen — the first cut used `#6E6980` and
 * was genuinely hard to tell from the motorway beneath it.
 *
 * Warm hue is what separates it from the network; low luminance is what keeps
 * it beneath the primary. It is dimmer than the brightest road, so it never
 * competes, while being the only warm line on the map besides the route it is
 * an alternative to — which is exactly the relationship it should express.
 */
const ALTERNATE = "#8A7442";
const ALTERNATE_CASING = "#0A0912";

/** Exported for the contrast invariant test. */
export const ROUTE_COLORS = {
  gold: GOLD,
  goldBright: GOLD_BRIGHT,
  specular: GOLD_SPECULAR,
  casing: ROUTE_CASING,
  alternate: ALTERNATE,
} as const;

// ---------------------------------------------------------------------------
// Widths
// ---------------------------------------------------------------------------

/**
 * Route width by zoom.
 *
 * Wider than any road in the ladder at the same zoom, because the route has to
 * be findable in a glance while driving, and hierarchy here is the point —
 * this is the only thing on screen the driver actually has to follow.
 */
function widthByZoom(
  stops: ReadonlyArray<readonly [zoom: number, width: number]>,
): unknown {
  return [
    "interpolate",
    ["exponential", 1.5],
    ["zoom"],
    ...stops.flatMap(([z, w]) => [z, w]),
  ];
}

const CORE_WIDTH = widthByZoom([
  [8, 2.5],
  [12, 4],
  [15, 6],
  [17, 9],
  [20, 16],
]);

const CASING_WIDTH = widthByZoom([
  [8, 5],
  [12, 7.5],
  [15, 10.5],
  [17, 14.5],
  [20, 23],
]);

const GLOW_WIDTH = widthByZoom([
  [8, 10],
  [12, 16],
  [15, 24],
  [17, 34],
  [20, 52],
]);

const SPECULAR_WIDTH = widthByZoom([
  [8, 0.8],
  [12, 1.2],
  [15, 1.8],
  [17, 2.6],
  [20, 4.5],
]);

const ALT_WIDTH = widthByZoom([
  [8, 2],
  [12, 3],
  [15, 4.5],
  [17, 6.5],
  [20, 11],
]);

const ALT_CASING_WIDTH = widthByZoom([
  [8, 4],
  [12, 5.5],
  [15, 7.5],
  [17, 10],
  [20, 16],
]);

const ROUND = { "line-cap": "round", "line-join": "round" } as const;

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** A GeoJSON LineString from Atlas coordinates. Longitude first, as GeoJSON requires. */
export function lineStringFor(geometry: readonly Coordinate[]): unknown {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: geometry.map((c) => [c.longitude, c.latitude]),
    },
  };
}

export function featureCollectionFor(
  geometries: readonly (readonly Coordinate[])[],
): unknown {
  return {
    type: "FeatureCollection",
    features: geometries.map((geometry) => lineStringFor(geometry)),
  };
}

/** An empty collection — the initial and cleared state of both sources. */
export function emptyFeatureCollection(): unknown {
  return { type: "FeatureCollection", features: [] };
}

export function routeSourceSpec(): unknown {
  return {
    type: "geojson",
    data: emptyFeatureCollection(),
    // Required for `line-gradient`, which sub-phase 5 uses to dim the travelled
    // portion of the route without rewriting geometry on every GPS fix.
    // Declared now because changing it later means recreating the source and
    // every layer that depends on it, mid-drive.
    lineMetrics: true,
  };
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/**
 * The full stack, bottom to top.
 *
 * Order is the design. Alternates sit entirely beneath the primary so they can
 * never interrupt it where the two overlap — which they do constantly, since
 * alternates usually share the first and last mile.
 */
export function routeLayerSpecs(): readonly { readonly id: string }[] {
  return [
    {
      id: "atlas-route-alt-casing",
      type: "line",
      source: ROUTE_SOURCE_ALTERNATES,
      layout: ROUND,
      paint: {
        "line-color": ALTERNATE_CASING,
        "line-width": ALT_CASING_WIDTH,
        "line-opacity": 0.85,
      },
    },
    {
      id: "atlas-route-alt",
      type: "line",
      source: ROUTE_SOURCE_ALTERNATES,
      layout: ROUND,
      paint: {
        "line-color": ALTERNATE,
        "line-width": ALT_WIDTH,
        // Subordinate by three means at once — colour, width, and opacity —
        // so the hierarchy survives on a dimmed screen in daylight, where any
        // single one of them alone would not.
        "line-opacity": 0.55,
      },
    },
    {
      id: "atlas-route-glow",
      type: "line",
      source: ROUTE_SOURCE_PRIMARY,
      layout: ROUND,
      paint: {
        "line-color": GOLD,
        "line-width": GLOW_WIDTH,
        "line-opacity": 0.16,
        "line-blur": 12,
      },
    },
    {
      id: "atlas-route-casing",
      type: "line",
      source: ROUTE_SOURCE_PRIMARY,
      layout: ROUND,
      paint: {
        "line-color": ROUTE_CASING,
        "line-width": CASING_WIDTH,
        "line-opacity": 0.95,
      },
    },
    {
      id: "atlas-route-core",
      type: "line",
      source: ROUTE_SOURCE_PRIMARY,
      layout: ROUND,
      paint: {
        "line-color": GOLD,
        "line-width": CORE_WIDTH,
      },
    },
    {
      id: "atlas-route-specular",
      type: "line",
      source: ROUTE_SOURCE_PRIMARY,
      layout: ROUND,
      paint: {
        "line-color": GOLD_SPECULAR,
        "line-width": SPECULAR_WIDTH,
        // Partial opacity so it reads as light on a surface rather than as a
        // second, thinner line drawn down the middle.
        "line-opacity": 0.45,
      },
    },
  ] as unknown as readonly { readonly id: string }[];
}
