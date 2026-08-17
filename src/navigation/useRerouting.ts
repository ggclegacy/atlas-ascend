"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Destination } from "@/destinations/types";
import type { AtlasRoute, RouteFailure, RoutingProvider } from "@/routing/types";
import type { NavigationProgress } from "./engine";
import type { NavigationSample } from "./sample";
import {
  DEFAULT_REROUTE_CONFIG,
  FOLLOWING,
  type RerouteConfig,
  type RerouteEvent,
  type RerouteReason,
  type RerouteState,
  rerouteReducer,
} from "./reroute";
import { REROUTE_ORIGIN_MAX_AGE_MS } from "./thresholds";

/**
 * THE REROUTE CONTROLLER.
 *
 * Where the reroute decision meets the network. The pure state machine in
 * `reroute.ts` decides *whether*; this decides *how*, and owns the four things
 * that cannot be pure: the request, the abort, the timeout, and the clock.
 *
 * Its entire reason for existing separately is that every hard bug in
 * rerouting is a lifetime bug rather than an algorithm bug — a response that
 * arrives after the driver rejoined the route, after the destination changed,
 * or after the drive ended. Those are handled here, once, with explicit
 * identity, instead of by hoping each call site remembers to check.
 */

/** How often settling and retry windows are re-examined with no new fix. */
const REROUTE_TICK_MS = 1_000;

export interface RerouteStats {
  /** Requests actually sent this drive. */
  readonly requests: number;
  /** Replacement routes accepted this drive. */
  readonly adopted: number;
  readonly lastReason: RerouteReason | null;
  readonly lastFailure: RouteFailure | null;
  /** Round-trip of the last completed request, in milliseconds. */
  readonly lastDurationMs: number | null;
  readonly lastRequestId: number | null;
}

const NO_STATS: RerouteStats = {
  requests: 0,
  adopted: 0,
  lastReason: null,
  lastFailure: null,
  lastDurationMs: null,
  lastRequestId: null,
};

export interface RerouteValue {
  readonly state: RerouteState;
  readonly stats: RerouteStats;
  /** Forces a reroute now. Debug affordance only; no product surface. */
  readonly forceReroute: () => void;
}

export interface RerouteInput {
  /** False outside an active drive. The controller holds nothing when idle. */
  readonly enabled: boolean;
  /** Where the driver is going. Its identity is the trip guard. */
  readonly destination: Destination | null;
  /** Live engine output. `null` before the first accepted fix. */
  readonly progress: NavigationProgress | null;
  /**
   * The last fix the engine actually accepted.
   *
   * Deliberately not the snapped position — that is a point on the route the
   * driver has just demonstrated they are not on — and deliberately not the
   * raw browser fix, which has not passed the engine's accuracy, ordering and
   * plausibility checks.
   */
  readonly lastSample: NavigationSample | null;
  readonly routing: RoutingProvider;
  /**
   * Called with a replacement. The consumer performs the atomic swap; the
   * controller never writes navigation state itself.
   */
  readonly onAdopt: (routes: readonly AtlasRoute[], destination: Destination) => void;
  readonly config?: RerouteConfig;
}

