"use client";

import { Panel, Row } from "@/features/debug/DebugReadout";
import { estimateArrival, formatArrivalClock } from "@/navigation/eta";
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
}: {
  state: NavigationState;
  now: number;
  /** What the map reports it is drawing, not what state believes. */
  drawnRouteId: string | null;
  drawnLayerCount: number;
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
      </Panel>
    </div>
  );
}
