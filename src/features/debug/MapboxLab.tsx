"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getPublicMapboxToken } from "@/lib/env";
import { atlasNightStyle } from "@/map/mapbox/atlas-night";
import {
  describeToken,
  detectWebGL,
  safeResource,
  tokenAccount,
  tokenFingerprint,
} from "@/map/mapbox/diagnostics";
import {
  type ProbeResult,
  type ProbeVerdict,
  runAllProbes,
  summarizeProbes,
} from "./endpointProbe";
import {
  MapboxMapProvider,
  classifyError,
  inspectMapboxMap,
} from "@/map/mapbox/MapboxMapProvider";
import type { MapHandle, MapInspection } from "@/map/provider";
import { pitchFor } from "@/map/types";
import {
  MIN_ROAD_GROUND_DELTA,
  afterScrim,
  clearBandFraction,
  luma,
  peakScrimAlpha,
} from "@/map/legibility";
import { Panel, Row, yesNo } from "./DebugReadout";
import {
  describeVerdict,
  type PixelStats,
  type RenderVerdict,
  sampleCanvas,
  verdictFor,
} from "./pixels";

/**
 * MAPBOX ISOLATION HARNESS — `/debug/mapbox`
 *
 * Not part of the product. One button mounts each layer of the stack in turn,
 * samples the actual framebuffer, and reports a verdict. The first level that
 * fails is the broken one.
 *
 * The framebuffer sampling is what makes this conclusive rather than another
 * screenshot to squint at: it can tell "nothing drew" apart from "everything
 * drew but it is too dark to see", which is exactly the ambiguity that made
 * this bug survive three passes.
 */

interface LevelSpec {
  readonly id: number;
  readonly label: string;
  readonly what: string;
}

const LEVELS: readonly LevelSpec[] = [
  { id: 1, label: "Raw SDK + stock style", what: "Mapbox itself, token, WebGL" },
  { id: 2, label: "Raw SDK + atlasNight (minimal)", what: "atlasNight layers, no fog/3D" },
  { id: 3, label: "Raw SDK + atlasNight (full)", what: "adds fog + 3D buildings" },
  { id: 4, label: "Atlas provider", what: "the Atlas map abstraction" },
  { id: 5, label: "Atlas provider + user puck", what: "custom markers" },
  {
    id: 6,
    label: "atlasNight + Command Center scrims",
    what: "the product's overlay composite — what you actually see",
  },
];

interface LevelResult {
  readonly id: number;
  readonly verdict: RenderVerdict | "error";
  readonly stats: PixelStats | null;
  readonly inspection: MapInspection | null;
  readonly errorStatus: number | null;
  readonly errorCategory: string | null;
  readonly errorResource: string | null;
  readonly errorMessage: string | null;
  readonly ms: number;
}

/** Austin — a neutral, unambiguously-mapped default. Not the user's location. */
const CENTER: [number, number] = [-97.7431, 30.2672];
const LOAD_TIMEOUT_MS = 14_000;

