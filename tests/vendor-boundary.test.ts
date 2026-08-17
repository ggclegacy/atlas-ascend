import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE VENDOR BOUNDARIES.
 *
 * Two rules this project has always stated and never enforced:
 *
 *   1. Nothing outside `src/map/mapbox/` imports `mapbox-gl`.
 *   2. Nothing outside `src/routing/mapbox/` knows what a Mapbox Directions
 *      response looks like.
 *
 * Both are what make the vendor replaceable, and both decay the same way — not
 * by someone deciding to violate them, but by one convenient field access that
 * looks harmless in review. By the time the boundary matters it has a hundred
 * small holes in it and the migration everyone assumed was possible is not.
 *
 * A rule enforced by a test is a rule; a rule in a comment is a preference.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Strips comments so a file may still *describe* the rule it obeys.
 *
 * The negative lookbehind is load-bearing: without it, `https://` is read as
 * the start of a comment and the rest of the line — including the endpoint
 * being asserted about — disappears. That is not a cosmetic bug in a test
 * helper; it silently blinds the check it exists to perform, which is strictly
 * worse than having no check at all.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(?<!:)\/\/[^\n]*/g, " ");
}

const FILES = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path).replace(/\\/g, "/"),
  code: code(readFileSync(path, "utf8")),
}));

describe("the map vendor stays behind src/map/mapbox/", () => {
  /**
   * The isolation harness is the one justified exception, and it proves the
   * rule rather than eroding it: `/debug/mapbox` exists precisely to mount the
   * raw SDK beside the Atlas abstraction and compare them. It cannot do that
   * through the abstraction it is testing. It ships no product surface.
   */
  const ALLOWED_TO_IMPORT_SDK = ["map/mapbox/", "features/debug/"];

  it("is imported nowhere else", () => {
    const offenders = FILES.filter(
      (file) =>
        !ALLOWED_TO_IMPORT_SDK.some((prefix) => file.path.startsWith(prefix)) &&
        /from\s+["']mapbox-gl["']|import\(["']mapbox-gl["']\)/.test(file.code),
    ).map((f) => f.path);

    expect(offenders).toEqual([]);
  });

  it("keeps the SDK out of every product surface", () => {
    // Stated separately so the debug exception can never quietly widen into
    // the Command Center.
    const productFiles = FILES.filter(
      (f) => f.path.startsWith("features/") && !f.path.startsWith("features/debug/"),
    );
    expect(productFiles.length).toBeGreaterThan(0);

    for (const file of productFiles) {
      expect(
        /from\s+["']mapbox-gl["']/.test(file.code),
        `${file.path} imports the map SDK directly`,
      ).toBe(false);
    }
  });
});

describe("the routing vendor stays behind src/routing/mapbox/", () => {
  /** Field names that exist only in a Mapbox Directions payload. */
  const DIRECTIONS_FIELDS = [
    "bannerInstructions",
    "voiceInstructions",
    "ssmlAnnouncement",
    "distanceAlongGeometry",
    "bearing_before",
    "bearing_after",
    "duration_typical",
    "rotary_name",
    "driving_side",
    "weight_name",
  ];

  it("leaks no Directions field name into feature or shared code", () => {
    for (const file of FILES) {
      if (file.path.startsWith("routing/mapbox/")) continue;
      for (const field of DIRECTIONS_FIELDS) {
        expect(
          file.code.includes(field),
          `${file.path} references the Mapbox Directions field "${field}"`,
        ).toBe(false);
      }
    }
  });

  it("calls the Directions endpoint from exactly one module", () => {
    const callers = FILES.filter((f) =>
      f.code.includes("api.mapbox.com/directions"),
    ).map((f) => f.path);

    expect(callers).toEqual(["routing/mapbox/MapboxDirections.ts"]);
  });

  it("keeps the browser away from the routing vendor entirely", () => {
    // A client component reaching the vendor directly would bypass /api/route,
    // and with it the one place caching, rate limiting and failure mapping
    // live.
    for (const file of FILES) {
      if (!/^["']use client["']/m.test(file.code)) continue;
      expect(
        file.code.includes("api.mapbox.com"),
        `${file.path} is a client component and calls Mapbox directly`,
      ).toBe(false);
    }
  });
});
