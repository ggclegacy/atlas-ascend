/**
 * SCREEN WAKE LOCK.
 *
 * The single most important mitigation for the biggest limitation of
 * navigating on the mobile web: when the screen locks, the page is suspended,
 * `watchPosition` stops, and navigation simply ends. Holding the screen awake
 * is what makes a web navigation session survive a drive at all.
 *
 * It is an enhancement, never a dependency. Safari gained it in 16.4, older
 * devices do not have it, and it can be revoked by the system at any time —
 * on low battery, for instance. Navigation must work identically without it;
 * the only difference is whose job it is to keep the screen on.
 *
 * Re-acquisition on visibility change is not optional: the lock is released
 * automatically whenever the page is hidden, so without it the first glance at
 * a notification permanently ends the protection.
 */

export type WakeLockStatus =
  /** Never attempted. */
  | "idle"
  /** No `navigator.wakeLock` on this browser. */
  | "unsupported"
  /** Held right now. */
  | "active"
  /** Attempted and refused, or lost and not yet regained. */
  | "unavailable"
  /** Deliberately released. */
  | "released";

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

export interface WakeLockController {
  readonly status: () => WakeLockStatus;
  /** Acquire, and keep re-acquiring across visibility changes. */
  acquire(): Promise<WakeLockStatus>;
  release(): Promise<void>;
}

export function isWakeLockSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "wakeLock" in navigator &&
    typeof (navigator as { wakeLock?: unknown }).wakeLock === "object"
  );
}

/**
 * Creates a controller that holds the screen awake for the duration of a
 * navigation session.
 *
 * `onChange` fires on every transition so a diagnostic can report the truth
 * rather than the intent — "requested" and "held" are different facts, and the
 * system can take the lock away without asking.
 */
export function createWakeLock(
  onChange?: (status: WakeLockStatus) => void,
): WakeLockController {
  let sentinel: WakeLockSentinelLike | null = null;
  let wanted = false;
  let status: WakeLockStatus = "idle";

  const set = (next: WakeLockStatus) => {
    if (status === next) return;
    status = next;
    onChange?.(next);
  };

  const request = async (): Promise<WakeLockStatus> => {
    if (!isWakeLockSupported()) {
      set("unsupported");
      return status;
    }
    if (sentinel !== null) return status;

    try {
      const api = (navigator as unknown as {
        wakeLock: { request(type: "screen"): Promise<WakeLockSentinelLike> };
      }).wakeLock;

      const next = await api.request("screen");
      sentinel = next;
      set("active");

      // The system can revoke it — low battery, or the page being hidden.
      next.addEventListener("release", () => {
        sentinel = null;
        // Only report a problem if it was still wanted; a deliberate release
        // is not a failure.
        if (wanted) set("unavailable");
      });
    } catch {
      // Refusal is normal and survivable. Navigation is unaffected.
      set("unavailable");
    }
    return status;
  };

  const onVisibility = () => {
    if (!wanted) return;
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      // The lock is dropped whenever the page hides. Without re-acquiring
      // here, one glance at a notification ends the protection for the rest
      // of the drive.
      void request();
    }
  };

  return {
    status: () => status,

    async acquire() {
      wanted = true;
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisibility);
      }
      return request();
    },

    async release() {
      wanted = false;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      const held = sentinel;
      sentinel = null;
      set("released");
      if (held) {
        try {
          await held.release();
        } catch {
          // Already gone. Nothing to do and nothing worth reporting.
        }
      }
    },
  };
}
