import type { ManeuverIconKey } from "@/navigation/maneuver";

/**
 * MANEUVER ICONS.
 *
 * Atlas-owned and geometric. Drawn as a single stroked path with a solid head,
 * so every arrow reads as the same object turning rather than as a set of
 * unrelated pictures — which is what makes a glance at 60mph resolve into
 * "left" instead of "some arrow".
 *
 * Deliberately not vendor icons: they carry another product's visual identity,
 * and this is the largest graphic on a driving screen.
 *
 * Conventions held across every icon:
 *   - the driver enters from the bottom centre, always
 *   - the stroke is uniform, so no direction reads as more urgent than another
 *   - `currentColor`, so the card owns the colour and can shift it to gold
 *     when a maneuver becomes imminent
 */

export function ManeuverIcon({
  icon,
  size = 44,
}: {
  icon: ManeuverIconKey;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      role="presentation"
    >
      {shapeFor(icon)}
    </svg>
  );
}

/** The arrow head, as a filled triangle pointing along `rotate` degrees. */
function Head({ x, y, rotate }: { x: number; y: number; rotate: number }) {
  return (
    <path
      d="M0,-7 L6.5,5 L-6.5,5 Z"
      fill="currentColor"
      stroke="none"
      transform={`translate(${x} ${y}) rotate(${rotate})`}
    />
  );
}

function shapeFor(icon: ManeuverIconKey) {
  switch (icon) {
    case "straight":
    case "depart":
      return (
        <>
          <path d="M24 42 V14" />
          <Head x={24} y={13} rotate={0} />
        </>
      );

    case "left":
      return (
        <>
          <path d="M24 42 V26 Q24 18 16 18 H12" />
          <Head x={11} y={18} rotate={-90} />
        </>
      );

    case "right":
      return (
        <>
          <path d="M24 42 V26 Q24 18 32 18 H36" />
          <Head x={37} y={18} rotate={90} />
        </>
      );

    case "slight-left":
      return (
        <>
          <path d="M24 42 V28 Q24 21 18 17 L15 15" />
          <Head x={14} y={14} rotate={-33} />
        </>
      );

    case "slight-right":
      return (
        <>
          <path d="M24 42 V28 Q24 21 30 17 L33 15" />
          <Head x={34} y={14} rotate={33} />
        </>
      );

    case "sharp-left":
      return (
        <>
          <path d="M24 42 V24 Q24 16 17 19 L14 21" />
          <Head x={13} y={22} rotate={-125} />
        </>
      );

    case "sharp-right":
      return (
        <>
          <path d="M24 42 V24 Q24 16 31 19 L34 21" />
          <Head x={35} y={22} rotate={125} />
        </>
      );

    case "u-turn":
      return (
        <>
          <path d="M30 42 V22 A7 7 0 0 0 16 22 V30" />
          <Head x={16} y={31} rotate={180} />
        </>
      );

    // Merging is a converging line joining the through-road, not a turn.
    case "merge-left":
      return (
        <>
          <path d="M30 42 V14" />
          <Head x={30} y={13} rotate={0} />
          <path d="M17 42 V32 Q17 24 25 20" strokeWidth={2.6} opacity={0.75} />
        </>
      );

    case "merge-right":
      return (
        <>
          <path d="M18 42 V14" />
          <Head x={18} y={13} rotate={0} />
          <path d="M31 42 V32 Q31 24 23 20" strokeWidth={2.6} opacity={0.75} />
        </>
      );

    // A fork shows both branches, with the taken one solid.
    case "fork-left":
      return (
        <>
          <path d="M24 42 V30" />
          <path d="M24 30 Q24 22 16 17 L14 16" />
          <Head x={13} y={15} rotate={-35} />
          <path d="M24 30 Q24 22 32 17" strokeWidth={2.4} opacity={0.45} />
        </>
      );

    case "fork-right":
      return (
        <>
          <path d="M24 42 V30" />
          <path d="M24 30 Q24 22 32 17 L34 16" />
          <Head x={35} y={15} rotate={35} />
          <path d="M24 30 Q24 22 16 17" strokeWidth={2.4} opacity={0.45} />
        </>
      );

    // A ramp departs from a road that carries on without you.
    case "ramp-left":
      return (
        <>
          <path d="M32 42 V12" strokeWidth={2.4} opacity={0.45} />
          <path d="M32 34 Q32 24 22 18 L19 16" />
          <Head x={18} y={15} rotate={-32} />
        </>
      );

    case "ramp-right":
      return (
        <>
          <path d="M16 42 V12" strokeWidth={2.4} opacity={0.45} />
          <path d="M16 34 Q16 24 26 18 L29 16" />
          <Head x={30} y={15} rotate={32} />
        </>
      );

    case "roundabout":
      return (
        <>
          <circle cx="24" cy="22" r="9" strokeWidth={3} />
          <path d="M24 42 V31" />
          <path d="M33 22 H40" />
          <Head x={41} y={22} rotate={90} />
        </>
      );

    case "arrive":
      return (
        <>
          <path d="M24 42 V22" />
          <circle cx="24" cy="15" r="6" fill="currentColor" stroke="none" />
          <circle cx="24" cy="15" r="2.4" fill="#05050A" stroke="none" />
        </>
      );

    // Honest fallback: an unrecognised maneuver still has a road name and a
    // distance, and a generic arrow is better than a wrong one.
    case "unknown":
      return (
        <>
          <path d="M24 42 V16" strokeDasharray="4 4" />
          <Head x={24} y={15} rotate={0} />
        </>
      );
  }
}
