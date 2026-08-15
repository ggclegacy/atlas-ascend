/**
 * Environment access.
 *
 * `NEXT_PUBLIC_*` values are inlined at build time, so they must be referenced
 * as complete literal property accesses — `process.env[name]` does not work.
 * That is why these are individual functions rather than a generic lookup.
 *
 * No secret belongs in a `NEXT_PUBLIC_` variable. The Mapbox token below is
 * public by design (it ships to the browser and is restricted by URL in the
 * Mapbox dashboard). Anything genuinely secret — model API keys, database
 * credentials — must stay server-only and never gain the prefix.
 */

/**
 * Mapbox public access token (`pk.…`).
 *
 * Returns `null` when unset, which the map surface renders as an explicit
 * blocked state rather than a broken canvas.
 */
export function getMapboxToken(): string | null {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token || token.trim().length === 0) return null;
  return token.trim();
}

/** True when the app was built with a Mapbox token available. */
export function hasMapboxToken(): boolean {
  return getMapboxToken() !== null;
}

/**
 * Whether Atlas intelligence has a configured backend.
 *
 * Server-only: read inside a route handler or server component, never shipped
 * to the browser. Absent means Atlas runs in its explicit simulated mode.
 */
export function hasAtlasModelKey(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}
