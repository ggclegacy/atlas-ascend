import type { Map as MapboxMap, Marker } from "mapbox-gl";
import { getPublicMapboxToken } from "@/lib/env";
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
  classifyResource,
  describeContainer,
  describeToken,
  detectWebGL,
  hasNonZeroSize,
  hostnameOf,
  readMapboxErrorBody,
  recordError,
  safeResource,
  sanitizeUrl,
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
    const token = getPublicMapboxToken();
    stage("availability", `token ${describeToken(token)}`);
    if (token === null) return "missing-token";

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
    // The stylesheet is NOT loaded here. It is imported statically by
    // `MapSurface`, deliberately — see the note at the top of that file. The
    // SDK is still split because that is a documented, first-class Next.js
    // capability; the CSS is not worth the same bet.
    let mapboxModule: typeof import("mapbox-gl");
    try {
      mapboxModule = await import("mapbox-gl");
      stage("sdk-import", "mapbox-gl loaded");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "dynamic import failed";
      stageFailed("sdk-import", detail);
      throw new MapUnavailableError("network", detail);
    }

    const mapboxgl = mapboxModule.default;
    mapboxgl.accessToken = getPublicMapboxToken() as string;

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

/**
 * The shape of a Mapbox `error` event, as far as Atlas relies on it.
 *
 * Failed requests arrive as an `AJAXError`, which carries `status`, `url`, and
 * a `statusText`-derived message — and nothing else. Notably **not** the
 * response body, which is where Mapbox names a scope. Source-attached errors
 * additionally carry `sourceId`.
 */
