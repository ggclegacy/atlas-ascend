import { NextResponse } from "next/server";
import type { PlaceSuggestion } from "@/destinations/types";

/**
 * Place search — server route.
 *
 * The geocoding call is proxied through the server rather than made from the
 * browser for three reasons:
 *
 * 1. It lets the geocoding token be a *server-only* secret (`MAPBOX_TOKEN`),
 *    separate from the public map token. Geocoding is billed per request and
 *    is worth protecting more carefully than tile loads.
 * 2. It gives one place to add rate limiting and caching later.
 * 3. It means swapping geocoding vendors never touches client code.
 *
 * Falls back to the public token so the feature works with a single-token
 * setup, which is the common case when getting started.
 */

// Node runtime rather than edge: the Edge Runtime is deprecated in Next 16,
// and this handler does nothing that benefits from edge placement — it is a
// single upstream fetch whose latency is dominated by the geocoder itself.
export const runtime = "nodejs";

const MAPBOX_GEOCODE = "https://api.mapbox.com/search/geocode/v6/forward";

function token(): string | null {
  const serverToken = process.env.MAPBOX_TOKEN;
  if (serverToken && serverToken.trim()) return serverToken.trim();

  const publicToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (publicToken && publicToken.trim()) return publicToken.trim();

  return null;
}

interface GeocodeFeature {
  id?: string;
  properties?: {
    name?: string;
    full_address?: string;
    place_formatted?: string;
    coordinates?: { latitude?: number; longitude?: number };
  };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const near = url.searchParams.get("near");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 6) || 6, 10);

  if (query.length < 2) {
    return NextResponse.json({ ok: true, suggestions: [] });
  }

  const accessToken = token();
  if (accessToken === null) {
    // An honest, machine-readable "not configured" — not an empty result set
    // pretending the search simply found nothing.
    return NextResponse.json(
      { ok: false, failure: "not-configured" },
      { status: 503 },
    );
  }

  const params = new URLSearchParams({
    q: query,
    access_token: accessToken,
    limit: String(limit),
  });
  if (near) params.set("proximity", near);

  try {
    const response = await fetch(`${MAPBOX_GEOCODE}?${params}`, {
      // Identical queries are common while typing; a short cache meaningfully
      // reduces billed requests without making results feel stale.
      next: { revalidate: 60 },
    });

    if (response.status === 429) {
      return NextResponse.json({ ok: false, failure: "rate-limited" }, { status: 429 });
    }
    if (!response.ok) {
      return NextResponse.json(
        { ok: false, failure: "error", detail: `Geocoder returned ${response.status}` },
        { status: 502 },
      );
    }

    const body = (await response.json()) as { features?: GeocodeFeature[] };
    const suggestions: PlaceSuggestion[] = (body.features ?? [])
      .map(toSuggestion)
      .filter((s): s is PlaceSuggestion => s !== null);

    return NextResponse.json({ ok: true, suggestions });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        failure: "network",
        detail: error instanceof Error ? error.message : "Request failed",
      },
      { status: 502 },
    );
  }
}

function toSuggestion(feature: GeocodeFeature): PlaceSuggestion | null {
  const coordinates = feature.properties?.coordinates;
  const latitude = coordinates?.latitude;
  const longitude = coordinates?.longitude;

  if (typeof latitude !== "number" || typeof longitude !== "number") return null;

  const name = feature.properties?.name?.trim();
  if (!name) return null;

  const address =
    feature.properties?.full_address?.trim() ??
    feature.properties?.place_formatted?.trim() ??
    null;

  return {
    id: feature.id ?? `${latitude},${longitude}`,
    name,
    address,
    coordinate: { latitude, longitude },
    distanceMeters: null,
  };
}
