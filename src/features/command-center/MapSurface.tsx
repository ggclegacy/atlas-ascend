"use client";

/**
 * Mapbox GL's stylesheet is imported statically, at the top of the one client
 * component that owns the map.
 *
 * An earlier version loaded it via a dynamic `import()` alongside the SDK to
 * keep ~40KB out of the initial payload. That mechanism was verified to work —
 * Turbopack emits a CSS chunk and a loader stub — but it depends on bundler
 * internals that are not part of any public contract, and this project has
 * already lost several passes to ambiguity about whether the deployed build
 * matched intent. Determinism outranks 40KB: a static import is the documented,
 * boring path that every Next.js version handles identically.
 */
import "mapbox-gl/dist/mapbox-gl.css";

import { useEffect, useRef, useState } from "react";
import { MapboxMapProvider, describeReason } from "@/map/mapbox/MapboxMapProvider";
import {
  type MapHandle,
  MapUnavailableError,
  type MapUnavailableReason,
} from "@/map/provider";
import type { MapConfiguration } from "@/map/types";
import { guidanceFor } from "@/map/guidance";
import { hydrateRoute } from "@/routing/wire";
import {
  getLastError,
  isMapDebugRequested,
  type RecordedError,
} from "@/map/mapbox/diagnostics";
import { WarningIcon } from "@/components/atlas/icons";
import { Eyebrow } from "@/components/atlas/primitives";
import { MapDiagnosticsOverlay } from "./MapDiagnosticsOverlay";

/**
 * Geometry for the element Mapbox mounts into — declared inline, deliberately.
 *
 * THIS MUST NOT BECOME A CLASS. Mapbox GL adds `.mapboxgl-map` to whatever
 * element it is given, and `mapbox-gl.css` declares
 * `.mapboxgl-map { position: relative }`. That is the same specificity as
 * Tailwind's `.absolute`, and the vendor stylesheet loads after ours — so the
 * class form loses the cascade, the container silently stops being absolutely
 * positioned, `top:0/bottom:0` decay into inert offsets, and its height
 * resolves to `auto` = **0**. Mapbox then computes a zero-area viewport,
 * requests no tiles at all, and paints nothing. The application renders a
 * perfect black rectangle with no error, no failed request, and a token that
 * is entirely fine.
 *
 * An inline style cannot be overridden by any stylesheet, which makes the
 * geometry independent of bundler CSS ordering — the one thing here that is
 * not a documented contract. `/debug/mapbox` has always done exactly this, and
 * that is the sole reason the harness rendered geography while the product did
 * not: it was never testing the same container.
 */
export const MAP_CONTAINER_STYLE = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
} as const;

/**
 * The map surface — the environmental canvas the whole product sits on.
 *
 * Owns the provider lifecycle and, critically, the honest failure states. A
 * missing token produces a designed, explanatory surface rather than a blank
 * grey canvas or a console error, because "the map is broken" and "the map is
 * not configured yet" are different facts the user deserves to distinguish.
 */
