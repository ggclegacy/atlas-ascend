/**
 * MAP DIAGNOSTICS
 *
 * Every stage of map initialization reports here, so a failure in production
 * can be attributed to a specific step instead of being inferred from a dark
 * rectangle.
 *
 * Verbose tracing is off by default in production and enabled per-session with
 * `?atlasdebug=map` in the URL — which matters because it makes a deployed
 * build diagnosable without a redeploy. Warnings and errors always log.
 *
 * **Never logs the token.** Only its presence, length, and `pk.`/`sk.` prefix,
 * which is enough to distinguish "absent", "malformed", and "secret key used by
 * mistake" without putting a credential in a console someone may screenshot.
 */

export type MapStage =
  | "availability"
  | "webgl"
  | "container"
  | "sdk-import"
  | "constructor"
  | "style-load"
  | "map-load"
  | "first-render"
  | "source-error"
  | "resize"
  | "destroy";

export interface StageRecord {
  readonly stage: MapStage;
  readonly at: number;
  readonly detail?: string;
  readonly ok: boolean;
}

const PREFIX = "[AtlasMap]";
const trace: StageRecord[] = [];
let started = 0;

/**
 * Whether the caller explicitly asked for map diagnostics.
 *
 * Query-param driven so a deployed build is diagnosable without a redeploy,
 * which is the entire point — the failure only reproduces in production.
 */
export function isMapDebugRequested(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("atlasdebug") === "map") {
      return true;
    }
    return window.localStorage.getItem("atlas.debug.map") === "1";
  } catch {
    return false;
  }
}

function verboseEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NODE_ENV !== "production") return true;
  return isMapDebugRequested();
}

function elapsed(): string {
  if (started === 0) started = Date.now();
  return `+${String(Date.now() - started).padStart(4, " ")}ms`;
}

/** Record a successful stage. */
export function stage(name: MapStage, detail?: string): void {
  if (started === 0) started = Date.now();
  trace.push({ stage: name, at: Date.now(), ok: true, ...(detail ? { detail } : {}) });
  if (verboseEnabled()) {
    console.info(`${PREFIX} ${elapsed()} ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Record a failed stage. Always logs, regardless of verbosity. */
export function stageFailed(name: MapStage, detail: string): void {
  if (started === 0) started = Date.now();
  trace.push({ stage: name, at: Date.now(), ok: false, detail });
  console.error(`${PREFIX} ${elapsed()} ✗ ${name} — ${detail}`);
}

/** Non-fatal problem worth surfacing. Always logs. */
export function warn(message: string): void {
  console.warn(`${PREFIX} ${elapsed()} ! ${message}`);
}

export function getTrace(): readonly StageRecord[] {
  return trace;
}

/** Milliseconds since the first recorded stage. */
export function elapsedMs(): number {
  return started === 0 ? 0 : Date.now() - started;
}

// ---------------------------------------------------------------------------
// Last error — the single most useful field in a bug report
// ---------------------------------------------------------------------------

/**
 * Which Mapbox resource a request was for.
 *
 * Recorded separately from the classified failure reason, and never collapsed
 * into it. "A 401 on the TileJSON" and "the token is missing a tile scope" are
 * different claims, and only the first one is ever observed.
 */
export type MapResourceKind =
  | "style"
  | "tilejson"
  | "tile"
  | "glyphs"
  | "sprite"
  | "terrain-dem"
  | "telemetry"
  | "map-session"
  | "geocode"
  | "directions"
  | "other"
  | "unknown";

export interface RecordedError {
  readonly category: string;
  readonly status: number | null;
  /** Host + path only. The query string carries the access token. */
  readonly resource: string | null;
  /** Full URL with every credential parameter redacted. */
  readonly url: string | null;
  readonly hostname: string | null;
  readonly kind: MapResourceKind;
  readonly message: string;
  /**
   * What Mapbox actually said, when it could be read.
   *
   * Mapbox GL's `AJAXError` keeps only `status`, `statusText`, and `url` — it
   * discards the response body. So this is `null` unless something explicitly
   * went and fetched it, and a `null` here means *no evidence was available*,
   * not *no reason was given*.
   */
  readonly body: string | null;
  /** The style source involved, when the SDK named one. */
  readonly sourceId: string | null;
  readonly at: number;
}

let lastError: RecordedError | null = null;
const errorLog: RecordedError[] = [];

export function recordError(error: RecordedError): void {
  lastError = error;
  errorLog.push(error);
}

export function getLastError(): RecordedError | null {
  return lastError;
}

/** Every recorded failure, oldest first. The first one is usually the cause. */
export function getErrorLog(): readonly RecordedError[] {
  return errorLog;
}

/**
 * Reduces a URL to `host/path`, discarding the query string.
 *
 * Mapbox puts `access_token=` in every request URL, so a raw URL must never
 * reach a diagnostic panel that someone will screenshot.
 */
export function safeResource(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, "https://example.invalid");
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    const index = url.indexOf("?");
    return index === -1 ? url : url.slice(0, index);
  }
}

/** Credential-bearing query parameters. Redacted, never shortened. */
const SECRET_PARAMS = ["access_token", "sku", "token"] as const;

/**
 * The full request URL with every credential redacted.
 *
 * Preferred over `safeResource` wherever the query string carries diagnostic
 * value (`?secure`, tile coordinates, font ranges) — which is most of the time.
 * The redaction is a replacement, not a truncation: a partial token is still a
 * leaked token.
 */
export function sanitizeUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, "https://example.invalid");
    for (const key of SECRET_PARAMS) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, "REDACTED");
    }
    return `${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    // Unparseable: fall back to dropping the query entirely rather than
    // risking a token in the output.
    return safeResource(url);
  }
}

export function hostnameOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url, "https://example.invalid").host;
  } catch {
    return null;
  }
}

