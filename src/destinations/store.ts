"use client";

import type { Destination } from "./types";

/**
 * Saved and recent destinations.
 *
 * Same durability story as the vehicle store: this is REAL persistence in this
 * browser, and is neither synced nor authenticated. It satisfies an interface
 * so the server-backed implementation drops in without touching callers.
 */

export interface DestinationStore {
  readonly durability: "device-local" | "account-synced";
  saved(): Destination[];
  recents(): Destination[];
  /** Home/Work are singletons keyed by origin. */
  setAnchor(origin: "home" | "work", destination: Destination): void;
  anchor(origin: "home" | "work"): Destination | null;
  /** Records a destination as used, promoting it to the top of recents. */
  recordUse(destination: Destination): void;
  remove(id: string): void;
}

const SAVED_KEY = "atlas.destinations.saved.v1";
const RECENT_KEY = "atlas.destinations.recent.v1";
const MAX_RECENTS = 8;

export class LocalDestinationStore implements DestinationStore {
  readonly durability = "device-local" as const;

  saved(): Destination[] {
    return read(SAVED_KEY);
  }

  recents(): Destination[] {
    return read(RECENT_KEY);
  }

  anchor(origin: "home" | "work"): Destination | null {
    return this.saved().find((d) => d.origin === origin) ?? null;
  }

  setAnchor(origin: "home" | "work", destination: Destination): void {
    const others = this.saved().filter((d) => d.origin !== origin);
    const anchor: Destination = {
      ...destination,
      origin,
      icon: origin,
      name: origin === "home" ? "Home" : "Work",
    };
    write(SAVED_KEY, [...others, anchor]);
  }

  recordUse(destination: Destination): void {
    const stamped: Destination = { ...destination, lastUsedAt: Date.now() };

    // Anchors live in `saved` and must not also accumulate in recents, or the
    // rail shows Home twice.
    if (destination.origin === "home" || destination.origin === "work") return;

    const deduped = this.recents().filter(
      (d) => !sameCoordinate(d, stamped) && d.id !== stamped.id,
    );
    const recent: Destination = { ...stamped, origin: "recent", icon: "recent" };
    write(RECENT_KEY, [recent, ...deduped].slice(0, MAX_RECENTS));
  }

  remove(id: string): void {
    write(SAVED_KEY, this.saved().filter((d) => d.id !== id));
    write(RECENT_KEY, this.recents().filter((d) => d.id !== id));
  }
}

/** Within ~11 meters — the same place for navigation purposes. */
function sameCoordinate(a: Destination, b: Destination): boolean {
  return (
    Math.abs(a.coordinate.latitude - b.coordinate.latitude) < 1e-4 &&
    Math.abs(a.coordinate.longitude - b.coordinate.longitude) < 1e-4
  );
}

function read(key: string): Destination[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDestination);
  } catch {
    return [];
  }
}

function write(key: string, destinations: Destination[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(destinations));
  } catch {
    // Storage full or unavailable (Safari private mode). Destinations are a
    // convenience, not user-authored content, so failing quietly is
    // acceptable here in a way it is not for vehicles.
  }
}

function isDestination(value: unknown): value is Destination {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Partial<Destination>;
  return (
    typeof d.id === "string" &&
    typeof d.name === "string" &&
    typeof d.coordinate === "object" &&
    d.coordinate !== null &&
    typeof d.coordinate.latitude === "number" &&
    typeof d.coordinate.longitude === "number"
  );
}