export function MapSurface({
  configuration,
  onReady,
  onUserInteraction,
}: {
  configuration: MapConfiguration;
  onReady: (handle: MapHandle) => void;
  onUserInteraction: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<MapHandle | null>(null);
  const startedRef = useRef(false);
  const [status, setStatus] = useState<"mounting" | "ready" | "blocked">("mounting");
  const [reason, setReason] = useState<MapUnavailableReason | null>(null);
  const [slow, setSlow] = useState(false);
  // Mirrors the handle into state purely so the diagnostics overlay re-renders
  // once a map exists; the ref remains the source of truth for commands.
  const [debugHandle, setDebugHandle] = useState<MapHandle | null>(null);
  const [debug, setDebug] = useState(false);

  // Read after mount — `location` is unavailable during server rendering.
  useEffect(() => setDebug(isMapDebugRequested()), []);

  /**
   * Diagnostic bridge, `?atlasdebug=map` only.
   *
   * Publishes the live map handle and the route hydrator so the map can be
   * driven from the console, or from an automated browser, against the real
   * Command Center rather than a harness that only resembles it. That
   * distinction is not theoretical here: `/debug/mapbox` mounted its map into
   * an inline-styled container and rendered geography perfectly for days while
   * the product showed a black rectangle, because it was never testing the
   * same element.
   *
   * Gated, never present in a normal session, and read-only from the app's
   * point of view — nothing in the product reads these.
   */
  useEffect(() => {
    if (!debug || debugHandle === null) return;
    const bridge = window as unknown as Record<string, unknown>;
    bridge["__atlasMap"] = debugHandle;
    bridge["__atlasHydrateRoute"] = hydrateRoute;
    return () => {
      delete bridge["__atlasMap"];
      delete bridge["__atlasHydrateRoute"];
    };
  }, [debug, debugHandle]);

  // Mount once. The configuration is passed as the initial camera only —
  // subsequent camera changes go through the imperative handle, because
  // re-rendering a map on every state change drops frames and fights the
  // SDK's own animation system.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Idempotence guard. React Strict Mode invokes effects twice in
    // development, and a second `mount()` would construct a second WebGL
    // context — browsers cap those, so the duplicate can cause the *real*
    // map to fail to acquire one.
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    const provider = new MapboxMapProvider();

    const blocked = provider.checkAvailability();
    if (blocked !== null) {
      setStatus("blocked");
      setReason(blocked);
      return;
    }

    provider
      .mount(container, configuration)
      .then((handle) => {
        if (cancelled) {
          handle.destroy();
          return;
        }
        handleRef.current = handle;
        setDebugHandle(handle);

        handle.on("ready", () => {
          if (!cancelled) setStatus("ready");
        });
        handle.on("userInteraction", onUserInteraction);
        handle.on("error", (error) => {
          if (cancelled) return;
          setStatus("blocked");
          setReason(error.reason);
        });

        onReady(handle);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus("blocked");
        setReason(
          error instanceof MapUnavailableError ? error.reason : "unknown",
        );
      });

    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
      startedRef.current = false;
    };
    // Deliberately mount-once. See comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If loading runs long, say so. The map has a hard watchdog behind it, but
  // six seconds of unexplained darkness is its own small failure.
  useEffect(() => {
    if (status !== "mounting") return;
    const timer = window.setTimeout(() => setSlow(true), 6_000);
    return () => window.clearTimeout(timer);
  }, [status]);

  // Mobile browser chrome collapsing changes the visual viewport without
  // firing a normal resize in every browser. visualViewport is the reliable
  // signal on iOS Safari specifically.
  useEffect(() => {
    const resize = () => handleRef.current?.resize();
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        style={MAP_CONTAINER_STYLE}
        // The map is decorative to a screen reader; all meaningful state is
        // exposed through the chrome above it.
        aria-hidden="true"
      />

      {status === "blocked" && reason !== null && (
        <MapBlocked reason={reason} />
      )}

      {status === "mounting" && <MapLoading slow={slow} />}

      {debug && (
        <MapDiagnosticsOverlay
          handle={debugHandle}
          status={status}
          reason={reason}
          containerRef={containerRef}
        />
      )}
    </div>
  );
}

/**
 * Shown while the map SDK loads.
 *
 * Deliberately quiet: an obsidian field with a single sweeping gold hairline.
 * A spinner would be louder and say less.
 */
function MapLoading({ slow }: { slow: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 bg-obsidian">
      <div
        className="absolute inset-x-0 top-1/2 h-px overflow-hidden"
        aria-label="Loading map"
        role="status"
      >
        <div
          className="atlas-gold-metal-h h-px w-1/3"
          style={{ animation: "atlas-sweep 1.6s cubic-bezier(0.32,0.72,0.16,1) infinite" }}
        />
      </div>

      {slow && (
        <p className="atlas-label absolute inset-x-0 top-[calc(50%+18px)] text-center text-ink-3">
          Still loading the map…
        </p>
      )}
    </div>
  );
}

/**
 * The map cannot run. This is a designed state, not an error page — the user
 * is told exactly what is missing and what happens next.
 */
function MapBlocked({ reason }: { reason: MapUnavailableReason }) {
  const guidance = guidanceFor(reason);

  return (
    <div className="absolute inset-0 grid place-items-center bg-obsidian px-8">
      {/* Faint violet horizon, carried over from the original Swift
          placeholder. Keeps the blocked state inside the Atlas world. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/3 h-56"
        style={{
          background:
            "linear-gradient(180deg, transparent, rgba(100,55,224,0.18) 50%, transparent)",
        }}
      />

      <div className="relative flex max-w-xs flex-col items-center gap-4 text-center">
        <span className="grid size-11 place-items-center rounded-full border border-caution/25 bg-caution/10 text-caution">
          <WarningIcon size={18} />
        </span>
        <Eyebrow tone="caution" tick={false}>
          Map unavailable
        </Eyebrow>
        <p className="atlas-body text-ink-2">{describeReason(reason)}</p>
        {guidance && <p className="atlas-label text-ink-3">{guidance}</p>}

        {/* The observation, printed next to the interpretation. Whoever reads
            this screen can then check the conclusion against the evidence
            rather than taking it on trust — which is the whole remedy for a
            failure state that once named the wrong cause with total
            confidence. */}
        <Evidence />

        {/* For a rejected token, the single most useful fact is the hostname
            that needs allowing. Printing it removes a guessing step — preview
            deployments in particular have hostnames nobody predicts. */}
        {SHOWS_HOSTNAME.has(reason) && <Hostname />}
      </div>
    </div>
  );
}

/**
 * The raw failure evidence: what Mapbox was asked for, and what it answered.
 *
 * Credential-free by construction — `recordError` stores only a redacted URL —
 * so this is safe to screenshot and paste into a bug report.
 */
function Evidence() {
  const [error, setError] = useState<RecordedError | null>(null);

  // Read after mount, and once more shortly after: the auth-failure body probe
  // resolves a beat behind the error that triggered it.
  useEffect(() => {
    setError(getLastError());
    const timer = window.setTimeout(() => setError(getLastError()), 3_000);
    return () => window.clearTimeout(timer);
  }, []);

  if (error === null || error.status === null) return null;

  return (
    <span className="atlas-selectable atlas-readout-sm max-w-full rounded-lg border border-white/8 bg-raised px-3 py-1.5 text-ink-3">
      HTTP {error.status} · {error.kind}
      {error.resource ? ` · ${error.resource}` : ""}
      {error.body ? ` · Mapbox: “${error.body}”` : ""}
    </span>
  );
}

/** The current hostname, rendered selectably so it can be copied. */
function Hostname() {
  const [host, setHost] = useState<string | null>(null);

  // Read after mount — `location` does not exist during server rendering, and
  // reading it in render would produce a hydration mismatch.
  useEffect(() => setHost(window.location.hostname), []);

  if (host === null) return null;

  return (
    <span className="atlas-selectable atlas-readout-sm rounded-lg border border-white/8 bg-raised px-3 py-1.5 text-gold">
      {host}
    </span>
  );
}

/**
 * Failures where naming the current hostname is the useful next step —
 * i.e. anything that could be a URL restriction on the token.
 */
const SHOWS_HOSTNAME: ReadonlySet<MapUnavailableReason> = new Set([
  "forbidden",
  "invalid-token",
]);
