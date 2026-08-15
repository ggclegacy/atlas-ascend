"use client";

import { useEffect, useRef, useState } from "react";
import { MapboxMapProvider, describeReason } from "@/map/mapbox/MapboxMapProvider";
import {
  type MapHandle,
  MapUnavailableError,
  type MapUnavailableReason,
} from "@/map/provider";
import type { MapConfiguration } from "@/map/types";
import { WarningIcon } from "@/components/atlas/icons";
import { Eyebrow } from "@/components/atlas/primitives";

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
  const [status, setStatus] = useState<"mounting" | "ready" | "blocked">("mounting");
  const [reason, setReason] = useState<MapUnavailableReason | null>(null);

  // Mount once. The configuration is passed as the initial camera only —
  // subsequent camera changes go through the imperative handle, because
  // re-rendering a map on every state change drops frames and fights the
  // SDK's own animation system.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
    };
    // Deliberately mount-once. See comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      {status === "mounting" && <MapLoading />}
    </div>
  );
}

/**
 * Shown while the map SDK loads.
 *
 * Deliberately quiet: an obsidian field with a single sweeping gold hairline.
 * A spinner would be louder and say less.
 */
function MapLoading() {
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
      </div>
    </div>
  );
}

function guidanceFor(reason: MapUnavailableReason): string | null {
  switch (reason) {
    case "no-token":
      return "Set NEXT_PUBLIC_MAPBOX_TOKEN in your environment and redeploy.";
    case "webgl-unsupported":
      return "Atlas Ascend needs WebGL to render the map.";
    case "load-failed":
      return "Check the network connection and reload.";
    case "network":
      return "Reconnect to load map tiles.";
  }
}
