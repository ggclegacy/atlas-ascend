import type { RouteFailure } from "@/routing/types";
import type { NavigationProgress } from "./engine";
import * as T from "./thresholds";

/**
 * REROUTING — the decision, not the request.
 *
 * Pure and deterministic, like the engine below it and for the same reason:
 * the alternative way to test "does Atlas reroute when I miss a turn" is to
 * miss a turn in a car, and then to do it again for every threshold change.
 *
 * The split that matters: **this module decides, the controller acts.** Nothing
 * here fetches, aborts, sets a timer, or reads a clock — `now` always arrives
 * as an argument. That is what makes a reroute loop, a stale response, and a
 * frontage road all reproducible in milliseconds.
 *
 * It sits on top of the engine's own off-route detection rather than replacing
 * it. The engine answers a measurement question — *is this position off the
 * line* — with accuracy scaling, stationary suppression and heading evidence
 * already folded in. This module answers a judgement question: *has that held
 * long enough to be worth a network request and throwing away the guidance
 * currently on screen.* Conflating the two is how navigation apps end up
 * rerouting people who were driving correctly.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Every number this module branches on.
 *
 * Injected rather than imported directly so a test can pin one value without
 * restating the other nine, and so Sub-phase 8 can drive alternative sets
 * without editing the source. `DEFAULT_REROUTE_CONFIG` is the shipped one.
 */
export interface RerouteConfig {
  readonly minDistanceMeters: number;
  readonly confirmMs: number;
  readonly ambiguousConfirmMs: number;
  readonly confirmSamples: number;
  readonly departedCorridorMultiple: number;
  readonly settleMs: number;
  readonly timeoutMs: number;
  readonly retryBackoffMs: readonly number[];
  readonly fatalCooldownMs: number;
  readonly recoverFraction: number;
}

export const DEFAULT_REROUTE_CONFIG: RerouteConfig = {
  minDistanceMeters: T.REROUTE_MIN_DISTANCE_M,
  confirmMs: T.REROUTE_CONFIRM_MS,
  ambiguousConfirmMs: T.REROUTE_AMBIGUOUS_CONFIRM_MS,
  confirmSamples: T.REROUTE_CONFIRM_SAMPLES,
  departedCorridorMultiple: T.REROUTE_DEPARTED_CORRIDOR_MULTIPLE,
  settleMs: T.REROUTE_SETTLE_MS,
  timeoutMs: T.REROUTE_TIMEOUT_MS,
  retryBackoffMs: T.REROUTE_RETRY_BACKOFF_MS,
  fatalCooldownMs: T.REROUTE_FATAL_COOLDOWN_MS,
  recoverFraction: T.REROUTE_RECOVER_FRACTION,
};

// ---------------------------------------------------------------------------
// Why
// ---------------------------------------------------------------------------

/**
 * How the driver appears to have left the route.
 *
 * Not cosmetic — it selects the confirmation window. Atlas cannot tell a
 * frontage road from a wrong turn without map matching, which is out of scope,
 * so it does not guess: the ambiguous case simply takes longer to confirm.
 */
