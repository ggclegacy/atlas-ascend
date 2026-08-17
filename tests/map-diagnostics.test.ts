import { describe, expect, it } from "vitest";
import {
  classifyResource,
  hostnameOf,
  safeResource,
  sanitizeUrl,
  tokenAccount,
} from "@/map/mapbox/diagnostics";
import { guidanceFor } from "@/map/guidance";
import { classifyError } from "@/map/mapbox/MapboxMapProvider";
import type { MapUnavailableReason } from "@/map/provider";
import { summarizeProbes, type ProbeResult } from "@/features/debug/endpointProbe";

/**
 * Regression tests for the 2026-08-17 misdiagnosis.
 *
 * Production reported "Map tile access denied — add the styles:tiles
 * capability" for a token that already had it. Nothing about a capability was
 * ever observed: the classifier inferred it from the shape of the failing URL.
 * These tests hold the line at the two places that can regress — the copy that
 * names a remedy, and the redaction that keeps the evidence publishable.
 */

// ---------------------------------------------------------------------------
// The rule: no unproven account diagnosis, anywhere in user-facing copy
// ---------------------------------------------------------------------------

const ALL_REASONS: readonly MapUnavailableReason[] = [
  "missing-token",
  "invalid-token",
  "forbidden",
  "tile-access-denied",
  "style-access-denied",
  "request-rejected",
  "network",
  "timeout",
  "webgl-unsupported",
  "unknown",
];

/** Reasons that are only reachable when Mapbox itself named the capability. */
const PROVEN_BY_MAPBOX: ReadonlySet<MapUnavailableReason> = new Set([
  "tile-access-denied",
  "style-access-denied",
]);

