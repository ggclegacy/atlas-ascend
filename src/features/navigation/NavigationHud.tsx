"use client";

import type { AtlasRoute } from "@/routing/types";
import type { NavigationProgress } from "@/navigation/engine";
import type { NavigationCameraMode } from "@/navigation/camera";
import { presentFollowing, presentManeuver } from "@/navigation/maneuver";
import { formatArrivalClock, formatDuration, formatRouteDistance } from "@/navigation/eta";
import { ManeuverIcon } from "@/components/atlas/ManeuverIcon";
import { CloseIcon, LocateIcon, MapIcon } from "@/components/atlas/icons";
import { LiveDot } from "@/components/atlas/primitives";

/**
 * THE DRIVING INTERFACE.
 *
 * Everything here answers to one question: can this be read in the fraction of
 * a second a driver can spare? So the screen carries four things and nothing
 * else — what to do, how far until you do it, how the drive is going, and how
 * to stop.
 *
 * Distance-to-turn is the largest type in the entire product. It is the only
 * number that changes what the driver does in the next few seconds.
 *
 * Everything the exploration interface offers — search, saved places, the
 * prompt bar, layers — is gone. Not dimmed: gone. A control that cannot be
 * used safely while driving should not be occupying attention while driving.
 */

/** Kept in sync with the camera's padding so the driver is never under the card. */
export const HUD_HEIGHT = 168;
export const HUD_CONTROLS_HEIGHT = 148;

