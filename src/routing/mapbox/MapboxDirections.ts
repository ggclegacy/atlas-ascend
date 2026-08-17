import type { Coordinate } from "@/map/types";
import type { RouteFailure } from "../types";
import type { RouteWire } from "../wire";
import {
  DirectionsShapeError,
  mapDirectionsRoutes,
  readDirectionsCode,
  readDirectionsMessage,
} from "./directions";

/**
 * MAPBOX DIRECTIONS — the request half.
 *
 * Server-side only: called from `/api/route`, never from the browser. That is
 * the same shape as `/api/search`, and for the same reasons — one place to add
 * caching and rate limiting, and one place the vendor relationship lives.
 *
 * This module builds the request and classifies the outcome. Turning the
 * payload into Atlas types is `directions.ts`.
 */

const DIRECTIONS = "https://api.mapbox.com/directions/v5/mapbox";

/**
 * `driving-traffic` rather than `driving`.
 *
 * It costs the same and returns durations that account for live conditions,
 * which is the difference between an ETA and a guess. Mapbox caps it at 25
 * coordinates per request; Atlas sends two.
 */
const PROFILE = "driving-traffic";

export const MAPBOX_DIRECTIONS_PROVIDER_ID = "mapbox-directions-v5";

/** Guards against a hung request holding the route screen open forever. */
const REQUEST_TIMEOUT_MS = 12_000;

export interface DirectionsRequest {
  readonly origin: Coordinate;
  readonly destination: Coordinate;
  readonly alternatives: boolean;
  /** Course over ground, so the first maneuver is not a U-turn. */
  readonly headingDegrees: number | null;
  readonly accessToken: string;
  readonly signal?: AbortSignal;
}

export type DirectionsResult =
  | { readonly ok: true; readonly routes: readonly RouteWire[] }
  | {
      readonly ok: false;
      readonly failure: RouteFailure;
      readonly status: number | null;
      readonly detail: string | null;
    };

/** `lon,lat;lon,lat` — longitude first, which is the opposite of speech. */
function encodePair(origin: Coordinate, destination: Coordinate): string {
  return (
    `${origin.longitude},${origin.latitude};` +
    `${destination.longitude},${destination.latitude}`
  );
}

export function buildDirectionsUrl(request: DirectionsRequest): string {
  const params = new URLSearchParams({
    alternatives: String(request.alternatives),
    // Encoded rather than GeoJSON: a long route is an order of magnitude
    // smaller on the wire, and Atlas decodes it anyway.
    geometries: "polyline6",
    overview: "full",
    steps: "true",
    banner_instructions: "true",
    voice_instructions: "true",
    annotations: "congestion,duration,distance",
    access_token: request.accessToken,
  });

  // Without a bearing the router may open the route with a U-turn, because it
  // has no idea which way the car is pointing. 45° of tolerance is wide enough
  // to survive ordinary GPS heading noise.
  if (request.headingDegrees !== null) {
    const bearing = Math.round(request.headingDegrees) % 360;
    params.set("bearings", `${bearing},45;`);
  }

  return `${DIRECTIONS}/${PROFILE}/${encodePair(request.origin, request.destination)}?${params}`;
}

/**
 * Requests a route.
 *
 * Never throws for an expected condition — every outcome, including an abort,
 * comes back as a value.
 */
export async function requestDirections(
  request: DirectionsRequest,
): Promise<DirectionsResult> {
  const requestedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // A caller-supplied abort and our own timeout both have to reach the fetch.
  const onCallerAbort = () => controller.abort();
  request.signal?.addEventListener("abort", onCallerAbort);

  try {
    const response = await fetch(buildDirectionsUrl(request), {
      signal: controller.signal,
      // Routes are position- and time-specific. Caching one would hand a
      // driver somebody else's route, or their own from twenty minutes ago.
      cache: "no-store",
    });

    const body: unknown = await response.json().catch(() => null);
    const message = readDirectionsMessage(body);

    if (!response.ok) {
      return {
        ok: false,
        failure: httpFailure(response.status, readDirectionsCode(body)),
        status: response.status,
        detail: message,
      };
    }

    // A 200 is not success. Mapbox reports "no route exists" as 200 with an
    // empty routes array, so the body's own code is the authority.
    const code = readDirectionsCode(body);
    if (code !== "ok") {
      return {
        ok: false,
        failure: codeFailure(code),
        status: response.status,
        detail: message,
      };
    }

    const routes = mapDirectionsRoutes(
      body,
      MAPBOX_DIRECTIONS_PROVIDER_ID,
      requestedAt,
    );

    // `Ok` with nothing in it is not a contract violation, but it is not a
    // route either, and it must not present as a successful empty preview.
    if (routes.length === 0) {
      return {
        ok: false,
        failure: "no-route",
        status: response.status,
        detail: message,
      };
    }

    return { ok: true, routes };
  } catch (error) {
    return { ok: false, ...classifyThrown(error, request.signal) };
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onCallerAbort);
  }
}

function httpFailure(status: number, code: string): RouteFailure {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "network";
  // 422 carries the provider's own diagnosis, which is more specific.
  if (code === "no-route") return "no-route";
  if (code === "no-segment") return "unroutable-point";
  return "error";
}

function codeFailure(code: string): RouteFailure {
  switch (code) {
    case "no-route":
      return "no-route";
    case "no-segment":
      return "unroutable-point";
    case "invalid-input":
    case "profile-not-found":
      // Atlas built the request, so this is our bug, not the driver's.
      return "error";
    default:
      return "error";
  }
}

function classifyThrown(
  error: unknown,
  callerSignal: AbortSignal | undefined,
): { failure: RouteFailure; status: null; detail: string | null } {
  const detail = error instanceof Error ? error.message : null;

  if (error instanceof DirectionsShapeError) {
    return { failure: "malformed-response", status: null, detail };
  }

  const aborted =
    error instanceof DOMException && error.name === "AbortError";
  if (aborted) {
    // Distinguishing the two matters: one is the user changing their mind,
    // the other is a service that did not answer in time.
    return {
      failure: callerSignal?.aborted ? "cancelled" : "timeout",
      status: null,
      detail: null,
    };
  }

  return { failure: "network", status: null, detail };
}
