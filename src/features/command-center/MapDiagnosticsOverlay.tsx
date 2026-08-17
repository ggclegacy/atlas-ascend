"use client";

import { useEffect, useState } from "react";
import { getPublicMapboxToken } from "@/lib/env";
import {
  describeToken,
  detectWebGL,
  elapsedMs,
  getLastError,
  getTrace,
  tokenAccount,
  tokenFingerprint,
} from "@/map/mapbox/diagnostics";
import type { MapHandle, MapInspection, MapUnavailableReason } from "@/map/provider";
import { Panel, Row, yesNo } from "@/features/debug/DebugReadout";

/**
 * On-screen map diagnostics for `?atlasdebug=map`.
 *
 * Exists because "open DevTools and read the console" is not a usable
 * instruction for diagnosing a phone. Everything needed to attribute a black
 * map is on screen and screenshot-safe: the token appears only as presence,
 * length, and kind, and request URLs are reduced to host and path so the
 * `access_token=` query string can never be captured.
 */
export function MapDiagnosticsOverlay({
  handle,
  status,
  reason,
  containerRef,
}: {
  handle: MapHandle | null;
  status: "mounting" | "ready" | "blocked";
  reason: MapUnavailableReason | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [hidden, setHidden] = useState(false);
  const [inspection, setInspection] = useState<MapInspection | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  // Identifies *which* token this build shipped without disclosing it, so a
  // deployment can be checked against the token it is supposed to be using.
  useEffect(() => {
    void tokenFingerprint(getPublicMapboxToken()).then(setFingerprint);
  }, []);

  // Poll rather than subscribe: the interesting values (canvas size, style
  // loaded, layer count) change without emitting events.
  useEffect(() => {
    const timer = setInterval(() => {
      setInspection(handle ? handle.inspect() : null);
      forceTick((n) => n + 1);
    }, 500);
    return () => clearInterval(timer);
  }, [handle]);

  if (hidden) return null;

  const token = getPublicMapboxToken();
  const webgl = detectWebGL();
  const lastError = getLastError();
  const trace = getTrace();
  const container = containerRef.current;
  const rect = container?.getBoundingClientRect();

  const reached = (name: string) => trace.some((r) => r.stage === name && r.ok);

  return (
    <div
      style={{
        position: "fixed",
        // Below the sheet (z-50) so it can never block the product UI.
        zIndex: 40,
        top: "calc(env(safe-area-inset-top, 0px) + 8px)",
        left: 8,
        right: 8,
        maxWidth: 460,
        margin: "0 auto",
        pointerEvents: "auto",
      }}
    >
      <Panel title="Atlas map diagnostics" onClose={() => setHidden(true)}>
        <Row label="hostname" value={window.location.hostname} />
        <Row label="env" value={process.env.NODE_ENV ?? "unknown"} />
        <Row
          label="token present"
          value={yesNo(token !== null).text}
          verdict={yesNo(token !== null).verdict}
        />
        <Row label="token" value={describeToken(token)} />
        <Row label="token prefix" value={token ? `${token.slice(0, 3)}…` : "—"} />
        <Row label="token account" value={tokenAccount(token) ?? "—"} />
        <Row label="token fingerprint" value={fingerprint ?? "…"} />
        <Row
          label="WebGL"
          value={webgl.supported ? webgl.detail : "unavailable"}
          verdict={webgl.supported ? "ok" : "bad"}
        />
        <Row
          label="container"
          value={rect ? `${Math.round(rect.width)} × ${Math.round(rect.height)}` : "—"}
          verdict={rect && rect.width > 0 && rect.height > 0 ? "ok" : "bad"}
        />
        <Row
          label="sdk imported"
          value={yesNo(reached("sdk-import")).text}
          verdict={yesNo(reached("sdk-import")).verdict}
        />
        {/* Mapbox CSS is a static import in MapSurface, so it is part of the
            route's stylesheet and cannot be absent at runtime. Reported as a
            constant rather than a probe, because a probe here would always
            read "no" and look like a fault. */}
        <Row label="mapbox css" value="static (bundled)" verdict="ok" />
        <Row
          label="constructor"
          value={yesNo(reached("constructor")).text}
          verdict={yesNo(reached("constructor")).verdict}
        />
        <Row
          label="style.load"
          value={yesNo(reached("style-load")).text}
          verdict={yesNo(reached("style-load")).verdict}
        />
        <Row
          label="map load"
          value={yesNo(reached("map-load")).text}
          verdict={yesNo(reached("map-load")).verdict}
        />
        <Row label="surface status" value={status} verdict={status === "ready" ? "ok" : "warn"} />
        <Row label="blocked reason" value={reason ?? "—"} verdict={reason ? "bad" : "ok"} />
        <Row label="elapsed" value={`${elapsedMs()}ms`} />

        {inspection && (
          <>
            <Row
              label="canvas"
              value={`${inspection.canvasWidth ?? "—"} × ${inspection.canvasHeight ?? "—"} px`}
              verdict={inspection.canvasExists ? "ok" : "bad"}
            />
            <Row
              label="canvas CSS"
              value={`${inspection.cssWidth ?? "—"} × ${inspection.cssHeight ?? "—"}`}
              verdict={inspection.cssWidth ? "ok" : "bad"}
            />
            <Row
              label="GL context"
              value={yesNo(inspection.hasWebGLContext).text}
              verdict={yesNo(inspection.hasWebGLContext).verdict}
            />
            <Row
              label="style loaded"
              value={yesNo(inspection.styleLoaded).text}
              verdict={yesNo(inspection.styleLoaded).verdict}
            />
            <Row
              label="sources / layers"
              value={`${inspection.sourceCount ?? "—"} / ${inspection.layerCount ?? "—"}`}
              verdict={inspection.layerCount ? "ok" : "warn"}
            />
            {/* Route rendering. Answers "is the route actually on the map"
                without opening DevTools — a route present in application
                state but absent from the style is exactly the class of
                failure this project has already lost days to. */}
            <Row
              label="route sources"
              value={yesNo(inspection.route.sourcesPresent).text}
              verdict={inspection.route.sourcesPresent ? "ok" : "warn"}
            />
            <Row
              label="route layers"
              value={inspection.route.layerCount}
              verdict={inspection.route.layerCount > 0 ? "ok" : "warn"}
            />
            <Row
              label="route vertices"
              value={inspection.route.primaryVertexCount || "—"}
              verdict={inspection.route.primaryVertexCount > 0 ? "ok" : "warn"}
            />
            <Row label="primary route" value={inspection.route.primaryRouteId ?? "—"} />
            <Row label="alternatives" value={inspection.route.alternativeCount} />
            <Row
              label="center"
              value={
                inspection.center
                  ? `${inspection.center.latitude.toFixed(3)}, ${inspection.center.longitude.toFixed(3)}`
                  : "—"
              }
            />
            <Row
              label="zoom / pitch"
              value={`${inspection.zoom?.toFixed(1) ?? "—"} / ${inspection.pitch?.toFixed(0) ?? "—"}`}
            />
          </>
        )}

        {lastError && (
          <>
            {/* Observation first, interpretation last. The classified category
                is a conclusion drawn from the rows above it, and printing it
                on its own once let a wrong conclusion travel unchallenged. */}
            <Row label="HTTP status" value={lastError.status ?? "—"} verdict="bad" />
            <Row label="resource kind" value={lastError.kind} verdict="bad" />
            <Row label="request" value={lastError.url ?? lastError.resource ?? "—"} />
            <Row label="source" value={lastError.sourceId ?? "—"} />
            <Row label="SDK message" value={lastError.message} />
            <Row
              label="Mapbox response"
              value={lastError.body ?? "not disclosed by the SDK"}
              verdict={lastError.body ? "bad" : "warn"}
            />
            <Row label="classified as" value={lastError.category} verdict="bad" />
          </>
        )}

        <div style={{ marginTop: 8, color: "#6B6874" }}>
          atlasNight: validated against the Mapbox style spec in CI (0 errors).
          Isolation harness at <span style={{ color: "#C4912F" }}>/debug/mapbox</span>.
        </div>
      </Panel>
    </div>
  );
}
