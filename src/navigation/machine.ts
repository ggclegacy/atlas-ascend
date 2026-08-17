import type { Destination } from "@/destinations/types";
import type { AtlasRoute, RouteFailure } from "@/routing/types";

/**
 * THE NAVIGATION STATE MACHINE.
 *
 * A discriminated union and a pure reducer, not a pile of booleans. The
 * difference is not stylistic: with booleans, "routing" and "routePreview" and
 * "routeFailed" can all be true at once, and every consumer has to remember
 * the precedence rules. Here the illegal combinations cannot be constructed.
 *
 * Two decisions are load-bearing:
 *
 * 1. **Every route request carries a `requestId`.** A driver who changes
 *    destination while a route is in flight gets two responses in an order
 *    nobody controls. The reducer ignores any response whose id is not the one
 *    it is waiting for, so a stale route can never overwrite a newer one. This
 *    is handled here, once, rather than by each caller remembering to check.
 *
 * 2. **Camera mode is deliberately NOT in this union.** Whether the map is
 *    following, exploring, or in overview is orthogonal to which navigation
 *    phase is active — folding it in would multiply the states without adding
 *    information, and the combinations would mostly be meaningless.
 */

/** Why routing could not produce a preview. Includes the pre-request cases. */
export type NavigationFailure =
  | RouteFailure
  /** Location permission was never granted, so there is no origin to route from. */
  | "no-location";

/**
 * Everything the active-navigation phase will need, assembled at the moment
 * the driver commits.
 *
 * Built here so Sub-phase 4 consumes a prepared object rather than reaching
 * back into preview state — the preview is allowed to be torn down the instant
 * navigation begins.
 */
export interface NavigationSession {
  readonly destination: Destination;
  readonly route: AtlasRoute;
  /** The alternatives that were on offer, kept for a later "change route". */
  readonly offered: readonly AtlasRoute[];
  readonly startedAt: number;
  readonly origin: { readonly latitude: number; readonly longitude: number };
}

export type NavigationState =
  | { readonly phase: "idle" }
  | { readonly phase: "searching" }
  | { readonly phase: "destinationSelected"; readonly destination: Destination }
  | {
      readonly phase: "routing";
      readonly destination: Destination;
      readonly requestId: number;
    }
  | {
      readonly phase: "routePreview";
      readonly destination: Destination;
      readonly routes: readonly AtlasRoute[];
      readonly selectedId: string;
    }
  | {
      readonly phase: "routeFailed";
      readonly destination: Destination | null;
      readonly failure: NavigationFailure;
    }
  /**
   * The driver has committed. Active guidance is NOT implemented yet, and the
   * UI must say so rather than imply otherwise — this state exists so the
   * boundary is real and Sub-phase 4 has somewhere to attach.
   */
  | { readonly phase: "navigationStarting"; readonly session: NavigationSession };

export type NavigationEvent =
  | { readonly type: "SEARCH_OPENED" }
  | { readonly type: "SEARCH_DISMISSED" }
  | { readonly type: "DESTINATION_SELECTED"; readonly destination: Destination }
  | { readonly type: "ROUTE_REQUESTED"; readonly requestId: number }
  | {
      readonly type: "ROUTE_SUCCEEDED";
      readonly requestId: number;
      readonly routes: readonly AtlasRoute[];
    }
  | {
      readonly type: "ROUTE_FAILED";
      readonly requestId: number;
      readonly failure: NavigationFailure;
    }
  | { readonly type: "ALTERNATE_SELECTED"; readonly routeId: string }
  | {
      readonly type: "START_DRIVE";
      readonly at: number;
      readonly origin: { readonly latitude: number; readonly longitude: number };
    }
  | { readonly type: "CANCEL" };

export const INITIAL_NAVIGATION_STATE: NavigationState = { phase: "idle" };

/**
 * The reducer. Total, pure, and deterministic.
 *
 * Any event that does not apply to the current phase returns the state
 * unchanged rather than throwing — a late tap on a button that has already
 * gone away is a normal occurrence on a touch screen, not an error.
 */