export function MapboxLab() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [results, setResults] = useState<LevelResult[]>([]);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  const [probes, setProbes] = useState<ProbeResult[] | null>(null);
  const [probeVerdict, setProbeVerdict] = useState<ProbeVerdict | null>(null);
  const [probing, setProbing] = useState(false);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  useEffect(() => {
    void tokenFingerprint(getPublicMapboxToken()).then(setFingerprint);
  }, []);

  /**
   * Asks Mapbox directly, before any SDK is involved.
   *
   * Answers on its own the question the six levels below cannot: whether
   * Mapbox is refusing anything, and if so, what it says about it. Runs first
   * in the page because a network refusal makes every render verdict beneath
   * it uninterpretable.
   */
  const runProbes = useCallback(async () => {
    const token = getPublicMapboxToken();
    if (token === null || probing) return;
    setProbing(true);
    setProbes(null);
    setProbeVerdict(null);
    const outcome = await runAllProbes(token);
    setProbes(outcome);
    setProbeVerdict(summarizeProbes(outcome));
    setProbing(false);
  }, [probing]);

  const runAll = useCallback(async () => {
    const host = hostRef.current;
    if (!host || running) return;

    setRunning(true);
    setResults([]);

    const token = getPublicMapboxToken();
    if (token === null) {
      setResults([
        {
          id: 0,
          verdict: "error",
          stats: null,
          inspection: null,
          errorStatus: null,
          errorCategory: "missing-token",
          errorResource: null,
          errorMessage: "NEXT_PUBLIC_MAPBOX_TOKEN is not present in this build",
          ms: 0,
        },
      ]);
      setRunning(false);
      return;
    }

    const [mod] = await Promise.all([
      import("mapbox-gl"),
      import("mapbox-gl/dist/mapbox-gl.css"),
    ]);
    const mapboxgl = mod.default;
    mapboxgl.accessToken = token;

    for (const level of LEVELS) {
      setCurrent(level.id);
      // Fresh container per level so nothing carries over.
      const container = document.createElement("div");
      container.style.cssText = "position:absolute;inset:0;";
      host.replaceChildren(container);

      const started = Date.now();
      let lastStatus: number | null = null;
      let lastCategory: string | null = null;
      let lastResource: string | null = null;
      let lastMessage: string | null = null;
      let teardown: (() => void) | null = null;
      let mapForPixels: import("mapbox-gl").Map | null = null;
      let handle: MapHandle | null = null;

      const noteError = (raw: (Error & { status?: number; url?: string }) | undefined) => {
        const status = typeof raw?.status === "number" ? raw.status : null;
        lastStatus = status;
        lastMessage = raw?.message ?? "unknown";
        lastResource = safeResource(raw?.url);
        lastCategory = classifyError(status, lastMessage, lastResource);
      };

      try {
        if (level.id === 4 || level.id === 5) {
          const provider = new MapboxMapProvider();
          handle = await provider.mount(container, {
            camera: {
              center: { latitude: CENTER[1], longitude: CENTER[0] },
              zoom: 15.4,
              pitch: pitchFor("driving"),
              bearing: 0,
            },
            style: "atlasNight",
            perspective: "driving",
            annotations: [],
          });
          handle.on("error", (error) => {
            lastCategory = error.reason;
            lastMessage = error.message;
          });
          if (level.id >= 5) {
            handle.setUserLocation({ latitude: CENTER[1], longitude: CENTER[0] }, 45);
            handle.setDestination({ latitude: 30.28, longitude: -97.73 });
          }
          const h = handle;
          teardown = () => h.destroy();
          await waitFor(() => h.inspect().loaded, LOAD_TIMEOUT_MS);
        } else {
          const style =
            level.id === 1
              ? "mapbox://styles/mapbox/dark-v11"
              : atlasNightStyle(
                  level.id === 2
                    ? { buildings3D: false, terrain: false, atmosphere: false }
                    : { buildings3D: true, terrain: false, atmosphere: true },
                );

          // Level 6 adds the product's actual scrim elements over the map, so
          // what is on screen is the real Command Center composite rather than
          // a bare map. They are DOM siblings, exactly as in production.
          if (level.id === 6) {
            for (const cls of ["atlas-scrim-top", "atlas-scrim-bottom"] as const) {
              const scrim = document.createElement("div");
              const top = cls === "atlas-scrim-top";
              scrim.className = cls;
              scrim.style.cssText = `position:absolute;left:0;right:0;${
                top ? "top:0;height:176px;" : "bottom:0;height:288px;"
              }pointer-events:none;z-index:10;`;
              host.appendChild(scrim);
            }
          }

          const map = new mapboxgl.Map({
            container,
            style: style as never,
            center: CENTER,
            zoom: 15.4,
            pitch: level.id === 2 ? 0 : 55,
            bearing: 0,
            // Required to read the framebuffer back. Debug-only.
            preserveDrawingBuffer: true,
            attributionControl: false,
          });
          mapForPixels = map;
          map.on("error", (event) =>
            noteError(event.error as (Error & { status?: number; url?: string }) | undefined),
          );
          teardown = () => map.remove();
          await waitFor(() => map.loaded(), LOAD_TIMEOUT_MS);
        }

        // Let the GPU settle before reading pixels.
        await delay(700);

        // Levels 4–5 go through the abstraction, which does not enable
        // preserveDrawingBuffer — so pixel sampling is only meaningful for
        // 1–3 and 6. For 4–5 the inspection data carries the verdict.
        const inspection = handle ? handle.inspect() : mapForPixels ? inspectMapboxMap(mapForPixels) : null;
        const stats = mapForPixels
          ? sampleCanvas(mapForPixels.getCanvas() as HTMLCanvasElement)
          : null;

        // Level 6 is the only level that answers the question that actually
        // matters: what survives the Command Center's scrims. The canvas
        // sample cannot see them — they are DOM siblings composited by the
        // browser — so the composite is computed from the measured canvas
        // luminance and the modeled scrim alpha.
        const composite =
          level.id === 6 && stats ? compositeReport(stats.meanLuminance) : null;

        const verdict: LevelResult["verdict"] = mapForPixels
          ? level.id === 6 && composite && composite.worstDelta < 12
            ? "unreadable"
            : verdictFor(stats)
          : inspection?.loaded && (inspection.layerCount ?? 0) > 0
            ? "rendered"
            : "flat";

        setResults((prior) => [
          ...prior,
          {
            id: level.id,
            verdict,
            stats,
            inspection,
            errorStatus: lastStatus,
            errorCategory: lastCategory,
            errorResource: lastResource,
            errorMessage: lastMessage,
            ms: Date.now() - started,
          },
        ]);
      } catch (error) {
        setResults((prior) => [
          ...prior,
          {
            id: level.id,
            verdict: "error",
            stats: null,
            inspection: null,
            errorStatus: lastStatus,
            errorCategory: lastCategory ?? "threw",
            errorResource: lastResource,
            errorMessage:
              lastMessage ?? (error instanceof Error ? error.message : String(error)),
            ms: Date.now() - started,
          },
        ]);
      } finally {
        teardown?.();
      }
    }

    host.replaceChildren();
    setCurrent(null);
    setRunning(false);
  }, [running]);

  const token = getPublicMapboxToken();
  const webgl = detectWebGL();
  const conclusion = concludeFrom(results);

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#08080B",
        color: "#F4F2ED",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        padding: 12,
        display: "grid",
        gap: 10,
      }}
    >
      {/* The network question comes first. If Mapbox is refusing requests, no
          rendering verdict below means anything. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => void runProbes()}
          disabled={probing || token === null}
          style={{
            fontFamily: "inherit",
            fontSize: 13,
            padding: "10px 18px",
            borderRadius: 8,
            cursor: probing ? "default" : "pointer",
            border: "1px solid #6437E0",
            background: probing ? "rgba(100,55,224,0.12)" : "rgba(100,55,224,0.26)",
            color: "#DCD2FF",
          }}
        >
          {probing ? "Asking Mapbox…" : "Probe Mapbox endpoints"}
        </button>
        <span style={{ fontSize: 11, color: "#6B6874" }}>
          Requests each resource directly and prints Mapbox&rsquo;s own answer.
        </span>
      </div>

      {probeVerdict && (
        <div
          style={{
            border: `1px solid ${probeVerdict.code === "H-application" ? "#3FB98A" : "#FF6B6B"}`,
            background: probeVerdict.code === "H-application" ? "#3FB98A1A" : "#FF6B6B1A",
            borderRadius: 8,
            padding: "10px 12px",
          }}
        >
          <div
            style={{
              color: probeVerdict.code === "H-application" ? "#3FB98A" : "#FF6B6B",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
            }}
          >
            {probeVerdict.headline}
          </div>
          <div style={{ color: "#6B6874", fontSize: 10, marginTop: 2 }}>
            class {probeVerdict.code}
          </div>
          <div style={{ color: "#D6D3DC", fontSize: 11, marginTop: 4 }}>
            {probeVerdict.detail}
          </div>
          <div style={{ color: "#F6E7BE", fontSize: 11, marginTop: 6 }}>
            → {probeVerdict.action}
          </div>
        </div>
      )}

      {probes && (
        <Panel title="Mapbox endpoint probe">
          <div style={{ overflowX: "auto" }}>
            <table
              style={{ borderCollapse: "collapse", width: "100%", fontSize: 10.5, minWidth: 560 }}
            >
              <thead>
                <tr style={{ color: "#6B6874", textAlign: "left" }}>
                  {["resource", "kind", "prod", "HTTP", "ms", "Mapbox said"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "4px 6px",
                        borderBottom: "1px solid rgba(255,255,255,0.14)",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {probes.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <td style={{ padding: "4px 6px" }}>{p.label}</td>
                    <td style={{ padding: "4px 6px", color: "#6B6874" }}>{p.kind}</td>
                    <td style={{ padding: "4px 6px", color: "#6B6874" }}>
                      {p.usedInProduction ? "yes" : "no"}
                    </td>
                    <td
                      style={{
                        padding: "4px 6px",
                        color: p.ok ? "#3FB98A" : "#FF6B6B",
                        fontWeight: 700,
                      }}
                    >
                      {p.status ?? "—"}
                    </td>
                    <td style={{ padding: "4px 6px", color: "#6B6874" }}>{p.ms}</td>
                    <td style={{ padding: "4px 6px", color: p.message ? "#FF6B6B" : "#6B6874" }}>
                      {p.message ?? (p.ok ? "ok" : "nothing")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8, color: "#6B6874" }}>
            Requested from this page, so the real Origin and Referer are sent — a
            URL restriction is tested exactly as the deployment experiences it.
            URLs are recorded with the token redacted.
          </div>
        </Panel>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => void runAll()}
          disabled={running}
          style={{
            fontFamily: "inherit",
            fontSize: 13,
            padding: "10px 18px",
            borderRadius: 8,
            cursor: running ? "default" : "pointer",
            border: "1px solid #C4912F",
            background: running ? "rgba(196,145,47,0.12)" : "rgba(196,145,47,0.24)",
            color: "#F6E7BE",
          }}
        >
          {running ? `Running level ${current ?? "…"} of 6…` : "Run all 6 levels"}
        </button>
        <span style={{ fontSize: 11, color: "#6B6874" }}>
          Mounts each layer, samples the framebuffer, reports a verdict.
        </span>
      </div>

      {/* Offscreen-ish mount host. Visible so you can watch each level draw. */}
      <div
        ref={hostRef}
        style={{
          position: "relative",
          height: "34vh",
          minHeight: 200,
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: 8,
          overflow: "hidden",
          background: "#101014",
        }}
      />

      {conclusion && (
        <div
          style={{
            border: `1px solid ${conclusion.tone}`,
            background: `${conclusion.tone}1A`,
            borderRadius: 8,
            padding: "10px 12px",
          }}
        >
          <div style={{ color: conclusion.tone, fontSize: 12, fontWeight: 700, letterSpacing: "0.08em" }}>
            {conclusion.headline}
          </div>
          <div style={{ color: "#D6D3DC", fontSize: 11, marginTop: 4 }}>{conclusion.detail}</div>
          {conclusion.action && (
            <div style={{ color: "#F6E7BE", fontSize: 11, marginTop: 6 }}>
              → {conclusion.action}
            </div>
          )}
        </div>
      )}

      <Panel title="Results">
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 10.5, minWidth: 560 }}>
            <thead>
              <tr style={{ color: "#6B6874", textAlign: "left" }}>
                {["#", "level", "rendered", "canvas", "GL", "style", "map", "layers", "src", "HTTP", "error"].map(
                  (h) => (
                    <th key={h} style={{ padding: "4px 6px", borderBottom: "1px solid rgba(255,255,255,0.14)" }}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {results.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ padding: 10, color: "#6B6874" }}>
                    Press “Run all 6 levels”.
                  </td>
                </tr>
              ) : (
                results.map((r) => {
                  const spec = LEVELS.find((l) => l.id === r.id);
                  const ok = r.verdict === "rendered";
                  const tone = ok ? "#3FB98A" : r.verdict === "unreadable" ? "#E0A64B" : "#FF6B6B";
                  const i = r.inspection;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <td style={{ padding: "4px 6px", color: "#6B6874" }}>{r.id}</td>
                      <td style={{ padding: "4px 6px" }}>{spec?.label ?? "—"}</td>
                      <td style={{ padding: "4px 6px", color: tone, fontWeight: 700 }}>
                        {ok ? "YES" : r.verdict.toUpperCase()}
                      </td>
                      <td style={{ padding: "4px 6px" }}>
                        {i?.cssWidth ? `${i.cssWidth}×${i.cssHeight}` : "—"}
                      </td>
                      <td style={{ padding: "4px 6px" }}>{i?.hasWebGLContext ? "y" : "n"}</td>
                      <td style={{ padding: "4px 6px" }}>{i?.styleLoaded ? "y" : "n"}</td>
                      <td style={{ padding: "4px 6px" }}>{i?.loaded ? "y" : "n"}</td>
                      <td style={{ padding: "4px 6px" }}>{i?.layerCount ?? "—"}</td>
                      <td style={{ padding: "4px 6px" }}>{i?.sourceCount ?? "—"}</td>
                      <td style={{ padding: "4px 6px", color: r.errorStatus ? "#FF6B6B" : "#6B6874" }}>
                        {r.errorStatus ?? "—"}
                      </td>
                      <td style={{ padding: "4px 6px", color: r.errorCategory ? "#FF6B6B" : "#6B6874" }}>
                        {r.errorCategory ?? "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {results.some((r) => r.stats) && (
          <div style={{ marginTop: 8, color: "#6B6874" }}>
            {results
              .filter((r) => r.stats)
              .map((r) => (
                <div key={r.id}>
                  L{r.id}: mean luma {r.stats?.meanLuminance.toFixed(1)}, max{" "}
                  {r.stats?.maxLuminance.toFixed(0)}, {r.stats?.distinctColors} colors,{" "}
                  {((r.stats?.nonBlackFraction ?? 0) * 100).toFixed(1)}% lit — {describeVerdict(r.verdict as RenderVerdict)}
                </div>
              ))}
          </div>
        )}
      </Panel>

      <Panel title="Environment">
        <Row label="hostname" value={typeof window === "undefined" ? "—" : window.location.hostname} />
        <Row label="env" value={process.env.NODE_ENV ?? "unknown"} />
        <Row
          label="token present"
          value={yesNo(token !== null).text}
          verdict={yesNo(token !== null).verdict}
        />
        <Row label="token" value={describeToken(token)} />
        <Row label="token prefix" value={token ? `${token.slice(0, 6)}…` : "—"} />
        {/* Identity without disclosure. The account name comes from the
            token's own public claim set, and the fingerprint reproduces as
            `printf %s "$TOKEN" | shasum -a 256 | cut -c1-12` — so a deployed
            build can be checked against the token it is meant to carry
            without either being pasted anywhere. */}
        <Row label="token account" value={tokenAccount(token) ?? "—"} />
        <Row label="token fingerprint" value={fingerprint ?? "…"} />
        <Row
          label="WebGL"
          value={webgl.supported ? webgl.detail : "unavailable"}
          verdict={webgl.supported ? "ok" : "bad"}
        />
        <Row label="device pixel ratio" value={typeof window === "undefined" ? "—" : window.devicePixelRatio} />
      </Panel>
    </main>
  );
}

// ---------------------------------------------------------------------------

/**
 * Turns the level results into a one-line answer.
 *
 * This is the point of the page: not data, a conclusion.
 */
function concludeFrom(
  results: readonly LevelResult[],
): { headline: string; detail: string; action: string | null; tone: string } | null {
  if (results.length === 0) return null;

  const failed = results.find((r) => r.verdict !== "rendered");

  if (!failed) {
    return {
      headline: "ALL LEVELS RENDER",
      detail:
        "Mapbox, atlasNight, the Atlas provider, and the Command Center map component all drew real geography.",
      action: "If the product still looks black, the problem is above the map layer.",
      tone: "#3FB98A",
    };
  }

  // Hostname is read live, never hard-coded — this page must work on whatever
  // domain the project happens to be deployed to.
  const host = typeof window === "undefined" ? "this site" : window.location.hostname;
  const http = failed.errorStatus ?? "401/403";

  switch (failed.errorCategory) {
    case "missing-token":
      return {
        headline: "NO TOKEN IN THIS BUILD",
        detail: "NEXT_PUBLIC_MAPBOX_TOKEN was not present when this build was compiled.",
        action: "Set it in Vercel and redeploy — it is inlined at build time, not read at runtime.",
        tone: "#FF6B6B",
      };

    // Reachable only when Mapbox's own response named the capability — the
    // classifier no longer infers one from the endpoint's path.
    case "tile-access-denied":
      return {
        headline: "MAPBOX NAMED A MISSING TILE CAPABILITY",
        detail: `HTTP ${http} at ${failed.errorResource ?? "the tile endpoint"}, with a response that named the capability.`,
        action: "Add styles:tiles to this public token in the Mapbox dashboard.",
        tone: "#FF6B6B",
      };

    case "style-access-denied":
      return {
        headline: "MAPBOX NAMED A MISSING STYLE CAPABILITY",
        detail: `HTTP ${http} at ${failed.errorResource ?? "the styles endpoint"}, with a response that named the capability.`,
        action: "Add styles:read to this public token in the Mapbox dashboard.",
        tone: "#FF6B6B",
      };

    // 401 and 403 are reported as what they are. Each has several possible
    // causes and Mapbox distinguishes none of them from the status alone, so
    // the action is to gather evidence rather than to change a setting.
    case "forbidden":
      return {
        headline: "MAPBOX REFUSED THE REQUEST (403)",
        detail: `HTTP ${http} at ${failed.errorResource ?? "the Mapbox API"}, from ${host}. Mapbox did not say why. Candidates: a URL restriction excluding this hostname, or a capability this endpoint requires.`,
        action: "Run the endpoint probe above — it prints Mapbox's own response body.",
        tone: "#FF6B6B",
      };

    case "invalid-token":
      return {
        headline: "MAPBOX REFUSED THE KEY (401)",
        detail: `HTTP ${http} at ${failed.errorResource ?? "the Mapbox API"}. The credential itself was rejected — revoked, deleted, truncated, or from another account.`,
        action: "Compare the token account and fingerprint below with the token you expect this build to carry.",
        tone: "#FF6B6B",
      };

    default:
      break;
  }

  if (failed.verdict === "unreadable") {
    return {
      headline: `LEVEL ${failed.id} RENDERS BUT IS TOO DARK`,
      detail: `Structure is present in the framebuffer (max luminance ${failed.stats?.maxLuminance.toFixed(0)}) but almost nothing is above the visible threshold.`,
      action: "This is a style luminance problem, not a Mapbox failure.",
      tone: "#E0A64B",
    };
  }

  const spec = LEVELS.find((l) => l.id === failed.id);
  const prior = results.filter((r) => r.id < failed.id && r.verdict === "rendered");

  return {
    headline: `LEVEL ${failed.id} IS THE FIRST FAILURE`,
    detail:
      prior.length === 0
        ? "Even the stock Mapbox style failed — the problem is the token, WebGL, or the network, not Atlas code."
        : `Levels 1–${failed.id - 1} rendered. The failure is introduced by: ${spec?.what ?? "this layer"}.`,
    action: failed.errorMessage ? `Last error: ${failed.errorMessage}` : null,
    tone: "#FF6B6B",
  };
}


/**
 * What the Command Center's scrims do to a measured map luminance.
 *
 * The canvas sample cannot see DOM overlays, so the composite is computed:
 * measured canvas luminance × (1 − scrim alpha) at the worst point on screen.
 * `worstDelta` is the motorway-to-ground separation that survives there.
 */
function compositeReport(meanCanvasLuma: number): {
  peakAlpha: number;
  clearFraction: number;
  worstDelta: number;
  bestDelta: number;
} {
  const viewport = 852; // iPhone-class viewport, the primary target.
  const peakAlpha = peakScrimAlpha(viewport);
  const ground = luma("#05050A");
  const motorway = luma("#7C7C91");

  return {
    peakAlpha,
    clearFraction: clearBandFraction(viewport),
    worstDelta: afterScrim(motorway, peakAlpha) - afterScrim(ground, peakAlpha),
    bestDelta: motorway - ground,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `predicate` until true or the timeout elapses. Never rejects. */
function waitFor(predicate: () => boolean, timeout: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (predicate() || Date.now() - started > timeout) {
        resolve();
        return;
      }
      setTimeout(tick, 150);
    };
    tick();
  });
}
