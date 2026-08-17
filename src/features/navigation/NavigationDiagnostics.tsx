"use client";

import { Panel, Row } from "@/features/debug/DebugReadout";
import { estimateArrival, formatArrivalClock } from "@/navigation/eta";
import type { NavigationProgress } from "@/navigation/engine";
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
}) {
  const destination = destinationOf(state);
  const routes = routesOf(state);
  const selected = selectedRouteOf(state);
  const arrival = selected ? estimateArrival(selected, now) : null;

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
      </Panel>
    </div>
  );
}
