"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAvailable } from "@/lib/provenance";
import type { GeolocationControls } from "@/location/useGeolocation";
import type { AtlasRoute } from "@/routing/types";
import {
  type EngineState,
  type NavigationProgress,
  advance,
  initialState,
  stepBoundaries,
  tick,
} from "./engine";
import type { NavigationSample } from "./sample";
import { type WakeLockStatus, createWakeLock } from "./wakeLock";

/**
 * THE LIVE NAVIGATION SESSION.
 *
 * The only place where the browser meets the engine. Everything above it reads
 * `NavigationProgress`; everything below it is pure and testable.
 *
 * Its whole job is to convert real fixes into Atlas samples faithfully and
 * hand them to the engine unmodified. It does not smooth, correct, or fill in
 * anything — the engine already rejects, filters and holds, and a second layer
 * of cleverness here would fight it invisibly.
 */

/**
 * How often freshness is re-evaluated with no new fix.
 *
 * Without this a tunnel shows a confident position frozen from thirty seconds
 * ago. Nothing is extrapolated; the tick only lets the state admit its age.
 */
const FRESHNESS_TICK_MS = 1_000;

export interface NavigationSessionValue {
  readonly progress: NavigationProgress;
  /** True once the engine has accepted a first fix. */
  readonly located: boolean;
  readonly wakeLock: WakeLockStatus;
  /** Fixes accepted this session, for diagnostics. */
  readonly acceptedSamples: number;
  readonly rejectedSamples: number;
  /** Feeds a fix directly. Used by the debug trace replay. */
  readonly injectSample: (sample: NavigationSample) => void;
  /** True while a simulated trace is driving the session. */
  readonly simulated: boolean;
  readonly setSimulated: (on: boolean) => void;
}

/**
 * Runs the engine for the duration of a drive.
 *
 * `route` of `null` means no session; the hook holds nothing and does nothing,
 * so mounting it unconditionally is safe.
 */
export function useNavigationSession(
  route: AtlasRoute | null,
  location: GeolocationControls,
): NavigationSessionValue {
  const boundaries = useMemo(
    () => (route ? stepBoundaries(route) : []),
    [route],
  );

  const engine = useRef<EngineState | null>(null);
  const counts = useRef({ accepted: 0, rejected: 0 });
  const [simulated, setSimulated] = useState(false);
  const [wakeLock, setWakeLock] = useState<WakeLockStatus>("idle");
  const [progress, setProgress] = useState<NavigationProgress | null>(null);

  // Reset whenever the route changes — including a reroute later on.
  useEffect(() => {
    if (route === null) {
      engine.current = null;
      setProgress(null);
      return;
    }
    engine.current = initialState(route, Date.now());
    counts.current = { accepted: 0, rejected: 0 };
    setProgress(engine.current.progress);
  }, [route]);

  const push = useCallback(
    (sample: NavigationSample) => {
      if (route === null || engine.current === null) return;
      const before = engine.current;
      const next = advance(route, boundaries, before, sample, Date.now());
      engine.current = next;

      if (next.progress.lastRejection === null) counts.current.accepted++;
      else counts.current.rejected++;

      setProgress(next.progress);
    },
    [route, boundaries],
  );

  // --- real GPS -----------------------------------------------------------
  //
  // Converts a browser fix into an Atlas sample and hands it over untouched.
  // `heading` and `speed` stay null when the device did not report them —
  // deriving them here and presenting them as measured is exactly the kind of
  // quiet fabrication the engine's own filtering is built to avoid.
  useEffect(() => {
    if (route === null || simulated) return;
    if (!isAvailable(location.fix)) return;

    const fix = location.fix.value;
    push({
      coordinate: fix.coordinate,
      timestamp: fix.timestamp,
      accuracyMeters: fix.accuracy,
      headingDegrees: isAvailable(location.heading) ? location.heading.value : null,
      speedMps: isAvailable(location.speed) ? location.speed.value : null,
    });
  }, [route, simulated, location.fix, location.heading, location.speed, push]);

  // --- freshness ----------------------------------------------------------
  useEffect(() => {
    if (route === null) return;
    const timer = setInterval(() => {
      if (engine.current === null) return;
      const next = tick(engine.current, Date.now());
      if (next !== engine.current) {
        engine.current = next;
        setProgress(next.progress);
      }
    }, FRESHNESS_TICK_MS);
    return () => clearInterval(timer);
  }, [route]);

  // --- wake lock ----------------------------------------------------------
  //
  // Held only for the duration of a drive. An enhancement: if it is refused or
  // revoked, navigation continues exactly as before and the diagnostics say so.
  useEffect(() => {
    if (route === null) return;
    const lock = createWakeLock(setWakeLock);
    void lock.acquire();
    return () => {
      void lock.release();
    };
  }, [route]);

  return {
    progress: progress ?? FALLBACK,
    located: (progress?.lastAcceptedAt ?? null) !== null,
    wakeLock,
    acceptedSamples: counts.current.accepted,
    rejectedSamples: counts.current.rejected,
    injectSample: push,
    simulated,
    setSimulated,
  };
}

/** Used only before a route exists; never rendered as live guidance. */
const FALLBACK: NavigationProgress = {
  status: "lost",
  snapped: { latitude: 0, longitude: 0 },
  distanceFromRouteMeters: 0,
  progressMeters: 0,
  remainingMeters: 0,
  progressFraction: 0,
  segmentIndex: 0,
  stepIndex: 0,
  maneuverStepIndex: null,
  distanceToManeuverMeters: 0,
  remainingSeconds: 0,
  etaEpochMs: 0,
  etaSource: "route",
  offRoute: "on-route",
  offRouteConfidence: 0,
  freshness: "lost",
  lastAcceptedAt: null,
  lastRejection: null,
  accuracyMeters: null,
  corridorMeters: 30,
};