interface MapboxErrorEvent {
  readonly error?: Error & { status?: number; url?: string };
  readonly sourceId?: string;
}

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
  /** One body probe per map. A failing token fails every request it makes. */
  private probedAuthFailure = false;

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

      // A timeout is a "not yet", not a "never". On a slow mobile connection
      // the style can land after the watchdog has already fired, and the
      // surface recovers because `ready` is emitted here unconditionally — but
      // the recorded fatal error would survive, get replayed to any later
      // subscriber, and block a genuine failure from being reported
      // afterwards. Clearing it keeps the recorded state equal to reality.
      // Auth failures are never cleared: those do not resolve themselves.
      if (this.fatalError?.reason === "timeout") {
        this.fatalError = null;
      }

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
      void this.handleMapError(event as MapboxErrorEvent);
    });
  }

  /**
   * Turns a Mapbox `error` event into recorded evidence and, if warranted, a
   * fatal failure.
   *
   * Asynchronous for one reason: on an auth failure the SDK hands us a status
   * code and nothing else, and a status code alone cannot distinguish a
   * revoked token from a URL restriction from a missing capability. One
   * follow-up fetch of the failing URL retrieves the `{"message": …}` Mapbox
   * actually returned, and that evidence is gathered *before* the failure is
   * classified — so the user is never shown a specific account remedy that the
   * response does not support. It runs at most once per map, only for 401/403,
   * and is bounded by a 2.5s timeout well inside the style watchdog.
   */
  private async handleMapError(event: MapboxErrorEvent): Promise<void> {
    const raw = event.error;
    const status = typeof raw?.status === "number" ? raw.status : null;
    const message = raw?.message ?? "Map failed to load";
    const url = typeof raw?.url === "string" ? raw.url : undefined;

    // Host + path for the compact readout; the full URL, credential-redacted,
    // for the record — `?secure`, tile coordinates, and glyph ranges all carry
    // diagnostic value.
    const resource = safeResource(url);
    const kind = classifyResource(url);
    const sourceId = typeof event.sourceId === "string" ? event.sourceId : null;

    let body: string | null = null;
    if (
      !this.probedAuthFailure &&
      url !== undefined &&
      (status === 401 || status === 403)
    ) {
      this.probedAuthFailure = true;
      body = await readMapboxErrorBody(url);
    }

    const reason = classifyError(status, message, resource, body);

    stageFailed(
      "source-error",
      `${status ?? "no status"} ${kind} ${resource ?? "unknown resource"}` +
        ` — ${message}${body ? ` — Mapbox said: ${body}` : ""}`,
    );
    recordError({
      category: reason,
      status,
      resource,
      url: sanitizeUrl(url),
      hostname: hostnameOf(url),
      kind,
      message,
      body,
      sourceId,
      at: Date.now(),
    });

    // Only auth/network failures are fatal to the whole surface. A single
    // failed glyph range should not blank a map that is otherwise fine.
    if (isAuthFailure(reason) || reason === "network") {
      this.fail(new MapUnavailableError(reason, message));
    } else if (!this.isReady) {
      this.fail(new MapUnavailableError(reason, message));
    }
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
 * Whether a Mapbox response actually says a scope is missing.
 *
 * Returns the named scope, `"unnamed"` when the wording proves a scope problem
 * without naming which, or `null` when there is no scope evidence at all.
 *
 * URLs are stripped before matching. Mapbox's own copy for a plain 401 is
 * "…you may have provided an invalid Mapbox access token. See
 * https://docs.mapbox.com/api/guides/#access-tokens-and-token-scopes" — an
 * anchor with the word "scopes" in it, attached to a message about an *invalid
 * token*. Reading that link as evidence of a missing capability is precisely
 * the mistake this function exists to prevent.
 *
 * Exported for testing.
 */
export function namesMissingScope(text: string | null | undefined): string | null {
  if (!text) return null;
  const prose = text.replace(/https?:\/\/\S+/g, " ");

  const named =
    /\b(styles:tiles|styles:read|styles:list|fonts:read|fonts:list|tilesets:read|datasets:read)\b/i.exec(
      prose,
    );
  if (named?.[1]) return named[1].toLowerCase();

  return /\b(required|insufficient|missing)\s+scopes?\b|\bscopes?\s+(is|are)\s+required\b|\bnot\s+authorized\s+for\s+scope\b/i.test(
    prose,
  )
    ? "unnamed"
    : null;
}

/**
 * Maps an HTTP status, message, failing resource, and — when it could be
 * obtained — Mapbox's own response body onto an Atlas failure reason.
 *
 * **A specific account misconfiguration is only ever named when Mapbox's
 * response proves it.** An earlier version inferred the cause from the URL
 * alone: any 401/403 on a `/v4/…` path became `tile-access-denied`, which the
 * UI renders as "add the styles:tiles capability". That is wrong in every
 * direction that matters. A revoked token, a deleted token, a token from
 * another account, and a URL restriction that excludes this host all produce an
 * identical 401/403 on that same path — and because `atlasNight` is an inline
 * style, `/v4/<tileset>.json` is the *first* authenticated request the map
 * makes, so every one of those causes was reported as a missing tile scope.
 *
 * Mapbox GL JS makes this worse by design: its `AJAXError` keeps only the
 * status, the URL, and a `statusText` that is empty over HTTP/2. The response
 * body — the only place Mapbox ever names a scope — is discarded. So unless a
 * caller passes `body` (see `readMapboxErrorBody`), there is no scope evidence
 * available and none may be claimed.
 *
 * Exported for testing.
 */
export function classifyError(
  status: number | null,
  message: string,
  resource?: string | null,
  body?: string | null,
): MapUnavailableReason {
  const path = resource ?? "";
  const isTile = /\/v4\//.test(path) || /\.mvt/.test(path);
  const isStyle = /\/styles\//.test(path);

  if (status === 401 || status === 403) {
    // The resource decides *which* capability is implicated, but only after
    // the response has established that a capability is implicated at all.
    const scope = namesMissingScope(`${message} ${body ?? ""}`);
    if (scope !== null) {
      if (scope === "styles:tiles" || (scope === "unnamed" && isTile)) {
        return "tile-access-denied";
      }
      if (
        scope === "styles:read" ||
        scope === "styles:list" ||
        (scope === "unnamed" && isStyle)
      ) {
        return "style-access-denied";
      }
    }
    // No scope evidence: report what was actually observed. 401 means the
    // credential was refused; 403 means it was recognized and not permitted.
    // Which of the several possible causes applies is not knowable from here,
    // and the guidance must not pretend otherwise.
    return status === 401 ? "invalid-token" : "forbidden";
  }

  if (status !== null && status >= 500) return "network";
  if (status !== null && status >= 400) return "request-rejected";

  // No status: fall back to the message, but keep auth detection strict so a
  // stray "unauthorized" in unrelated prose cannot mislabel a transport fault.
  if (/\b401\b|unauthorized|invalid.*token|token.*invalid/i.test(message)) {
    return "invalid-token";
  }
  if (/\b403\b|forbidden|not allowed/i.test(message)) {
    return "forbidden";
  }
  if (/failed to fetch|networkerror|load failed|err_internet|err_network/i.test(message)) {
    return "network";
  }
  return "unknown";
}

/** True when this reason is an authentication or authorization failure. */
export function isAuthFailure(reason: MapUnavailableReason): boolean {
  return (
    reason === "invalid-token" ||
    reason === "forbidden" ||
    reason === "tile-access-denied" ||
    reason === "style-access-denied"
  );
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

/**
 * User-facing wording. Simplified relative to the internal taxonomy — the
 * person looking at the screen needs a category, not a status code. The precise
 * reason is preserved in diagnostics.
 */
export function describeReason(reason: MapUnavailableReason): string {
  switch (reason) {
    case "missing-token":
      return "Map service not configured";
    case "invalid-token":
      return "Map service rejected this key";
    // Deliberately does not say "this site". A 403 is consistent with a URL
    // restriction, a missing capability, and an account-level block, and
    // Mapbox does not say which.
    case "forbidden":
      return "Map service refused this request";
    case "tile-access-denied":
      return "Map tile access denied";
    case "style-access-denied":
      return "Map style access denied";
    case "request-rejected":
      return "Map request rejected";
    case "network":
      return "Map service unreachable";
    case "timeout":
      return "Map failed to load";
    case "webgl-unsupported":
      return "Browser graphics unsupported";
    case "unknown":
      return "Map failed to load";
  }
}
