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
 * `no-token` and `unauthorized` are deliberately distinct. Collapsing them —
 * as an earlier version did — tells a user whose token IS configured to go
 * configure their token, which sends them to fix the one thing that is not
 * broken. A rejected token is almost always a URL restriction that does not
 * list the deployment hostname, and the UI has to be able to say so.
 */
export type MapUnavailableReason =
  /** No token present in the build at all. */
  | "no-token"
  /** Token present but rejected by Mapbox (401/403) — usually a URL restriction. */
  | "unauthorized"
  | "webgl-unsupported"
  | "load-failed"
  | "network"
  /** The style never finished loading within the watchdog window. */
  | "timeout";

export class MapUnavailableError extends Error {
  constructor(
    readonly reason: MapUnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = "MapUnavailableError";
  }
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
