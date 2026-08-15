"use client";

import { distanceMeters } from "@/map/types";
import type {
  PlaceSearchOptions,
  PlaceSearchProvider,
  PlaceSuggestion,
  SearchOutcome,
} from "./types";

/**
 * Client-side search provider.
 *
 * Talks to `/api/search`, which owns the geocoding vendor relationship. This
 * class deliberately knows nothing about Mapbox — swapping the geocoder is a
 * change to one route handler.
 */
export class AtlasPlaceSearch implements PlaceSearchProvider {
  readonly id = "atlas-search-api";

  async search(
    query: string,
    options: PlaceSearchOptions = {},
  ): Promise<SearchOutcome> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return { ok: true, suggestions: [] };

    const params = new URLSearchParams({ q: trimmed });
    if (options.near) {
      // Mapbox proximity is lon,lat — the opposite of how coordinates are
      // spoken, and a reliable source of silently wrong results.
      params.set("near", `${options.near.longitude},${options.near.latitude}`);
    }
    if (options.limit) params.set("limit", String(options.limit));

    try {
      const response = await fetch(`/api/search?${params}`, {
        signal: options.signal ?? null,
      });
      const body = (await response.json()) as SearchOutcome;

      if (!body.ok) return body;

      // Distance is computed client-side because that is where the user's
      // location lives; sending it to the server would leak position for no
      // benefit.
      const near = options.near;
      const suggestions: PlaceSuggestion[] = near
        ? body.suggestions.map((s) => ({
            ...s,
            distanceMeters: distanceMeters(near, s.coordinate),
          }))
        : [...body.suggestions];

      return { ok: true, suggestions };
    } catch (error) {
      // An aborted request is a normal part of type-ahead, not a failure.
      if (error instanceof DOMException && error.name === "AbortError") {
        return { ok: true, suggestions: [] };
      }
      return {
        ok: false,
        failure: "network",
        detail: error instanceof Error ? error.message : "Request failed",
      };
    }
  }
}
