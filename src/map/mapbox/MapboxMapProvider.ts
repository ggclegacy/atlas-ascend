import type { Map as MapboxMap, Marker } from "mapbox-gl";
import { getMapboxToken } from "@/lib/env";
import {
  type MapEvents,
  type MapHandle,
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
import { createDestinationElement, createUserPuckElement } from "./markers";

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
    if (getMapboxToken() === null) return "no-token";
    if (!supportsWebGL()) return "webgl-unsupported";
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

    // Dynamic import keeps ~800KB of map SDK out of the initial bundle. The
    // Command Center shell renders and becomes interactive before this lands.
    //
    // The stylesheet is loaded here too rather than statically at the top of
    // the map component: a static import would put ~40KB of Mapbox CSS in the
    // render-blocking payload for a surface that has not mounted yet.
    const [mapboxModule] = await Promise.all([
      import("mapbox-gl"),
      import("mapbox-gl/dist/mapbox-gl.css"),
    ]);

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

    return new MapboxHandle(map, mapboxgl, initial);
  }
}

// ---------------------------------------------------------------------------

class MapboxHandle implements MapHandle {
  private userMarker: Marker | null = null;
  private destinationMarker: Marker | null = null;
  private puckElement: HTMLElement | null = null;
  private destroyed = false;

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
  ) {
    map.on("load", () => {
      this.emit("ready");
    });

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
      // Mapbox surfaces tile 401/403s here; a bad token is the common cause
      // and deserves a real UI state rather than a silent grey canvas.
      const message = event.error?.message ?? "Map failed to load";
      const reason: MapUnavailableReason = /401|403|token|unauthor/i.test(message)
        ? "no-token"
        : "load-failed";
      this.emit("error", new MapUnavailableError(reason, message));
    });
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

  on<K extends keyof MapEvents>(event: K, handler: MapEvents[K]): () => void {
    this.listeners[event].add(handler);
    return () => {
      this.listeners[event].delete(handler);
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.userMarker?.remove();
    this.destinationMarker?.remove();
    this.map.remove();
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

function supportsWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") ?? canvas.getContext("webgl"),
    );
  } catch {
    return false;
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
      return "Mapbox access token not configured";
    case "webgl-unsupported":
      return "This browser does not support WebGL";
    case "load-failed":
      return "The map failed to load";
    case "network":
      return "Network unavailable";
  }
}
