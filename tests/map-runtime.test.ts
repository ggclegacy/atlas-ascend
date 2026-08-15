import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error - CJS style-spec bundle ships without a mapped types path
import { validate } from "mapbox-gl/dist/style-spec/index.cjs";
import { atlasNightStyle } from "@/map/mapbox/atlas-night";
import {
  MapboxHandle,
  classifyError,
  describeReason,
} from "@/map/mapbox/MapboxMapProvider";
import { MapUnavailableError, type MapUnavailableReason } from "@/map/provider";
import type { MapConfiguration } from "@/map/types";

/**
 * Regression tests for the blank-map incident.
 *
 * Each block corresponds to a defect that produced, or could have produced, a
 * dark rectangle instead of either a map or an honest failure state.
 */

// ---------------------------------------------------------------------------
// atlasNight validity — proven against Mapbox's own validator, not asserted
// ---------------------------------------------------------------------------

describe("atlasNight is a valid Mapbox style", () => {
  it("validates with zero errors in every capability configuration", () => {
    for (const buildings3D of [true, false]) {
      for (const terrain of [true, false]) {
        const errors = validate(atlasNightStyle({ buildings3D, terrain })) as Array<{
          message: string;
        }>;
        expect(
          errors.map((e) => e.message),
          `buildings3D=${buildings3D} terrain=${terrain}`,
        ).toEqual([]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Error classification — the fix that stops a rejected token being reported
// as an unconfigured one
// ---------------------------------------------------------------------------

describe("map error classification", () => {
  it("reports 401 and 403 as unauthorized, never as a missing token", () => {
    // The regression: a URL-restricted token 401s, and the old regex reported
    // "no-token", telling the user to configure the one thing already correct.
    expect(classifyError(401, "Unauthorized")).toBe("unauthorized");
    expect(classifyError(403, "Forbidden")).toBe("unauthorized");
    expect(classifyError(401, "Unauthorized")).not.toBe("no-token");
  });

  it("distinguishes 404 and server errors", () => {
    expect(classifyError(404, "Not Found")).toBe("load-failed");
    expect(classifyError(500, "Internal Server Error")).toBe("network");
    expect(classifyError(503, "Service Unavailable")).toBe("network");
  });

  it("falls back to the message when no status is available", () => {
    expect(classifyError(null, "Failed to fetch")).toBe("network");
    expect(classifyError(null, "invalid token supplied")).toBe("unauthorized");
    expect(classifyError(null, "something odd happened")).toBe("load-failed");
  });

  it("does not mistake unrelated prose for an auth failure", () => {
    // Guards against the old over-eager pattern matching.
    expect(classifyError(null, "sprite image could not be decoded")).toBe(
      "load-failed",
    );
  });

  it("gives every reason a distinct, non-empty, trace-free description", () => {
    const reasons: MapUnavailableReason[] = [
      "no-token",
      "unauthorized",
      "webgl-unsupported",
      "load-failed",
      "network",
      "timeout",
    ];
    const described = reasons.map(describeReason);

    for (const text of described) {
      expect(text.length).toBeGreaterThan(0);
      // User-facing copy must never leak internals.
      expect(text).not.toMatch(/error:|stack|undefined|null|at </i);
    }
    // "no-token" and "unauthorized" must not read identically.
    expect(describeReason("no-token")).not.toBe(describeReason("unauthorized"));
  });
});

// ---------------------------------------------------------------------------
// Handle lifecycle — the replay defect that stranded the UI on its veil
// ---------------------------------------------------------------------------

interface FakeMap {
  on(event: string, handler: (payload?: unknown) => void): void;
  emit(event: string, payload?: unknown): void;
  removed: boolean;
}

function createFakeMap(): FakeMap {
  const handlers = new Map<string, Array<(payload?: unknown) => void>>();
  return {
    on(event: string, handler: (payload?: unknown) => void) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    emit(event: string, payload?: unknown) {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
    removed: false,
    getCenter: () => ({ lat: 30.2672, lng: -97.7431 }),
    getZoom: () => 15,
    getPitch: () => 60,
    getBearing: () => 0,
    resize() {},
    remove() {
      (this as unknown as FakeMap).removed = true;
    },
  } as unknown as FakeMap;
}

const CONTAINER = {
  getBoundingClientRect: () => ({ width: 390, height: 780 }),
} as unknown as HTMLElement;

const CONFIG: MapConfiguration = {
  camera: {
    center: { latitude: 30.2672, longitude: -97.7431 },
    zoom: 15,
    pitch: 60,
    bearing: 0,
  },
  style: "atlasNight",
  perspective: "driving",
  annotations: [],
};

function createHandle(map: FakeMap) {
  return new MapboxHandle(
    map as never,
    {} as never,
    CONFIG,
    CONTAINER,
  );
}

describe("MapboxHandle event replay", () => {
  beforeEach(() => {
    // stageFailed logs unconditionally by design; keep the suite readable.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("replays ready to a subscriber that arrives after the map loaded", () => {
    // THE ORIGINAL DEFECT: the consumer subscribes only after `mount()`
    // resolves. A `load` in that window was dropped, the UI never left
    // "mounting", and its opaque veil covered a working map forever.
    const map = createFakeMap();
    const handle = createHandle(map);

    map.emit("load"); // fires BEFORE anyone subscribes

    const onReady = vi.fn();
    handle.on("ready", onReady);

    expect(onReady).toHaveBeenCalledTimes(1);
    handle.destroy();
  });

  it("still delivers ready to a subscriber that arrives first", () => {
    const map = createFakeMap();
    const handle = createHandle(map);

    const onReady = vi.fn();
    handle.on("ready", onReady);
    expect(onReady).not.toHaveBeenCalled();

    map.emit("load");
    expect(onReady).toHaveBeenCalledTimes(1);
    handle.destroy();
  });

  it("replays a fatal error to a late subscriber", () => {
    const map = createFakeMap();
    const handle = createHandle(map);

    map.emit("error", { error: Object.assign(new Error("Unauthorized"), { status: 401 }) });

    const onError = vi.fn();
    handle.on("error", onError);

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as MapUnavailableError).reason).toBe(
      "unauthorized",
    );
    handle.destroy();
  });

  it("reports only the first fatal error, not the cascade", () => {
    const map = createFakeMap();
    const handle = createHandle(map);

    const onError = vi.fn();
    handle.on("error", onError);

    map.emit("error", { error: Object.assign(new Error("Unauthorized"), { status: 401 }) });
    map.emit("error", { error: Object.assign(new Error("Unauthorized"), { status: 401 }) });
    map.emit("error", { error: Object.assign(new Error("Not Found"), { status: 404 }) });

    expect(onError).toHaveBeenCalledTimes(1);
    handle.destroy();
  });

  it("does not blank an already-loaded map over one failed sub-resource", () => {
    // A single missing glyph range must not take down a working map.
    const map = createFakeMap();
    const handle = createHandle(map);

    const onError = vi.fn();
    handle.on("ready", () => {});
    handle.on("error", onError);

    map.emit("load");
    map.emit("error", { error: Object.assign(new Error("Not Found"), { status: 404 }) });

    expect(onError).not.toHaveBeenCalled();
    handle.destroy();
  });

  it("still reports auth failure even after the map loaded", () => {
    // Tiles 401ing after style load leaves an empty obsidian field that looks
    // identical to a broken map — so this one must always surface.
    const map = createFakeMap();
    const handle = createHandle(map);

    const onError = vi.fn();
    handle.on("error", onError);

    map.emit("load");
    map.emit("error", { error: Object.assign(new Error("Unauthorized"), { status: 401 }) });

    expect(onError).toHaveBeenCalledTimes(1);
    handle.destroy();
  });
});

describe("MapboxHandle watchdog", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("converts an indefinite hang into an honest timeout", () => {
    const map = createFakeMap();
    const handle = createHandle(map);

    const onError = vi.fn();
    handle.on("error", onError);

    vi.advanceTimersByTime(16_000);

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as MapUnavailableError).reason).toBe("timeout");
    handle.destroy();
  });

  it("does not fire once the map has loaded", () => {
    const map = createFakeMap();
    const handle = createHandle(map);

    const onError = vi.fn();
    handle.on("error", onError);

    map.emit("load");
    vi.advanceTimersByTime(60_000);

    expect(onError).not.toHaveBeenCalled();
    handle.destroy();
  });

  it("does not fire after destroy", () => {
    const map = createFakeMap();
    const handle = createHandle(map);

    const onError = vi.fn();
    handle.on("error", onError);

    handle.destroy();
    handle.destroy(); // idempotent
    vi.advanceTimersByTime(60_000);

    expect(onError).not.toHaveBeenCalled();
  });
});
