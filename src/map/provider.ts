import type { AtlasRoute } from "@/routing/types";
import type {
  CameraTransition,
  Coordinate,
  MapCamera,
  MapConfiguration,
  MapPerspective,
} from "./types";

/**
 * Maturity of a map provider implementation.
 *
 * Exists so the app can tell the truth about itself at runtime. A provider that
 * is not `production` must be visibly labeled in the UI — nobody should ever
 * look at a screenshot and be unsure whether the map is real.
 */
export type MapProviderMaturity = "production" | "development-placeholder";

/**
 * Why a map could not be mounted. Drives honest UI, not a console warning.
 *
 * Deliberately granular. An earlier version collapsed every 401/403 into
 * "no token", which told a user whose token was correctly configured to go fix
 * the one thing that was not broken. The distinctions below each imply a
 * *different action*, which is the only justification for a separate case:
 *
 * - `missing-token` → set the env var and redeploy
 * - `invalid-token` → the token itself is wrong, revoked, or malformed
 * - `forbidden` → the token is real but not permitted here (URL restriction)
 * - `tile-access-denied` → the token lacks the tile capability
 * - `style-access-denied` → the token lacks the styles capability
 *
 * The UI may simplify the wording; diagnostics must preserve the real one.
 */
export type MapUnavailableReason =
  /** No token was present in the build at all. Mapbox is never constructed. */
  | "missing-token"
  /** 401 — Mapbox rejected the credential outright. */
  | "invalid-token"
  /** 403 — credential accepted but not permitted for this origin. */
  | "forbidden"
  /** 401/403 on a tile or TileJSON endpoint — a scope problem. */
  | "tile-access-denied"
  /** 401/403 on a styles endpoint — a scope problem. */
  | "style-access-denied"
  /** Another 4xx: malformed request, rate limit, missing resource. */
  | "request-rejected"
  /** 5xx or a transport failure. */
  | "network"
  /** The style never finished loading within the watchdog window. */
  | "timeout"
  | "webgl-unsupported"
  /** Classified as a failure, but not into any known bucket. */
  | "unknown";

export class MapUnavailableError extends Error {
  constructor(
    readonly reason: MapUnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = "MapUnavailableError";
  }
}

/**
 * A snapshot of what the map is actually doing right now.
 *
 * Vendor-neutral on purpose: a canvas that exists at 390×780 with a live WebGL
 * context but zero rendered layers is a completely different failure from a map
 * that never constructed, and the difference is invisible from the outside.
 * This is the only way to tell them apart from a screenshot.
 */
export interface MapInspection {
  readonly canvasExists: boolean;
  /** Backing store size in device pixels. */
  readonly canvasWidth: number | null;
  readonly canvasHeight: number | null;
  /** Layout size in CSS pixels. Zero here with a non-zero backing store is a
   *  classic "canvas present but invisible" signature. */
  readonly cssWidth: number | null;
  readonly cssHeight: number | null;
  readonly hasWebGLContext: boolean;
  readonly loaded: boolean;
  readonly styleLoaded: boolean;
  readonly sourceCount: number | null;
  readonly layerCount: number | null;
  readonly center: Coordinate | null;
  readonly zoom: number | null;
  readonly pitch: number | null;
  readonly bearing: number | null;
  /** Route rendering state. See `RouteRenderState`. */
  readonly route: RouteRenderState;
}

/** A geographic box. */
export interface MapBounds {
  readonly southwest: Coordinate;
  readonly northeast: Coordinate;
}

/** Per-edge padding in CSS pixels. */
export interface MapEdgePadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * What the map is currently drawing for the route.
 *
 * Reported vendor-neutrally so a diagnostic can answer "is the route actually
 * on the map" without anyone opening DevTools — the same reasoning that put
 * canvas size and layer count in `MapInspection`. A route that is set in
 * application state but absent from the map is exactly the class of failure
 * this project has already lost days to.
 */
export interface RouteRenderState {
  /** Both route sources exist on the style. */
  readonly sourcesPresent: boolean;
  /** How many of the route layers are attached. */
  readonly layerCount: number;
  /** Vertices in the primary route currently drawn. */
  readonly primaryVertexCount: number;
  /** Id of the route drawn as primary, or `null` when none. */
  readonly primaryRouteId: string | null;
  readonly alternativeCount: number;
}

