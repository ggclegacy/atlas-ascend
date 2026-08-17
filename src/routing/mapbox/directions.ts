import type { Coordinate } from "@/map/types";
import { decodePolyline } from "../polyline";
import type { AtlasManeuverDirection, AtlasManeuverKind } from "../types";
import type { RouteWire, RouteWireLeg, RouteWireStep } from "../wire";

/**
 * MAPBOX DIRECTIONS → ATLAS.
 *
 * The only module permitted to know what a Mapbox Directions response looks
 * like. Everything above it speaks Atlas types. If a feature needs something
 * this mapper does not carry across, the fix is to widen the Atlas types and
 * map the field here — never to reach past this boundary.
 *
 * Nothing in here trusts the payload. Every value is checked before it is
 * used, and a response that does not satisfy the contract produces a
 * `malformed-response` failure rather than a route with `NaN` in it. A route
 * is a thing someone drives; a plausible-looking wrong one is worse than none.
 */

// ---------------------------------------------------------------------------
// The maneuver table
// ---------------------------------------------------------------------------

/**
 * Every maneuver type the Directions API documents, mapped to the Atlas
 * vocabulary. Written out in full rather than pattern-matched, because a
 * missed case here is a wrong arrow at a junction.
 *
 * `rotary` and `roundabout` are the same gesture to a driver — the distinction
 * is a road-classification one — so both land on `roundabout`, with the exit
 * number carried separately. `end of road` is a turn at a T-junction and keeps
 * its modifier. `notification` is not a maneuver at all: it marks a change in
 * road conditions with no action required, so it maps to `continue`.
 */
const MANEUVER_KINDS: Readonly<Record<string, AtlasManeuverKind>> = {
  turn: "turn",
  depart: "depart",
  arrive: "arrive",
  merge: "merge",
  "on ramp": "on-ramp",
  "off ramp": "off-ramp",
  fork: "fork",
  "end of road": "turn",
  continue: "continue",
  roundabout: "roundabout",
  rotary: "roundabout",
  "roundabout turn": "roundabout",
  "exit roundabout": "roundabout-exit",
  "exit rotary": "roundabout-exit",
  notification: "continue",
};

const MANEUVER_DIRECTIONS: Readonly<Record<string, AtlasManeuverDirection>> = {
  left: "left",
  right: "right",
  straight: "straight",
  uturn: "u-turn",
  "slight left": "slight-left",
  "slight right": "slight-right",
  "sharp left": "sharp-left",
  "sharp right": "sharp-right",
};

/**
 * Maps a provider maneuver onto the Atlas vocabulary.
 *
 * An unrecognised type becomes `"unknown"` rather than throwing. A maneuver
 * Atlas cannot name is still one the driver can perform: the step keeps its
 * road name, distance, and the provider's own instruction text, so the card
 * stays useful. Discarding the whole route over one unfamiliar string would
 * turn a cosmetic gap into a failed drive.
 *
 * Exported for testing.
 */
export function mapManeuverKind(
  type: unknown,
  modifier: unknown,
): AtlasManeuverKind {
  const kind = typeof type === "string" ? MANEUVER_KINDS[type] : undefined;
  if (kind === undefined) return "unknown";

  // A U-turn arrives as `turn`/`continue` plus a `uturn` modifier. It is a
  // different instruction to give and deserves its own kind.
  if ((kind === "turn" || kind === "continue") && modifier === "uturn") {
    return "u-turn";
  }
  return kind;
}

/** Exported for testing. */
export function mapManeuverDirection(
  modifier: unknown,
): AtlasManeuverDirection | null {
  if (typeof modifier !== "string") return null;
  return MANEUVER_DIRECTIONS[modifier] ?? null;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Thrown internally when the payload violates the contract. */
export class DirectionsShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectionsShapeError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireFiniteNumber(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DirectionsShapeError(`${what} is not a finite number`);
  }
  return value;
}

function optionalFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Trimmed string, or null for absent/blank. Blank strings are not names. */
function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Mapbox coordinates are `[longitude, latitude]` — the opposite of speech. */
function requireCoordinate(value: unknown, what: string): Coordinate {
  if (!Array.isArray(value) || value.length < 2) {
    throw new DirectionsShapeError(`${what} is not a coordinate pair`);
  }
  const longitude = requireFiniteNumber(value[0], `${what} longitude`);
  const latitude = requireFiniteNumber(value[1], `${what} latitude`);

  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new DirectionsShapeError(
      `${what} ${latitude},${longitude} is outside the possible range`,
    );
  }
  return { latitude, longitude };
}

