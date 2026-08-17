"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AtlasRoute } from "@/routing/types";
import type { NavigationSample } from "@/navigation/sample";
import {
  cleanTrace,
  excursionTrace,
  gpsJumpTrace,
  missedTurnTrace,
  parallelRoadTrace,
  stationaryTrace,
  tunnelTrace,
  wrongTurnTrace,
} from "@/navigation/simulator";
import { Panel, Row } from "@/features/debug/DebugReadout";

/**
 * TRACE REPLAY — `?atlasdebug=map` only.
 *
 * Drives the real navigation UI from the Sub-phase 4 simulator. Crucially it
 * feeds the *same* engine the same sample shape real GPS produces: there is no
 * demo path, no second code route, and nothing here that production does not
 * also run. A demo that bypasses the engine would look convincing and prove
 * nothing.
 *
 * This is how the driving interface, the camera, and every maneuver state get
 * exercised without a car — including the ones that are hard to produce on
 * demand in the world, like a tunnel or a wrong turn.
 */

const SCENARIOS = {
  clean: { label: "Clean drive", build: (r: AtlasRoute) => cleanTrace(r, { stepMeters: 18 }) },
  noisy: {
    label: "Noisy city",
    build: (r: AtlasRoute) =>
      cleanTrace(r, { stepMeters: 18, noiseMeters: 30, accuracyMeters: 22 }),
  },
  tunnel: {
    label: "Tunnel gap",
    build: (r: AtlasRoute) =>
      tunnelTrace(r, { stepMeters: 18, gapStartMeters: 250, gapMeters: 500 }),
  },
  wrongTurn: {
    label: "Wrong turn",
    build: (r: AtlasRoute) =>
      wrongTurnTrace(r, { stepMeters: 18, turnAtMeters: 350, departMeters: 300 }),
  },
  jump: {
    label: "GPS jump",
    build: (r: AtlasRoute) => gpsJumpTrace(r, { stepMeters: 18, jumpMeters: 2_500 }),
  },
  stationary: {
    label: "Stopped at a light",
    build: (r: AtlasRoute) =>
      stationaryTrace(r, { atMeters: 250, samples: 60, reportSpeed: false }),
  },

  // --- Sub-phase 6: the rerouting scenarios ---
  //
  // The first three should each end in a reroute; the last two must not. That
  // pairing is the point — a control that only demonstrates success proves
  // nothing about a detector whose hardest job is staying quiet.
  missedTurn: {
    label: "Missed turn →⟲",
    build: (r: AtlasRoute) =>
      missedTurnTrace(r, { stepMeters: 18, continueMeters: 600 }),
  },
  earlyTurn: {
    label: "Early wrong turn →⟲",
    build: (r: AtlasRoute) =>
      wrongTurnTrace(r, { stepMeters: 18, turnAtMeters: 200, departMeters: 500 }),
  },
  parallel: {
    label: "Parallel road →⟲",
    build: (r: AtlasRoute) =>
      parallelRoadTrace(r, { stepMeters: 14, offsetMeters: 45 }),
  },
  rejoin: {
    label: "Leave & rejoin (no reroute)",
    build: (r: AtlasRoute) =>
      excursionTrace(r, { stepMeters: 16, atMeters: 300, peakMeters: 60 }),
  },
  poorGps: {
    label: "Poor GPS (no reroute)",
    build: (r: AtlasRoute) =>
      cleanTrace(r, { stepMeters: 16, noiseMeters: 38, accuracyMeters: 34 }),
  },
} as const;

export type ScenarioKey = keyof typeof SCENARIOS;

