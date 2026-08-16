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
