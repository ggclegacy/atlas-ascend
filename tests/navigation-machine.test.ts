import { describe, expect, it } from "vitest";
import {
  INITIAL_NAVIGATION_STATE,
  type NavigationEvent,
  type NavigationState,
  describeNavigationFailure,
  destinationOf,
  navigationReducer,
  routesOf,
  selectedRouteOf,
  showsRoute,
} from "@/navigation/machine";
import type { Destination } from "@/destinations/types";
import type { AtlasRoute, RouteFailure } from "@/routing/types";

/**
 * The navigation state machine.
 *
 * The reason this is a reducer rather than a set of booleans is that the
 * illegal combinations must be unrepresentable — "routing" and "routePreview"
 * and "routeFailed" cannot all be true at once here, so no consumer has to
 * remember a precedence rule.
 *
 * The tests that matter most are the stale-response ones. A driver changing
 * destination mid-request is ordinary, and the two responses come back in an
 * order nobody controls.
 */

const DEST: Destination = {
  id: "d1",
  origin: "search",
  name: "Trinity Street",
  address: "Trinity St, Austin",
  coordinate: { latitude: 30.2872, longitude: -97.7331 },
  icon: "pin",
};

const OTHER: Destination = { ...DEST, id: "d2", name: "Zilker Park" };

function route(id: string, durationSeconds = 600): AtlasRoute {
  return {
    id,
    distanceMeters: 5000,
    durationSeconds,
    typicalDurationSeconds: null,
    geometry: [
      { latitude: 30.26, longitude: -97.74 },
      { latitude: 30.28, longitude: -97.73 },
    ],
    cumulative: [0, 2000],
    legs: [],
    bounds: {
      southwest: { latitude: 30.26, longitude: -97.74 },
      northeast: { latitude: 30.28, longitude: -97.73 },
    },
    voiceLocale: "en-US",
    provider: "test",
    requestedAt: 0,
  };
}

/** Applies events in order from the initial state. */
function run(...events: NavigationEvent[]): NavigationState {
  return events.reduce(navigationReducer, INITIAL_NAVIGATION_STATE);
}

const toPreview = (routes: AtlasRoute[]): NavigationEvent[] => [
  { type: "DESTINATION_SELECTED", destination: DEST },
  { type: "ROUTE_REQUESTED", requestId: 1 },
  { type: "ROUTE_SUCCEEDED", requestId: 1, routes },
];

// ---------------------------------------------------------------------------

describe("the happy path", () => {
  it("walks idle → searching → destination → routing → preview", () => {
    expect(INITIAL_NAVIGATION_STATE.phase).toBe("idle");

    let state = navigationReducer(INITIAL_NAVIGATION_STATE, { type: "SEARCH_OPENED" });
    expect(state.phase).toBe("searching");

    state = navigationReducer(state, { type: "DESTINATION_SELECTED", destination: DEST });
    expect(state.phase).toBe("destinationSelected");

    state = navigationReducer(state, { type: "ROUTE_REQUESTED", requestId: 1 });
    expect(state.phase).toBe("routing");

    state = navigationReducer(state, {
      type: "ROUTE_SUCCEEDED",
      requestId: 1,
      routes: [route("a"), route("b")],
    });
    expect(state.phase).toBe("routePreview");
    if (state.phase !== "routePreview") return;
    // The first route is the provider's own preferred one.
    expect(state.selectedId).toBe("a");
    expect(state.routes).toHaveLength(2);
  });

  it("exposes the destination through every phase that has one", () => {
    expect(destinationOf(run({ type: "SEARCH_OPENED" }))).toBeNull();
    expect(destinationOf(run(...toPreview([route("a")])))?.id).toBe("d1");
  });
});

// ---------------------------------------------------------------------------
// Stale responses — the case that silently corrupts a route
// ---------------------------------------------------------------------------