/** Events a mounted map can emit back to the application. */
export interface MapEvents {
  /** First full render completed — safe to reveal the surface. */
  ready: () => void;
  /** The user moved the camera by hand. Used to break follow-mode. */
  userInteraction: () => void;
  /** Camera settled after any move. */
  cameraChanged: (camera: MapCamera) => void;
  /** Unrecoverable failure after mount. */
  error: (error: MapUnavailableError) => void;
}

/**
 * A mounted, live map instance.
 *
 * Imperative on purpose. Map SDKs own a canvas and a render loop; pretending
 * otherwise and driving the camera through React state produces dropped frames
 * and fights the SDK's own animation system.
 */
export interface MapHandle {
  setCamera(camera: Partial<MapCamera>, transition: CameraTransition): void;
  setPerspective(perspective: MapPerspective, transition: CameraTransition): void;
  /** Position the user puck. `null` removes it. */
  setUserLocation(coordinate: Coordinate | null, heading: number | null): void;
  /** Show or clear the destination marker. */
  setDestination(coordinate: Coordinate | null): void;

  /**
   * Draw a set of routes, with one of them primary.
   *
   * Takes Atlas routes and nothing else — no GeoJSON, no source or layer
   * names, no vendor objects. Replacing the set is a single call rather than a
   * clear followed by a set, so the map never passes through an empty frame
   * mid-reroute.
   *
   * `primaryId` must identify one of `routes`; an id that is not present, or
   * `null` when routes exist, promotes the first route rather than drawing
   * none — the driver seeing the wrong emphasis is recoverable, seeing no
   * route is not. Routes with unusable geometry are skipped, not drawn
   * partially.
   */
  setRoutes(routes: readonly AtlasRoute[], primaryId: string | null): void;

  /**
   * Promote an already-drawn route to primary.
   *
   * Separate from `setRoutes` because choosing between offered alternates must
   * not re-request or re-decode anything — it is a restyle of geometry the map
   * already holds. Unknown ids are ignored.
   */
  selectRoute(routeId: string): void;

  /** Remove every route. Safe to call when none is drawn. */
  clearRoutes(): void;

  /**
   * Move the camera for driving.
   *
   * Separate from `setCamera` because it takes padding — which is what seats
   * the driver low on the screen with the road ahead above — and an explicit
   * duration matched to the GPS fix rate, so consecutive moves join up into
   * continuous motion instead of a series of animations interrupting each
   * other.
   */
  setNavigationCamera(
    camera: MapCamera,
    padding: MapEdgePadding,
    durationMs: number,
  ): void;

  /**
   * Frame a geographic box into the visible part of the viewport.
   *
   * `padding` is in CSS pixels per edge and is deliberately asymmetric in
   * practice — the preview sheet covers the bottom of the screen, so a route
   * centred geometrically would sit behind its own preview. Projection is the
   * provider's job; deciding how much room the route may have is not, and
   * lives in `src/navigation/framing.ts`.
   *
   * `maxZoom` stops a short route being fitted to building level, where both
   * markers overlap and the overview shows one intersection.
   */
  frameBounds(
    bounds: MapBounds,
    padding: MapEdgePadding,
    options: { readonly maxZoom?: number; readonly transition: CameraTransition },
  ): void;
  /** Recompute size after a container or viewport change. */
  resize(): void;
  /** Diagnostic snapshot. Cheap; safe to poll. */
  inspect(): MapInspection;
  on<K extends keyof MapEvents>(event: K, handler: MapEvents[K]): () => void;
  destroy(): void;
}

/**
 * Renders the map surface.
 *
 * The entire vendor relationship passes through this one interface. Mapbox is
 * the production provider, but nothing outside `src/map/mapbox/` may import
 * `mapbox-gl` — that is what makes the vendor replaceable if licensing,
 * pricing, or capability ever forces the issue.
 */
export interface MapProvider {
  readonly id: string;
  readonly maturity: MapProviderMaturity;
  /** Whether this provider can run at all right now (token present, WebGL, …). */
  checkAvailability(): MapUnavailableReason | null;
  mount(container: HTMLElement, initial: MapConfiguration): Promise<MapHandle>;
}