export function navigationReducer(
  state: NavigationState,
  event: NavigationEvent,
): NavigationState {
  switch (event.type) {
    case "SEARCH_OPENED":
      // Opening search over an existing preview keeps the preview underneath;
      // it is only replaced once a new destination is actually chosen.
      return state.phase === "idle" ? { phase: "searching" } : state;

    case "SEARCH_DISMISSED":
      return state.phase === "searching" ? { phase: "idle" } : state;

    case "DESTINATION_SELECTED":
      // Legal from anywhere before the drive begins: choosing a new
      // destination while a route is loading, or while previewing another, is
      // ordinary use.
      if (state.phase === "navigationStarting") return state;
      return { phase: "destinationSelected", destination: event.destination };

    case "ROUTE_REQUESTED": {
      const destination = destinationOf(state);
      if (destination === null) return state;
      return { phase: "routing", destination, requestId: event.requestId };
    }

    case "ROUTE_SUCCEEDED": {
      // Stale guard. A response for a request we are no longer waiting on is
      // discarded — otherwise a slow route to the previous destination lands
      // after a fast one to the current destination and silently wins.
      if (state.phase !== "routing" || state.requestId !== event.requestId) {
        return state;
      }
      const first = event.routes[0];
      if (first === undefined) {
        return {
          phase: "routeFailed",
          destination: state.destination,
          failure: "no-route",
        };
      }
      return {
        phase: "routePreview",
        destination: state.destination,
        routes: event.routes,
        selectedId: first.id,
      };
    }

    case "ROUTE_FAILED": {
      if (state.phase !== "routing" || state.requestId !== event.requestId) {
        return state;
      }
      // A request the app itself abandoned is not a failure to report; the
      // thing that superseded it owns the next state.
      if (event.failure === "cancelled") return state;
      return {
        phase: "routeFailed",
        destination: state.destination,
        failure: event.failure,
      };
    }

    case "ALTERNATE_SELECTED": {
      if (state.phase !== "routePreview") return state;
      if (!state.routes.some((route) => route.id === event.routeId)) return state;
      if (state.selectedId === event.routeId) return state;
      // Only the selection changes. The routes are already held and already
      // drawn, so this must never trigger a re-request or a layer rebuild.
      return { ...state, selectedId: event.routeId };
    }

    case "START_DRIVE": {
      if (state.phase !== "routePreview") return state;
      const route = state.routes.find((r) => r.id === state.selectedId);
      if (route === undefined) return state;
      return {
        phase: "navigationStarting",
        session: {
          destination: state.destination,
          route,
          offered: state.routes,
          startedAt: event.at,
          origin: event.origin,
        },
      };
    }

    case "CANCEL":
      return { phase: "idle" };
  }
}

// ---------------------------------------------------------------------------
// Selectors — so consumers never re-derive these inconsistently
// ---------------------------------------------------------------------------

export function destinationOf(state: NavigationState): Destination | null {
  switch (state.phase) {
    case "destinationSelected":
    case "routing":
    case "routePreview":
      return state.destination;
    case "routeFailed":
      return state.destination;
    case "navigationStarting":
      return state.session.destination;
    default:
      return null;
  }
}

/** The route the driver is looking at, or has committed to. */
export function selectedRouteOf(state: NavigationState): AtlasRoute | null {
  if (state.phase === "routePreview") {
    return state.routes.find((r) => r.id === state.selectedId) ?? null;
  }
  if (state.phase === "navigationStarting") return state.session.route;
  return null;
}

export function routesOf(state: NavigationState): readonly AtlasRoute[] {
  if (state.phase === "routePreview") return state.routes;
  if (state.phase === "navigationStarting") return state.session.offered;
  return [];
}

/** Whether the map should currently be drawing a route at all. */
export function showsRoute(state: NavigationState): boolean {
  return state.phase === "routePreview" || state.phase === "navigationStarting";
}

/** Whether a route request is in flight. Drives the loading state. */
export function isRouting(state: NavigationState): boolean {
  return state.phase === "routing";
}

/**
 * User-facing failure copy.
 *
 * Never a raw provider error. Each string names what happened and what the
 * driver can do about it; the underlying status and provider message stay in
 * diagnostics, where they belong.
 */
export function describeNavigationFailure(failure: NavigationFailure): string {
  switch (failure) {
    case "no-location":
      return "Atlas needs your location to plan a route from here.";
    case "no-route":
      return "No driving route exists to this destination.";
    case "unroutable-point":
      return "Atlas could not find a road near this destination.";
    case "not-configured":
      return "Routing is not configured for this deployment.";
    case "unauthorized":
    case "forbidden":
      return "The map service refused this request.";
    case "rate-limited":
      return "Too many route requests. Try again in a moment.";
    case "timeout":
      return "The routing service did not respond in time.";
    case "network":
      return "No connection to the routing service.";
    case "malformed-response":
      return "The routing service returned something Atlas could not read.";
    case "cancelled":
    case "error":
      return "Atlas could not calculate this route.";
  }
}
