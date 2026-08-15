"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  EM_DASH,
  formatReading,
  isAvailable,
  type Reading,
  reasonLabel,
} from "@/lib/provenance";

/**
 * Design-system primitives.
 *
 * Ported from the Swift foundation's `AtlasDesign` components. These exist so
 * feature code never hand-rolls a control — that is what keeps tracking,
 * casing, tap targets, and press feedback uniform across the product.
 */

// ---------------------------------------------------------------------------
// Eyebrow — the cockpit legend
// ---------------------------------------------------------------------------

/**
 * Small, uppercase, widely-tracked label preceded by a short gold tick.
 *
 * The tick is what turns a label into instrumentation — it reads as an index
 * mark on a gauge rather than as text sitting on a page.
 */
export function Eyebrow({
  children,
  tick = true,
  tone = "muted",
  className = "",
}: {
  children: ReactNode;
  tick?: boolean;
  tone?: "muted" | "caution" | "gold";
  className?: string;
}) {
  const color =
    tone === "caution"
      ? "text-caution"
      : tone === "gold"
        ? "text-gold"
        : "text-ink-3";

  return (
    <span className={`atlas-eyebrow flex items-center gap-2 ${color} ${className}`}>
      {tick && (
        <span
          aria-hidden="true"
          className="atlas-gold-metal-h h-px w-3 shrink-0"
        />
      )}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Metric — telemetry readout driven by a Reading
// ---------------------------------------------------------------------------

/**
 * A telemetry value with its legend and unit.
 *
 * Takes a `Reading<T>` rather than a raw value, which is what makes the
 * em-dash rule structural: there is no way to render this component with a
 * fabricated number, because an unavailable reading carries no number to
 * render. The legend switches to the reason the value is missing.
 */
export function Metric<T>({
  label,
  reading,
  format,
  unit,
  size = "medium",
}: {
  label: string;
  reading: Reading<T>;
  format: (value: T) => string;
  unit?: string;
  size?: "large" | "medium" | "small";
}) {
  const available = isAvailable(reading);
  const text = formatReading(reading, format);

  const valueClass =
    size === "large"
      ? "atlas-telemetry"
      : size === "medium"
        ? "atlas-readout"
        : "atlas-readout-sm";

  // When a value is missing, the legend explains why rather than repeating
  // the metric's name — "No signal" is more useful than "Speed" beside a dash.
  const legend = available ? label : reasonLabel(reading.reason);

  return (
    <div className="flex flex-col gap-1.5">
      <Eyebrow tick={size === "large"} tone={available ? "muted" : "caution"}>
        {legend}
      </Eyebrow>
      <div className="flex items-baseline gap-1">
        <span
          className={`${valueClass} ${available ? "text-ink" : "text-ink-3"}`}
        >
          {text}
        </span>
        {unit && text !== EM_DASH && (
          <span className="atlas-label text-ink-3">{unit}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

type ButtonBase = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;

/**
 * Square glass icon button. Always a 44pt tap target regardless of icon size —
 * non-negotiable, and doubly so in a product used while driving.
 *
 * `active` is one of the few places ordinary chrome earns violet: an engaged
 * control is live system state, which is what the accent is reserved for.
 */
export function IconButton({
  icon,
  label,
  active = false,
  disabled = false,
  ...props
}: ButtonBase & {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={[
        "atlas-glass grid size-11 shrink-0 place-items-center rounded-[14px]",
        "transition-all duration-200 active:scale-[0.96]",
        active ? "text-violet-halo" : "text-ink-2",
        active ? "atlas-edge-violet" : "",
        disabled ? "opacity-35" : "",
      ].join(" ")}
      {...props}
    >
      {icon}
    </button>
  );
}

/**
 * Compact rounded control: icon plus label, optionally with a trailing value.
 *
 * `accented` applies the gold edge. At most one per cluster — the accent stops
 * meaning anything the moment it is applied to everything.
 */
export function Pill({
  icon,
  title,
  detail,
  accented = false,
  disabled = false,
  ...props
}: ButtonBase & {
  icon?: ReactNode;
  title: string;
  detail?: string;
  accented?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={detail ? `${title}, ${detail}` : title}
      className={[
        "flex h-[38px] shrink-0 items-center gap-2 rounded-[19px] px-4",
        "transition-all duration-200 active:scale-[0.97]",
        accented ? "atlas-edge-gold" : "atlas-glass",
        disabled ? "opacity-40" : "",
      ].join(" ")}
      {...props}
    >
      {icon && (
        <span className={accented ? "text-gold" : "text-ink-2"}>{icon}</span>
      )}
      <span className="atlas-callout whitespace-nowrap text-ink">{title}</span>
      {detail && (
        <span className="atlas-readout-sm whitespace-nowrap text-ink-3">
          {detail}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Live indicator
// ---------------------------------------------------------------------------

/**
 * A breathing dot for live state.
 *
 * The halo animates, the core does not. Animating both reads as a throbbing
 * alert; animating only the halo reads as a steady signal with presence.
 */
export function LiveDot({
  tone = "positive",
  live = true,
}: {
  tone?: "positive" | "caution" | "violet";
  live?: boolean;
}) {
  const color =
    tone === "caution"
      ? "var(--color-caution)"
      : tone === "violet"
        ? "var(--color-violet-electric)"
        : "var(--color-positive)";

  return (
    <span
      aria-hidden="true"
      className="relative grid size-4 place-items-center"
    >
      {live && (
        <span
          className="absolute size-4 rounded-full"
          style={{
            backgroundColor: color,
            opacity: 0.28,
            animation: "atlas-breathe 2.6s ease-in-out infinite alternate",
          }}
        />
      )}
      <span
        className="relative size-1.5 rounded-full"
        style={{ backgroundColor: live ? color : "var(--color-ink-4)" }}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Honesty badge
// ---------------------------------------------------------------------------

/**
 * Renders what on this screen is not real.
 *
 * Required by the product-integrity rule: staged data is fine during
 * development, silently staged data is not. Renders nothing at all once every
 * note clears, so it removes itself as capabilities come online.
 */
export function SimulationBadge({ notes }: { notes: readonly string[] }) {
  if (notes.length === 0) return null;

  return (
    <div
      className="flex items-center gap-2 self-start rounded-full border border-caution/30 bg-obsidian/65 px-3 py-1.5"
      role="status"
      aria-label={`Development build. ${notes.join(", ")}`}
    >
      <svg
        width="9"
        height="9"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="shrink-0 text-caution"
        aria-hidden="true"
      >
        <path d="M12 2L1 21h22L12 2zm0 6l7 12H5l7-12zm-1 3v4h2v-4h-2zm0 5v2h2v-2h-2z" />
      </svg>
      <span className="atlas-eyebrow text-caution/90">{notes.join(" · ")}</span>
    </div>
  );
}
