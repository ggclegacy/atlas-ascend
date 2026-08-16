import type { Map as MapboxMap, Marker } from "mapbox-gl";
import { getMapboxToken } from "@/lib/env";
import {
  type MapEvents,
  type MapHandle,
  type MapInspection,
  type MapProvider,
  type MapProviderMaturity,
  MapUnavailableError,
  type MapUnavailableReason,
} from "../provider";
import type {
  CameraTransition,
  Coordinate,
  MapCamera,
  MapConfiguration,
  MapPerspective,
} from "../types";
import { pitchFor } from "../types";
import { atlasNightStyle } from "./atlas-night";
import {
  describeContainer,
  describeToken,
  detectWebGL,
  hasNonZeroSize,
  recordError,
  safeResource,
  stage,
  stageFailed,
  warn,
} from "./diagnostics";
import { createDestinationElement, createUserPuckElement } from "./markers";

/**
 * How long to wait for the style to finish loading before declaring failure.
 *
 * Without this the map can sit forever behind its loading veil when a source
 * request hangs — which is precisely the "blank dark rectangle" failure this
 * watchdog exists to convert into an honest error state.
 */
const STYLE_LOAD_TIMEOUT_MS = 15_000;

/** How long to wait for a zero-size container to receive layout. */
const CONTAINER_LAYOUT_TIMEOUT_MS = 2_000;

/**
 * Production map provider, backed by Mapbox GL JS v3.
 *
 * This is the ONLY module permitted to import `mapbox-gl` alongside its
 * siblings in this directory. Everything above it speaks Atlas types.
 */
export class MapboxMapProvider implements MapProvider {
  readonly id = "mapbox-gl";
  readonly maturity: MapProviderMaturity = "production";

  checkAvailability(): MapUnavailableReason | null {
    const token = getMapboxToken();
    stage("availability", `token ${describeToken(token)}`);
    if (token === null) return "no-token";

    const webgl = detectWebGL();
    if (!webgl.supported) {
      stageFailed("webgl", webgl.detail);
      return "webgl-unsupported";
    }
    stage("webgl", webgl.detail);

    return null;
  }

  async mount(
    container: HTMLElement,
    initial: MapConfiguration,
  ): Promise<MapHandle> {
    const blocked = this.checkAvailability();
    if (blocked !== null) {
      throw new MapUnavailableError(blocked, describeReason(blocked));
    }

    // A Mapbox map constructed into a zero-size container renders nothing and
    // never recovers on its own. Wait for real layout before constructing.
    if (!hasNonZeroSize(container)) {
      warn(`container has no size (${describeContainer(container)}); waiting for layout`);
      await waitForLayout(container, CONTAINER_LAYOUT_TIMEOUT_MS);
    }
    if (!hasNonZeroSize(container)) {
      // Proceed anyway — a ResizeObserver below will resize once layout
      // arrives — but record it, because it is a strong suspect if the map
      // ends up blank.
      stageFailed("container", `still zero-size after ${CONTAINER_LAYOUT_TIMEOUT_MS}ms`);
    } else {
      stage("container", describeContainer(container));
    }

    // Dynamic import keeps ~800KB of map SDK out of the initial bundle. The
    // Command Center shell renders and becomes interactive before this lands.
    //
    // The stylesheet is loaded here too rather than statically at the top of
    // the map component: a static import would put ~40KB of Mapbox CSS in the
    // render-blocking payload for a surface that has not mounted yet.
    // Verified to resolve through Turbopack's CSS chunk loader in a production
    // build — see `tests/map-runtime.test.ts`.
    let mapboxModule: typeof import("mapbox-gl");
    try {
      const [sdk] = await Promise.all([
        import("mapbox-gl"),
        import("mapbox-gl/dist/mapbox-gl.css").then(() => stage("css-import")),
      ]);
      mapboxModule = sdk;
      stage("sdk-import", `mapbox-gl loaded`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "dynamic import failed";
      stageFailed("sdk-import", detail);
      throw new MapUnavailableError("network", detail);
    }

    const mapboxgl = mapboxModule.default;
    mapboxgl.accessToken = getMapboxToken() as string;

    const capability = detectCapability();

    const map = new mapboxgl.Map({
      container,
      style: atlasNightStyle({
        buildings3D: capability.buildings3D,
        terrain: capability.terrain,
      }),
      center: [initial.camera.center.longitude, initial.camera.center.latitude],
      zoom: initial.camera.zoom,
      pitch: initial.camera.pitch,
      bearing: initial.camera.bearing,
      // Our own chrome replaces all of Mapbox's.
      attributionControl: true,
      logoPosition: "bottom-right",
      // The compass/zoom controls are not added at all.
      pitchWithRotate: true,
      dragRotate: true,
      // Rendering the world more than once horizontally costs draw calls for
      // a case a driver never encounters.
      renderWorldCopies: false,
      // Cap the pixel ratio on very high-DPI phones. Rendering a full 3x
      // buffer is the single biggest GPU cost on mobile and is visually
      // indistinguishable from 2x while driving.
      maxPitch: 75,
      antialias: capability.antialias,
    });

    stage(
      "constructor",
      `3D=${capability.buildings3D} terrain=${capability.terrain} aa=${capability.antialias}`,
    );

    return new MapboxHandle(map, mapboxgl, initial, container);
  }
}

/** Resolves once the element has non-zero size, or after `timeout`. */
function waitForLayout(element: HTMLElement, timeout: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof ResizeObserver === "undefined") {
      setTimeout(resolve, 100);
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    };

