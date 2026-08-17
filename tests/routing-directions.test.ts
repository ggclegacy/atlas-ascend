import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DirectionsShapeError,
  mapDirectionsRoutes,
  mapManeuverDirection,
  mapManeuverKind,
  readDirectionsCode,
  readDirectionsMessage,
} from "@/routing/mapbox/directions";
import { buildDirectionsUrl } from "@/routing/mapbox/MapboxDirections";
import { hydrateRoute } from "@/routing/wire";
import { distanceMeters } from "@/map/types";
import type { AtlasRoute } from "@/routing/types";

/**
 * Mapbox Directions → Atlas mapping.
 *
 * Every fixture in `tests/fixtures/directions/` is a real captured response
 * from api.mapbox.com, not a hand-written approximation. Fields the mapper
 * never reads (`annotation`, `intersections`, `admins`) were removed to keep
 * them a readable size; everything the mapper does read is exactly as Mapbox
 * returned it.
 *
 * The failure fixtures are the reason this matters. **Mapbox reports "no route
 * exists" with HTTP 200.** A mapper written against assumptions rather than
 * real payloads classifies that as success with zero routes.
 */

const FIXTURES = join(new URL("..", import.meta.url).pathname, "tests/fixtures/directions");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));
}

const PROVIDER = "test-provider";
const AT = 1_700_000_000_000;

function mapped(name: string): AtlasRoute[] {
  return mapDirectionsRoutes(fixture(name), PROVIDER, AT).map(hydrateRoute);
}

// ---------------------------------------------------------------------------
// Outcome codes — status is not the authority
// ---------------------------------------------------------------------------