export function TraceReplayControl({
  route,
  onSample,
  onActiveChange,
  onForceReroute,
  rerouteState,
}: {
  route: AtlasRoute;
  onSample: (sample: NavigationSample) => void;
  onActiveChange: (active: boolean) => void;
  /** Skips detection entirely and requests a route now. Debug only. */
  onForceReroute?: () => void;
  /** Echoed back so the scenario and its outcome are readable together. */
  rerouteState?: string;
}) {
  const [scenario, setScenario] = useState<ScenarioKey>("clean");
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [index, setIndex] = useState(0);
  const samples = useRef<NavigationSample[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
    setRunning(false);
    onActiveChange(false);
  }, [onActiveChange]);

  const start = useCallback(() => {
    stop();
    // Timestamps are rebased onto now so freshness behaves as it would live —
    // a trace recorded at an epoch in the past would read as instantly stale.
    const built = SCENARIOS[scenario].build(route);
    const base = Date.now();
    const offset = built[0]?.timestamp ?? 0;
    samples.current = built.map((s) => ({ ...s, timestamp: base + (s.timestamp - offset) }));

    setIndex(0);
    setRunning(true);
    onActiveChange(true);

    let i = 0;
    timer.current = setInterval(() => {
      const sample = samples.current[i];
      if (!sample) {
        stop();
        return;
      }
      // Re-stamped to now on delivery, so replaying faster than real time does
      // not make every fix look stale on arrival.
      onSample({ ...sample, timestamp: Date.now() });
      i++;
      setIndex(i);
    }, Math.max(60, 1000 / speed));
  }, [scenario, route, speed, onSample, onActiveChange, stop]);

  useEffect(() => stop, [stop]);

  return (
    <div className="pointer-events-auto">
      <Panel title="Trace replay (simulated)">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {(Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setScenario(key)}
              style={{
                fontFamily: "inherit",
                fontSize: 10,
                padding: "4px 8px",
                borderRadius: 6,
                cursor: "pointer",
                border: `1px solid ${scenario === key ? "#C4912F" : "rgba(255,255,255,0.16)"}`,
                background: scenario === key ? "rgba(196,145,47,0.18)" : "transparent",
                color: scenario === key ? "#F6E7BE" : "#A5A2AC",
              }}
            >
              {SCENARIOS[key].label}
            </button>
          ))}
        </div>

        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={running ? stop : start}
            style={{
              fontFamily: "inherit",
              fontSize: 11,
              padding: "6px 14px",
              borderRadius: 6,
              cursor: "pointer",
              border: "1px solid #6437E0",
              background: "rgba(100,55,224,0.22)",
              color: "#DCD2FF",
            }}
          >
            {running ? "Stop" : "Play"}
          </button>
          {[1, 4, 12].map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => setSpeed(x)}
              style={{
                fontFamily: "inherit",
                fontSize: 10,
                padding: "4px 8px",
                borderRadius: 6,
                cursor: "pointer",
                border: `1px solid ${speed === x ? "#C4912F" : "rgba(255,255,255,0.16)"}`,
                background: "transparent",
                color: speed === x ? "#F6E7BE" : "#A5A2AC",
              }}
            >
              {x}×
            </button>
          ))}

          {onForceReroute && (
            <button
              type="button"
              onClick={onForceReroute}
              title="Skip detection and request a replacement route now"
              style={{
                fontFamily: "inherit",
                fontSize: 10,
                marginLeft: "auto",
                padding: "4px 8px",
                borderRadius: 6,
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.16)",
                background: "transparent",
                color: "#A5A2AC",
              }}
            >
              Force reroute
            </button>
          )}
        </div>

        <Row label="scenario" value={SCENARIOS[scenario].label} />
        <Row label="sample" value={`${index} / ${samples.current.length || "—"}`} />
        <Row
          label="feeding engine"
          value={running ? "yes — real GPS suspended" : "no"}
          verdict={running ? "warn" : "neutral"}
        />
        {rerouteState !== undefined && (
          <Row
            label="reroute"
            value={rerouteState}
            verdict={rerouteState === "following" ? "ok" : "warn"}
          />
        )}
      </Panel>
    </div>
  );
}
