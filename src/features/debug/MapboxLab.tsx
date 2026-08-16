"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getMapboxToken } from "@/lib/env";
import { atlasNightStyle } from "@/map/mapbox/atlas-night";
import {
  describeToken,
  detectWebGL,
  getLastError,
  safeResource,
} from "@/map/mapbox/diagnostics";
import {
  MapboxMapProvider,
  inspectMapboxMap,
} from "@/map/mapbox/MapboxMapProvider";
import type { MapHandle, MapInspection } from "@/map/provider";
import { pitchFor } from "@/map/types";
import { Panel, Row, yesNo } from "./DebugReadout";

/**
 * MAPBOX ISOLATION HARNESS — `/debug/mapbox`
 *
 * Not part of the product. Its only job is to answer, in order, the questions
 * that a black Command Center map cannot distinguish between:
 *
 *   1. Can Mapbox GL JS render *anything* with this token, in this browser?
 *   2. Does atlasNight render, once we know Mapbox itself works?
 *   3. Does the Atlas provider abstraction preserve that?
 *
 * Each level adds exactly one layer. The first level that goes black is the
 * broken one. Debugging six layers at once is what made the last two passes
 * inconclusive.
 */

type Level = 1 | 2 | 3 | 4 | 5 | 6;

interface LevelSpec {
  readonly id: Level;
  readonly label: string;
  readonly detail: string;
}

const LEVELS: readonly LevelSpec[] = [
  { id: 1, label: "1 · Mapbox Standard", detail: "Stock style, raw SDK. Known-good baseline." },
  { id: 2, label: "2 · Mapbox Dark", detail: "Stock dark style, raw SDK." },
  { id: 3, label: "3 · atlasNight minimal", detail: "No fog, no 3D, no terrain. Flat camera." },
  { id: 4, label: "4 · atlasNight full", detail: "Fog + 3D buildings, pitched camera." },
  { id: 5, label: "5 · Atlas provider", detail: "Through MapboxMapProvider abstraction." },
  { id: 6, label: "6 · Provider + markers", detail: "Adds the user puck and destination pin." },
];

/** Austin — a neutral, unambiguously-mapped default. Not the user's location. */
const CENTER: [number, number] = [-97.7431, 30.2672];

