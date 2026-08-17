import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AtlasRouting } from "@/routing/AtlasRouting";
import { mapDirectionsRoutes } from "@/routing/mapbox/directions";
import type { Destination } from "@/destinations/types";
import type { RouteRequest } from "@/routing/types";

/**
 * The client-side routing provider.
 *
 * Covers the half that runs in the browser: request construction, hydration of
 * the wire format, and — the part most easily got wrong — what happens when a
 * request is abandoned. Type-ahead and destination changes abort routes
 * constantly, and an abort reported as a failure puts an error on screen for
 * something the user did on purpose.
 */

const FIXTURES = join(new URL("..", import.meta.url).pathname, "tests/fixtures/directions");

const DESTINATION: Destination = {
  id: "dest-1",
  origin: "search",
  name: "Trinity Street",
  address: "Trinity St, Austin, TX",
  coordinate: { latitude: 30.2872, longitude: -97.7331 },
  icon: "pin",
};

const REQUEST: RouteRequest = {
  origin: { latitude: 30.2672, longitude: -97.7431 },
  destination: DESTINATION,
};

function wireBody() {
  const raw = JSON.parse(
    readFileSync(join(FIXTURES, "austin-two-alternatives.json"), "utf8"),
  );
  return { ok: true, routes: mapDirectionsRoutes(raw, "test", 1_700_000_000_000) };
}

function stubFetch(impl: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => impl(url, init)));
}

afterEach(() => vi.unstubAllGlobals());

describe("AtlasRouting", () => {
  it("hydrates a wire response into Atlas routes with decoded geometry", async () => {
    stubFetch(() => ({ ok: true, json: async () => wireBody() }));

    const outcome = await new AtlasRouting().route(REQUEST);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.routes.length).toBe(2);

    const route = outcome.routes[0]!;
    // The wire carries an encoded polyline; the caller gets coordinates.
    expect(route.geometry.length).toBeGreaterThan(10);
    expect(route.cumulative.length).toBe(route.geometry.length);
    expect(route.legs[0]!.steps.length).toBeGreaterThan(0);
  });

  it("sends coordinates the API can parse, destination last", async () => {
    let seen = "";
    stubFetch((url) => {
      seen = url;
      return { ok: true, json: async () => wireBody() };
    });

    await new AtlasRouting().route({ ...REQUEST, headingDegrees: 87.4 });

    expect(seen).toContain("originLat=30.2672");
    expect(seen).toContain("originLon=-97.7431");
    expect(seen).toContain("destLat=30.2872");
    expect(seen).toContain("destLon=-97.7331");
    // Fractional headings are rounded; the API accepts whole degrees.
    expect(seen).toContain("heading=87");
  });

  it("omits the heading when there is none, rather than sending a guess", async () => {
    let seen = "";
    stubFetch((url) => {
      seen = url;
      return { ok: true, json: async () => wireBody() };
    });

    await new AtlasRouting().route({ ...REQUEST, headingDegrees: null });
    expect(seen).not.toContain("heading=");
  });

  it("passes through the failure the server reported", async () => {
    stubFetch(() => ({
      ok: false,
      json: async () => ({
        ok: false,
        failure: "no-route",
        status: 200,
        detail: "No route found",
      }),
    }));

    const outcome = await new AtlasRouting().route(REQUEST);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure).toBe("no-route");
    expect(outcome.detail).toBe("No route found");
  });

  it("does not trust an unrecognised failure string from the wire", async () => {
    // The value crossed a network boundary. An unknown one must not reach a
    // UI switch statement as a case that does not exist.
    stubFetch(() => ({
      ok: false,
      json: async () => ({ ok: false, failure: "banana" }),
    }));

    const outcome = await new AtlasRouting().route(REQUEST);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure).toBe("error");
  });

  it("reports an abort as cancelled, not as a failure worth showing", async () => {
    // THE CASE THAT MATTERS. Changing destination aborts the in-flight route.
    // Reported as a network error, that puts a red state on screen for
    // something the user did deliberately.
    stubFetch(() => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });

    const outcome = await new AtlasRouting().route(REQUEST);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure).toBe("cancelled");
  });

  it("never reports a cancellation as an empty success", async () => {
    // The other tempting shortcut: return zero routes. That reads as
    // "no route exists between these points", which is a different fact.
    stubFetch(() => {
      throw new DOMException("aborted", "AbortError");
    });

    const outcome = await new AtlasRouting().route(REQUEST);
    expect(outcome.ok).toBe(false);
  });

  it("reports a transport failure as network", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });

    const outcome = await new AtlasRouting().route(REQUEST);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure).toBe("network");
  });

  it("forwards the caller's abort signal to the request", async () => {
    let seenInit: RequestInit | undefined;
    stubFetch((_url, init) => {
      seenInit = init;
      return { ok: true, json: async () => wireBody() };
    });

    const controller = new AbortController();
    await new AtlasRouting().route({ ...REQUEST, signal: controller.signal });
    expect(seenInit?.signal).toBe(controller.signal);
  });
});