/**
 * Which Mapbox resource a URL addresses.
 *
 * Path-based and deliberately narrow. This answers "what failed", which is an
 * observation. It must never be used on its own to answer "why", which is an
 * inference — that conflation is exactly what produced a confident, wrong
 * scope diagnosis.
 */
export function classifyResource(url: string | undefined | null): MapResourceKind {
  if (!url) return "unknown";
  const path = safeResource(url) ?? "";

  if (/^events\.mapbox\.com/.test(path)) return "telemetry";
  if (/\/map-sessions\//.test(path)) return "map-session";
  if (/\/search\/geocode\//.test(path) || /\/geocoding\//.test(path)) return "geocode";
  if (/\/directions\/v\d+\//.test(path)) return "directions";
  // Glyphs are checked before tiles: both end in `.pbf`.
  if (/\/fonts\//.test(path)) return "glyphs";
  if (/\/sprites?\//.test(path) || /sprite(@2x)?\.(png|json)$/.test(path)) return "sprite";
  if (/terrain-dem/.test(path)) return "terrain-dem";
  if (/\/styles\/v\d+\//.test(path)) return "style";
  // TileJSON is the source manifest: `/v4/<tileset>.json`. It is NOT a tile,
  // and treating the two as one thing is what made a plain token rejection
  // read as a missing tile capability.
  if (/\/v4\/[^/]+\.json$/.test(path)) return "tilejson";
  if (/\/v4\//.test(path) || /\.(mvt|vector\.pbf|webp|png|jpg)$/.test(path)) return "tile";
  return "other";
}

// ---------------------------------------------------------------------------
// Token identity — enough to compare two deployments, never enough to use
// ---------------------------------------------------------------------------

/**
 * The Mapbox account a public token belongs to.
 *
 * A `pk.` token's middle segment is base64url-encoded JSON carrying the
 * account name (`u`) and the token's own id (`a`). The account name is not a
 * credential, and it is the fastest way to prove a build is using a token from
 * the account you think it is.
 */
export function tokenAccount(token: string | null): string | null {
  if (token === null) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))) as {
      u?: unknown;
    };
    return typeof json.u === "string" ? json.u : null;
  } catch {
    return null;
  }
}

/**
 * A short SHA-256 of the token — a stable identifier that reveals nothing.
 *
 * Exists so a deployed build can be compared against an expected token without
 * either being disclosed. Reproduce it locally with:
 *
 *     printf %s "$TOKEN" | shasum -a 256 | cut -c1-12
 *
 * Returns `null` where WebCrypto is unavailable (non-secure contexts) rather
 * than substituting a weaker digest that would not match that command.
 */
export async function tokenFingerprint(token: string | null): Promise<string | null> {
  if (token === null) return null;
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(token),
    );
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12);
  } catch {
    return null;
  }
}