// ---------------------------------------------------------------------------
// Guidance
// ---------------------------------------------------------------------------

function mapVoice(raw: unknown): RouteWireStep["voice"] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const text = optionalText(entry["announcement"]);
    const at = optionalFiniteNumber(entry["distanceAlongGeometry"]);
    if (text === null || at === null) return [];

    return [
      {
        // Mapbox's `distanceAlongGeometry` on a voice instruction is the
        // distance still to run in the step when it should be spoken — not
        // the distance already travelled. Reading it the other way announces
        // every turn at the wrong end of the step.
        atRemainingMeters: at,
        text,
        ssml: optionalText(entry["ssmlAnnouncement"]),
      },
    ];
  });
}

function mapBanner(raw: unknown): RouteWireStep["banner"] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const at = optionalFiniteNumber(entry["distanceAlongGeometry"]);
    const primaryBlock = entry["primary"];
    const primary = isRecord(primaryBlock)
      ? optionalText(primaryBlock["text"])
      : null;
    if (at === null || primary === null) return [];

    const secondaryBlock = entry["secondary"];
    const subBlock = entry["sub"];

    return [
      {
        atRemainingMeters: at,
        primary,
        secondary: isRecord(secondaryBlock)
          ? optionalText(secondaryBlock["text"])
          : null,
        detail: isRecord(subBlock) ? optionalText(subBlock["text"]) : null,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Steps, legs, routes
// ---------------------------------------------------------------------------

/**
 * Maps one step.
 *
 * `geometryStart` is supplied by the caller and `geometryEnd` derived from the
 * step's own geometry length, because the provider gives per-step geometry
 * separately from the route overview and the indices have to be reconstructed.
 */
function mapStep(
  raw: unknown,
  geometryStart: number,
): { step: RouteWireStep; vertexCount: number } {
  if (!isRecord(raw)) throw new DirectionsShapeError("step is not an object");

  const maneuverRaw = raw["maneuver"];
  if (!isRecord(maneuverRaw)) {
    throw new DirectionsShapeError("step has no maneuver");
  }

  const stepGeometry =
    typeof raw["geometry"] === "string"
      ? decodePolyline(raw["geometry"])
      : [];

  // Consecutive steps share their boundary vertex: a step's last point is the
  // next step's first. Counting naively would drift the indices by one per
  // step, and by the end of a long route the highlighted step would be
  // visibly wrong.
  const vertexCount = Math.max(0, stepGeometry.length - 1);

  const step: RouteWireStep = {
    maneuver: {
      kind: mapManeuverKind(maneuverRaw["type"], maneuverRaw["modifier"]),
      direction: mapManeuverDirection(maneuverRaw["modifier"]),
      coordinate: requireCoordinate(maneuverRaw["location"], "maneuver location"),
      bearingBefore: optionalFiniteNumber(maneuverRaw["bearing_before"]) ?? 0,
      bearingAfter: optionalFiniteNumber(maneuverRaw["bearing_after"]) ?? 0,
      roundaboutExit: optionalFiniteNumber(maneuverRaw["exit"]),
      exitNumber: optionalText(raw["exits"]),
    },
    roadName: optionalText(raw["name"]) ?? optionalText(raw["rotary_name"]),
    roadRef: optionalText(raw["ref"]),
    towards: optionalText(raw["destinations"]),
    distanceMeters: requireFiniteNumber(raw["distance"], "step distance"),
    durationSeconds: requireFiniteNumber(raw["duration"], "step duration"),
    voice: mapVoice(raw["voiceInstructions"]),
    banner: mapBanner(raw["bannerInstructions"]),
    geometryStart,
    geometryEnd: geometryStart + vertexCount,
    instruction: optionalText(maneuverRaw["instruction"]) ?? "",
  };

  return { step, vertexCount };
}

function mapLeg(raw: unknown, geometryStart: number): {
  leg: RouteWireLeg;
  vertexCount: number;
} {
  if (!isRecord(raw)) throw new DirectionsShapeError("leg is not an object");

  const stepsRaw = raw["steps"];
  if (!Array.isArray(stepsRaw)) {
    throw new DirectionsShapeError("leg has no steps array");
  }

  const steps: RouteWireStep[] = [];
  let cursor = geometryStart;

  for (const stepRaw of stepsRaw) {
    const { step, vertexCount } = mapStep(stepRaw, cursor);
    steps.push(step);
    cursor += vertexCount;
  }

  return {
    leg: {
      distanceMeters: requireFiniteNumber(raw["distance"], "leg distance"),
      durationSeconds: requireFiniteNumber(raw["duration"], "leg duration"),
      steps,
    },
    vertexCount: cursor - geometryStart,
  };
}

function boundsOf(geometry: readonly Coordinate[]): RouteWire["bounds"] {
  if (geometry.length === 0) {
    throw new DirectionsShapeError("route geometry is empty");
  }

  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;

  for (const { latitude, longitude } of geometry) {
    if (latitude > north) north = latitude;
    if (latitude < south) south = latitude;
    if (longitude > east) east = longitude;
    if (longitude < west) west = longitude;
  }

  return {
    southwest: { latitude: south, longitude: west },
    northeast: { latitude: north, longitude: east },
  };
}

/**
 * Maps one route. `index` only supplies a stable id for the alternates.
 *
 * Exported for testing.
 */
export function mapRoute(
  raw: unknown,
  index: number,
  providerId: string,
  requestedAt: number,
): RouteWire {
  if (!isRecord(raw)) throw new DirectionsShapeError("route is not an object");

  const polyline = raw["geometry"];
  if (typeof polyline !== "string" || polyline.length === 0) {
    throw new DirectionsShapeError("route has no encoded geometry");
  }

  // Decoded here purely to derive the bounds and to fail early on a corrupt
  // line — the wire carries the encoded form, and the client decodes it again.
  const geometry = decodePolyline(polyline);

  const legsRaw = raw["legs"];
  if (!Array.isArray(legsRaw) || legsRaw.length === 0) {
    throw new DirectionsShapeError("route has no legs");
  }

  const legs: RouteWireLeg[] = [];
  let cursor = 0;
  for (const legRaw of legsRaw) {
    const { leg, vertexCount } = mapLeg(legRaw, cursor);
    legs.push(leg);
    cursor += vertexCount;
  }

  return {
    id: `${providerId}:${requestedAt}:${index}`,
    distanceMeters: requireFiniteNumber(raw["distance"], "route distance"),
    durationSeconds: requireFiniteNumber(raw["duration"], "route duration"),
    // `duration_typical` is the free-flow estimate; `duration` on the
    // driving-traffic profile already accounts for live conditions. Reported
    // separately so the UI can say "slower than usual" rather than conflating
    // them into one number that silently means different things by profile.
    durationInTrafficSeconds: optionalFiniteNumber(raw["duration_typical"]),
    polyline,
    legs,
    bounds: boundsOf(geometry),
    voiceLocale: optionalText(raw["voiceLocale"]),
    provider: providerId,
    requestedAt,
  };
}

/**
 * The provider's own outcome code, independent of HTTP status.
 *
 * This distinction is load-bearing and was established from real responses:
 * **Mapbox answers "no route exists" with HTTP 200.** `NoRoute` and
 * `NoSegment` both arrive as 200 with an empty `routes` array, and only
 * `InvalidInput` carries a 4xx. Classifying on status alone would report a
 * perfectly successful request that found nothing as a success with zero
 * routes — which the UI would render as an empty preview rather than "no
 * route found".
 */
export type DirectionsCode =
  | "ok"
  | "no-route"
  | "no-segment"
  | "invalid-input"
  | "profile-not-found"
  | "unknown";

export function readDirectionsCode(body: unknown): DirectionsCode {
  const code = isRecord(body) ? body["code"] : undefined;
  switch (code) {
    case "Ok":
      return "ok";
    case "NoRoute":
      return "no-route";
    case "NoSegment":
      return "no-segment";
    case "InvalidInput":
      return "invalid-input";
    case "ProfileNotFound":
      return "profile-not-found";
    default:
      return "unknown";
  }
}

/** The message Mapbox supplied, when it supplied one. Never invented. */
export function readDirectionsMessage(body: unknown): string | null {
  return isRecord(body) ? optionalText(body["message"]) : null;
}

/**
 * Maps a whole successful Directions payload.
 *
 * Throws `DirectionsShapeError` if the payload violates the contract; the
 * caller converts that into a `malformed-response` failure.
 */
export function mapDirectionsRoutes(
  body: unknown,
  providerId: string,
  requestedAt: number,
): RouteWire[] {
  if (!isRecord(body)) {
    throw new DirectionsShapeError("response is not an object");
  }

  const routesRaw = body["routes"];
  if (!Array.isArray(routesRaw)) {
    throw new DirectionsShapeError("response has no routes array");
  }

  return routesRaw.map((route, index) =>
    mapRoute(route, index, providerId, requestedAt),
  );
}