describe("stale route responses", () => {
  it("ignores a response for a superseded request", () => {
    // THE DEFECT THIS PREVENTS: pick A, pick B before A returns, then A's
    // slower response lands and the driver is shown a route to A while the
    // sheet says B.
    const state = run(
      { type: "DESTINATION_SELECTED", destination: DEST },
      { type: "ROUTE_REQUESTED", requestId: 1 },
      { type: "DESTINATION_SELECTED", destination: OTHER },
      { type: "ROUTE_REQUESTED", requestId: 2 },
      // Request 1 finally answers — too late.
      { type: "ROUTE_SUCCEEDED", requestId: 1, routes: [route("stale")] },
    );

    expect(state.phase).toBe("routing");
    if (state.phase !== "routing") return;
    expect(state.requestId).toBe(2);
    expect(state.destination.id).toBe("d2");
  });

  it("ignores a stale failure just as firmly", () => {
    // A stale *failure* is worse than a stale success: it would replace a
    // perfectly good in-flight request with an error screen.
    const state = run(
      { type: "DESTINATION_SELECTED", destination: DEST },
      { type: "ROUTE_REQUESTED", requestId: 1 },
      { type: "ROUTE_REQUESTED", requestId: 2 },
      { type: "ROUTE_FAILED", requestId: 1, failure: "network" },
    );
    expect(state.phase).toBe("routing");
  });

  it("accepts the response it is actually waiting for", () => {
    const state = run(
      { type: "DESTINATION_SELECTED", destination: DEST },
      { type: "ROUTE_REQUESTED", requestId: 1 },
      { type: "ROUTE_REQUESTED", requestId: 2 },
      { type: "ROUTE_SUCCEEDED", requestId: 2, routes: [route("fresh")] },
    );
    expect(state.phase).toBe("routePreview");
  });

  it("does not show an error for a request the app itself abandoned", () => {
    // Cancellation is not a failure to report — whatever superseded the
    // request owns the next state.
    const state = run(
      { type: "DESTINATION_SELECTED", destination: DEST },
      { type: "ROUTE_REQUESTED", requestId: 1 },
      { type: "ROUTE_FAILED", requestId: 1, failure: "cancelled" },
    );
    expect(state.phase).toBe("routing");
  });
});

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

describe("route failures", () => {
  it("surfaces a real failure with its destination intact", () => {
    const state = run(
      { type: "DESTINATION_SELECTED", destination: DEST },
      { type: "ROUTE_REQUESTED", requestId: 1 },
      { type: "ROUTE_FAILED", requestId: 1, failure: "no-route" },
    );
    expect(state.phase).toBe("routeFailed");
    // Retry needs the destination, so it must survive the failure.
    expect(destinationOf(state)?.id).toBe("d1");
  });

  it("treats an empty success as no route, not as a preview of nothing", () => {
    // Mapbox can return code Ok with zero routes; an empty preview would show
    // a sheet with no time, no distance, and a Start Drive button.
    const state = run(
      { type: "DESTINATION_SELECTED", destination: DEST },
      { type: "ROUTE_REQUESTED", requestId: 1 },
      { type: "ROUTE_SUCCEEDED", requestId: 1, routes: [] },
    );
    expect(state.phase).toBe("routeFailed");
    if (state.phase !== "routeFailed") return;
    expect(state.failure).toBe("no-route");
  });

  it("reports missing location as its own failure", () => {
    const state = run(
      { type: "DESTINATION_SELECTED", destination: DEST },
      { type: "ROUTE_REQUESTED", requestId: 1 },
      { type: "ROUTE_FAILED", requestId: 1, failure: "no-location" },
    );
    expect(state.phase).toBe("routeFailed");
    expect(describeNavigationFailure("no-location")).toMatch(/location/i);
  });

  it("gives every failure actionable copy with no technical leakage", () => {
    const failures: RouteFailure[] = [
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
    ];
    for (const failure of [...failures, "no-location" as const]) {
      const text = describeNavigationFailure(failure);
      expect(text.length).toBeGreaterThan(10);
      // A driver cannot act on "HTTP 422" or a stack frame.
      expect(text).not.toMatch(/HTTP|\d{3}\b|undefined|null|Error:/);
    }
  });
});

// ---------------------------------------------------------------------------
// Alternates
// ---------------------------------------------------------------------------