export function MapboxLab() {
  const [level, setLevel] = useState<Level>(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const [inspection, setInspection] = useState<MapInspection | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [constructed, setConstructed] = useState(false);
  const [startedAt, setStartedAt] = useState(() => Date.now());

  const log = useCallback((line: string) => {
    setEvents((prior) => [...prior.slice(-24), `${line}`]);
  }, []);

  // Rebuild the map whenever the level changes. Full teardown each time so a
  // level's result is never contaminated by the previous one.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    setInspection(null);
    setEvents([]);
    setConstructed(false);
    setStartedAt(Date.now());

    const token = getMapboxToken();
    if (token === null) {
      log("ABORT: no token in build");
      return;
    }

    let poll: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      try {
        const [mod] = await Promise.all([
          import("mapbox-gl"),
          import("mapbox-gl/dist/mapbox-gl.css"),
        ]);
        if (disposed) return;

        log("sdk imported");
        const mapboxgl = mod.default;
        mapboxgl.accessToken = token;

        // Levels 5 and 6 go through the real Atlas abstraction; 1–4 use the
        // raw SDK so the abstraction itself is isolated as a variable.
        if (level >= 5) {
          const provider = new MapboxMapProvider();
          const handle: MapHandle = await provider.mount(container, {
            camera: {
              center: { latitude: CENTER[1], longitude: CENTER[0] },
              zoom: 15.5,
              pitch: pitchFor("driving"),
              bearing: 0,
            },
            style: "atlasNight",
            perspective: "driving",
            annotations: [],
          });
          if (disposed) {
            handle.destroy();
            return;
          }
          setConstructed(true);
          log("provider mounted");

          handle.on("ready", () => log("EVENT ready"));
          handle.on("error", (error) => log(`EVENT error: ${error.reason} — ${error.message}`));

          if (level === 6) {
            handle.setUserLocation({ latitude: CENTER[1], longitude: CENTER[0] }, 45);
            handle.setDestination({ latitude: 30.28, longitude: -97.73 });
            log("markers added");
          }

          poll = setInterval(() => setInspection(handle.inspect()), 500);
          cleanupRef.current = () => {
            if (poll) clearInterval(poll);
            handle.destroy();
          };
          return;
        }

        const style =
          level === 1
            ? "mapbox://styles/mapbox/standard"
            : level === 2
              ? "mapbox://styles/mapbox/dark-v11"
              : atlasNightStyle(
                  level === 3
                    ? { buildings3D: false, terrain: false, atmosphere: false }
                    : { buildings3D: true, terrain: false, atmosphere: true },
                );

        const map = new mapboxgl.Map({
          container,
          style: style as never,
          center: CENTER,
          zoom: 15.5,
          pitch: level === 3 ? 0 : 55,
          bearing: 0,
        });
        setConstructed(true);
        log("constructor returned");

        map.on("style.load", () => log("EVENT style.load"));
        map.on("load", () => log("EVENT load"));
        map.on("idle", () => log("EVENT idle (first full render)"));
        map.on("error", (event) => {
          const raw = event.error as (Error & { status?: number; url?: string }) | undefined;
          log(
            `EVENT error ${raw?.status ?? "-"} ${raw?.message ?? "unknown"} @ ${safeResource(raw?.url) ?? "-"}`,
          );
        });

        poll = setInterval(() => setInspection(inspectMapboxMap(map)), 500);
        cleanupRef.current = () => {
          if (poll) clearInterval(poll);
          map.remove();
        };
      } catch (error) {
        log(`THREW: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();

    return () => {
      disposed = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [level, log]);

  const token = getMapboxToken();
  const webgl = detectWebGL();
  const lastError = getLastError();
  const spec = LEVELS.find((candidate) => candidate.id === level);

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#08080B",
        color: "#F4F2ED",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      {/* Level selector */}
      <div style={{ padding: "12px 12px 8px", display: "flex", flexWrap: "wrap", gap: 6 }}>
        {LEVELS.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => setLevel(candidate.id)}
            style={{
              fontFamily: "inherit",
              fontSize: 11,
              padding: "6px 10px",
              borderRadius: 6,
              cursor: "pointer",
              border:
                level === candidate.id
                  ? "1px solid #C4912F"
                  : "1px solid rgba(255,255,255,0.16)",
              background: level === candidate.id ? "rgba(196,145,47,0.16)" : "transparent",
              color: level === candidate.id ? "#F6E7BE" : "#A5A2AC",
            }}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      <p style={{ margin: "0 12px 10px", fontSize: 11, color: "#6B6874" }}>
        {spec?.detail} — if this level is black but a lower one is not, the layer
        this level adds is the broken one.
      </p>

      {/* The map. Fixed height so container sizing is never a variable here. */}
      <div
        ref={containerRef}
        style={{
          height: "46vh",
          minHeight: 260,
          margin: "0 12px",
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: 8,
          overflow: "hidden",
          background: "#101014",
        }}
      />

      <div style={{ padding: 12, display: "grid", gap: 10 }}>
        <Panel title="Environment">
          <Row label="hostname" value={typeof window === "undefined" ? "—" : window.location.hostname} />
          <Row label="env" value={process.env.NODE_ENV ?? "unknown"} />
          <Row
            label="token present"
            value={yesNo(token !== null).text}
            verdict={yesNo(token !== null).verdict}
          />
          <Row label="token" value={describeToken(token)} />
          <Row label="token prefix" value={token ? `${token.slice(0, 3)}…` : "—"} />
          <Row
            label="WebGL"
            value={webgl.supported ? webgl.detail : "unavailable"}
            verdict={webgl.supported ? "ok" : "bad"}
          />
          <Row
            label="constructor reached"
            value={yesNo(constructed).text}
            verdict={yesNo(constructed).verdict}
          />
          <Row label="elapsed" value={`${Date.now() - startedAt}ms`} />
        </Panel>

        <Panel title="Canvas & style">
          {inspection === null ? (
            <Row label="status" value="no map instance yet" verdict="warn" />
          ) : (
            <>
              <Row
                label="canvas exists"
                value={yesNo(inspection.canvasExists).text}
                verdict={yesNo(inspection.canvasExists).verdict}
              />
              <Row
                label="canvas (device px)"
                value={`${inspection.canvasWidth ?? "—"} × ${inspection.canvasHeight ?? "—"}`}
              />
              <Row
                label="canvas (CSS px)"
                value={`${inspection.cssWidth ?? "—"} × ${inspection.cssHeight ?? "—"}`}
                verdict={inspection.cssWidth ? "ok" : "bad"}
              />
              <Row
                label="WebGL context"
                value={yesNo(inspection.hasWebGLContext).text}
                verdict={yesNo(inspection.hasWebGLContext).verdict}
              />
              <Row
                label="style loaded"
                value={yesNo(inspection.styleLoaded).text}
                verdict={yesNo(inspection.styleLoaded).verdict}
              />
              <Row
                label="map loaded"
                value={yesNo(inspection.loaded).text}
                verdict={yesNo(inspection.loaded).verdict}
              />
              <Row
                label="sources"
                value={inspection.sourceCount ?? "—"}
                verdict={inspection.sourceCount ? "ok" : "warn"}
              />
              <Row
                label="layers"
                value={inspection.layerCount ?? "—"}
                verdict={inspection.layerCount ? "ok" : "warn"}
              />
              <Row
                label="center"
                value={
                  inspection.center
                    ? `${inspection.center.latitude.toFixed(4)}, ${inspection.center.longitude.toFixed(4)}`
                    : "—"
                }
              />
              <Row label="zoom" value={inspection.zoom?.toFixed(2) ?? "—"} />
              <Row label="pitch" value={inspection.pitch?.toFixed(0) ?? "—"} />
            </>
          )}
        </Panel>

        <Panel title="Last Mapbox error">
          {lastError === null ? (
            <Row label="status" value="none recorded" verdict="ok" />
          ) : (
            <>
              <Row label="category" value={lastError.category} verdict="bad" />
              <Row label="HTTP status" value={lastError.status ?? "—"} verdict="bad" />
              <Row label="resource" value={lastError.resource ?? "—"} />
              <Row label="message" value={lastError.message} />
            </>
          )}
        </Panel>

        <Panel title="Event log">
          {events.length === 0 ? (
            <div style={{ color: "#6B6874" }}>no events yet</div>
          ) : (
            events.map((line, index) => (
              <div
                key={`${index}-${line}`}
                style={{
                  color: line.includes("error") || line.includes("THREW") ? "#FF6B6B" : "#A5A2AC",
                  padding: "1px 0",
                }}
              >
                {line}
              </div>
            ))
          )}
        </Panel>
      </div>
    </main>
  );
}
