import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE SERVER-ONLY CREDENTIAL BOUNDARY.
 *
 * `NEXT_PUBLIC_` is not a naming convention, it is a publication decision:
 * Next.js inlines any variable carrying that prefix into the JavaScript served
 * to every visitor. Exactly one variable in this project is meant to be
 * published, and it is protected by URL restrictions rather than secrecy.
 *
 * The others are billed API keys. The mistake that leaks one is not
 * sophisticated — it is adding six characters to a variable name, or reading
 * it from a module that a client component happens to import. Both are
 * invisible in review and irreversible on deploy: a key inlined into a public
 * bundle is compromised the moment it ships, whatever is done afterwards.
 *
 * So the rule is enforced here rather than remembered. This test reads the
 * actual source tree, which is the only version of the rule that cannot drift
 * out of date.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

/** The one variable that is allowed to reach the browser. */
const PUBLISHABLE = new Set(["NEXT_PUBLIC_MAPBOX_TOKEN"]);

/**
 * Names that must never be published, whatever prefix someone gives them.
 * Matched as substrings so `NEXT_PUBLIC_OPENAI_API_KEY` is caught too.
 */
const SECRET_MARKERS = [
  "OPENAI",
  "ELEVENLABS",
  "ANTHROPIC",
  "SECRET",
  "PRIVATE_KEY",
  "SERVICE_ROLE",
];

/** Where a server-only credential may legitimately be read. */
const SERVER_ONLY_PREFIXES = ["app/api/"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path),
  text: readFileSync(path, "utf8"),
}));

/** Every `process.env.X` read in the source tree, with its file. */
const ENV_READS = FILES.flatMap(({ path, text }) =>
  [...text.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => ({
    path,
    name: m[1]!,
  })),
);

describe("server-only credentials never reach the browser", () => {
  it("publishes exactly one environment variable", () => {
    const published = new Set(
      ENV_READS.map((r) => r.name).filter((n) => n.startsWith("NEXT_PUBLIC_")),
    );
    expect([...published].sort()).toEqual([...PUBLISHABLE].sort());
  });

  it("never gives a secret-looking name a public prefix", () => {
    // The six-character mistake. `NEXT_PUBLIC_OPENAI_API_KEY` compiles, runs,
    // passes review, and ships the key to every visitor.
    for (const { path, name } of ENV_READS) {
      if (!name.startsWith("NEXT_PUBLIC_")) continue;
      for (const marker of SECRET_MARKERS) {
        expect(
          name.includes(marker),
          `${path} publishes ${name} to the browser bundle`,
        ).toBe(false);
      }
    }
  });

  it("reads secret credentials only from server routes", () => {
    for (const { path, name } of ENV_READS) {
      const isSecret = SECRET_MARKERS.some((m) => name.includes(m));
      if (!isSecret) continue;

      const allowed = SERVER_ONLY_PREFIXES.some((prefix) =>
        path.replace(/\\/g, "/").startsWith(prefix),
      );
      expect(
        allowed,
        `${path} reads ${name}; secret credentials may only be read from ${SERVER_ONLY_PREFIXES.join(", ")}`,
      ).toBe(true);
    }
  });

  it("never reads a secret credential from a client component", () => {
    // Belt and braces: even inside an allowed directory, a "use client" file
    // is compiled into the browser bundle.
    for (const { path, text } of FILES) {
      const isClient = /^["']use client["']/m.test(text);
      if (!isClient) continue;

      for (const marker of SECRET_MARKERS) {
        expect(
          new RegExp(`process\\.env\\.[A-Z0-9_]*${marker}`).test(text),
          `${path} is a client component and reads a ${marker} credential`,
        ).toBe(false);
      }
    }
  });

  it("keeps .env.example free of real values", () => {
    // Every key must be present and empty. A committed example file with a
    // value in it is the other common way this goes wrong.
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    const assignments = [...example.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)];

    expect(assignments.length).toBeGreaterThan(0);
    for (const [, name, value] of assignments) {
      expect(value, `${name} must have no value in .env.example`).toBe("");
    }

    // And the documented set must match what is actually deployed, so this
    // file stays a truthful deployment contract.
    expect(assignments.map(([, n]) => n).sort()).toEqual(
      [
        "ELEVENLABS_API_KEY",
        "ELEVENLABS_VOICE_ID",
        "NEXT_PUBLIC_MAPBOX_TOKEN",
        "OPENAI_API_KEY",
      ].sort(),
    );
  });
});
