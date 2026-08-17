"use client";

import { Panel, Row } from "@/features/debug/DebugReadout";
import { estimateArrival, formatArrivalClock } from "@/navigation/eta";
import type { NavigationProgress } from "@/navigation/engine";
import { type RerouteState, confirmWindowMs } from "@/navigation/reroute";
import type { RerouteStats } from "@/navigation/useRerouting";
import {
  REROUTE_CONFIRM_SAMPLES,
  REROUTE_MIN_DISTANCE_M,
} from "@/navigation/thresholds";
import type { WakeLockStatus } from "@/navigation/wakeLock";
import {
  type NavigationState,
  destinationOf,
  routesOf,
  selectedRouteOf,
} from "@/navigation/machine";

/**
 * Navigation diagnostics for `?atlasdebug=map`.
 *
 * Rendered in the layout flow above the preview sheet rather than as a
 * floating overlay, so it can never cover the surface it is describing — a
 * diagnostic that hides the thing being diagnosed has caused enough trouble on
 * this project already.
 *
 * Shows the machine's phase alongside what the map was actually told, because
 * the interesting failure is when those two disagree.
 */
export function NavigationDiagnostics({
  state,
  now,
  drawnRouteId,
  drawnLayerCount,
  progress = null,
  wakeLock = "idle",
  samples,
  reroute,
  stats,
  clock,
}: {
  state: NavigationState;
  now: number;
  /** What the map reports it is drawing, not what state believes. */
  drawnRouteId: string | null;
  drawnLayerCount: number;
  /** Live engine output while guiding. */
  progress?: NavigationProgress | null;
  wakeLock?: WakeLockStatus;
  samples?: { accepted: number; rejected: number };
  reroute?: RerouteState;
  stats?: RerouteStats;
  /**
   * Live wall clock, for the reroute countdowns.
   *
   * Separate from `now`, which is frozen at preview time on purpose so the
   * arrival clock does not tick while the driver is reading it. A countdown
   * that does not count down is worse than useless in a debug panel.
   */
  clock?: number;
}) {
  const destination = destinationOf(state);
  const routes = routesOf(state);
  const selected = selectedRouteOf(state);
  const arrival = selected ? estimateArrival(selected, now) : null;

  const live = clock ?? now;

  // Short ids: the full one is provider:timestamp:index and wraps three lines
  // on a phone for no diagnostic gain.
  const short = (id: string | null) => (id === null ? "—" : id.split(":").pop() ?? id);

  return (
    <div className="pointer-events-auto">
      <Panel title="Atlas navigation">
        <Row label="phase" value={state.phase} verdict="ok" />
        <Row label="destination" value={destination?.name ?? "—"} />
        <Row label="routes offered" value={routes.length} />
        <Row
          label="selected"
          value={short(selected?.id ?? null)}
          verdict={selected ? "ok" : "neutral"}
        />
        <Row
          label="drawn on map"
          value={short(drawnRouteId)}
          // The disagreement worth catching: state says one route, the map is
          // drawing another or none at all.
          verdict={
            (selected?.id ?? null) === drawnRouteId ? "ok" : "bad"
          }
        />
        <Row
          label="route layers"
          value={drawnLayerCount}
          verdict={drawnLayerCount > 0 || routes.length === 0 ? "ok" : "bad"}
        />
        {selected && (
          <>
            <Row label="distance" value={`${Math.round(selected.distanceMeters)} m`} />
            <Row label="duration (live)" value={`${Math.round(selected.durationSeconds)} s`} />
            <Row
              label="duration (typical)"
              value={
                selected.typicalDurationSeconds === null
                  ? "—"
                  : `${Math.round(selected.typicalDurationSeconds)} s`
              }
            />
            <Row label="vertices" value={selected.geometry.length} />
            <Row
              label="steps"
              value={selected.legs.reduce((n, leg) => n + leg.steps.length, 0)}
            />
          </>
        )}
        {arrival && (
          <Row label="ETA" value={formatArrivalClock(arrival.etaEpochMs)} />
        )}
        {state.phase === "routeFailed" && (
          <Row label="failure" value={state.failure} verdict="bad" />
        )}

        {/* Live driving state. The interesting failures are disagreements —
            a confident maneuver distance on a lost fix, or camera mode stuck
            in exploring after a recenter. */}
        {progress && (
          <>
            <Row label="—" value="driving" />
            <Row
              label="camera"
              value={state.phase === "navigating" ? state.camera : "—"}
              verdict={state.phase === "navigating" && state.camera === "following" ? "ok" : "warn"}
            />
            <Row
              label="GPS freshness"
              value={progress.freshness}
              verdict={progress.freshness === "fresh" ? "ok" : "warn"}
            />
            <Row
              label="accuracy"
              value={progress.accuracyMeters === null ? "—" : `${Math.round(progress.accuracyMeters)} m`}
            />
            <Row label="engine status" value={progress.status} />
            <Row label="step" value={progress.stepIndex} />
            <Row
              label="to maneuver"
              value={`${Math.round(progress.distanceToManeuverMeters)} m`}
            />
            <Row label="off route" value={progress.offRoute}
              verdict={progress.offRoute === "on-route" ? "ok" : "bad"} />
            <Row
              label="off-route conf."
              value={progress.offRouteConfidence.toFixed(2)}
            />
            <Row label="from route" value={`${Math.round(progress.distanceFromRouteMeters)} m`} />
            <Row label="progress" value={`${Math.round(progress.progressMeters)} m`} />
            <Row
              label="wake lock"
              value={wakeLock}
              verdict={wakeLock === "active" ? "ok" : wakeLock === "unsupported" ? "warn" : "neutral"}
            />
            {samples && (
              <Row
                label="samples"
                value={`${samples.accepted} accepted / ${samples.rejected} rejected`}
              />
            )}
          </>
        )}

        {/* Rerouting. Structured rather than a log line, because the question
            being answered in the field is always "why did it not reroute" —
            and that is answered by the gap between the evidence and the
            thresholds, which has to be readable side by side. */}
        {reroute && progress && (
          <>
            <Row label="—" value="rerouting" />
            <Row
              label="reroute state"
              value={reroute.kind}
              verdict={
                reroute.kind === "following" || reroute.kind === "settling"
                  ? "ok"
                  : reroute.kind === "failed"
                    ? "bad"
                    : "warn"
              }
            />
            <Row
              label="from route"
              value={`${Math.round(progress.distanceFromRouteMeters)} m`}
            />
            <Row
              label="trigger floor"
              value={`${Math.max(REROUTE_MIN_DISTANCE_M, Math.round(progress.corridorMeters))} m`}
            />
            <Row
              label="heading conflict"
              value={progress.headingDisagrees ? "yes" : "no"}
              verdict={progress.headingDisagrees ? "warn" : "ok"}
            />
            {reroute.kind === "suspected" && (
              <>
                <Row label="reason" value={reroute.reason} />
                <Row
                  label="held"
                  value={`${Math.round((live - reroute.since) / 100) / 10}s / ${
                    confirmWindowMs(reroute.reason) / 1000
                  }s`}
                />
                <Row
                  label="evidence"
                  value={`${reroute.samples} / ${REROUTE_CONFIRM_SAMPLES} samples`}
                />
                <Row
                  label="worst"
                  value={`${Math.round(reroute.worstDistanceMeters)} m`}
                />
              </>
            )}
            {reroute.kind === "requesting" && (
              <>
                <Row label="request" value={reroute.requestId} />
                <Row label="reason" value={reroute.reason} />
                <Row label="attempt" value={reroute.attempt} />
              </>
            )}
            {reroute.kind === "failed" && (
              <>
                <Row label="failure" value={reroute.failure} verdict="bad" />
                <Row label="attempt" value={reroute.attempt} />
                <Row
                  label="retry in"
                  value={`${Math.max(0, Math.round((reroute.retryAt - live) / 1000))}s`}
                />
              </>
            )}
            {reroute.kind === "settling" && (
              <Row
                label="settles in"
                value={`${Math.max(0, Math.round((reroute.until - live) / 1000))}s`}
              />
            )}
            {stats && (
              <>
                <Row
                  label="requests"
                  value={`${stats.requests} sent / ${stats.adopted} adopted`}
                />
                <Row label="last reason" value={stats.lastReason ?? "—"} />
                <Row
                  label="last failure"
                  value={stats.lastFailure ?? "—"}
                  verdict={stats.lastFailure === null ? "ok" : "bad"}
                />
                <Row
                  label="last round-trip"
                  value={
                    stats.lastDurationMs === null ? "—" : `${stats.lastDurationMs} ms`
                  }
                />
              </>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