describe("provider outcome codes", () => {
  it("reads success", () => {
    expect(readDirectionsCode(fixture("austin-two-alternatives"))).toBe("ok");
  });

  it("recognises the failures that arrive as HTTP 200", () => {
    // Captured live: both of these came back 200 with an empty routes array.
    expect(readDirectionsCode(fixture("no-route"))).toBe("no-route");
    expect(readDirectionsCode(fixture("no-segment"))).toBe("no-segment");
    expect(readDirectionsMessage(fixture("no-route"))).toBe("No route found");
    expect(readDirectionsMessage(fixture("no-segment"))).toMatch(
      /matching segment/i,
    );
  });

  it("recognises rejected input", () => {
    expect(readDirectionsCode(fixture("invalid-input"))).toBe("invalid-input");
    expect(readDirectionsMessage(fixture("invalid-input"))).toMatch(
      /Latitude must be between/i,
    );
  });

  it("does not mistake an unrecognised code for success", () => {
    expect(readDirectionsCode({ code: "SomethingNew" })).toBe("unknown");
    expect(readDirectionsCode({})).toBe("unknown");
    expect(readDirectionsCode(null)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// A real route, end to end
// ---------------------------------------------------------------------------

describe("mapping a real route", () => {
  const routes = mapped("austin-two-alternatives");

  it("returns every alternative the provider offered", () => {
    expect(routes.length).toBe(2);
    expect(new Set(routes.map((r) => r.id)).size).toBe(2);
  });

  it("carries distance, duration and the traffic estimate", () => {
    const [route] = routes;
    expect(route!.distanceMeters).toBeGreaterThan(1_000);
    expect(route!.durationSeconds).toBeGreaterThan(60);
    // driving-traffic returns a free-flow figure alongside the live one.
    expect(route!.durationInTrafficSeconds).not.toBeNull();
  });

  it("produces ETA-ready arithmetic", () => {
    // Everything an ETA needs is present without further provider calls.
    const route = routes[0]!;
    const eta = route.requestedAt + route.durationSeconds * 1000;
    expect(eta).toBeGreaterThan(route.requestedAt);
    expect(Number.isFinite(eta)).toBe(true);
  });

  it("decodes geometry that matches the reported distance", () => {
    const route = routes[0]!;
    expect(route.geometry.length).toBeGreaterThan(10);

    let summed = 0;
    for (let i = 1; i < route.geometry.length; i++) {
      summed += distanceMeters(route.geometry[i - 1]!, route.geometry[i]!);
    }
    // Great-circle summation against the provider's own road-network figure.
    expect(summed).toBeGreaterThan(route.distanceMeters * 0.95);
    expect(summed).toBeLessThan(route.distanceMeters * 1.05);
  });

  it("builds a monotonic cumulative distance table", () => {
    const { cumulative, geometry } = routes[0]!;
    expect(cumulative.length).toBe(geometry.length);
    expect(cumulative[0]).toBe(0);
    for (let i = 1; i < cumulative.length; i++) {
      expect(cumulative[i]!).toBeGreaterThanOrEqual(cumulative[i - 1]!);
    }
    expect(cumulative[cumulative.length - 1]!).toBeGreaterThan(0);
  });

  it("bounds the whole line", () => {
    const { bounds, geometry } = routes[0]!;
    for (const point of geometry) {
      expect(point.latitude).toBeGreaterThanOrEqual(bounds.southwest.latitude);
      expect(point.latitude).toBeLessThanOrEqual(bounds.northeast.latitude);
      expect(point.longitude).toBeGreaterThanOrEqual(bounds.southwest.longitude);
      expect(point.longitude).toBeLessThanOrEqual(bounds.northeast.longitude);
    }
  });

  it("maps legs and steps", () => {
    const route = routes[0]!;
    expect(route.legs.length).toBeGreaterThan(0);

    const steps = route.legs.flatMap((l) => l.steps);
    expect(steps.length).toBeGreaterThan(1);
    for (const step of steps) {
      expect(Number.isFinite(step.distanceMeters)).toBe(true);
      expect(Number.isFinite(step.durationSeconds)).toBe(true);
      expect(step.distanceMeters).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives every step a geometry range inside the route", () => {
    // Step indices address the shared route geometry. Off-by-one accumulation
    // here would highlight the wrong stretch of road, increasingly so toward
    // the end of a long route.
    const route = routes[0]!;
    for (const step of route.legs.flatMap((l) => l.steps)) {
      expect(step.geometryStart).toBeGreaterThanOrEqual(0);
      expect(step.geometryEnd).toBeGreaterThanOrEqual(step.geometryStart);
      expect(step.geometryEnd).toBeLessThanOrEqual(route.geometry.length);
    }
  });

  it("tiles the geometry contiguously across steps", () => {
    // Each step must begin exactly where the previous one ended, and the last
    // must reach the end of the line. Consecutive steps share their boundary
    // vertex, so counting naively drifts by one per step — by the end of a
    // long route the highlighted stretch would be visibly wrong, and progress
    // tracking would advance the maneuver at the wrong moment.
    for (const name of ["austin-two-alternatives", "highway-ramps", "rotary"]) {
      for (const route of mapped(name)) {
        const steps = route.legs.flatMap((l) => l.steps);
        expect(steps[0]!.geometryStart, name).toBe(0);
        for (let i = 1; i < steps.length; i++) {
          expect(steps[i]!.geometryStart, `${name} step ${i}`).toBe(
            steps[i - 1]!.geometryEnd,
          );
        }
        expect(steps[steps.length - 1]!.geometryEnd, name).toBe(
          route.geometry.length,
        );
      }
    }
  });

  it("keeps each step's geometry slice consistent with its stated distance", () => {
    // Guards the indices against being contiguous but offset — a shift that
    // tiles perfectly and still points at the wrong road.
    const route = mapped("highway-ramps")[0]!;
    for (const step of route.legs.flatMap((l) => l.steps)) {
      if (step.distanceMeters < 100) continue;
      const slice = route.geometry.slice(step.geometryStart, step.geometryEnd + 1);
      if (slice.length < 2) continue;

      let measured = 0;
      for (let i = 1; i < slice.length; i++) {
        measured += distanceMeters(slice[i - 1]!, slice[i]!);
      }
      expect(
        Math.abs(measured - step.distanceMeters),
        `step "${step.roadName ?? step.instruction}"`,
      ).toBeLessThan(step.distanceMeters * 0.15 + 20);
    }
  });

  it("opens with depart and closes with arrive", () => {
    const steps = routes[0]!.legs.flatMap((l) => l.steps);
    expect(steps[0]!.maneuver.kind).toBe("depart");
    expect(steps[steps.length - 1]!.maneuver.kind).toBe("arrive");
  });
});

// ---------------------------------------------------------------------------
// Guidance preservation — what Phase 4 voice will consume
// ---------------------------------------------------------------------------

describe("guidance data is preserved", () => {
  it("keeps the provider's spoken cues verbatim", () => {
    const steps = mapped("austin-two-alternatives")[0]!.legs.flatMap(
      (l) => l.steps,
    );
    const withVoice = steps.filter((s) => s.voice.length > 0);
    expect(withVoice.length).toBeGreaterThan(0);

    for (const step of withVoice) {
      for (const cue of step.voice) {
        expect(cue.text.length).toBeGreaterThan(0);
        expect(Number.isFinite(cue.atRemainingMeters)).toBe(true);
        expect(cue.atRemainingMeters).toBeGreaterThanOrEqual(0);
      }
    }

    // Phrased, unit-aware guidance is the thing worth preserving — a template
    // over raw fields does not produce sentences like this.
    const all = withVoice.flatMap((s) => s.voice.map((v) => v.text));
    expect(all.some((t) => /\b(mile|feet|meters?)\b/i.test(t))).toBe(true);
  });

  it("keeps banner cues with their primary text", () => {
    const steps = mapped("austin-two-alternatives")[0]!.legs.flatMap(
      (l) => l.steps,
    );
    const banners = steps.flatMap((s) => s.banner);
    expect(banners.length).toBeGreaterThan(0);
    for (const banner of banners) {
      expect(banner.primary.length).toBeGreaterThan(0);
    }
  });

  it("records the locale the cues are written in", () => {
    expect(mapped("austin-two-alternatives")[0]!.voiceLocale).toMatch(/^[a-z]{2}/i);
  });

  it("treats a step with no cues as legitimate, not as an error", () => {
    // Arrival steps routinely carry none.
    const steps = mapped("austin-two-alternatives")[0]!.legs.flatMap(
      (l) => l.steps,
    );
    expect(steps.every((s) => Array.isArray(s.voice))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Maneuvers
// ---------------------------------------------------------------------------

describe("maneuver mapping", () => {
  it("covers every type the Directions API documents", () => {
    const table: ReadonlyArray<readonly [string, string]> = [
      ["turn", "turn"],
      ["depart", "depart"],
      ["arrive", "arrive"],
      ["merge", "merge"],
      ["on ramp", "on-ramp"],
      ["off ramp", "off-ramp"],
      ["fork", "fork"],
      ["end of road", "turn"],
      ["continue", "continue"],
      ["roundabout", "roundabout"],
      ["rotary", "roundabout"],
      ["roundabout turn", "roundabout"],
      ["exit roundabout", "roundabout-exit"],
      ["exit rotary", "roundabout-exit"],
      ["notification", "continue"],
    ];
    for (const [type, expected] of table) {
      expect(mapManeuverKind(type, null), type).toBe(expected);
    }
  });

  it("promotes a u-turn modifier to its own kind", () => {
    expect(mapManeuverKind("turn", "uturn")).toBe("u-turn");
    expect(mapManeuverKind("continue", "uturn")).toBe("u-turn");
    // But a u-turn modifier on a roundabout is still a roundabout.
    expect(mapManeuverKind("roundabout", "uturn")).toBe("roundabout");
  });

  it("degrades an unknown maneuver instead of discarding the route", () => {
    // A maneuver Atlas cannot name is still one the driver can perform. The
    // step keeps its road name, distance and the provider's instruction.
    expect(mapManeuverKind("teleport", null)).toBe("unknown");
    expect(mapManeuverKind(undefined, null)).toBe("unknown");
    expect(mapManeuverKind(42, null)).toBe("unknown");
  });

  it("maps every documented modifier and rejects nonsense", () => {
    const table: ReadonlyArray<readonly [string, string]> = [
      ["left", "left"],
      ["right", "right"],
      ["straight", "straight"],
      ["uturn", "u-turn"],
      ["slight left", "slight-left"],
      ["slight right", "slight-right"],
      ["sharp left", "sharp-left"],
      ["sharp right", "sharp-right"],
    ];
    for (const [modifier, expected] of table) {
      expect(mapManeuverDirection(modifier), modifier).toBe(expected);
    }
    expect(mapManeuverDirection("sideways")).toBeNull();
    expect(mapManeuverDirection(undefined)).toBeNull();
  });

  it("carries roundabout exit numbers from a real rotary route", () => {
    const steps = mapped("rotary")[0]!.legs.flatMap((l) => l.steps);
    const roundabouts = steps.filter(
      (s) => s.maneuver.kind === "roundabout" || s.maneuver.kind === "roundabout-exit",
    );
    expect(roundabouts.length).toBeGreaterThan(0);
    expect(roundabouts.some((s) => s.maneuver.roundaboutExit !== null)).toBe(true);
  });

  it("carries ramp exit numbers and destinations from a real highway route", () => {
    const steps = mapped("highway-ramps")[0]!.legs.flatMap((l) => l.steps);
    expect(steps.some((s) => s.maneuver.kind === "off-ramp")).toBe(true);
    expect(steps.some((s) => s.maneuver.exitNumber !== null)).toBe(true);
    // `towards` is the sign the driver reads; `roadRef` is the shield.
    expect(steps.some((s) => s.towards !== null || s.roadRef !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Malformed payloads
// ---------------------------------------------------------------------------

describe("malformed responses are refused, not patched", () => {
  const good = () => structuredClone(fixture("austin-two-alternatives")) as {
    routes: Array<Record<string, unknown>>;
  };

  it("rejects a response that is not an object", () => {
    expect(() => mapDirectionsRoutes(null, PROVIDER, AT)).toThrow(DirectionsShapeError);
    expect(() => mapDirectionsRoutes("nope", PROVIDER, AT)).toThrow(DirectionsShapeError);
  });

  it("rejects a missing routes array", () => {
    expect(() => mapDirectionsRoutes({ code: "Ok" }, PROVIDER, AT)).toThrow(
      DirectionsShapeError,
    );
  });

  it("rejects a route with no geometry", () => {
    const body = good();
    delete body.routes[0]!["geometry"];
    expect(() => mapDirectionsRoutes(body, PROVIDER, AT)).toThrow(/geometry/i);
  });

  it("rejects a route with no legs", () => {
    const body = good();
    body.routes[0]!["legs"] = [];
    expect(() => mapDirectionsRoutes(body, PROVIDER, AT)).toThrow(/legs/i);
  });

  it("rejects a non-numeric distance rather than producing NaN", () => {
    // A route with NaN distance renders, animates, and reports an ETA of
    // "NaN minutes" — or worse, silently formats to something plausible.
    const body = good();
    body.routes[0]!["distance"] = "about three miles";
    expect(() => mapDirectionsRoutes(body, PROVIDER, AT)).toThrow(/finite number/i);
  });

  it("rejects an impossible maneuver location", () => {
    const body = good();
    const legs = body.routes[0]!["legs"] as Array<{ steps: Array<Record<string, unknown>> }>;
    (legs[0]!.steps[0]!["maneuver"] as Record<string, unknown>)["location"] = [999, 999];
    expect(() => mapDirectionsRoutes(body, PROVIDER, AT)).toThrow(/possible range/i);
  });
});

// ---------------------------------------------------------------------------
// Request construction
// ---------------------------------------------------------------------------

describe("request construction", () => {
  const base = {
    origin: { latitude: 30.2672, longitude: -97.7431 },
    destination: { latitude: 30.2872, longitude: -97.7331 },
    alternatives: true,
    headingDegrees: null,
    accessToken: "pk.test",
  };

  it("orders coordinates longitude-first, as the API requires", () => {
    // Reversed, this silently routes somewhere in the Indian Ocean.
    expect(buildDirectionsUrl(base)).toContain("-97.7431,30.2672;-97.7331,30.2872");
  });

  it("asks for everything navigation and voice need", () => {
    const url = buildDirectionsUrl(base);
    expect(url).toContain("steps=true");
    expect(url).toContain("banner_instructions=true");
    expect(url).toContain("voice_instructions=true");
    expect(url).toContain("geometries=polyline6");
    expect(url).toContain("overview=full");
    expect(url).toContain("alternatives=true");
  });

  it("sends a bearing only when the heading is known", () => {
    expect(buildDirectionsUrl(base)).not.toContain("bearings=");
    // Without this the router can open the route with a U-turn, having no
    // idea which way the car is pointing.
    expect(buildDirectionsUrl({ ...base, headingDegrees: 90 })).toContain(
      "bearings=90%2C45%3B",
    );
  });

  it("uses the traffic-aware profile", () => {
    expect(buildDirectionsUrl(base)).toContain("/driving-traffic/");
  });
});
