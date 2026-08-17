"use client";

import type {
  RouteFailure,
  RouteOutcome,
  RouteRequest,
  RoutingProvider,
} from "./types";
import { type RouteWireResponse, hydrateRoute } from "./wire";

const ROUTE_FAILURES: ReadonlySet<string> = new Set<RouteFailure>([
  "not-configured",
  "unauthorized",
  "forbidden",
  "no-route",
  "unroutable-point",
  "rate-limited",
  "network",
  "timeout",
  "malformed-response",
  "cancelled",
  "error",
]);

/**
 * Narrows a failure string from the wire.
 *
 * The value crossed a network boundary, so it is checked rather than asserted.
 * An unrecognised one becomes `"error"` — vague, but honest, and it cannot
 * make the UI switch on a case that does not exist.
 */
function asRouteFailure(value: string): RouteFailure {
  return ROUTE_FAILURES.has(value) ? (value as RouteFailure) : "error";
}

/**
 * The routing provider feature code uses.
 *
 * Talks to `/api/route`, which owns the vendor relationship, and hands back
 * `AtlasRoute` objects. Deliberately knows nothing about Mapbox — swapping the
 * router is a change to one route handler and one mapper, and nothing in the
 * feature layer moves.
 *
 * Same shape as `AtlasPlaceSearch`, on purpose: two vendor-backed services
 * that behave the same way are two fewer things to remember.
 */
export class AtlasRouting implements RoutingProvider {
  readonly id = "atlas-route-api";

  async route(request: RouteRequest): Promise<RouteOutcome> {
    const params = new URLSearchParams({
      originLat: String(request.origin.latitude),
      originLon: String(request.origin.longitude),
      destLat: String(request.destination.coordinate.latitude),
      destLon: String(request.destination.coordinate.longitude),
      alternatives: String(request.alternatives ?? true),
    });

    if (
      typeof request.headingDegrees === "number" &&
      Number.isFinite(request.headingDegrees)
    ) {
      params.set("heading", String(Math.round(request.headingDegrees)));
    }

    try {
      const response = await fetch(`/api/route?${params}`, {
        signal: request.signal ?? null,
      });

      const body = (await response.json()) as RouteWireResponse;

      if (!body.ok) {
        return {
          ok: false,
          failure: asRouteFailure(body.failure),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.detail !== undefined ? { detail: body.detail } : {}),
        };
      }

      // Geometry is decoded here rather than on the server: it travels as an
      // encoded polyline precisely so it does not have to be sent expanded.
      // A corrupt line throws, and is reported as such rather than becoming a
      // route that is silently missing its end.
      return { ok: true, routes: body.routes.map(hydrateRoute) };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // The caller changed their mind. Not a failure to show anyone.
        return { ok: false, failure: "cancelled" };
      }
      return {
        ok: false,
        failure: "network",
        detail: error instanceof Error ? error.message : "Request failed",
      };
    }
  }
}
