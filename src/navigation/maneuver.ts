import type {
  AtlasManeuver,
  AtlasManeuverDirection,
  AtlasRouteStep,
} from "@/routing/types";

/**
 * MANEUVER PRESENTATION.
 *
 * Turns an `AtlasRouteStep` into the words and the icon a driver reads at
 * speed. Pure, because every one of these decisions is a judgement about
 * legibility that should be arguable in a test rather than discovered on a
 * motorway.
 *
 * Nothing here invents language. The provider's own instruction and banner
 * text are used where they exist — they are phrased, unit-aware and
 * pronunciation-aware in a way a template over raw fields is not — and Atlas
 * only supplies structure and fallbacks.
 */

export type ManeuverIconKey =
  | "depart"
  | "arrive"
  | "straight"
  | "left"
  | "right"
  | "slight-left"
  | "slight-right"
  | "sharp-left"
  | "sharp-right"
  | "u-turn"
  | "merge-left"
  | "merge-right"
  | "fork-left"
  | "fork-right"
  | "ramp-left"
  | "ramp-right"
  | "roundabout"
  | "unknown";

const LEFTISH: ReadonlySet<AtlasManeuverDirection> = new Set([
  "left",
  "slight-left",
  "sharp-left",
]);

/**
 * The icon for a maneuver.
 *
 * Every kind mapped in Sub-phase 1 resolves to something drawable. `unknown`
 * is a real outcome rather than a crash: an unrecognised maneuver still has a
 * road name, a distance and the provider's own instruction, so the card stays
 * useful and only the arrow is generic.
 */
export function maneuverIcon(maneuver: AtlasManeuver): ManeuverIconKey {
  const left = maneuver.direction !== null && LEFTISH.has(maneuver.direction);

  switch (maneuver.kind) {
    case "depart":
      return "depart";
    case "arrive":
      return "arrive";
    case "u-turn":
      return "u-turn";
    case "roundabout":
    case "roundabout-exit":
      return "roundabout";
    case "merge":
      return left ? "merge-left" : "merge-right";
    case "fork":
      return left ? "fork-left" : "fork-right";
    case "on-ramp":
    case "off-ramp":
      return left ? "ramp-left" : "ramp-right";
    case "continue":
      return directionIcon(maneuver.direction) ?? "straight";
    case "turn":
      return directionIcon(maneuver.direction) ?? "straight";
    case "unknown":
      return "unknown";
  }
}

function directionIcon(
  direction: AtlasManeuverDirection | null,
): ManeuverIconKey | null {
  switch (direction) {
    case "left":
      return "left";
    case "right":
      return "right";
    case "slight-left":
      return "slight-left";
    case "slight-right":
      return "slight-right";
    case "sharp-left":
      return "sharp-left";
    case "sharp-right":
      return "sharp-right";
    case "u-turn":
      return "u-turn";
    case "straight":
      return "straight";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

const FEET_PER_METER = 3.28084;
const METERS_PER_MILE = 1609.344;

/**
 * Distance to the maneuver, at the precision a driver can act on.
 *
 * Feet close in, because "0.03 mi" is not a thing anyone can judge from a
 * driving seat, and rounded hard — a number that changes every fix is harder
 * to read than one that changes every few seconds, and the extra digits carry
 * no information a driver can use.
 */
export function formatManeuverDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "—";

  const feet = meters * FEET_PER_METER;
  if (feet < 100) return "Now";
  if (feet < 1_000) return `${Math.round(feet / 50) * 50} ft`;

  const miles = meters / METERS_PER_MILE;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

/**
 * True when the maneuver is close enough to be imminent.
 *
 * Drives emphasis in the UI. 100m is roughly the last four seconds at city
 * speed — the point at which the driver should already be in the right lane.
 */
export function isManeuverImminent(meters: number): boolean {
  return Number.isFinite(meters) && meters <= 100;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export interface ManeuverPresentation {
  readonly icon: ManeuverIconKey;
  /** The distance, already formatted. */
  readonly distance: string;
  readonly imminent: boolean;
  /** The road being turned onto, or the instruction. Never invented. */
  readonly primary: string;
  /** Signage or road number, when the provider supplied it. */
  readonly secondary: string | null;
  /** Motorway exit, e.g. "Exit 240B". */
  readonly exit: string | null;
  /** Roundabout exit, e.g. "3rd exit". */
  readonly roundaboutExit: string | null;
}

/**
 * Everything the maneuver card shows.
 *
 * `step` is the step being driven; its maneuver happens at its END, and its
 * banner describes that maneuver — the convention established from real
 * Mapbox responses in Sub-phase 1. `next` is the step that follows, used only
 * for the maneuver's own geometry when the banner is absent.
 */
export function presentManeuver(
  step: AtlasRouteStep,
  next: AtlasRouteStep | null,
  distanceToManeuverMeters: number,
): ManeuverPresentation {
  const maneuver = next?.maneuver ?? step.maneuver;
  const banner = step.banner[0] ?? null;

  // The provider's banner is preferred over anything assembled here: it is
  // written for a windscreen, not derived from fields.
  const primary =
    banner?.primary ?? next?.roadName ?? next?.instruction ?? step.instruction ?? "Continue";

  const secondary = banner?.secondary ?? next?.towards ?? next?.roadRef ?? null;

  return {
    icon: maneuverIcon(maneuver),
    distance: formatManeuverDistance(distanceToManeuverMeters),
    imminent: isManeuverImminent(distanceToManeuverMeters),
    primary,
    secondary,
    exit: maneuver.exitNumber ? `Exit ${maneuver.exitNumber}` : null,
    roundaboutExit:
      maneuver.roundaboutExit !== null && maneuver.roundaboutExit > 0
        ? `${ordinal(maneuver.roundaboutExit)} exit`
        : null,
  };
}

/**
 * The maneuver after the next one — the "then" line.
 *
 * Suppressed when it would say nothing new. Observed on a real route:
 * "0.3 mi · Barton Springs Road / THEN Barton Springs Road", because the step
 * after the turn is still on the road you just turned onto. A driver reading
 * that at speed learns nothing and has to work out why it is there.
 *
 * `primary` is what the card already says, so the comparison can be made here
 * rather than duplicated at the call site.
 */
export function presentFollowing(
  afterNext: AtlasRouteStep | null,
  primary?: string,
): { icon: ManeuverIconKey; text: string } | null {
  if (afterNext === null) return null;

  const arriving = afterNext.maneuver.kind === "arrive";
  const text = arriving
    ? "Arrive"
    : (afterNext.roadName ?? afterNext.instruction ?? "");

  if (text.trim().length === 0) return null;
  // Repeating the line above it is worse than omitting it.
  if (primary !== undefined && text.trim() === primary.trim()) return null;

  return { icon: maneuverIcon(afterNext.maneuver), text };
}

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : n % 10 === 1
        ? "st"
        : n % 10 === 2
          ? "nd"
          : n % 10 === 3
            ? "rd"
            : "th";
  return `${n}${suffix}`;
}