interface InFlight {
  readonly controller: AbortController;
  readonly requestId: number;
  readonly startedAt: number;
  timedOut: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export function useRerouting({
  enabled,
  destination,
  progress,
  lastSample,
  routing,
  onAdopt,
  config = DEFAULT_REROUTE_CONFIG,
}: RerouteInput): RerouteValue {
  const [state, setState] = useState<RerouteState>(FOLLOWING);
  const [stats, setStats] = useState<RerouteStats>(NO_STATS);

  /**
   * The reducer's authoritative state.
   *
   * React state lags a render behind, and both a GPS fix and a settling
   * response can arrive inside that window. Every guard reads this; the React
   * copy exists only so the UI can render.
   */
  const machine = useRef<RerouteState>(FOLLOWING);
  const requestSeq = useRef(0);
  const inFlight = useRef<InFlight | null>(null);

  // Latest inputs for the async continuation, which must not close over the
  // render that started the request. Assigned in an effect declared before
  // every other effect in this hook, so the ordering is guaranteed.
  const latest = useRef({ destination, lastSample, onAdopt, routing, config });
  useEffect(() => {
    latest.current = { destination, lastSample, onAdopt, routing, config };
  });

  const dispatch = useCallback((event: RerouteEvent) => {
    const next = rerouteReducer(machine.current, event, latest.current.config);
    if (next === machine.current) return;
    machine.current = next;
    setState(next);
  }, []);

  /** Abandons whatever is in flight. Safe when nothing is. */
  const abort = useCallback(() => {
    const record = inFlight.current;
    if (record === null) return;
    if (record.timer !== null) clearTimeout(record.timer);
    record.controller.abort();
    inFlight.current = null;
  }, []);

  // --- trip lifetime -------------------------------------------------------
  //
  // One effect for both teardown cases, because they are the same case: this
  // controller belongs to exactly one (drive, destination) pair, and any change
  // to that pair invalidates everything in flight. Running as a cleanup means a
  // destination change aborts the old request before the new pair is armed.
  const destinationId = destination?.id ?? null;
  useEffect(() => {
    return () => {
      abort();
      machine.current = FOLLOWING;
      setState(FOLLOWING);
      setStats(NO_STATS);
    };
  }, [enabled, destinationId, abort]);

  // --- evidence ------------------------------------------------------------
  useEffect(() => {
    if (!enabled || progress === null) return;
    dispatch({ type: "SAMPLED", progress, now: Date.now() });
  }, [enabled, progress, dispatch]);

  // Settling and retry windows have to expire on their own; without this a
  // driver who stops moving inside a grace period stays inside it forever.
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(
      () => dispatch({ type: "TICK", now: Date.now() }),
      REROUTE_TICK_MS,
    );
    return () => clearInterval(timer);
  }, [enabled, dispatch]);

  // --- connectivity --------------------------------------------------------
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onOnline = () =>
      dispatch({ type: "CONNECTIVITY_RESTORED", at: Date.now() });
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [enabled, dispatch]);

  // --- the request ---------------------------------------------------------
  //
  // Fires only on `triggered` — the single state that permits a request, which
  // the machine reaches only after the engine's confirmed off-route verdict has
  // held for a second confirmation window. The defence against a request storm
  // is therefore structural: sending one leaves the only state that allows it.
  //
  // `lastSample` is a dependency because a trigger raised while the last fix is
  // too old to route from must be retried when a fresher one lands.
  const sampleAt = lastSample?.timestamp ?? null;
  useEffect(() => {
    if (!enabled) return;
    // `machine.current` rather than `state`: React state can still read
    // `triggered` for one render after the request has already gone out.
    if (machine.current.kind !== "triggered") return;
    const reason = machine.current.reason;

    const trip = latest.current.destination;
    const sample = latest.current.lastSample;
    const now = Date.now();
    if (trip === null) return;

    // Routing from a stale position produces a first instruction the driver has
    // already driven past. Waiting is better: the machine stays in `triggered`
    // and this effect re-runs on the next fix.
    if (sample === null || now - sample.timestamp > REROUTE_ORIGIN_MAX_AGE_MS) {
      return;
    }

    abort();
    const requestId = ++requestSeq.current;
    const record: InFlight = {
      controller: new AbortController(),
      requestId,
      startedAt: now,
      timedOut: false,
      timer: null,
    };
    inFlight.current = record;

    dispatch({ type: "REQUEST_STARTED", requestId, at: now });
    setStats((s) => ({
      ...s,
      requests: s.requests + 1,
      lastReason: reason,
      lastRequestId: requestId,
    }));

    // Offline is answered without spending a request. `navigator.onLine` is
    // only trustworthy in the negative direction — false genuinely means no
    // network — which is precisely the direction used here.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      inFlight.current = null;
      dispatch({ type: "REQUEST_FAILED", requestId, failure: "network", at: now });
      setStats((s) => ({ ...s, lastFailure: "network", lastDurationMs: 0 }));
      return;
    }

    // Owned by the record, not by this effect's cleanup: the effect re-runs the
    // moment the state becomes `requesting`, and a cleanup-owned timer would
    // cancel the timeout it had just armed.
    record.timer = setTimeout(() => {
      record.timedOut = true;
      record.controller.abort();
    }, latest.current.config.timeoutMs);

    void (async () => {
      const outcome = await latest.current.routing.route({
        origin: sample.coordinate,
        destination: trip,
        // No alternates while driving. A second route the driver cannot safely
        // choose between costs response time at the moment it matters most, and
        // Sub-phase 3's comparison UI has no business on a moving windscreen.
        alternatives: false,
        headingDegrees: sample.headingDegrees,
        signal: record.controller.signal,
      });

      if (record.timer !== null) clearTimeout(record.timer);
      const settledAt = Date.now();
      const durationMs = settledAt - record.startedAt;
      if (inFlight.current === record) inFlight.current = null;

      if (outcome.ok && outcome.routes.length > 0) {
        // The trip guard, re-read at settle time rather than captured: the
        // destination may have changed while this was in the air.
        const current = latest.current.destination;
        if (current === null || current.id !== trip.id) {
          dispatch({ type: "REQUEST_FAILED", requestId, failure: "cancelled", at: settledAt });
          return;
        }

        // Order matters. The machine's stale guard runs first and decides
        // whether this response is still wanted; only then is the route
        // adopted. Adopting first would let a response the driver has since
        // rejoined past replace a route they are correctly following.
        const before = machine.current;
        dispatch({ type: "REQUEST_SUCCEEDED", requestId, at: settledAt });
        if (machine.current === before) return;

        latest.current.onAdopt(outcome.routes, trip);
        setStats((s) => ({
          ...s,
          adopted: s.adopted + 1,
          lastFailure: null,
          lastDurationMs: durationMs,
        }));
        return;
      }

      // An empty success means no route exists, not a transport failure.
      const failure: RouteFailure = outcome.ok
        ? "no-route"
        : record.timedOut && outcome.failure === "cancelled"
          ? // The abort was Atlas's own timeout, not the driver changing their
            // mind. Reporting it as `cancelled` would swallow it silently.
            "timeout"
          : outcome.failure;

      dispatch({ type: "REQUEST_FAILED", requestId, failure, at: settledAt });
      setStats((s) => ({ ...s, lastFailure: failure, lastDurationMs: durationMs }));
    })();
  }, [enabled, state, sampleAt, dispatch, abort]);

  const forceReroute = useCallback(() => {
    if (!enabled) return;
    machine.current = {
      kind: "triggered",
      reason: "departed",
      at: Date.now(),
      attempt: 0,
    };
    setState(machine.current);
  }, [enabled]);

  return { state, stats, forceReroute };
}
