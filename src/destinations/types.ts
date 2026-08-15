import type { Coordinate } from "@/map/types";

/**
 * THE DESTINATION MODEL — one model, not five.
 *
 * Search results, recents, favorites, Home, Work, and destinations spoken to
 * Atlas all converge here. The brief was explicit about this and it is worth
 * restating why: the moment "a search result" and "a saved place" are different
 * types, every consumer needs a conversion, routing needs an adapter, and Atlas
 * needs to know which kind it is holding. Keeping one shape means a destination
 * from any origin can be routed to, saved, or spoken about identically.
 *
 * `origin` records where a destination came from. It affects presentation
 * (icon, whether it can be deleted) but never identity.
 */

export type DestinationOrigin =
  | "search"
  | "saved"
  | "recent"
  | "home"
  | "work"
  | "coordinate"
  | "atlas";

/** Semantic icon key. Mapped to an SVG at the presentation layer. */
export type DestinationIcon =
  | "home"
  | "work"
  | "fuel"
  | "charge"
  | "food"
  | "star"
  | "pin"
  | "recent";

export interface Destination {
  readonly id: string;
  readonly origin: DestinationOrigin;
  /** What the user calls it: "Home", "Whole Foods". */
  readonly name: string;
  /** Full postal address, when known. */
  readonly address: string | null;
  readonly coordinate: Coordinate;
  readonly icon: DestinationIcon;
  /** Epoch ms. Present on recents and previously-used saved places. */
  readonly lastUsedAt?: number;
}

/** A place returned by a search provider, before the user commits to it. */
export interface PlaceSuggestion {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
  readonly coordinate: Coordinate;
  /** Straight-line meters from the search origin, when one was supplied. */
  readonly distanceMeters: number | null;
}

export function suggestionToDestination(
  suggestion: PlaceSuggestion,
): Destination {
  return {
    id: suggestion.id,
    origin: "search",
    name: suggestion.name,
    address: suggestion.address,
    coordinate: suggestion.coordinate,
    icon: "pin",
  };
}

export function iconFor(origin: DestinationOrigin): DestinationIcon {
  switch (origin) {
    case "home":
      return "home";
    case "work":
      return "work";
    case "recent":
      return "recent";
    case "saved":
      return "star";
    default:
      return "pin";
  }
}

// ---------------------------------------------------------------------------
// Search provider boundary
// ---------------------------------------------------------------------------

export type SearchFailure =
  | "not-configured"
  | "network"
  | "rate-limited"
  | "error";

export type SearchOutcome =
  | { readonly ok: true; readonly suggestions: readonly PlaceSuggestion[] }
  | { readonly ok: false; readonly failure: SearchFailure; readonly detail?: string };

export interface PlaceSearchOptions {
  /** Bias results toward here. Omitted when location is unavailable. */
  readonly near?: Coordinate;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

/**
 * Address and place search.
 *
 * Kept as an interface so the geocoding vendor is replaceable independently of
 * the map vendor — they are commonly different services, and tying them
 * together is a mistake that is expensive to undo later.
 */
export interface PlaceSearchProvider {
  readonly id: string;
  search(query: string, options?: PlaceSearchOptions): Promise<SearchOutcome>;
}
