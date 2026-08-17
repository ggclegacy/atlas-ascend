"use client";

import type { Destination } from "@/destinations/types";
import type { AtlasRoute } from "@/routing/types";
import {
  compareToFastest,
  describeDelay,
  estimateArrival,
  formatArrivalClock,
  formatDuration,
  formatRouteDistance,
} from "@/navigation/eta";
import {
  type NavigationFailure,
  describeNavigationFailure,
} from "@/navigation/machine";
import { Eyebrow, LiveDot } from "@/components/atlas/primitives";
import { CloseIcon, NavigationIcon, WarningIcon } from "@/components/atlas/icons";

/**
 * THE ROUTE PREVIEW.
 *
 * The first surface in Atlas Ascend that asks the driver to commit to
 * something, and it is built around one question: *can I read this in the two
 * seconds before the light changes?*
 *
 * Hierarchy, largest to smallest: destination, drive time, arrival clock,
 * distance, route options, and then the gold action. Drive time is the number
 * people actually decide on, so it is the only one set at display scale.
 *
 * Everything Mapbox returns that is not one of those things — weights, step
 * counts, congestion arrays — is deliberately absent. A preview that shows
 * every available field is a debugging surface, not a product one.
 */

const SHEET_MIN_HEIGHT = 208;

export function RoutePreview({
  destination,
  routes,
  selectedId,
  now,
  onSelectRoute,
  onStartDrive,
  onCancel,
}: {
  destination: Destination;
  routes: readonly AtlasRoute[];
  selectedId: string;
  /** Injected so the arrival clock is deterministic in tests and snapshots. */
  now: number;
  onSelectRoute: (routeId: string) => void;
  onStartDrive: () => void;
  onCancel: () => void;
}) {
  const selected = routes.find((route) => route.id === selectedId) ?? routes[0];
  if (!selected) return null;

  const arrival = estimateArrival(selected, now);
  const delay = describeDelay(arrival);

  return (
    <section
      className="atlas-glass pointer-events-auto flex flex-col gap-4 rounded-[26px] px-5 pb-5 pt-4"
      style={{ minHeight: SHEET_MIN_HEIGHT }}
      aria-label="Route preview"
    >
      {/* ---------- Destination ---------- */}
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Eyebrow tone="gold" tick={false}>
            Route
          </Eyebrow>
          <h2 className="atlas-title mt-1 truncate text-ink">{destination.name}</h2>
          {destination.address && (
            <p className="atlas-label mt-0.5 truncate text-ink-3">
              {destination.address}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel route"
          className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-raised text-ink-2 transition-transform active:scale-[0.94]"
        >
          <CloseIcon size={14} />
        </button>
      </header>

      {/* ---------- Time / ETA / distance ----------
          One row, three weights. The drive time is the decision; the arrival
          clock is what gets compared against an appointment; the distance is
          context and is sized accordingly. */}
      <div className="flex items-baseline gap-4">
        <span className="atlas-display leading-none text-gold">
          {formatDuration(arrival.durationSeconds)}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="atlas-readout text-ink">
            {formatArrivalClock(arrival.etaEpochMs)}
          </span>
          <span className="atlas-label text-ink-3">
            {formatRouteDistance(selected.distanceMeters)}
          </span>
        </div>
      </div>

      {/* Traffic is only mentioned when it is actually costing the driver
          something. A permanent "traffic: normal" line is noise. */}
      {delay && (
        <p className="atlas-label -mt-2 text-caution">{delay}</p>
      )}

      {/* ---------- Alternates ----------
          Only when there is a genuine choice. Two chips, not a table. */}
      {routes.length > 1 && (
        <div
          className="flex gap-2 overflow-x-auto pb-0.5"
          role="radiogroup"
          aria-label="Route options"
        >
          {routes.map((route) => (
            <RouteOption
              key={route.id}
              route={route}
              routes={routes}
              selected={route.id === selected.id}
              onSelect={() => onSelectRoute(route.id)}
            />
          ))}
        </div>
      )}

      {/* ---------- Commit ---------- */}
      <button
        type="button"
        onClick={onStartDrive}
        className="atlas-gold-metal flex h-14 items-center justify-center gap-2.5 rounded-2xl text-ink-on-gold transition-transform active:scale-[0.985]"
      >
        <NavigationIcon size={18} />
        <span className="atlas-callout font-semibold tracking-wide">Start Drive</span>
      </button>
    </section>
  );
}

/**
 * One route option.
 *
 * Shows the trade, not the data: "Fastest" or "+4 min", with the drive time
 * beneath. A driver choosing between routes wants the difference, and can get
 * it from two words.
 */
function RouteOption({
  route,
  routes,
  selected,
  onSelect,
}: {
  route: AtlasRoute;
  routes: readonly AtlasRoute[];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={[
        "flex shrink-0 flex-col items-start gap-0.5 rounded-2xl border px-3.5 py-2 text-left transition-colors",
        selected
          ? "border-gold/55 bg-gold/12"
          : "border-white/8 bg-raised/70 active:bg-raised",
      ].join(" ")}
    >
      <span
        className={`atlas-eyebrow ${selected ? "text-gold" : "text-ink-3"}`}
      >
        {compareToFastest(route, routes)}
      </span>
      <span className={`atlas-callout ${selected ? "text-ink" : "text-ink-2"}`}>
        {formatDuration(route.durationSeconds)}
      </span>
      <span className="atlas-label text-ink-3">
        {formatRouteDistance(route.distanceMeters)}
      </span>
    </button>
  );
}

/**
 * Route calculation in flight.
 *
 * Same footprint as the preview it becomes, so the sheet does not jump when
 * the route lands — the transition should feel like information arriving, not
 * like the interface rebuilding itself.
 */
export function RouteLoading({
  destination,
  onCancel,
}: {
  destination: Destination;
  onCancel: () => void;
}) {
  return (
    <section
      className="atlas-glass pointer-events-auto flex flex-col gap-4 rounded-[26px] px-5 pb-5 pt-4"
      style={{ minHeight: SHEET_MIN_HEIGHT }}
      aria-label="Calculating route"
      aria-busy="true"
    >
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Eyebrow tone="gold" tick={false}>
            Plotting route
          </Eyebrow>
          <h2 className="atlas-title mt-1 truncate text-ink">{destination.name}</h2>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel route"
          className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-raised text-ink-2"
        >
          <CloseIcon size={14} />
        </button>
      </header>

      {/* A single sweeping hairline, matching the map's own loading language.
          A spinner would be louder and say less. */}
      <div className="relative h-px overflow-hidden rounded-full bg-white/6">
        <div
          className="atlas-gold-metal-h h-px w-1/3"
          style={{ animation: "atlas-sweep 1.6s cubic-bezier(0.32,0.72,0.16,1) infinite" }}
        />
      </div>

      <p className="atlas-label text-ink-3">Calculating the fastest way there…</p>
    </section>
  );
}

/**
 * Routing failed.
 *
 * Names what happened and what can be done. The provider's status code and
 * message are preserved in diagnostics, not shown here — a driver cannot act
 * on "HTTP 422 InvalidInput".
 */
export function RouteFailure({
  destination,
  failure,
  onRetry,
  onDismiss,
}: {
  destination: Destination | null;
  failure: NavigationFailure;
  onRetry: (() => void) | null;
  onDismiss: () => void;
}) {
  return (
    <section
      className="atlas-glass pointer-events-auto flex flex-col gap-3.5 rounded-[26px] px-5 pb-5 pt-4"
      aria-label="Route unavailable"
    >
      <header className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-caution/25 bg-caution/10 text-caution">
          <WarningIcon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <Eyebrow tone="caution" tick={false}>
            Route unavailable
          </Eyebrow>
          {destination && (
            <h2 className="atlas-callout mt-1 truncate text-ink">
              {destination.name}
            </h2>
          )}
        </div>
      </header>

      <p className="atlas-body text-ink-2">{describeNavigationFailure(failure)}</p>

      <div className="flex gap-2.5">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="atlas-callout h-12 flex-1 rounded-2xl border border-gold/40 bg-gold/10 text-gold transition-transform active:scale-[0.985]"
          >
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="atlas-callout h-12 flex-1 rounded-2xl border border-white/10 bg-raised text-ink-2 transition-transform active:scale-[0.985]"
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}

/**
 * The Start Drive boundary.
 *
 * Active guidance is not implemented yet, and this says so plainly rather than
 * showing a maneuver card with nothing behind it. The route, the destination
 * and the full step list are all held in the navigation session at this point —
 * Sub-phase 4 attaches here without the preview architecture changing.
 *
 * The honesty standard applies most exactly where the product is most nearly
 * finished: a fake turn card would be indistinguishable from a real one until
 * someone drove it.
 */
export function NavigationStarting({
  destination,
  route,
  now,
  onExit,
}: {
  destination: Destination;
  route: AtlasRoute;
  now: number;
  onExit: () => void;
}) {
  const arrival = estimateArrival(route, now);
  const steps = route.legs.reduce((count, leg) => count + leg.steps.length, 0);

  return (
    <section
      className="atlas-glass pointer-events-auto flex flex-col gap-3.5 rounded-[26px] px-5 pb-5 pt-4"
      aria-label="Navigation session ready"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2">
          <LiveDot tone="violet" />
          <Eyebrow tone="muted" tick={false}>
            Session ready
          </Eyebrow>
        </span>
        <span className="atlas-readout-sm text-ink-3">
          {formatDuration(arrival.durationSeconds)} ·{" "}
          {formatArrivalClock(arrival.etaEpochMs)}
        </span>
      </div>

      <h2 className="atlas-callout truncate text-ink">{destination.name}</h2>

      <p className="atlas-body text-ink-2">
        The route and its {steps} maneuvers are loaded and ready to follow.
        <span className="text-ink-3">
          {" "}
          Live turn-by-turn guidance arrives in the next phase — Atlas will not
          pretend to be guiding you until it genuinely is.
        </span>
      </p>

      <button
        type="button"
        onClick={onExit}
        className="atlas-callout h-12 rounded-2xl border border-white/10 bg-raised text-ink-2 transition-transform active:scale-[0.985]"
      >
        End session
      </button>
    </section>
  );
}