export type RerouteReason =
  /** Unambiguous: well outside the corridor, or heading somewhere else. */
  | "departed"
  /**
   * Ambiguous: outside the corridor but close, heading still agreeing. A
   * frontage road, the opposite carriageway, or a parallel street all look
   * exactly like this, and so does a genuine slow departure.
   */
  | "drifted";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type RerouteState =
  /** Nothing to do. The overwhelming majority of a drive. */
  | { readonly kind: "following" }
  /**
   * Off-route evidence is accumulating but has not met the bar. Deliberately
   * invisible to the driver: a status that flickers on every wide junction is
   * worse than no status.
   */
  | {
      readonly kind: "suspected";
      /** Timestamp of the first qualifying fix in this episode. */
      readonly since: number;
      readonly samples: number;
      readonly reason: RerouteReason;
      readonly worstDistanceMeters: number;
    }
  /**
   * Confirmed. A request should be made — but this module does not make it.
   * The controller observes this state, allocates an id, and acts.
   */
  | {
      readonly kind: "triggered";
      readonly reason: RerouteReason;
      readonly at: number;
      /** Attempts already spent in this episode. 0 for the first. */
      readonly attempt: number;
    }
  | {
      readonly kind: "requesting";
      readonly requestId: number;
      readonly startedAt: number;
      readonly reason: RerouteReason;
      readonly attempt: number;
    }
  /** The request did not produce a route. Navigation continues regardless. */
  | {
      readonly kind: "failed";
      readonly failure: RouteFailure;
      readonly at: number;
      readonly attempt: number;
      readonly reason: RerouteReason;
      /** When another attempt becomes permissible. Never null: Atlas always
       *  eventually re-examines, it just may be two minutes later. */
      readonly retryAt: number;
    }
  /**
   * A new route was just adopted. Suppresses immediate re-triggering.
   *
   * The loop this exists to prevent is concrete: the replacement was computed
   * from where the car was when the request went out, and by the time it lands
   * the car has moved on. Measuring against it instantly can read as "still off
   * route" and fetch another, forever.
   */
  | { readonly kind: "settling"; readonly until: number };

export const FOLLOWING: RerouteState = { kind: "following" };

export type RerouteEvent =
  /** A fix reached the engine and produced progress. The main driver. */
  | { readonly type: "SAMPLED"; readonly progress: NavigationProgress; readonly now: number }
  /** Time passed with no fix — expires settling and retry windows. */
  | { readonly type: "TICK"; readonly now: number }
  | { readonly type: "REQUEST_STARTED"; readonly requestId: number; readonly at: number }
  | { readonly type: "REQUEST_SUCCEEDED"; readonly requestId: number; readonly at: number }
  | {
      readonly type: "REQUEST_FAILED";
      readonly requestId: number;
      readonly failure: RouteFailure;
      readonly at: number;
    }
  /**
   * The device came back online.
   *
   * Collapses the remaining backoff for failures connectivity explains, so a
   * driver who leaves a dead zone is rerouted on the next fix rather than
   * serving out a twenty-second timer that is no longer about anything.
   */
  | { readonly type: "CONNECTIVITY_RESTORED"; readonly at: number }
  /** Navigation ended, or the destination changed. Everything is discarded. */
  | { readonly type: "RESET" };

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export interface RerouteEvidence {
  /** This fix supports the claim that the driver has left the route. */
  readonly qualifies: boolean;
  /** This fix shows the driver is back on the line. */
  readonly recovered: boolean;
  readonly reason: RerouteReason;
  /**
   * The fix is too weak to argue either way — poor accuracy, stopped, stale.
   * Suspicion is held rather than accumulated or cleared.
   */
  readonly inconclusive: boolean;
}

/**
 * Reads one engine output as reroute evidence.
 *
 * Everything it consults is already on `NavigationProgress`; nothing is
 * recomputed from raw fixes, so the two layers cannot disagree about how far
 * off the line the driver is.
 */
export function readEvidence(
  progress: NavigationProgress,
  config: RerouteConfig = DEFAULT_REROUTE_CONFIG,
): RerouteEvidence {
  const reason: RerouteReason =
    progress.headingDisagrees ||
    progress.distanceFromRouteMeters >
      progress.corridorMeters * config.departedCorridorMultiple
      ? "departed"
      : "drifted";

  // A fix Atlas cannot reason from. Not evidence of anything, in either
  // direction — a parked car in an urban canyon is the classic case, and both
  // accumulating and clearing on it are wrong.
  const inconclusive =
    progress.freshness !== "fresh" ||
    progress.status === "stationary" ||
    progress.status === "degraded" ||
    progress.status === "lost";

  if (inconclusive) {
    return { qualifies: false, recovered: false, reason, inconclusive: true };
  }

  // The engine's own confirmed verdict is a precondition, never a conclusion.
  // It already required consecutive divergent samples over a minimum duration
  // with accuracy scaling; this adds the distance floor and, below, the second
  // confirmation window.
  const qualifies =
    progress.offRoute === "off-route" &&
    progress.distanceFromRouteMeters >= config.minDistanceMeters;

  // Tighter than the corridor on purpose: clearing at the exact edge lets a
  // driver hovering on the boundary flicker between states, and every flip
  // restarts the confirmation window — which would make a genuine slow
  // departure take forever to confirm.
  const recovered =
    progress.distanceFromRouteMeters <=
    progress.corridorMeters * config.recoverFraction;

  return { qualifies, recovered, reason, inconclusive: false };
}

