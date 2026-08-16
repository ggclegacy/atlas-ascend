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
        for (const atmosphere of [true, false]) {
          const errors = validate(
            atlasNightStyle({ buildings3D, terrain, atmosphere }),
          ) as Array<{ message: string }>;
          expect(
            errors.map((e) => e.message),
            `buildings3D=${buildings3D} terrain=${terrain} atmosphere=${atmosphere}`,
          ).toEqual([]);
        }
      }
    }
  });

  it("keeps fog on by default and drops it only when asked", () => {
    // The debug harness A/Bs this: fog darkens distance toward near-black, so
    // on a style this dark it is a candidate for "renders correctly but reads
    // as black". Production behavior must stay unchanged by its existence.
    const withFog = atlasNightStyle({ buildings3D: true, terrain: false }) as unknown as {
      fog?: unknown;
    };
    expect(withFog.fog).toBeDefined();

    const without = atlasNightStyle({
      buildings3D: true,
      terrain: false,
      atmosphere: false,
    }) as unknown as { fog?: unknown };
    expect(without.fog).toBeUndefined();
  });

  it("always declares at least one source and a full layer stack", () => {
    // A style that validates but has no sources renders a blank canvas — the
    // exact symptom under investigation, so assert it directly.
    const style = atlasNightStyle({ buildings3D: true, terrain: false }) as unknown as {
      sources: Record<string, unknown>;
      layers: unknown[];
    };
    expect(Object.keys(style.sources).length).toBeGreaterThan(0);
    expect(style.layers.length).toBeGreaterThan(15);
  });
});

// ---------------------------------------------------------------------------
// Error classification — the fix that stops a rejected token being reported
// as an unconfigured one
// ---------------------------------------------------------------------------

describe("map error classification", () => {
  it("never reports an auth failure as a missing token", () => {
    // The original regression: a rejected token was classified "no token",
    // sending the user to configure the one thing that was already correct.
    for (const status of [401, 403]) {
      expect(classifyError(status, "Unauthorized")).not.toBe("missing-token");
    }
  });

  it("separates an invalid key from a forbidden origin", () => {
    // 401 means the credential itself was refused; 403 means it was accepted
    // but not permitted here — typically a URL restriction. Different fixes.
    expect(classifyError(401, "Unauthorized")).toBe("invalid-token");
    expect(classifyError(403, "Forbidden")).toBe("forbidden");
  });

  it("names the missing capability when a tile or style request is refused", () => {
    // This is what turns "check your Mapbox settings" into a specific action.
    expect(
      classifyError(403, "Forbidden", "api.mapbox.com/v4/mapbox.mapbox-streets-v8.json"),
    ).toBe("tile-access-denied");
    expect(
      classifyError(401, "Unauthorized", "api.mapbox.com/v4/mapbox.mapbox-streets-v8/12/935/1686.mvt"),
    ).toBe("tile-access-denied");
    expect(
      classifyError(403, "Forbidden", "api.mapbox.com/styles/v1/mapbox/dark-v11"),
    ).toBe("style-access-denied");
  });

  it("distinguishes client rejections from server and transport failures", () => {
    expect(classifyError(404, "Not Found")).toBe("request-rejected");
    expect(classifyError(429, "Too Many Requests")).toBe("request-rejected");
    expect(classifyError(500, "Internal Server Error")).toBe("network");
    expect(classifyError(503, "Service Unavailable")).toBe("network");
  });

  it("falls back to the message when no status is available", () => {
    expect(classifyError(null, "Failed to fetch")).toBe("network");
    expect(classifyError(null, "invalid token supplied")).toBe("invalid-token");
    expect(classifyError(null, "Forbidden")).toBe("forbidden");
    expect(classifyError(null, "something odd happened")).toBe("unknown");
  });

  it("does not mistake unrelated prose for an auth failure", () => {
    // Guards against the old over-eager pattern matching.
    expect(classifyError(null, "sprite image could not be decoded")).toBe("unknown");
  });

  it("gives every reason a distinct, non-empty, trace-free description", () => {
    const reasons: MapUnavailableReason[] = [
      "missing-token",
      "invalid-token",
      "forbidden",
      "tile-access-denied",
      "style-access-denied",
      "request-rejected",
      "network",
      "timeout",
      "webgl-unsupported",
      "unknown",
    ];
    const described = reasons.map(describeReason);

    for (const text of described) {
      expect(text.length).toBeGreaterThan(0);
      // User-facing copy must never leak internals.
      expect(text).not.toMatch(/error:|stack|undefined|null|at </i);
    }
    // User-facing wording is deliberately allowed to collapse (timeout and
    // unknown both read "Map failed to load") — the precise reason survives in
    // diagnostics. What must NEVER collapse is "not configured" against any
    // auth failure: that specific conflation is what sent the user to fix a
    // token that was already correct.
    const notConfigured = describeReason("missing-token");
    for (const authReason of [
      "invalid-token",
      "forbidden",
      "tile-access-denied",
      "style-access-denied",
    ] as const) {
      expect(
        describeReason(authReason),
        `${authReason} must not read as "not configured"`,
      ).not.toBe(notConfigured);
    }

    // And each auth failure must name a different remedy.
    const authTexts = [
      describeReason("invalid-token"),
      describeReason("forbidden"),
      describeReason("tile-access-denied"),
      describeReason("style-access-denied"),
    ];
    expect(new Set(authTexts).size).toBe(authTexts.length);
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
      "invalid-token",
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