/**
 * Reads what Mapbox actually said about a refused request.
 *
 * Necessary because Mapbox GL JS throws the response body away: its
 * `AJAXError` carries `status`, `statusText`, and `url` and nothing else, and
 * over HTTP/2 `statusText` is the empty string. So a map `error` event alone
 * contains **no evidence whatsoever** about scopes, restrictions, or revocation
 * — only a number. Fetching the failing URL once is the only way to obtain the
 * `{"message": …}` Mapbox returns.
 *
 * Never logs or returns the URL; only the body.
 */
export async function readMapboxErrorBody(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_500);
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
    });
    clearTimeout(timer);

    const text = (await response.text()).slice(0, 400);
    try {
      const parsed = JSON.parse(text) as { message?: unknown; error_detail?: unknown };
      const parts = [parsed.message, parsed.error_detail].filter(
        (part): part is string => typeof part === "string",
      );
      return parts.length > 0 ? parts.join(" — ") : text;
    } catch {
      return text.trim().length > 0 ? text : null;
    }
  } catch {
    return null;
  }
}

/**
 * A redacted description of the token, safe to log and safe to screenshot.
 * Reveals only what is needed to diagnose: whether it exists, whether it is the
 * right kind of key, and whether it looks truncated.
 */
export function describeToken(token: string | null): string {
  if (token === null) return "absent";

  const kind = token.startsWith("pk.")
    ? "public"
    : token.startsWith("sk.")
      ? "SECRET (wrong kind — use a pk. token)"
      : "unrecognized prefix";

  return `${kind}, length ${token.length}`;
}

/** Container geometry, for the zero-size failure mode. */
export function describeContainer(element: HTMLElement): string {
  const rect = element.getBoundingClientRect();
  return `${Math.round(rect.width)}×${Math.round(rect.height)}`;
}

export function hasNonZeroSize(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * WebGL capability.
 *
 * Probes WebGL2 then WebGL1, and explicitly releases the probe context —
 * browsers cap simultaneous WebGL contexts, and leaking one on every mount can
 * itself cause the real map to fail to acquire a context later.
 */
export interface WebGLSupport {
  readonly supported: boolean;
  readonly version: "webgl2" | "webgl" | null;
  readonly detail: string;
}

export function detectWebGL(): WebGLSupport {
  if (typeof document === "undefined") {
    return { supported: false, version: null, detail: "no document (SSR)" };
  }

  try {
    const canvas = document.createElement("canvas");

    for (const version of ["webgl2", "webgl"] as const) {
      const context = canvas.getContext(version) as WebGLRenderingContext | null;
      if (!context) continue;

      const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
      const renderer = debugInfo
        ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
        : "renderer hidden";

      // Release immediately; this was only a probe.
      context.getExtension("WEBGL_lose_context")?.loseContext();

      return { supported: true, version, detail: `${version}, ${renderer}` };
    }

    return {
      supported: false,
      version: null,
      detail: "no WebGL context could be created",
    };
  } catch (error) {
    return {
      supported: false,
      version: null,
      detail: error instanceof Error ? error.message : "WebGL probe threw",
    };
  }
}
