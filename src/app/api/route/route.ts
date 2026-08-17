import { NextResponse } from "next/server";
import { z } from "zod";
import { getPublicMapboxToken } from "@/lib/env";
import { requestDirections } from "@/routing/mapbox/MapboxDirections";
import type { RouteFailure } from "@/routing/types";

/**
 * Route calculation — server route.
 *
 * Mirrors `/api/search`: the vendor relationship lives on the server, the
 * browser asks Atlas for a route and receives Atlas types back. A Mapbox
 * Directions payload never crosses the wire to the client, which is what keeps
 * the boundary real rather than aspirational.
 *
 * The credential is `getPublicMapboxToken()` — the same single accessor
 * everything else uses. It is public by design and no secret is involved here.
 */

// Node runtime, matching `/api/search`. Nothing here benefits from the edge:
// the latency is dominated by the upstream router itself.
export const runtime = "nodejs";

/**
 * Input validation.
 *
 * Coordinates arrive as query strings from a client we control today and may
 * not control tomorrow. Rejecting a malformed request here is cheaper than
 * discovering it as a confusing Mapbox `InvalidInput`, and it keeps a bad
 * request from being billed.
 */
const querySchema = z.object({
  originLat: z.coerce.number().finite().min(-90).max(90),
  originLon: z.coerce.number().finite().min(-180).max(180),
  destLat: z.coerce.number().finite().min(-90).max(90),
  destLon: z.coerce.number().finite().min(-180).max(180),
  alternatives: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  heading: z.coerce.number().finite().min(0).max(360).optional(),
});

/** HTTP status for each failure. The body always carries the real reason. */
const STATUS_FOR: Readonly<Record<RouteFailure, number>> = {
  "not-configured": 503,
  unauthorized: 502,
  forbidden: 502,
  "no-route": 404,
  "unroutable-point": 404,
  "rate-limited": 429,
  network: 502,
  timeout: 504,
  "malformed-response": 502,
  cancelled: 499,
  error: 502,
};

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        failure: "error",
        detail: `Invalid route request: ${parsed.error.issues
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join("; ")}`,
      },
      { status: 400 },
    );
  }

  const accessToken = getPublicMapboxToken();
  if (accessToken === null) {
    // Honest and machine-readable, exactly as the geocoder does it — not an
    // empty route list implying no route exists.
    return NextResponse.json(
      { ok: false, failure: "not-configured" satisfies RouteFailure },
      { status: 503 },
    );
  }

  const { originLat, originLon, destLat, destLon, alternatives, heading } =
    parsed.data;

  const result = await requestDirections({
    origin: { latitude: originLat, longitude: originLon },
    destination: { latitude: destLat, longitude: destLon },
    alternatives,
    headingDegrees: heading ?? null,
    accessToken,
    signal: request.signal,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        failure: result.failure,
        status: result.status,
        // Whatever the provider actually said. Never a guess, and never a
        // claim about an account setting the response did not state.
        ...(result.detail ? { detail: result.detail } : {}),
      },
      { status: STATUS_FOR[result.failure] },
    );
  }

  return NextResponse.json({ ok: true, routes: result.routes });
}
