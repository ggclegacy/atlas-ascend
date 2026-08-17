/**
 * DIRECT MAPBOX ENDPOINT PROBE
 *
 * Requests each resource the map depends on straight from the browser and
 * reports the HTTP status and Mapbox's own response body.
 *
 * This exists because the map SDK cannot answer the question. Mapbox GL JS
 * wraps a failed request in an `AJAXError` carrying `status`, `url`, and a
 * `statusText` that is the empty string over HTTP/2 — and throws the response
 * body away. The body is the only place Mapbox ever explains itself, so an
 * application watching `map.on("error")` sees a bare number and can do nothing
 * with it but guess. Guessing is what produced a confident, wrong diagnosis of
 * a missing `styles:tiles` capability.
 *
 * Running from the page also means the request carries the real `Origin` and
 * `Referer`, so it tests URL restrictions as the deployment actually
 * experiences them — something curl from a laptop cannot do.
 */

import {
  ATLAS_NIGHT_DEM_TILESET,
  ATLAS_NIGHT_FONT_STACKS,
  ATLAS_NIGHT_TILESET,
} from "@/map/mapbox/atlas-night";
import { type MapResourceKind, sanitizeUrl } from "@/map/mapbox/diagnostics";

const API = "https://api.mapbox.com";

/** A tile well inside continental coverage — Austin at z12. */
const SAMPLE_TILE = "12/935/1686";

export interface ProbeSpec {
  readonly id: string;
  readonly label: string;
  readonly kind: MapResourceKind;
  /** Whether the production Command Center actually requests this. */
  readonly usedInProduction: boolean;
  /** What a failure here would mean. */
  readonly meaning: string;
  readonly url: (token: string) => string;
}

const glyphStack = (stack: readonly string[]) =>
  stack.map(encodeURIComponent).join(",");

/**
 * The probe set, derived from `atlas-night.ts` rather than transcribed from
 * it — so it cannot drift away from what the style requests.
 */
export const PROBES: readonly ProbeSpec[] = [
  {
    id: "tilejson",
    label: `TileJSON — ${ATLAS_NIGHT_TILESET}`,
    kind: "tilejson",
    usedInProduction: true,
    meaning:
      "The atlasNight source manifest. Because atlasNight is an inline style, this is the FIRST authenticated request the product makes — so any token-level rejection surfaces here first, whatever its cause.",
    url: (t) => `${API}/v4/${ATLAS_NIGHT_TILESET}.json?secure&access_token=${t}`,
  },
  {
    id: "tile",
    label: `Vector tile — ${SAMPLE_TILE}`,
    kind: "tile",
    usedInProduction: true,
    meaning:
      "An actual vector tile. Passing here is what proves the token can read tiles; a 200 on this line makes 'add styles:tiles' false by observation.",
    url: (t) =>
      `${API}/v4/${ATLAS_NIGHT_TILESET}/${SAMPLE_TILE}.vector.pbf?access_token=${t}`,
  },
  ...ATLAS_NIGHT_FONT_STACKS.map((stack, index) => ({
    id: `glyphs-${index}`,
    label: `Glyphs — ${stack[0]}`,
    kind: "glyphs" as const,
    usedInProduction: true,
    meaning:
      "A font range for the symbol layers. Failing here blanks every label while the geometry still draws.",
    url: (t: string) => `${API}/fonts/v1/mapbox/${glyphStack(stack)}/0-255.pbf?access_token=${t}`,
  })),
  {
    id: "style",
    label: "Hosted style — mapbox/dark-v11",
    kind: "style",
    usedInProduction: false,
    meaning:
      "A stock Mapbox style. The product never requests one — atlasNight is authored in-repo — so this only tests the token's style capability, and only Level 1 of the harness depends on it.",
    url: (t) => `${API}/styles/v1/mapbox/dark-v11?access_token=${t}`,
  },
  {
    id: "terrain",
    label: `Terrain DEM — ${ATLAS_NIGHT_DEM_TILESET}`,
    kind: "terrain-dem",
    usedInProduction: false,
    meaning:
      "Only requested when terrain is enabled, which capability detection currently never does. Probed so enabling it later cannot fail silently.",
    url: (t) => `${API}/v4/${ATLAS_NIGHT_DEM_TILESET}.json?secure&access_token=${t}`,
  },
  {
    id: "geocode",
    label: "Geocoding v6 — forward",
    kind: "geocode",
    usedInProduction: true,
    meaning: "Backs place search. Independent of the map surface.",
    url: (t) => `${API}/search/geocode/v6/forward?q=austin&limit=1&access_token=${t}`,
  },
];

