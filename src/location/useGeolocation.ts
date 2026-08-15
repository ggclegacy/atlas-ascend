"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  live,
  type Reading,
  unavailable,
  type UnavailableReason,
} from "@/lib/provenance";
import type { Coordinate } from "@/map/types";

/**
 * BROWSER GEOLOCATION — honest state machine.
 *
 * Every state a real permission flow can be in is represented explicitly.
 * Nothing here ever invents a position, a speed, or a heading.
 *
 * Notes on real browser behavior, which is less uniform than the spec suggests:
 *
 * - `speed` and `heading` are `null` on most devices unless the user is
 *   actually moving, and are frequently `null` forever on desktop. They are
 *   therefore modeled as independently-unavailable readings, not as numbers.
 * - Safari on iOS does not support `navigator.permissions.query({name:
 *   "geolocation"})`, so permission state cannot be read ahead of time there.
 *   The flow is built to work without it and to use it only as an enhancement.
 * - Geolocation requires a secure context. On plain HTTP (other than
 *   localhost) it fails immediately, which is surfaced as `unsupported`.
 */

export type LocationPermission =
  | "unknown"
  | "prompt"
  | "granted"
  | "denied"
  | "unsupported";

export interface LocationFix {
  readonly coordinate: Coordinate;
  /** Horizontal accuracy in meters. */
  readonly accuracy: number;
  readonly timestamp: number;
}

export interface GeolocationState {
  readonly permission: LocationPermission;
  /** True while a fix is being acquired. */
  readonly acquiring: boolean;
  readonly fix: Reading<LocationFix>;
  /** Speed in meters per second. Independently unavailable — usually is. */
  readonly speed: Reading<number>;
  /** Heading in degrees from true north. Independently unavailable. */
  readonly heading: Reading<number>;
  /** True once the user has been asked at least once this session. */
  readonly requested: boolean;
}

export interface GeolocationControls extends GeolocationState {
  /** Ask for permission and begin watching. Safe to call repeatedly. */
  request: () => void;
  /** Stop watching and release the sensor. */
  stop: () => void;
}

const INITIAL: GeolocationState = {
  permission: "unknown",
  acquiring: false,
  fix: unavailable("not-requested"),
  speed: unavailable("not-requested"),
  heading: unavailable("not-requested"),
  requested: false,
};

export function useGeolocation(): GeolocationControls {
  const [state, setState] = useState<GeolocationState>(INITIAL);
  const watchId = useRef<number | null>(null);

  // Probe permission state where supported, purely as an enhancement so the
  // UI can show "denied" without forcing a prompt first. Safari will simply
  // not resolve this path.
  useEffect(() => {
    if (typeof navigator === "undefined") return;

    if (!("geolocation" in navigator)) {
      setState((s) => ({
        ...s,
        permission: "unsupported",
        fix: unavailable("unsupported"),
        speed: unavailable("unsupported"),
        heading: unavailable("unsupported"),
      }));
      return;
    }

    // Secure-context requirement. localhost is exempt.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setState((s) => ({
        ...s,
        permission: "unsupported",
        fix: unavailable("unsupported", "Requires a secure (HTTPS) connection"),
      }));
      return;
    }

    let cancelled = false;
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "geolocation" as PermissionName })
        .then((status) => {
          if (cancelled) return;
          const apply = () => {
            setState((s) => ({
              ...s,
              permission: status.state as LocationPermission,
              fix:
                status.state === "denied"
                  ? unavailable<LocationFix>("permission-denied")
                  : s.fix,
            }));
          };
          apply();
          status.addEventListener("change", apply);
        })
        .catch(() => {
          // Unsupported query — remain "unknown" and let the request flow
          // establish the truth.
        });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const stop = useCallback(() => {
    if (watchId.current !== null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setState((s) => ({ ...s, acquiring: false }));
  }, []);

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setState((s) => ({ ...s, permission: "unsupported" }));
      return;
    }
    if (watchId.current !== null) return; // Already watching.

    setState((s) => ({
      ...s,
      requested: true,
      acquiring: true,
      fix: unavailable("acquiring"),
    }));

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const { coords, timestamp } = position;

        setState((s) => ({
          ...s,
          permission: "granted",
          acquiring: false,
          fix: live<LocationFix>(
            {
              coordinate: {
                latitude: coords.latitude,
                longitude: coords.longitude,
              },
              accuracy: coords.accuracy,
              timestamp,
            },
            timestamp,
          ),
          // `speed`/`heading` are null far more often than not. Modeling them
          // as unavailable rather than 0 is the whole point — a speedometer
          // reading zero while moving is worse than one admitting it does
          // not know.
          speed:
            typeof coords.speed === "number" && Number.isFinite(coords.speed)
              ? live(coords.speed, timestamp)
              : unavailable("position-unavailable"),
          heading:
            typeof coords.heading === "number" && Number.isFinite(coords.heading)
              ? live(coords.heading, timestamp)
              : unavailable("position-unavailable"),
        }));
      },
      (error) => {
        const reason = mapError(error);
        setState((s) => ({
          ...s,
          acquiring: false,
          permission: reason === "permission-denied" ? "denied" : s.permission,
          fix: unavailable(reason, error.message),
          speed: unavailable(reason),
          heading: unavailable(reason),
        }));
        if (watchId.current !== null) {
          navigator.geolocation.clearWatch(watchId.current);
          watchId.current = null;
        }
      },
      {
        enableHighAccuracy: true,
        // A long-lived watch should not error out on a brief tunnel; 20s is
        // generous enough to survive one while still failing eventually.
        timeout: 20_000,
        maximumAge: 2_000,
      },
    );
  }, []);

  // Release the sensor on unmount — an orphaned watch drains battery.
  useEffect(() => stop, [stop]);

  return { ...state, request, stop };
}

function mapError(error: GeolocationPositionError): UnavailableReason {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "permission-denied";
    case error.POSITION_UNAVAILABLE:
      return "position-unavailable";
    case error.TIMEOUT:
      return "timeout";
    default:
      return "error";
  }
}
