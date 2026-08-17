import type { MapUnavailableReason } from "./provider";

/**
 * Recovery guidance for a map failure.
 *
 * Written for whoever is actually looking at the screen — which during setup is
 * the operator, not an end user. Never a stack trace, always a next action.
 *
 * **The governing rule: never assert a specific account misconfiguration that
 * the underlying Mapbox response does not prove.** Mapbox answers a refused
 * request with a bare 401 or 403; a revoked token, a deleted token, a token
 * from another account, a URL restriction, and a missing capability are
 * indistinguishable from the status alone. Where the cause is not knowable,
 * these strings list the candidates and point at the evidence instead of
 * picking the most plausible-sounding remedy — because picking one sent an
 * operator to add a capability their token already had.
 *
 * Lives outside the component so it can be tested directly. This copy is the
 * part of the failure state that can be wrong in a way that costs someone an
 * afternoon.
 */
export function guidanceFor(reason: MapUnavailableReason): string | null {
  switch (reason) {
    case "missing-token":
      return "Set NEXT_PUBLIC_MAPBOX_TOKEN in your environment and redeploy. It is read at build time, not at runtime.";
    case "invalid-token":
      return "Mapbox refused this key outright (HTTP 401). It may be revoked, deleted, from a different account, or truncated. Compare the token fingerprint at /debug/mapbox with the token you expect.";
    case "forbidden":
      return "Mapbox recognised the key but refused the request (HTTP 403). Usual causes: a URL restriction that excludes this hostname, or a capability this endpoint needs. Mapbox does not say which — run /debug/mapbox to see its actual response.";
    // Reached only when Mapbox's own response named the capability.
    case "tile-access-denied":
      return "Mapbox named a missing tile capability for this token. Add styles:tiles to it in the Mapbox dashboard.";
    case "style-access-denied":
      return "Mapbox named a missing style capability for this token. Add styles:read to it in the Mapbox dashboard.";
    case "request-rejected":
      return "Mapbox refused the request. Reload to try again.";
    case "webgl-unsupported":
      return "Atlas Ascend needs WebGL to render the map.";
    case "network":
      return "Reconnect to load map tiles.";
    case "timeout":
      return "The map service did not respond. Reload to try again.";
    case "unknown":
      return "Reload to try again.";
  }
}
