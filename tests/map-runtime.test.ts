import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error - CJS style-spec bundle ships without a mapped types path
import { validate } from "mapbox-gl/dist/style-spec/index.cjs";
import { atlasNightStyle } from "@/map/mapbox/atlas-night";
import {
  MapboxHandle,
  classifyError,
  describeReason,
  namesMissingScope,
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

  it("never invents a missing capability from the endpoint alone", () => {
    // THE 2026-08-17 REGRESSION. Any 401/403 on a `/v4/…` path was reported as
    // `tile-access-denied`, which the UI renders as "add the styles:tiles
    // capability" — told to an operator whose token already had it.
    //
    // It is not a near miss. Because atlasNight is an inline style, the source
    // manifest at `/v4/<tileset>.json` is the FIRST authenticated request the
    // map makes, so a revoked token, a deleted token, a token from another
    // account, and a URL restriction excluding the host ALL landed on this
    // path first and all came out as "your token lacks styles:tiles".
    const tilejson = "api.mapbox.com/v4/mapbox.mapbox-streets-v8.json";
    const tile = "api.mapbox.com/v4/mapbox.mapbox-streets-v8/12/935/1686.mvt";
    const style = "api.mapbox.com/styles/v1/mapbox/dark-v11";

    for (const resource of [tilejson, tile]) {
      expect(classifyError(403, "Forbidden", resource)).toBe("forbidden");
      expect(classifyError(401, "Unauthorized", resource)).toBe("invalid-token");
    }
    expect(classifyError(403, "Forbidden", style)).toBe("forbidden");
    expect(classifyError(401, "Unauthorized", style)).toBe("invalid-token");
  });

  it("does not treat the bodies Mapbox actually returns as scope evidence", () => {
    // Captured from api.mapbox.com. None of them mentions a capability.
    const tilejson = "api.mapbox.com/v4/mapbox.mapbox-streets-v8.json";

    expect(
      classifyError(401, "Unauthorized", tilejson, "Not Authorized - Invalid Token"),
    ).toBe("invalid-token");
    expect(
      classifyError(401, "Unauthorized", tilejson, "Not Authorized — Direct access not allowed"),
    ).toBe("invalid-token");
    expect(classifyError(403, "Forbidden", tilejson, "Forbidden")).toBe("forbidden");
  });

  it("is not fooled by the docs link in Mapbox's own 401 copy", () => {
    // mapbox-gl builds this message itself for any 401 on a Mapbox host. The
    // anchor is literally "#access-tokens-and-token-scopes" — a URL is never
    // evidence, and reading it as one would resurrect the bug.
    const sdkMessage =
      "Unauthorized: you may have provided an invalid Mapbox access token. " +
      "See https://docs.mapbox.com/api/guides/#access-tokens-and-token-scopes";

    expect(
      classifyError(401, sdkMessage, "api.mapbox.com/v4/mapbox.mapbox-streets-v8.json"),
    ).toBe("invalid-token");
    expect(namesMissingScope(sdkMessage)).toBeNull();
  });

  it("names the capability only when Mapbox's response names it", () => {
    // The one case where the specific remedy is honest.
    expect(
      classifyError(
        403,
        "Forbidden",
        "api.mapbox.com/v4/mapbox.mapbox-streets-v8/12/935/1686.mvt",
        "The access token does not have the required scope: styles:tiles",
      ),
    ).toBe("tile-access-denied");

    expect(
      classifyError(
        403,
        "Forbidden",
        "api.mapbox.com/styles/v1/mapbox/dark-v11",
        '{"message":"Insufficient scope: styles:read"}',
      ),
    ).toBe("style-access-denied");

    // Wording that proves a scope problem without naming which one: the
    // endpoint may then say which capability is implicated.
    expect(
      classifyError(
        403,
        "Forbidden",
        "api.mapbox.com/v4/mapbox.mapbox-streets-v8.json",
        "Token is missing a required scope",
      ),
    ).toBe("tile-access-denied");
  });

  it("recognises scope wording without matching unrelated prose", () => {
    expect(namesMissingScope("required scope: styles:tiles")).toBe("styles:tiles");
    expect(namesMissingScope("insufficient scope")).toBe("unnamed");
    expect(namesMissingScope("Not Authorized - Invalid Token")).toBeNull();
    expect(namesMissingScope("Forbidden")).toBeNull();
    expect(namesMissingScope("")).toBeNull();
    expect(namesMissingScope(null)).toBeNull();
    // "telescope" must not read as "scope".
    expect(namesMissingScope("the telescope failed")).toBeNull();
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

  it("does not strand the surface when a slow style lands after the timeout", () => {
    // On a slow mobile connection the style can arrive after the 15s watchdog
    // has already declared failure. The map is fine; the recorded failure is
    // not. It must be withdrawn, or it gets replayed to every later subscriber
    // and hides any genuine failure that follows.
    const map = createFakeMap();
    const handle = createHandle(map);

    const first = vi.fn();
    handle.on("error", first);
    vi.advanceTimersByTime(16_000);
    expect((first.mock.calls[0]?.[0] as MapUnavailableError).reason).toBe("timeout");

    map.emit("load");

    const late = vi.fn();
    handle.on("error", late);
    expect(late, "a withdrawn timeout must not be replayed").not.toHaveBeenCalled();

    const ready = vi.fn();
    handle.on("ready", ready);
    expect(ready).toHaveBeenCalledTimes(1);

    // And a real failure arriving afterwards must still get through.
    const after = vi.fn();
    handle.on("error", after);
    map.emit("error", { error: Object.assign(new Error("Unauthorized"), { status: 401 }) });
    expect(after).toHaveBeenCalledTimes(1);
    expect((after.mock.calls[0]?.[0] as MapUnavailableError).reason).toBe("invalid-token");

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
