import type { StyleSpecification } from "mapbox-gl";

/**
 * ATLAS NIGHT — the Atlas Ascend map environment.
 *
 * This is a complete Mapbox style specification authored in this repository,
 * not a reference to a Mapbox Studio style URL. That is a deliberate
 * architectural choice: the map is central to the product identity, so its
 * visual definition belongs in version control where it can be reviewed,
 * diffed, and rolled back — rather than living in a web console where it can
 * drift out from under the application without a commit.
 *
 * DESIGN DISCIPLINE
 *
 * The map lives almost entirely inside the obsidian world. Brand color is
 * spent sparingly and with meaning:
 *
 * - **Roads are a neutral grey ladder**, brightening with importance. They are
 *   NOT gold. Painting the road network gold would spend the accent on
 *   permanent chrome and leave nothing to signify the active route.
 * - **Gold is reserved** for the route line, active guidance, and precision
 *   information — added at runtime as route layers, not baked into the basemap.
 * - **Violet is reserved** for Atlas intelligence and live state. In the
 *   basemap it appears only in the atmosphere (fog horizon) and faintly in
 *   water, which reads as depth and distance rather than decoration.
 *
 * Legibility outranks atmosphere everywhere they conflict. This is a surface
 * people read while driving.
 */

// ---------------------------------------------------------------------------
// Palette — obsidian world
// ---------------------------------------------------------------------------

const OBSIDIAN = "#05050A";
const LAND = "#08080D";
const LAND_RESIDENTIAL = "#0B0B11";

/** Violet-tinted near-black. Water reads as depth, never as blue. */
const WATER = "#0A0917";
const WATER_DEEP = "#070610";

const PARK = "#0A100D";
const PARK_MAJOR = "#0B130F";

const BUILDING = "#101017";
const BUILDING_3D = "#13131B";
const BUILDING_3D_TOP = "#191922";

/**
 * Road ladder. Each step up in importance gains luminance, which is what makes
 * the network hierarchy readable at a glance while driving.
 */
const ROAD_SERVICE = "#191920";
const ROAD_STREET = "#23232B";
const ROAD_TERTIARY = "#2A2A34";
const ROAD_SECONDARY = "#31313D";
const ROAD_PRIMARY = "#3B3B48";
const ROAD_TRUNK = "#454554";
const ROAD_MOTORWAY = "#525263";

/** Casing sits darker than the fill and creates the sense of a cut channel. */
const ROAD_CASING = "#020205";

const RAIL = "#1A1A22";
const ADMIN = "#2B2B36";

const LABEL_ROAD = "#8F8C99";
const LABEL_PLACE = "#E8E6E1";
const LABEL_PLACE_MINOR = "#9C99A5";
const LABEL_POI = "#6B6874";
const LABEL_WATER = "#4A4560";
const LABEL_HALO = "#000000";

const FONT_MEDIUM = ["DIN Pro Medium", "Arial Unicode MS Regular"];
const FONT_BOLD = ["DIN Pro Bold", "Arial Unicode MS Bold"];

const V8 = "composite";
const SRC = "mapbox://mapbox.mapbox-streets-v8";
const DEM = "mapbox://mapbox.mapbox-terrain-dem-v1";

/**
 * Interpolated line width. Mapbox road widths must scale with zoom or the
 * network turns into either hairlines or slabs.
 */
function widthByZoom(stops: ReadonlyArray<readonly [number, number]>): unknown {
  return [
    "interpolate",
    ["exponential", 1.5],
    ["zoom"],
    ...stops.flatMap(([z, w]) => [z, w]),
  ];
}

export interface AtlasNightOptions {
  /**
   * Include 3D building extrusions. Costly on low-end mobile GPUs, so the
   * caller decides based on device capability rather than this file assuming.
   */
  readonly buildings3D: boolean;
  /** Include terrain elevation. Adds a DEM source and extra tile requests. */
  readonly terrain: boolean;
}

/**
 * Builds the Atlas Night style.
 *
 * Returned as a fresh object each call because Mapbox mutates the style it is
 * given; sharing one frozen constant between map instances causes subtle,
 * miserable bugs.
 */