export interface ProbeResult {
  readonly id: string;
  readonly label: string;
  readonly kind: MapResourceKind;
  readonly usedInProduction: boolean;
  /** Credential-redacted. Safe to screenshot. */
  readonly url: string;
  readonly status: number | null;
  readonly ok: boolean;
  /** Mapbox's own explanation, when it returned one. */
  readonly message: string | null;
  readonly ms: number;
}

/** Extracts Mapbox's `message` from an error body without assuming JSON. */
function explain(text: string): string | null {
  const trimmed = text.trim().slice(0, 300);
  if (trimmed.length === 0) return null;
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown; error_detail?: unknown };
    const parts = [parsed.message, parsed.error_detail].filter(
      (part): part is string => typeof part === "string",
    );
    return parts.length > 0 ? parts.join(" — ") : trimmed;
  } catch {
    return trimmed;
  }
}

export async function runProbe(spec: ProbeSpec, token: string): Promise<ProbeResult> {
  const url = spec.url(token);
  const started = Date.now();

  const base = {
    id: spec.id,
    label: spec.label,
    kind: spec.kind,
    usedInProduction: spec.usedInProduction,
    // Redacted at construction, so no caller can accidentally surface the raw
    // URL — it carries the token in its query string.
    url: sanitizeUrl(url) ?? spec.id,
  };

  try {
    const response = await fetch(url, { credentials: "omit", cache: "no-store" });
    // Only read the body on failure. A successful tile is megabytes of
    // protobuf nobody needs, and reading it would distort the timing.
    const message = response.ok ? null : explain(await response.text());
    return {
      ...base,
      status: response.status,
      ok: response.ok,
      message,
      ms: Date.now() - started,
    };
  } catch (error) {
    // A transport failure, not a rejection. Reported as such — a blocked
    // request and a refused one are different problems.
    return {
      ...base,
      status: null,
      ok: false,
      message: error instanceof Error ? `transport: ${error.message}` : "transport failure",
      ms: Date.now() - started,
    };
  }
}