describe("alternate selection", () => {
  const preview = run(...toPreview([route("a", 600), route("b", 900)]));

  it("changes only the selection", () => {
    const next = navigationReducer(preview, {
      type: "ALTERNATE_SELECTED",
      routeId: "b",
    });
    expect(next.phase).toBe("routePreview");
    if (next.phase !== "routePreview") return;
    expect(next.selectedId).toBe("b");
    // The route objects are untouched — the map must not rebuild layers.
    expect(next.routes).toBe(preview.phase === "routePreview" ? preview.routes : []);
  });

  it("ignores an unknown route id rather than clearing the preview", () => {
    const next = navigationReducer(preview, {
      type: "ALTERNATE_SELECTED",
      routeId: "nope",
    });
    expect(next).toBe(preview);
  });

  it("is a no-op when the route is already selected", () => {
    // Identity matters: a new object here would re-run the map effect and
    // refit the camera for no reason.
    const next = navigationReducer(preview, {
      type: "ALTERNATE_SELECTED",
      routeId: "a",
    });
    expect(next).toBe(preview);
  });

  it("reports the selected route, not merely the first", () => {
    const next = navigationReducer(preview, {
      type: "ALTERNATE_SELECTED",
      routeId: "b",
    });
    expect(selectedRouteOf(next)?.id).toBe("b");
    expect(routesOf(next)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Start Drive — the Sub-phase 4 boundary
// ---------------------------------------------------------------------------

describe("Start Drive", () => {
  const origin = { latitude: 30.2672, longitude: -97.7431 };

  it("captures everything the navigation phase will need", () => {
    const preview = run(...toPreview([route("a"), route("b")]));
    const state = navigationReducer(preview, {
      type: "START_DRIVE",
      at: 1_700_000_000_000,
      origin,
    });

    expect(state.phase).toBe("navigationStarting");
    if (state.phase !== "navigationStarting") return;

    const { session } = state;
    expect(session.destination.id).toBe("d1");
    expect(session.route.id).toBe("a");
    // The alternatives are kept so a later "change route" needs no request.
    expect(session.offered).toHaveLength(2);
    expect(session.startedAt).toBe(1_700_000_000_000);
    expect(session.origin).toEqual(origin);
  });

  it("commits the alternate the driver actually chose", () => {
    const state = run(
      ...toPreview([route("a"), route("b")]),
      { type: "ALTERNATE_SELECTED", routeId: "b" },
      { type: "START_DRIVE", at: 1, origin },
    );
    expect(state.phase).toBe("navigationStarting");
    if (state.phase !== "navigationStarting") return;
    expect(state.session.route.id).toBe("b");
  });

  it("cannot be triggered without a route", () => {
    for (const state of [
      run({ type: "SEARCH_OPENED" }),
      run({ type: "DESTINATION_SELECTED", destination: DEST }),
      run(
        { type: "DESTINATION_SELECTED", destination: DEST },
        { type: "ROUTE_REQUESTED", requestId: 1 },
      ),
    ]) {
      const next = navigationReducer(state, { type: "START_DRIVE", at: 1, origin });
      expect(next.phase).not.toBe("navigationStarting");
    }
  });

  it("keeps drawing the route once the drive has begun", () => {
    const state = run(...toPreview([route("a")]), {
      type: "START_DRIVE",
      at: 1,
      origin,
    });
    expect(showsRoute(state)).toBe(true);
    expect(selectedRouteOf(state)?.id).toBe("a");
  });

  it("ignores a new destination once committed", () => {
    // Changing destination mid-drive is a Sub-phase 4 concern with its own
    // rules; silently swapping the session here would be worse than refusing.
    const state = run(...toPreview([route("a")]), {
      type: "START_DRIVE",
      at: 1,
      origin,
    });
    const next = navigationReducer(state, {
      type: "DESTINATION_SELECTED",
      destination: OTHER,
    });
    expect(next).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

describe("cancel", () => {
  it("returns to idle from every phase, carrying nothing forward", () => {
    const origin = { latitude: 30, longitude: -97 };
    const states: NavigationState[] = [
      run({ type: "SEARCH_OPENED" }),
      run({ type: "DESTINATION_SELECTED", destination: DEST }),
      run(
        { type: "DESTINATION_SELECTED", destination: DEST },
        { type: "ROUTE_REQUESTED", requestId: 1 },
      ),
      run(...toPreview([route("a")])),
      run(
        { type: "DESTINATION_SELECTED", destination: DEST },
        { type: "ROUTE_REQUESTED", requestId: 1 },
        { type: "ROUTE_FAILED", requestId: 1, failure: "network" },
      ),
      run(...toPreview([route("a")]), { type: "START_DRIVE", at: 1, origin }),
    ];

    for (const state of states) {
      const next = navigationReducer(state, { type: "CANCEL" });
      expect(next.phase, `cancel from ${state.phase}`).toBe("idle");
      // No stale destination, no stale route, no stale ETA.
      expect(destinationOf(next)).toBeNull();
      expect(selectedRouteOf(next)).toBeNull();
      expect(routesOf(next)).toHaveLength(0);
      expect(showsRoute(next)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Totality
// ---------------------------------------------------------------------------

describe("the reducer is total", () => {
  it("never throws, whatever event arrives in whatever phase", () => {
    const origin = { latitude: 30, longitude: -97 };
    const events: NavigationEvent[] = [
      { type: "SEARCH_OPENED" },
      { type: "SEARCH_DISMISSED" },
      { type: "DESTINATION_SELECTED", destination: DEST },
      { type: "ROUTE_REQUESTED", requestId: 9 },
      { type: "ROUTE_SUCCEEDED", requestId: 9, routes: [route("x")] },
      { type: "ROUTE_FAILED", requestId: 9, failure: "network" },
      { type: "ALTERNATE_SELECTED", routeId: "x" },
      { type: "START_DRIVE", at: 1, origin },
      { type: "CANCEL" },
    ];

    // A late tap on a control that has already gone away is normal on a touch
    // screen, not an error.
    for (const first of events) {
      for (const second of events) {
        expect(() =>
          navigationReducer(navigationReducer(INITIAL_NAVIGATION_STATE, first), second),
        ).not.toThrow();
      }
    }
  });
});