export function atlasNightStyle(options: AtlasNightOptions): StyleSpecification {
  const layers: unknown[] = [
    // ---------------------------------------------------------------- ground
    {
      id: "background",
      type: "background",
      paint: { "background-color": OBSIDIAN },
    },

    {
      id: "landuse-residential",
      type: "fill",
      source: V8,
      "source-layer": "landuse",
      filter: ["match", ["get", "class"], ["residential", "neighbourhood"], true, false],
      paint: {
        "fill-color": LAND_RESIDENTIAL,
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0, 13, 0.7],
      },
    },

    {
      id: "landuse-park",
      type: "fill",
      source: V8,
      "source-layer": "landuse",
      filter: ["match", ["get", "class"], ["park", "grass", "pitch", "wood", "scrub"], true, false],
      paint: {
        "fill-color": PARK,
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0, 12, 0.85],
      },
    },

    {
      id: "landuse-national-park",
      type: "fill",
      source: V8,
      "source-layer": "landuse_overlay",
      filter: ["==", ["get", "class"], "national_park"],
      paint: { "fill-color": PARK_MAJOR, "fill-opacity": 0.6 },
    },

    // ----------------------------------------------------------------- water
    {
      id: "water",
      type: "fill",
      source: V8,
      "source-layer": "water",
      paint: { "fill-color": WATER },
    },

    {
      id: "waterway",
      type: "line",
      source: V8,
      "source-layer": "waterway",
      filter: ["match", ["get", "class"], ["river", "canal"], true, false],
      paint: {
        "line-color": WATER_DEEP,
        "line-width": widthByZoom([
          [9, 0.6],
          [14, 2.2],
          [18, 7],
        ]),
      },
    },

    // ------------------------------------------------------------- buildings
    {
      id: "building",
      type: "fill",
      source: V8,
      "source-layer": "building",
      minzoom: 14,
      filter: ["!=", ["get", "underground"], "true"],
      paint: {
        "fill-color": BUILDING,
        // Fades out exactly where the 3D extrusions fade in, so the two never
        // double-render the same footprint.
        "fill-opacity": options.buildings3D
          ? ["interpolate", ["linear"], ["zoom"], 14, 0.7, 15.5, 0]
          : ["interpolate", ["linear"], ["zoom"], 14, 0, 15, 0.8],
      },
    },

    // ------------------------------------------------------------ road: rail
    {
      id: "rail",
      type: "line",
      source: V8,
      "source-layer": "road",
      minzoom: 12,
      filter: ["match", ["get", "class"], ["major_rail", "minor_rail"], true, false],
      paint: {
        "line-color": RAIL,
        "line-width": widthByZoom([
          [12, 0.5],
          [18, 2],
        ]),
        "line-dasharray": [3, 2],
      },
    },

    // -------------------------------------------------------- road: casings
    // Drawn as one casing pass beneath all fills so intersections read as a
    // continuous network rather than stacked ribbons.
    {
      id: "road-casing",
      type: "line",
      source: V8,
      "source-layer": "road",
      minzoom: 11,
      filter: [
        "all",
        ["!=", ["get", "structure"], "tunnel"],
        [
          "match",
          ["get", "class"],
          ["motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link"],
          true,
          false,
        ],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROAD_CASING,
        "line-gap-width": widthByZoom([
          [11, 1],
          [16, 6],
          [20, 20],
        ]),
        "line-width": widthByZoom([
          [11, 0.8],
          [16, 1.4],
          [20, 2.4],
        ]),
      },
    },

    // ---------------------------------------------------------- road: fills
    // Ordered least to most important so majors always draw on top.
    {
      id: "road-service",
      type: "line",
      source: V8,
      "source-layer": "road",
      minzoom: 14,
      filter: ["match", ["get", "class"], ["service", "track"], true, false],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROAD_SERVICE,
        "line-width": widthByZoom([
          [14, 0.5],
          [18, 3],
          [20, 7],
        ]),
      },
    },

    {
      id: "road-street",
      type: "line",
      source: V8,
      "source-layer": "road",
      minzoom: 12,
      filter: ["match", ["get", "class"], ["street", "street_limited", "pedestrian"], true, false],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROAD_STREET,
        "line-width": widthByZoom([
          [12, 0.5],
          [16, 3.5],
          [20, 12],
        ]),
      },
    },

    {
      id: "road-tertiary",
      type: "line",
      source: V8,
      "source-layer": "road",
      minzoom: 10,
      filter: ["match", ["get", "class"], ["tertiary", "tertiary_link"], true, false],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROAD_TERTIARY,
        "line-width": widthByZoom([
          [10, 0.6],
          [16, 4.5],
          [20, 15],
        ]),
      },
    },

    {
      id: "road-secondary",
      type: "line",
      source: V8,
      "source-layer": "road",
      minzoom: 9,
      filter: ["match", ["get", "class"], ["secondary", "secondary_link"], true, false],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROAD_SECONDARY,
        "line-width": widthByZoom([
          [9, 0.7],
          [16, 5.5],
          [20, 18],
        ]),
      },
    },

    {
      id: "road-primary",
      type: "line",
      source: V8,
      "source-layer": "road",
      minzoom: 8,
      filter: ["match", ["get", "class"], ["primary", "primary_link"], true, false],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROAD_PRIMARY,
        "line-width": widthByZoom([
          [8, 0.8],
          [16, 6.5],
          [20, 22],
        ]),
      },
    },

    {
      id: "road-trunk",
      type: "line",
      source: V8,
      "source-layer": "road",
      minzoom: 6,
      filter: ["match", ["get", "class"], ["trunk", "trunk_link"], true, false],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROAD_TRUNK,
        "line-width": widthByZoom([
          [6, 0.7],
          [16, 7],
          [20, 24],
        ]),
      },
    },

    {
      id: "road-motorway",
      type: "line",
      source: V8,
      "source-layer": "road",
      minzoom: 5,
      filter: ["match", ["get", "class"], ["motorway", "motorway_link"], true, false],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROAD_MOTORWAY,
        "line-width": widthByZoom([
          [5, 0.8],
          [16, 8],
          [20, 26],
        ]),
      },
    },

    // -------------------------------------------------------------- admin
    {
      id: "admin-state",
      type: "line",
      source: V8,
      "source-layer": "admin",
      // `maritime` is a Boolean in mapbox-streets-v8, not a string. Comparing
      // it to "false" is never true, which silently suppressed every state
      // boundary — a bug the style-spec validator cannot catch, because the
      // expression is perfectly well-formed.
      filter: ["all", ["==", ["get", "admin_level"], 1], ["==", ["get", "maritime"], false]],
      paint: {
        "line-color": ADMIN,
        "line-width": widthByZoom([
          [4, 0.5],
          [10, 1.4],
        ]),
        "line-dasharray": [4, 3],
        "line-opacity": 0.7,
      },
    },

    {
      id: "admin-country",
      type: "line",
      source: V8,
      "source-layer": "admin",
      filter: ["all", ["==", ["get", "admin_level"], 0], ["==", ["get", "maritime"], false]],
      paint: {
        "line-color": ADMIN,
        "line-width": widthByZoom([
          [3, 0.7],
          [10, 2],
        ]),
      },
    },
  ];

  // ---------------------------------------------------------- 3D buildings
  if (options.buildings3D) {
    layers.push({
      id: "building-3d",
      type: "fill-extrusion",
      source: V8,
      "source-layer": "building",
      minzoom: 15,
      filter: ["all", ["==", ["get", "extrude"], "true"], ["!=", ["get", "underground"], "true"]],
      paint: {
        // A vertical gradient across the extrusion makes towers read as lit
        // volumes rather than flat blocks.
        "fill-extrusion-color": [
          "interpolate",
          ["linear"],
          ["get", "height"],
          0,
          BUILDING_3D,
          80,
          BUILDING_3D_TOP,
        ],
        "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 15, 0, 16.5, ["get", "height"]],
        "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 15, 0, 16.5, ["get", "min_height"]],
        "fill-extrusion-opacity": 0.9,
        "fill-extrusion-vertical-gradient": true,
      },
    });
  }

  // -------------------------------------------------------------- labels
  layers.push(
    {
      id: "label-road",
      type: "symbol",
      source: V8,
      "source-layer": "road",
      minzoom: 13,
      filter: [
        "match",
        ["get", "class"],
        ["motorway", "trunk", "primary", "secondary", "tertiary", "street"],
        true,
        false,
      ],
      layout: {
        "text-field": ["get", "name"],
        "text-font": FONT_MEDIUM,
        "symbol-placement": "line",
        "text-size": ["interpolate", ["linear"], ["zoom"], 13, 9, 18, 12],
        "text-letter-spacing": 0.08,
        "text-max-angle": 30,
        "text-padding": 4,
      },
      paint: {
        "text-color": LABEL_ROAD,
        "text-halo-color": LABEL_HALO,
        "text-halo-width": 1.2,
        "text-halo-blur": 0.4,
      },
    },

    {
      id: "label-water",
      type: "symbol",
      source: V8,
      "source-layer": "natural_label",
      minzoom: 8,
      filter: ["match", ["get", "class"], ["water", "bay", "sea", "ocean"], true, false],
      layout: {
        "text-field": ["get", "name"],
        "text-font": FONT_MEDIUM,
        "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 14, 13],
        "text-letter-spacing": 0.12,
        "text-max-width": 7,
      },
      paint: {
        "text-color": LABEL_WATER,
        "text-halo-color": LABEL_HALO,
        "text-halo-width": 1,
      },
    },

    {
      id: "label-poi",
      type: "symbol",
      source: V8,
      "source-layer": "poi_label",
      minzoom: 16,
      // Aggressively filtered. A premium navigation surface is not a directory,
      // and POI noise is the fastest way to make a dark map feel cheap.
      filter: ["<=", ["get", "filterrank"], 2],
      layout: {
        "text-field": ["get", "name"],
        "text-font": FONT_MEDIUM,
        "text-size": 10,
        "text-max-width": 8,
        "text-offset": [0, 0.6],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: {
        "text-color": LABEL_POI,
        "text-halo-color": LABEL_HALO,
        "text-halo-width": 1,
      },
    },

    {
      id: "label-place-minor",
      type: "symbol",
      source: V8,
      "source-layer": "place_label",
      filter: ["match", ["get", "class"], ["settlement_subdivision"], true, false],
      minzoom: 12,
      layout: {
        "text-field": ["get", "name"],
        "text-font": FONT_MEDIUM,
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 16, 13],
        "text-letter-spacing": 0.14,
        "text-transform": "uppercase",
        "text-max-width": 8,
      },
      paint: {
        "text-color": LABEL_PLACE_MINOR,
        "text-halo-color": LABEL_HALO,
        "text-halo-width": 1.2,
      },
    },

    {
      id: "label-place",
      type: "symbol",
      source: V8,
      "source-layer": "place_label",
      filter: ["==", ["get", "class"], "settlement"],
      layout: {
        "text-field": ["get", "name"],
        "text-font": FONT_BOLD,
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4,
          11,
          10,
          16,
          14,
          20,
        ],
        "text-letter-spacing": 0.04,
        "text-max-width": 9,
      },
      paint: {
        "text-color": LABEL_PLACE,
        "text-halo-color": LABEL_HALO,
        "text-halo-width": 1.4,
        "text-halo-blur": 0.5,
      },
    },
  );

  const style = {
    version: 8,
    name: "Atlas Night",
    metadata: {
      "atlas:version": "0.1.0",
      "atlas:description":
        "Atlas Ascend map environment. Obsidian world, neutral road hierarchy, brand color reserved for route and intelligence.",
    },
    glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
    // No sprite is declared. POI icons are intentionally omitted — text-only
    // labels keep the surface quiet and remove a whole class of asset requests.
    sources: {
      [V8]: { type: "vector", url: SRC },
      ...(options.terrain ? { "atlas-dem": { type: "raster-dem", url: DEM, tileSize: 512 } } : {}),
    },
    // Atmospheric depth. The violet horizon is continuity with the original
    // Swift placeholder's horizon glow, and it is the only place violet appears
    // in the basemap.
    fog: {
      range: [0.8, 9],
      color: "#0A0912",
      "high-color": "#1B1038",
      "space-color": "#000000",
      "horizon-blend": 0.06,
      "star-intensity": 0.02,
    },
    light: {
      anchor: "viewport",
      color: "#C8C4D8",
      intensity: 0.22,
      position: [1.4, 200, 40],
    },
    ...(options.terrain ? { terrain: { source: "atlas-dem", exaggeration: 1.05 } } : {}),
    layers,
  };

  return style as unknown as StyleSpecification;
}