export async function runAllProbes(token: string): Promise<ProbeResult[]> {
  return Promise.all(PROBES.map((spec) => runProbe(spec, token)));
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

/**
 * The failure classes the harness must keep distinct.
 *
 * Enumerated so that no two of them can be collapsed into one friendly
 * sentence before the underlying evidence has been recorded.
 */
export type ProbeVerdictCode =
  /** Every endpoint refused the token — it is not accepted anywhere. */
  | "A-authentication"
  /** atlasNight's own resources fail while unrelated ones succeed. */
  | "B-atlasnight-resource"
  | "C-tile"
  | "D-font"
  | "E-style"
  /** The source manifest is refused: the account cannot read that tileset. */
  | "F-source-authorization"
  /** A 401/403 that the evidence does not explain. */
  | "G-unknown-auth"
  /** Nothing on the network is failing; the fault is above it. */
  | "H-application";

export interface ProbeVerdict {
  readonly code: ProbeVerdictCode;
  readonly headline: string;
  readonly detail: string;
  readonly action: string;
}

const isAuthRefusal = (r: ProbeResult) => r.status === 401 || r.status === 403;

/**
 * Reduces probe results to one conclusion — without inventing a cause.
 *
 * Where Mapbox's response does not name a scope, the verdict says so
 * explicitly instead of picking the most plausible-sounding remedy.
 */
export function summarizeProbes(results: readonly ProbeResult[]): ProbeVerdict {
  const failed = results.filter((r) => !r.ok);

  if (failed.length === 0) {
    return {
      code: "H-application",
      headline: "EVERY MAPBOX ENDPOINT ACCEPTS THIS TOKEN",
      detail:
        "Source manifest, vector tile, every glyph range, and the hosted style all returned 2xx from this origin. The token, its capabilities, and its URL restrictions are all conclusively fine.",
      action:
        "Any map failure is above the network layer — container size, WebGL, style application, or the surface's own state machine. Run the six levels above.",
    };
  }

  const refusals = failed.filter(isAuthRefusal);
  const namedScope = refusals.find((r) => r.message !== null && /scope|styles:|fonts:/i.test(r.message));

  if (refusals.length === results.length) {
    return {
      code: "A-authentication",
      headline: "MAPBOX REJECTS THIS TOKEN OUTRIGHT",
      detail: `Every probed endpoint returned ${[...new Set(refusals.map((r) => r.status))].join("/")}. Mapbox said: ${refusals[0]?.message ?? "nothing"}. A token missing one capability would still pass the endpoints that capability does not gate — this fails all of them.`,
      action:
        "Compare the token fingerprint above with the token you expect this deployment to carry. A wholesale rejection means revoked, deleted, from another account, truncated, or restricted away from this hostname — not a missing scope.",
    };
  }

  const tilejson = failed.find((r) => r.kind === "tilejson");
  const tile = failed.find((r) => r.kind === "tile");
  const glyphs = failed.find((r) => r.kind === "glyphs");
  const style = failed.find((r) => r.kind === "style");

  if (namedScope) {
    return {
      code: namedScope.kind === "style" ? "E-style" : "C-tile",
      headline: "MAPBOX NAMED A MISSING CAPABILITY",
      detail: `${namedScope.label} returned ${namedScope.status}. Mapbox said: “${namedScope.message}”.`,
      action:
        "This is the one case where a capability really is the cause, because Mapbox said so. Add the named capability to this token.",
    };
  }

  if (tilejson && !tile && !glyphs) {
    return {
      code: "F-source-authorization",
      headline: "THE ATLASNIGHT SOURCE MANIFEST WAS REFUSED",
      detail: `${tilejson.label} returned ${tilejson.status} while tiles and glyphs did not. Mapbox said: ${tilejson.message ?? "nothing"}.`,
      action:
        "The failure is specific to that tileset, not to the token as a whole. Confirm the tileset id is Mapbox-owned and public.",
    };
  }

  if (tile) {
    return {
      code: "C-tile",
      headline: "TILE REQUESTS ARE FAILING",
      detail: `${tile.label} returned ${tile.status ?? "no status"}. Mapbox said: ${tile.message ?? "nothing"}.`,
      action:
        tile.status === null
          ? "No HTTP status: the request never completed. Suspect the network, an extension, or a content blocker before suspecting Mapbox."
          : "Read the message above before changing anything in the Mapbox dashboard.",
    };
  }

  if (glyphs) {
    return {
      code: "D-font",
      headline: "GLYPH REQUESTS ARE FAILING",
      detail: `${glyphs.label} returned ${glyphs.status ?? "no status"}. Mapbox said: ${glyphs.message ?? "nothing"}.`,
      action: "Geometry will still draw; every label will be missing.",
    };
  }

  if (style) {
    return {
      code: "E-style",
      headline: "HOSTED STYLE REQUESTS ARE FAILING",
      detail: `${style.label} returned ${style.status ?? "no status"}. Mapbox said: ${style.message ?? "nothing"}.`,
      action:
        "The product does not use hosted styles — atlasNight is authored in-repo — so this affects Level 1 of the harness only.",
    };
  }

  const first = failed[0];
  if (refusals.length > 0) {
    return {
      code: "G-unknown-auth",
      headline: "UNEXPLAINED MAPBOX 401/403",
      detail: `${refusals.map((r) => `${r.label} → ${r.status}`).join("; ")}. Mapbox gave no explanation beyond the status code.`,
      action:
        "Do not change a capability on this evidence. Report the statuses and endpoints above as-is.",
    };
  }

  return {
    code: "B-atlasnight-resource",
    headline: "AN ATLASNIGHT RESOURCE FAILED",
    detail: `${first?.label ?? "A resource"} returned ${first?.status ?? "no status"}. Mapbox said: ${first?.message ?? "nothing"}.`,
    action: "The failure is resource-specific, not token-wide.",
  };
}