describe("failure guidance never asserts an unproven account setting", () => {
  it("only names a Mapbox capability for reasons that require proof of one", () => {
    // Naming a capability as one of several candidates is honest; naming it as
    // the answer, or telling the operator to go add it, is the failure mode.
    for (const reason of ALL_REASONS) {
      const text = guidanceFor(reason) ?? "";
      const namesCapability =
        /\b(styles:tiles|styles:read|styles:list|fonts:read|tilesets:read)\b/i.test(text) ||
        /\badd\b[^.]*\b(capability|scope)\b/i.test(text);
      expect(
        namesCapability,
        `${reason} guidance must not prescribe a capability: ${text}`,
      ).toBe(PROVEN_BY_MAPBOX.has(reason));
    }
  });

  it("does not state a single cause for an ambiguous 401 or 403", () => {
    // Both statuses have several possible causes that Mapbox does not
    // distinguish. The copy must not pick one and present it as the answer.
    for (const reason of ["invalid-token", "forbidden"] as const) {
      const text = guidanceFor(reason) ?? "";
      expect(text).toMatch(/40[13]/);
      expect(text.length).toBeGreaterThan(40);
    }
    // The 403 case in particular used to instruct the operator to add the
    // hostname to the token's URL restrictions, as though that were known.
    expect(guidanceFor("forbidden")).toMatch(/does not say which/i);
  });

  it("cannot be reached with a capability claim from a bare status", () => {
    // End to end: the only inputs available from a Mapbox error event are a
    // status and a URL. Neither may produce capability copy.
    for (const status of [401, 403]) {
      for (const resource of [
        "api.mapbox.com/v4/mapbox.mapbox-streets-v8.json",
        "api.mapbox.com/v4/mapbox.mapbox-streets-v8/12/935/1686.vector.pbf",
        "api.mapbox.com/styles/v1/mapbox/dark-v11",
        "api.mapbox.com/fonts/v1/mapbox/DIN%20Pro%20Medium/0-255.pbf",
      ]) {
        const reason = classifyError(status, "Forbidden", resource);
        expect(
          guidanceFor(reason) ?? "",
          `${status} on ${resource}`,
        ).not.toMatch(/styles:tiles|styles:read/i);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Redaction — diagnostics are meant to be screenshotted
// ---------------------------------------------------------------------------

describe("URL sanitisation", () => {
  const TOKEN = "pk.eyJ1IjoiZXhhbXBsZSIsImEiOiJhYmMifQ.c2lnbmF0dXJlLXZhbHVl";

  it("replaces the access token rather than truncating it", () => {
    const url = `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8.json?secure&access_token=${TOKEN}`;
    const safe = sanitizeUrl(url) ?? "";

    expect(safe).not.toContain(TOKEN);
    // A partial token is still a leaked token — no fragment may survive.
    expect(safe).not.toContain(TOKEN.slice(0, 12));
    expect(safe).toContain("access_token=REDACTED");
    // The diagnostically useful parts are kept.
    expect(safe).toContain("api.mapbox.com/v4/mapbox.mapbox-streets-v8.json");
    expect(safe).toContain("secure");
  });

  it("redacts the SKU token the SDK appends to tile requests", () => {
    const safe =
      sanitizeUrl(
        `https://api.mapbox.com/v4/x/1/2/3.vector.pbf?sku=101abcdefghij&access_token=${TOKEN}`,
      ) ?? "";
    expect(safe).not.toContain("101abcdefghij");
    expect(safe).toContain("sku=REDACTED");
  });

  it("drops the whole query when a URL cannot be parsed", () => {
    const safe = sanitizeUrl(`::not a url::?access_token=${TOKEN}`) ?? "";
    expect(safe).not.toContain(TOKEN);
  });

  it("keeps safeResource query-free", () => {
    expect(
      safeResource(`https://api.mapbox.com/v4/a.json?access_token=${TOKEN}`),
    ).toBe("api.mapbox.com/v4/a.json");
    expect(sanitizeUrl(undefined)).toBeNull();
    expect(hostnameOf(`https://api.mapbox.com/v4/a.json`)).toBe("api.mapbox.com");
  });
});

// ---------------------------------------------------------------------------
// Resource attribution — an observation, kept separate from the inference
// ---------------------------------------------------------------------------

describe("resource classification", () => {
  it("separates the source manifest from an actual tile", () => {
    // These were treated as one thing, which is how "the token was refused"
    // became "the token cannot read tiles".
    expect(classifyResource("https://api.mapbox.com/v4/mapbox.mapbox-streets-v8.json?secure")).toBe(
      "tilejson",
    );
    expect(
      classifyResource("https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/12/935/1686.vector.pbf"),
    ).toBe("tile");
  });

  it("does not mistake a glyph range for a tile", () => {
    // Both end in .pbf.
    expect(
      classifyResource("https://api.mapbox.com/fonts/v1/mapbox/DIN%20Pro%20Medium/0-255.pbf"),
    ).toBe("glyphs");
  });

  it("attributes the remaining Mapbox endpoints", () => {
    expect(classifyResource("https://api.mapbox.com/styles/v1/mapbox/dark-v11")).toBe("style");
    expect(
      classifyResource("https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1/12/1/1.webp"),
    ).toBe("terrain-dem");
    expect(classifyResource("https://events.mapbox.com/events/v2")).toBe("telemetry");
    expect(classifyResource("https://api.mapbox.com/map-sessions/v1")).toBe("map-session");
    expect(classifyResource("https://api.mapbox.com/search/geocode/v6/forward?q=x")).toBe(
      "geocode",
    );
    expect(classifyResource(undefined)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Token identity — comparable without being disclosed
// ---------------------------------------------------------------------------

describe("token account", () => {
  it("reads the account from a public token's claim set", () => {
    // btoa of {"u":"example","a":"abc"}, base64url-encoded as Mapbox does.
    const payload = btoa(JSON.stringify({ u: "example", a: "abc" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(tokenAccount(`pk.${payload}.signature`)).toBe("example");
  });

  it("returns null rather than throwing on anything malformed", () => {
    expect(tokenAccount(null)).toBeNull();
    expect(tokenAccount("pk.not-base64!.sig")).toBeNull();
    expect(tokenAccount("nonsense")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Probe verdicts — the eight classes must stay distinguishable
// ---------------------------------------------------------------------------

function probe(over: Partial<ProbeResult> & Pick<ProbeResult, "id" | "kind">): ProbeResult {
  return {
    label: over.id,
    usedInProduction: true,
    url: `api.mapbox.com/${over.id}?access_token=REDACTED`,
    status: 200,
    ok: true,
    message: null,
    ms: 10,
    ...over,
  };
}

describe("endpoint probe verdicts", () => {
  const passing = [
    probe({ id: "tilejson", kind: "tilejson" }),
    probe({ id: "tile", kind: "tile" }),
    probe({ id: "glyphs-0", kind: "glyphs" }),
    probe({ id: "style", kind: "style" }),
  ];

  it("clears Mapbox entirely when every endpoint answers", () => {
    const verdict = summarizeProbes(passing);
    expect(verdict.code).toBe("H-application");
    expect(verdict.action).not.toMatch(/styles:tiles/i);
  });

  it("calls a wholesale refusal an authentication failure, not a scope one", () => {
    // The decisive distinction: a token missing ONE capability still passes
    // the endpoints that capability does not gate.
    const verdict = summarizeProbes(
      passing.map((p) => ({
        ...p,
        ok: false,
        status: 401,
        message: "Not Authorized - Invalid Token",
      })),
    );
    expect(verdict.code).toBe("A-authentication");
    expect(verdict.detail).not.toMatch(/styles:tiles/i);
    expect(verdict.action).toMatch(/not a missing scope/i);
  });

  it("names a capability only when Mapbox's body does", () => {
    const verdict = summarizeProbes([
      ...passing.slice(0, 2).map((p) => ({
        ...p,
        ok: false,
        status: 403,
        message: "required scope: styles:tiles",
      })),
      ...passing.slice(2),
    ]);
    expect(verdict.headline).toMatch(/NAMED A MISSING CAPABILITY/);
    expect(verdict.detail).toMatch(/styles:tiles/);
  });

  it("reports an unexplained 403 as unexplained", () => {
    const verdict = summarizeProbes([
      { ...passing[0]!, ok: false, status: 403, message: null },
      ...passing.slice(1),
    ]);
    expect(verdict.code).toBe("F-source-authorization");
    expect(verdict.detail).toMatch(/nothing/);
    expect(verdict.action).not.toMatch(/styles:tiles/i);
  });

  it("distinguishes a blocked request from a refused one", () => {
    const verdict = summarizeProbes([
      passing[0]!,
      { ...passing[1]!, ok: false, status: null, message: "transport: Failed to fetch" },
      ...passing.slice(2),
    ]);
    expect(verdict.code).toBe("C-tile");
    expect(verdict.action).toMatch(/never completed/i);
  });
});