export function NavigationHud({
  route,
  progress,
  camera,
  degraded,
  onRecenter,
  onOverview,
  onEnd,
}: {
  route: AtlasRoute;
  progress: NavigationProgress;
  camera: NavigationCameraMode;
  /** GPS is stale or lost. Shown calmly; guidance is not torn down. */
  degraded: boolean;
  onRecenter: () => void;
  onOverview: () => void;
  onEnd: () => void;
}) {
  const steps = route.legs.flatMap((leg) => leg.steps);
  const step = steps[progress.stepIndex];
  const next = progress.maneuverStepIndex !== null
    ? steps[progress.maneuverStepIndex] ?? null
    : null;
  const after = progress.maneuverStepIndex !== null
    ? steps[progress.maneuverStepIndex + 1] ?? null
    : null;

  if (!step) return null;

  const maneuver = presentManeuver(step, next, progress.distanceToManeuverMeters);
  const following = presentFollowing(after, maneuver.primary);

  return (
    <>
      {/* ------------------------------------------------------ maneuver */}
      <div
        className="pointer-events-auto"
        style={{ minHeight: HUD_HEIGHT }}
        aria-live="polite"
        aria-atomic="true"
      >
        <section
          className="atlas-glass-panel flex flex-col gap-3 rounded-[26px] px-5 py-4"
          aria-label="Next maneuver"
        >
          <div className="flex items-center gap-4">
            {/* Gold once the turn is imminent — the accent marks the moment
                the driver has to act, not the whole drive. */}
            <span className={maneuver.imminent ? "text-gold" : "text-ink"}>
              <ManeuverIcon icon={maneuver.icon} size={52} />
            </span>

            <div className="min-w-0 flex-1">
              <div
                className={`atlas-display leading-none ${
                  maneuver.imminent ? "text-gold" : "text-ink"
                }`}
              >
                {maneuver.distance}
              </div>
              <div className="atlas-title mt-1 truncate text-ink">
                {maneuver.primary}
              </div>
              {(maneuver.exit ?? maneuver.roundaboutExit ?? maneuver.secondary) && (
                <div className="atlas-label mt-0.5 truncate text-ink-3">
                  {[maneuver.exit, maneuver.roundaboutExit, maneuver.secondary]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
            </div>
          </div>

          {following && (
            <div className="flex items-center gap-2.5 border-t border-white/8 pt-2.5 text-ink-3">
              <span className="atlas-eyebrow shrink-0">Then</span>
              <ManeuverIcon icon={following.icon} size={20} />
              <span className="atlas-label truncate">{following.text}</span>
            </div>
          )}
        </section>

        {/* Calm, never alarming. GPS coming and going is normal; the guidance
            behind it is still the last thing Atlas actually knew. */}
        {degraded && (
          <div className="atlas-glass-panel mt-2 flex items-center gap-2.5 rounded-2xl px-4 py-2.5">
            <LiveDot tone="caution" live={false} />
            <span className="atlas-label text-caution">
              {progress.freshness === "lost"
                ? "GPS signal lost — holding last known position"
                : "GPS signal limited"}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* ------------------------------------------------------- controls */}
      <div
        className="pointer-events-auto flex flex-col gap-3"
        style={{ minHeight: HUD_CONTROLS_HEIGHT }}
      >
        {/* Recenter only exists when it would do something. A permanent
            button that is usually a no-op trains people to ignore it. */}
        {camera !== "following" && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={onRecenter}
              className="atlas-glass-panel flex h-13 items-center gap-2.5 rounded-full px-5 text-gold transition-transform active:scale-[0.97]"
              style={{ minHeight: 52 }}
            >
              <LocateIcon size={18} />
              <span className="atlas-callout">Recenter</span>
            </button>
          </div>
        )}

        <section
          className="atlas-glass-panel flex items-center gap-3 rounded-[26px] px-4 py-3"
          aria-label="Trip status"
        >
          <Metric
            value={formatArrivalClock(progress.etaEpochMs)}
            label="Arrive"
            emphasis
          />
          <Divider />
          <Metric value={formatDuration(progress.remainingSeconds)} label="Left" />
          <Divider />
          <Metric
            value={formatRouteDistance(progress.remainingMeters)}
            label="Distance"
          />

          <div className="flex-1" />

          {/* Two controls, both thumb-sized. Anything more is a menu, and a
              menu is not something to open while driving. */}
          <button
            type="button"
            onClick={onOverview}
            aria-label="Route overview"
            className={`grid size-13 shrink-0 place-items-center rounded-2xl border transition-transform active:scale-[0.94] ${
              camera === "overview"
                ? "border-gold/50 bg-gold/12 text-gold"
                : "border-white/10 bg-raised text-ink-2"
            }`}
            style={{ width: 52, height: 52 }}
          >
            <MapIcon size={20} />
          </button>
          <button
            type="button"
            onClick={onEnd}
            aria-label="End navigation"
            className="grid shrink-0 place-items-center rounded-2xl border border-white/10 bg-raised text-ink-2 transition-transform active:scale-[0.94]"
            style={{ width: 52, height: 52 }}
          >
            <CloseIcon size={18} />
          </button>
        </section>
      </div>
    </>
  );
}

function Metric({
  value,
  label,
  emphasis = false,
}: {
  value: string;
  label: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span
        className={`atlas-readout leading-none ${emphasis ? "text-gold" : "text-ink"}`}
      >
        {value}
      </span>
      <span className="atlas-eyebrow mt-1 text-ink-3">{label}</span>
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" className="h-7 w-px shrink-0 bg-white/10" />;
}

/**
 * Shown between Start Drive and the first accepted fix.
 *
 * Brief, but it must exist: guidance cannot honestly begin before Atlas knows
 * where the driver is, and a maneuver card rendered against no position would
 * be showing a turn measured from a guess.
 */
export function NavigationAcquiring({ onEnd }: { onEnd: () => void }) {
  return (
    <section
      className="atlas-glass-panel pointer-events-auto flex items-center gap-4 rounded-[26px] px-5 py-4"
      aria-label="Acquiring position"
    >
      <LiveDot tone="violet" />
      <div className="min-w-0 flex-1">
        <div className="atlas-callout text-ink">Locating you on the route</div>
        <div className="atlas-label text-ink-3">
          Guidance begins as soon as Atlas has a position.
        </div>
      </div>
      <button
        type="button"
        onClick={onEnd}
        aria-label="End navigation"
        className="grid shrink-0 place-items-center rounded-2xl border border-white/10 bg-raised text-ink-2"
        style={{ width: 48, height: 48 }}
      >
        <CloseIcon size={16} />
      </button>
    </section>
  );
}
