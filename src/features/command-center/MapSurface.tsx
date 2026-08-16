"use client";

import { useEffect, useRef, useState } from "react";
import { MapboxMapProvider, describeReason } from "@/map/mapbox/MapboxMapProvider";
import {
  type MapHandle,
  MapUnavailableError,
  type MapUnavailableReason,
} from "@/map/provider";
import type { MapConfiguration } from "@/map/types";
import { isMapDebugRequested } from "@/map/mapbox/diagnostics";
import { WarningIcon } from "@/components/atlas/icons";
import { Eyebrow } from "@/components/atlas/primitives";
import { MapDiagnosticsOverlay } from "./MapDiagnosticsOverlay";

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
          error instanceof MapUnavailableError ? error.reason : "load-failed",
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
        className="absolute inset-0"
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

        {/* For a rejected token, the single most useful fact is the hostname
            that needs allowing. Printing it removes a guessing step — preview
            deployments in particular have hostnames nobody predicts. */}
        {reason === "unauthorized" && <Hostname />}
      </div>
    </div>
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
 * Recovery guidance.
 *
 * Written for whoever is actually looking at the screen — which during setup is
 * the operator, not an end user. Never a stack trace, always a next action.
 */
function guidanceFor(reason: MapUnavailableReason): string | null {
  switch (reason) {
    case "no-token":
      return "Set NEXT_PUBLIC_MAPBOX_TOKEN in your environment and redeploy.";
    case "unauthorized":
      // The overwhelmingly common cause of a 401/403 when a token IS present:
      // the token's URL restrictions do not list this hostname.
      return "The token is present but Mapbox refused it for this domain. Add this site's hostname to the token's URL restrictions.";
    case "webgl-unsupported":
      return "Atlas Ascend needs WebGL to render the map.";
    case "load-failed":
      return "Reload to try again.";
    case "network":
      return "Reconnect to load map tiles.";
    case "timeout":
      return "The map service did not respond. Reload to try again.";
  }
}