    const observer = new ResizeObserver(() => {
      if (hasNonZeroSize(element)) finish();
    });
    observer.observe(element);

    const timer = setTimeout(finish, timeout);
  });
}

// ---------------------------------------------------------------------------

/** Exported for tests; not part of the public map surface. */
export class MapboxHandle implements MapHandle {
  private userMarker: Marker | null = null;
  private destinationMarker: Marker | null = null;
  private puckElement: HTMLElement | null = null;
  private destroyed = false;

  /**
   * Replay state.
   *
   * The consumer subscribes *after* `mount()` resolves, so any event the map
   * emits in the interim would otherwise be dropped and never reproduced —
   * leaving the UI stuck on its loading veil forever. Recording whether the
   * map became ready, and the first fatal error, makes subscription order
   * irrelevant.
   */
  private isReady = false;
  private fatalError: MapUnavailableError | null = null;

  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private readonly listeners: {
    [K in keyof MapEvents]: Set<MapEvents[K]>;
  } = {
    ready: new Set(),
    userInteraction: new Set(),
    cameraChanged: new Set(),
    error: new Set(),
  };

  constructor(
    private readonly map: MapboxMap,
    private readonly mapboxgl: typeof import("mapbox-gl").default,
    private config: MapConfiguration,
    container: HTMLElement,
  ) {
    map.on("style.load", () => stage("style-load"));

    map.on("load", () => {
      this.isReady = true;
      this.clearWatchdog();
      stage("map-load", `canvas ${describeContainer(container)}`);
      this.emit("ready");
    });

    // Converts an indefinite hang into an honest failure. Without it, a source
    // request that never resolves leaves the UI dark with nothing to report.
    this.watchdog = setTimeout(() => {
      if (this.isReady || this.destroyed) return;
      const error = new MapUnavailableError(
        "timeout",
        `Style did not finish loading within ${STYLE_LOAD_TIMEOUT_MS / 1000}s`,
      );
      stageFailed("map-load", error.message);
      this.fail(error);
    }, STYLE_LOAD_TIMEOUT_MS);

    // Keep the canvas matched to its container. Covers late layout, orientation
    // change, and mobile browser chrome collapsing — all of which otherwise
    // leave the canvas sized to a stale rect.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.destroyed) this.map.resize();
      });
      this.resizeObserver.observe(container);
    }

    // `dragstart`/`rotatestart` fire only for genuine user gestures, not for
    // programmatic camera moves — which is exactly the distinction needed to
    // know when to break follow-mode.
    const onUser = () => this.emit("userInteraction");
    map.on("dragstart", onUser);
    map.on("rotatestart", onUser);
    map.on("pitchstart", onUser);

    map.on("moveend", () => {
      const c = map.getCenter();
      this.emit("cameraChanged", {
        center: { latitude: c.lat, longitude: c.lng },
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      });
    });

    map.on("error", (event) => {
      // Mapbox wraps failed requests in an AJAXError carrying the real HTTP
      // status. Classifying on `status` rather than pattern-matching the
      // message is what makes "token rejected" reliably distinguishable from
      // "network died" — the previous regex approach silently mislabeled a
      // 401 from a URL-restricted token as "no token configured".
      const raw = event.error as
        | (Error & { status?: number; url?: string })
        | undefined;

      const status = typeof raw?.status === "number" ? raw.status : null;
      const message = raw?.message ?? "Map failed to load";
      const reason = classifyError(status, message);

      // The request URL identifies which resource failed (tiles vs glyphs vs
      // TileJSON). Strip the query string — it carries the access token.
      const resource = safeResource(raw?.url);
      stageFailed(
        "source-error",
        `${status ?? "no status"} ${message} — ${resource ?? "unknown resource"}`,
      );
      recordError({
        category: reason,
        status,
        resource,
        message,
        at: Date.now(),
      });

      // Only auth/network failures are fatal to the whole surface. A single
      // failed glyph range should not blank a map that is otherwise fine.
      if (reason === "unauthorized" || reason === "network") {
        this.fail(new MapUnavailableError(reason, message));
      } else if (!this.isReady) {
        this.fail(new MapUnavailableError(reason, message));
      }
    });
  }

  /** Records and emits a fatal error, so late subscribers still receive it. */
  private fail(error: MapUnavailableError): void {
    if (this.fatalError !== null) return; // Report the first cause, not the cascade.
    this.fatalError = error;
    this.clearWatchdog();
    this.emit("error", error);
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  setCamera(camera: Partial<MapCamera>, transition: CameraTransition): void {
    if (this.destroyed) return;

    const options: Record<string, unknown> = {};
    if (camera.center) {
      options["center"] = [camera.center.longitude, camera.center.latitude];
    }
    if (camera.zoom !== undefined) options["zoom"] = camera.zoom;
    if (camera.pitch !== undefined) options["pitch"] = camera.pitch;
    if (camera.bearing !== undefined) options["bearing"] = camera.bearing;

    switch (transition) {
      case "immediate":
        this.map.jumpTo(options);
        break;
      case "standard":
        this.map.easeTo({ ...options, duration: 600, easing: easeAtlas });
        break;
      case "cinematic":
        // flyTo arcs through altitude rather than interpolating linearly
        // across the ground, which is what makes a long move watchable.
        this.map.flyTo({ ...options, duration: 2200, curve: 1.42, speed: 0.7 });
        break;
    }
  }

  setPerspective(perspective: MapPerspective, transition: CameraTransition): void {
    this.config = { ...this.config, perspective };
    this.setCamera({ pitch: pitchFor(perspective) }, transition);
  }

  setUserLocation(coordinate: Coordinate | null, heading: number | null): void {
    if (this.destroyed) return;

    if (coordinate === null) {
      this.userMarker?.remove();
      this.userMarker = null;
      this.puckElement = null;
      return;
    }

    if (this.userMarker === null) {
      const element = createUserPuckElement();
      this.puckElement = element;
      this.userMarker = new this.mapboxgl.Marker({
        element,
        // The puck must not scale with pitch; it is UI, not geography.
        pitchAlignment: "map",
        rotationAlignment: "map",
      })
        .setLngLat([coordinate.longitude, coordinate.latitude])
        .addTo(this.map);
    } else {
      this.userMarker.setLngLat([coordinate.longitude, coordinate.latitude]);
    }

    // Only rotate the heading cone when heading is actually known. Drawing a
    // direction we do not have would be a small lie with real consequences
    // while driving.
    if (this.puckElement) {
      const cone = this.puckElement.querySelector<HTMLElement>("[data-atlas-cone]");
      if (cone) {
        cone.style.display = heading === null ? "none" : "block";
        if (heading !== null) {
          cone.style.transform = `translate(-50%, -100%) rotate(${heading}deg)`;
        }
      }
    }
  }

  setDestination(coordinate: Coordinate | null): void {
    if (this.destroyed) return;

    if (coordinate === null) {
      this.destinationMarker?.remove();
      this.destinationMarker = null;
      return;
    }

    if (this.destinationMarker === null) {
      this.destinationMarker = new this.mapboxgl.Marker({
        element: createDestinationElement(),
        anchor: "bottom",
      })
        .setLngLat([coordinate.longitude, coordinate.latitude])
        .addTo(this.map);
    } else {
      this.destinationMarker.setLngLat([coordinate.longitude, coordinate.latitude]);
    }
  }

  resize(): void {
    if (!this.destroyed) this.map.resize();
  }

  inspect(): MapInspection {
    return inspectMapboxMap(this.map, this.destroyed);
  }

  on<K extends keyof MapEvents>(event: K, handler: MapEvents[K]): () => void {
    this.listeners[event].add(handler);

    // Replay terminal state to late subscribers. Subscription happens after
    // `mount()` resolves, so without this a map that became ready — or failed —
    // during that window would never inform the UI, stranding it on its
    // loading veil indefinitely.
    if (event === "ready" && this.isReady) {
      (handler as MapEvents["ready"])();
    } else if (event === "error" && this.fatalError !== null) {
      (handler as MapEvents["error"])(this.fatalError);
    }

    return () => {
      this.listeners[event].delete(handler);
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearWatchdog();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.userMarker?.remove();
    this.destinationMarker?.remove();
    this.map.remove();
    stage("destroy");
  }

  private emit<K extends keyof MapEvents>(
    event: K,
    ...args: Parameters<MapEvents[K]>
  ): void {
    for (const handler of this.listeners[event]) {
      (handler as (...a: unknown[]) => void)(...args);
    }
  }
}

// ---------------------------------------------------------------------------
// Capability detection
// ---------------------------------------------------------------------------

interface Capability {
  readonly buildings3D: boolean;
  readonly terrain: boolean;
  readonly antialias: boolean;
}

/**
 * Decide how much visual richness this device can afford.
 *
 * The performance standard outranks spectacle: a phone dropping frames while
 * navigating is a worse product than one without extruded buildings. These are
 * coarse heuristics, but they fail in the safe direction.
 */
function detectCapability(): Capability {
  if (typeof navigator === "undefined") {
    return { buildings3D: false, terrain: false, antialias: false };
  }

  const cores = navigator.hardwareConcurrency ?? 4;
  const reducedMotion =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Treat <= 4 cores as low-end. Extrusions and terrain both add substantial
  // per-frame cost, and terrain additionally multiplies tile requests.
  const capable = cores > 4 && !reducedMotion;

  return {
    buildings3D: capable,
    // Terrain stays off even on capable devices for now: it is the most
    // expensive feature here and adds little at city navigation zooms.
    // Enabling it is a deliberate future decision, not a default.
    terrain: false,
    antialias: capable,
  };
}

/**
 * Maps an HTTP status (and message, when no status is available) onto an Atlas
 * failure reason.
 *
 * Exported for testing — this classification is the difference between telling
 * a user to configure a token they already configured and telling them their
 * token does not allow their deployment hostname.
 */
export function classifyError(
  status: number | null,
  message: string,
): MapUnavailableReason {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "load-failed";
  if (status !== null && status >= 500) return "network";

  // No status: fall back to the message, but keep auth detection strict so a
  // stray "unauthorized" in unrelated prose cannot mislabel a network fault.
  if (/\b(401|403)\b|unauthorized|forbidden|invalid.*token|token.*invalid/i.test(message)) {
    return "unauthorized";
  }
  if (/failed to fetch|networkerror|load failed|err_internet/i.test(message)) {
    return "network";
  }
  return "load-failed";
}

/**
 * Reads live state off a Mapbox map instance.
 *
 * Exported so the isolation harness at `/debug/mapbox` can report identically
 * for a raw Mapbox map as for one behind the Atlas abstraction — which is what
 * makes an A/B comparison between the two meaningful.
 */
export function inspectMapboxMap(
  map: MapboxMap,
  destroyed = false,
): MapInspection {
  const empty: MapInspection = {
    canvasExists: false,
    canvasWidth: null,
    canvasHeight: null,
    cssWidth: null,
    cssHeight: null,
    hasWebGLContext: false,
    loaded: false,
    styleLoaded: false,
    sourceCount: null,
    layerCount: null,
    center: null,
    zoom: null,
    pitch: null,
    bearing: null,
  };

  if (destroyed) return empty;

  try {
    const canvas = map.getCanvas() as HTMLCanvasElement | undefined;
    const style = map.getStyle();
    const center = map.getCenter();

    return {
      canvasExists: Boolean(canvas),
      canvasWidth: canvas?.width ?? null,
      canvasHeight: canvas?.height ?? null,
      cssWidth: canvas ? Math.round(canvas.getBoundingClientRect().width) : null,
      cssHeight: canvas ? Math.round(canvas.getBoundingClientRect().height) : null,
      // A canvas whose WebGL context was lost still exists in the DOM and still
      // reports dimensions — it just renders nothing. Checking the context is
      // the only way to catch that.
      hasWebGLContext: Boolean(
        canvas?.getContext("webgl2") ?? canvas?.getContext("webgl"),
      ),
      loaded: map.loaded(),
      styleLoaded: map.isStyleLoaded(),
      sourceCount: style?.sources ? Object.keys(style.sources).length : null,
      layerCount: style?.layers ? style.layers.length : null,
      center: { latitude: center.lat, longitude: center.lng },
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
    };
  } catch {
    return empty;
  }
}

/** Matches the design system's `--ease-atlas-cinematic`. */
function easeAtlas(t: number): number {
  return cubicBezier(0.32, 0.72, 0.16, 1.0, t);
}

function cubicBezier(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  t: number,
): number {
  // Newton-Raphson against the x-curve, then evaluate y. Cheap and accurate
  // enough for a camera easing at 60fps.
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;

  let x = t;
  for (let i = 0; i < 5; i++) {
    const slope = (3 * ax * x + 2 * bx) * x + cx;
    if (Math.abs(slope) < 1e-6) break;
    const error = ((ax * x + bx) * x + cx) * x - t;
    x -= error / slope;
  }
  return ((ay * x + by) * x + cy) * x;
}

export function describeReason(reason: MapUnavailableReason): string {
  switch (reason) {
    case "no-token":
      return "Map service not configured";
    case "unauthorized":
      return "Map service rejected this site";
    case "webgl-unsupported":
      return "Browser graphics unsupported";
    case "load-failed":
      return "Map failed to load";
    case "network":
      return "Map service unreachable";
    case "timeout":
      return "Map failed to load";
  }
}