/** How long this episode must hold before a request is worth making. */
export function confirmWindowMs(
  reason: RerouteReason,
  config: RerouteConfig = DEFAULT_REROUTE_CONFIG,
): number {
  return reason === "departed" ? config.confirmMs : config.ambiguousConfirmMs;
}

/** Failures where the same request, tried again shortly, could succeed. */
const RETRYABLE: ReadonlySet<RouteFailure> = new Set<RouteFailure>([
  "network",
  "timeout",
  "rate-limited",
  "error",
  "malformed-response",
]);

export function isRetryableFailure(failure: RouteFailure): boolean {
  return RETRYABLE.has(failure);
}

/**
 * When another attempt becomes permissible after a failure.
 *
 * Escalating backoff for transient failures, and a long hold once the budget is
 * spent or the failure is one retrying cannot fix — a destination with no road
 * near it will not acquire one in three seconds, and a driver in a dead zone
 * must not generate a request per GPS fix for the rest of the trip.
 */
export function retryDelayMs(
  failure: RouteFailure,
  attempt: number,
  config: RerouteConfig = DEFAULT_REROUTE_CONFIG,
): number {
  if (!isRetryableFailure(failure)) return config.fatalCooldownMs;
  // `attempt` counts attempts already made, so the first failure reads slot 0.
  return config.retryBackoffMs[attempt] ?? config.fatalCooldownMs;
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

/**
 * Total, pure, deterministic.
 *
 * Events that do not apply to the current state return it unchanged rather
 * than throwing: a response arriving after the driver rejoined the route is
 * ordinary, not exceptional.
 */
export function rerouteReducer(
  state: RerouteState,
  event: RerouteEvent,
  config: RerouteConfig = DEFAULT_REROUTE_CONFIG,
): RerouteState {
  switch (event.type) {
    case "RESET":
      return FOLLOWING;

    case "TICK":
      return expire(state, event.now);

    case "CONNECTIVITY_RESTORED":
      if (state.kind !== "failed") return state;
      // Only failures the network explains. A destination with no road near it
      // is just as unroutable on a good connection.
      if (state.failure !== "network" && state.failure !== "timeout") return state;
      return { ...state, retryAt: event.at };

    case "SAMPLED":
      return onSample(expire(state, event.now), event.progress, event.now, config);

    case "REQUEST_STARTED":
      // Only a confirmed trigger may become a request. Anything else means the
      // controller and this module disagree, and the state machine wins.
      if (state.kind !== "triggered") return state;
      return {
        kind: "requesting",
        requestId: event.requestId,
        startedAt: event.at,
        reason: state.reason,
        attempt: state.attempt,
      };

    case "REQUEST_SUCCEEDED":
      // THE STALE GUARD. A response for a request we are no longer waiting on
      // is discarded here, once, rather than by every caller remembering to
      // check. Covers a superseded request, a response that arrives after the
      // driver rejoined, and one that lands after navigation moved on.
      if (state.kind !== "requesting" || state.requestId !== event.requestId) {
        return state;
      }
      return { kind: "settling", until: event.at + config.settleMs };

    case "REQUEST_FAILED": {
      if (state.kind !== "requesting" || state.requestId !== event.requestId) {
        return state;
      }
      // The app abandoned this request itself — the driver rejoined, or a newer
      // request superseded it. Not a failure anyone needs to see.
      if (event.failure === "cancelled") return FOLLOWING;

      const attempt = state.attempt + 1;
      return {
        kind: "failed",
        failure: event.failure,
        at: event.at,
        attempt,
        reason: state.reason,
        retryAt: event.at + retryDelayMs(event.failure, state.attempt, config),
      };
    }
  }
}

/**
 * Expires the two time-boxed states.
 *
 * A `failed` whose retry window has elapsed does NOT immediately re-request —
 * it returns to `suspected`-equivalent scrutiny, so the next fix decides. A
 * driver who rejoined the route during the backoff gets no request at all,
 * which is the whole point of waiting.
 */
function expire(state: RerouteState, now: number): RerouteState {
  if (state.kind === "settling" && now >= state.until) return FOLLOWING;
  return state;
}

function onSample(
  state: RerouteState,
  progress: NavigationProgress,
  now: number,
  config: RerouteConfig,
): RerouteState {
  const evidence = readEvidence(progress, config);

  switch (state.kind) {
    case "settling":
      // Inside the grace period nothing accumulates. The replacement route was
      // computed from a position the car has already left; measuring against it
      // immediately is how the reroute loop starts.
      return state;

    case "following":
      if (!evidence.qualifies) return state;
      return {
        kind: "suspected",
        since: now,
        samples: 1,
        reason: evidence.reason,
        worstDistanceMeters: progress.distanceFromRouteMeters,
      };

    case "suspected": {
      if (evidence.recovered) return FOLLOWING;
      // Held, not advanced: a fix that proves nothing must not shorten the
      // confirmation window, and must not discard evidence already gathered.
      if (evidence.inconclusive || !evidence.qualifies) return state;

      // Reasons only escalate. Once there is unambiguous evidence in an
      // episode, a later ambiguous-looking fix does not restore the driver's
      // benefit of the doubt.
      const reason: RerouteReason =
        state.reason === "departed" ? "departed" : evidence.reason;

      const next = {
        kind: "suspected" as const,
        since: state.since,
        samples: state.samples + 1,
        reason,
        worstDistanceMeters: Math.max(
          state.worstDistanceMeters,
          progress.distanceFromRouteMeters,
        ),
      };

      const held = now - next.since;
      if (
        next.samples >= config.confirmSamples &&
        held >= confirmWindowMs(reason, config)
      ) {
        return { kind: "triggered", reason, at: now, attempt: 0 };
      }
      return next;
    }

    case "triggered":
      // Waiting for the controller to pick this up. A driver who rejoins in
      // that window saves the request entirely.
      return evidence.recovered ? FOLLOWING : state;

    case "requesting":
      // THE IN-FLIGHT REJOIN. The original route is still valid and the driver
      // is on it; adopting a replacement computed from a position they have
      // since left would be strictly worse. Leaving `requesting` makes the
      // pending response stale by the guard above, and the controller aborts.
      return evidence.recovered ? FOLLOWING : state;

    case "failed": {
      if (evidence.recovered) return FOLLOWING;
      if (now < state.retryAt) return state;
      if (!evidence.qualifies) return state;
      // The backoff has elapsed and the driver is still off route. Spend
      // another attempt — the attempt counter carries, so the backoff keeps
      // escalating rather than restarting.
      return {
        kind: "triggered",
        reason: state.reason,
        at: now,
        attempt: state.attempt,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** Whether a request should be in flight right now. */
export function isRerouting(state: RerouteState): boolean {
  return state.kind === "triggered" || state.kind === "requesting";
}

/**
 * What the driver should be told, or `null` for silence.
 *
 * Silence is the right answer for `suspected` and `settling`. A driver who has
 * genuinely left the route learns nothing from "we are thinking about it", and
 * a status that appears at every wide junction teaches them to ignore it.
 */
export function describeReroute(
  state: RerouteState,
): { readonly text: string; readonly tone: "working" | "caution" } | null {
  switch (state.kind) {
    case "triggered":
    case "requesting":
      return { text: "Rerouting…", tone: "working" };
    case "failed":
      return {
        text:
          state.failure === "network" || state.failure === "timeout"
            ? "Offline — keeping your current route"
            : state.failure === "no-route" || state.failure === "unroutable-point"
              ? "No new route from here"
              : "Couldn’t reroute — still trying",
        tone: "caution",
      };
    case "following":
    case "suspected":
    case "settling":
      return null;
  }
}
