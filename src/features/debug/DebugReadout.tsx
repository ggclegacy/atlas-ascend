"use client";

import type { ReactNode } from "react";

/**
 * Diagnostic readout UI.
 *
 * Deliberately plain and high-contrast rather than styled to the Atlas system:
 * this is an instrument, it gets screenshotted and read at a glance, and on a
 * product whose whole palette is near-black, a diagnostic panel that blends in
 * would be self-defeating.
 */

export type Verdict = "ok" | "bad" | "warn" | "neutral";

const TONE: Record<Verdict, string> = {
  ok: "#3FB98A",
  bad: "#FF6B6B",
  warn: "#E0A64B",
  neutral: "#A5A2AC",
};

export function Row({
  label,
  value,
  verdict = "neutral",
}: {
  label: string;
  value: ReactNode;
  verdict?: Verdict;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "3px 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <span style={{ color: "#6B6874", flexShrink: 0 }}>{label}</span>
      <span
        style={{
          color: TONE[verdict],
          textAlign: "right",
          wordBreak: "break-all",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function yesNo(value: boolean): { text: string; verdict: Verdict } {
  return value ? { text: "yes", verdict: "ok" } : { text: "no", verdict: "bad" };
}

export function Panel({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.45,
        background: "rgba(8,8,11,0.94)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 10,
        padding: "10px 12px",
        color: "#F4F2ED",
        maxHeight: "70vh",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          fontSize: 9,
          color: "#C4912F",
        }}
      >
        <span>{title}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 4,
              color: "#A5A2AC",
              cursor: "pointer",
              fontSize: 9,
              padding: "2px 6px",
            }}
          >
            hide
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
