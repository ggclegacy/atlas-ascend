/**
 * Environment access — the single point at which Atlas Ascend reads config.
 *
 * Atlas Ascend requires exactly **one** environment variable:
 * `NEXT_PUBLIC_MAPBOX_TOKEN`.
 *
 * Two rules govern this file:
 *
 * 1. **The access must be statically analyzable.** Next.js replaces
 *    `process.env.NEXT_PUBLIC_MAPBOX_TOKEN` with a literal at build time by
 *    pattern-matching the complete member expression. A dynamic lookup like
 *    `process.env[name]` is not substituted and silently yields `undefined` in
 *    the browser — which presents as a map that will not initialize. That is
 *    why this is a named function around a literal access, not a generic getter.
 *
 * 2. **The value is public.** `NEXT_PUBLIC_` means "inlined into the browser
 *    bundle". It is protected by URL restrictions in the Mapbox dashboard, not
 *    by secrecy. No genuinely secret value may ever take this prefix.
 *
 * Because the token is baked in at build time, changing it requires a rebuild —
 * not merely a restart or a redeploy of the same artifact.
 */

/**
 * The Mapbox public access token (`pk.…`), or `null` when the build had none.
 *
 * `null` is a first-class outcome, not an error: the app deploys and runs
 * without a token, showing an explicit "MAP SERVICE NOT CONFIGURED" state
 * rather than attempting to initialize Mapbox and producing a black canvas.
 */
export function getPublicMapboxToken(): string | null {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token || token.trim().length === 0) return null;
  return token.trim();
}
