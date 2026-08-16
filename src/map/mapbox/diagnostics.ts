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
  | "css-import"
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

export interface RecordedError {
  readonly category: string;
  readonly status: number | null;
  /** Host + path only. The query string carries the access token. */
  readonly resource: string | null;
  readonly message: string;
  readonly at: number;
}

let lastError: RecordedError | null = null;

export function recordError(error: RecordedError): void {
  lastError = error;
}

export function getLastError(): RecordedError | null {
  return lastError;
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
