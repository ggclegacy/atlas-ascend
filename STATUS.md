# Atlas Ascend — Implementation Status

The honesty standard requires that we always know what is real. This file is the
ledger. **Update it in the same commit as the code it describes.**

| Status | Meaning |
|---|---|
| 🟢 **REAL** | Actually connected and functioning |
| 🟡 **FUNCTIONAL, INCOMPLETE** | Works, but does not yet represent the final experience |
| 🟠 **SIMULATED** | Intentionally simulated for development |
| 🔵 **PLACEHOLDER** | Visual/structural only |
| 🔴 **BLOCKED** | Requires credentials, provider setup, browser capability, or another dependency |

**Phase:** 2 — web application foundation, prepared for a clean Vercel import
**Last updated:** 2026-08-17 (fresh-deployment readiness)
**Deployable to Vercel:** Yes, zero-config. The application reads exactly one environment variable (`NEXT_PUBLIC_MAPBOX_TOKEN`), and deploys successfully without even that — showing an explicit MAP SERVICE NOT CONFIGURED state. Three further credentials are provisioned for later phases and are read by nothing yet.

---

## Verification tiers

Each tier is a strictly stronger claim. None is asserted without having been
observed at that level.

| Tier | State |
|---|---|
| ✅ **BUILD VERIFIED** | Yes — clean typecheck, full suite green, clean production build, both with and without a token |
| ✅ **RUNTIME VERIFIED** | Yes — production server driven in headless Chromium with WebGL; every route served, map reached `load`, real geography drawn |
| ⬜ **PRODUCTION VERIFIED** | **Not yet** — becomes yes only once the new Vercel deployment has been observed rendering on a real device |

---

## Fresh deployment contract

Everything a clean Vercel import needs, and nothing else.

| Item | Value |
|---|---|
| Framework | Next.js (auto-detected) |
| Root directory | `./` |
| Build / install / output | Vercel defaults — **no `vercel.json`, none needed** |
| Node | `engines.node >= 20.9.0` — permissive, so Vercel picks its own default |
| Environment variables | **one that the app reads:** `NEXT_PUBLIC_MAPBOX_TOKEN`. `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` are provisioned for later phases, server-only, and read by no code today |

**One variable, one accessor.** `getPublicMapboxToken()` in `src/lib/env.ts` is
the only place any Mapbox credential is resolved — the map, the diagnostics,
and the `/api/search` geocoder all route through it. There is no
`MAPBOX_TOKEN`, no fallback, no hardcoded token, and no second reader whose
trim/empty rules could drift from the first.

**Server-only credentials stay server-only.** `OPENAI_API_KEY`,
`ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` carry no `NEXT_PUBLIC_` prefix,
so Next.js will not inline them into the client bundle. When they are used it
must be from a route handler, following the `/api/search` pattern. A guard test
fails the suite if a secret-looking name is ever given a public prefix or read
outside `src/app/api/`.

**`NEXT_PUBLIC_` means build time.** The value is inlined into the client
bundle when the project is compiled, not read when it runs. Changing it
requires a **new build**; redeploying an existing artifact keeps the old value.
This single fact accounts for most of the time this project has lost to
deployment ambiguity.

**No token is still a valid deployment.** The app builds and serves every route
with the variable absent, showing an explicit MAP SERVICE NOT CONFIGURED state;
`/api/search` answers `503 {"failure":"not-configured"}` rather than crashing.

**No deployment identity in the repository.** No `.vercel` directory, no
committed environment files, no hostname or project name from any prior
deployment. Diagnostics read `window.location.hostname` live, so the app is
correct on whatever domain it lands on.

---

## Map incidents — resolved

Five defects, each of which produced a dark rectangle or a confidently wrong
explanation for one. Recorded because the guards that now prevent them only
make sense alongside what they are guarding against.

**0 · The map container was collapsed to zero height by the vendor stylesheet.**
This was the actual black rectangle, and it outlived every other fix. The
element Mapbox mounts into carried Tailwind's `absolute inset-0`. Mapbox GL
adds `.mapboxgl-map` to that same element and `mapbox-gl.css` declares
`.mapboxgl-map { position: relative }` — identical specificity, loaded later,
so it won the cascade. The container stopped being absolutely positioned,
`top:0/bottom:0` decayed into inert offsets, height resolved to `auto` = **0**,
and Mapbox computed a zero-area viewport and requested **zero tiles**. Measured
on the real DOM chain: `main` 390×844 → wrapper 390×844 → `.mapboxgl-map`
**390×0**.

Everything else reported success — token valid, style applied, 23 layers, no
failed request, `load` fired — which is why this survived so many passes with
no error to follow.

`/debug/mapbox` could never reproduce it: the harness sets
`position:absolute;inset:0` as an **inline** style, which no stylesheet can
override. The harness was never testing the same container as the product. That
single difference is why "all levels render" and "the app is black" were both
true for days.

Fixed by pinning the container's geometry inline (`MAP_CONTAINER_STYLE`), which
is immune to bundler CSS ordering — the one thing in this chain that is not a
documented contract. A map that reaches `load` with a zero-area container is now
also reported as an explicit failure rather than succeeding silently, and
`tests/map-diagnostics.test.ts` fails if the geometry moves back to a class.

**1 · The surface hid a working map.** The loading veil was opaque with no
timeout, and `ready`/`error` emitted before the consumer subscribed were
dropped with no replay — so a map that loaded during that window left the UI
veiled forever. Fixed with terminal-state replay and a 15s watchdog. A style
that lands *after* the watchdog fires now withdraws the recorded timeout, so a
slow connection cannot strand the surface or mask a later real failure.

**2 · The map rendered but read as black.** Roads ran `#191920`–`#525263` on a
`#05050A` ground while the scrims laid 0.82/0.93 black over ~65% of a phone
viewport. The framebuffer was full of geography that no one could see — which
is why four passes of "all levels render" never contradicted the symptom.
Fixed by re-spacing the road ladder to even ~13-luma steps and lightening the
scrims to 0.68/0.82. `src/map/legibility.ts` now models the scrim composite
analytically and `tests/legibility.test.ts` enforces a minimum road-to-ground
separation, so the map cannot silently become unreadable again.

**3 · A generic 401 was reported as a missing capability.** `classifyError`
inferred a scope from the shape of the failing URL: any 401/403 on a `/v4/…`
path became "add the `styles:tiles` capability". Because `atlasNight` is an
**inline** style, `/v4/<tileset>.json` is the *first* authenticated request the
map makes — so a revoked token, a deleted token, a token from another account,
and a URL restriction all landed there first and all came out as the same
false accusation. Mapbox GL JS compounds it: its `AJAXError` keeps `status`,
`url`, and a `statusText` that is empty over HTTP/2, and **discards the
response body**, which is the only place Mapbox ever names a scope.

Measured directly: every way a public token can be wrong — truncated,
re-signed, unknown account, quote-wrapped, newline-suffixed, empty — returns an
identical `401 {"message":"Not Authorized - Invalid Token"}` on both the hosted
style and the TileJSON. No scope is distinguishable from a status code, and a
403 (not a 401) is what a *valid* but restricted or under-scoped token returns.

Now: a capability is named **only** when Mapbox's own response names one; on a
401/403 the provider fetches the failing URL once to read the body the SDK threw
away, *before* classifying; and the failure screen prints the raw evidence
beside the interpretation. `tests/map-diagnostics.test.ts` forbids any
user-facing string from prescribing a capability for a reason that does not
require proof of one.

**4 · A stale build-time token.** Two projects built from the same commit
seconds apart behaved differently, because `NEXT_PUBLIC_*` is baked in at build.
This is the failure mode the fresh-deployment contract above exists to remove,
and the reason `/debug/mapbox` reports a token fingerprint.

---

## Diagnostics

Permanent, unlinked from every product surface, `noindex`, and reachable in
production by design — the failures worth diagnosing only occur there.

| Surface | What it answers |
|---|---|
| `/debug/mapbox` → **Probe Mapbox endpoints** | Requests every resource the style needs from the page itself, so the real `Origin`/`Referer` are sent and URL restrictions are tested exactly as the deployment experiences them. Prints HTTP status, resource kind, sanitized endpoint, and Mapbox's own message, with an eight-class verdict that keeps authentication, tile, font, style, source-authorization, and application failures distinct. |
| `/debug/mapbox` → **Run all 6 levels** | Mounts raw SDK → atlasNight → Atlas provider → provider + markers → the Command Center composite, samples the actual framebuffer, and reports whether pixels are `rendered`, `flat`, or `unreadable`. |
| `?atlasdebug=map` on any product route | The same environment, stage trace, and last-error evidence as an on-screen panel — DevTools is not required to diagnose a phone. |

**Token identity without disclosure.** Both surfaces report the token's
account, its `pk.`/`sk.` classification, its length, a three-character prefix,
and a SHA-256 first-12 fingerprint reproducible as
`printf %s "$TOKEN" | shasum -a 256 | cut -c1-12`. Length and prefix alone
cannot tell two tokens from one account apart — every default public token for
an account has the same shape — which is exactly why the fingerprint exists.
The full token is never printed, and request URLs are recorded with
`access_token` and `sku` **replaced**, never truncated.

---

## Platform

| Item | Status | Notes |
|---|---|---|
| Next.js 16 / React 19 / TypeScript app | 🟢 REAL | Builds clean, no warnings. Strict TS with `noUncheckedIndexedAccess`. |
| Tailwind v4 design system | 🟢 REAL | Atlas tokens in `globals.css`. Canonical gold `#C4912F`. |
| Vercel deployment config | 🟢 REAL | Zero-config. `.env.example` documents every variable. |
| PWA manifest + generated icons | 🟢 REAL | `display: standalone`, `viewport-fit: cover`, `black-translucent` status bar. Icons generated as real PNGs at build time. |
| Service worker / offline shell | ⬜ Not started | Deliberately deferred — see ARCHITECTURE.md. |
| Test suite (67 tests) | 🟢 REAL | Vitest. Covers provenance, geometry, Atlas rules, vehicle schema, map style discipline, and map runtime lifecycle. The event-replay tests were mutation-checked — they fail against the pre-fix code. |

## Map

| Item | Status | Notes |
|---|---|---|
| Atlas-owned map abstraction | 🟢 REAL | `MapProvider` / `MapHandle`. Nothing outside `src/map/mapbox/` imports `mapbox-gl`. |
| Mapbox GL JS v3 provider | 🟢 REAL | Code-split — the SDK and its CSS load only when the map mounts. |
| `atlasNight` style | 🟢 REAL | Full style spec authored in-repo (`src/map/mapbox/atlas-night.ts`), not a Studio URL. Obsidian world, seven-step neutral road ladder, violet atmosphere, filtered POIs. **Validated against Mapbox's own style-spec validator (0 errors)**, plus design-discipline assertions. |
| Map failure diagnostics | 🟢 REAL | Twelve-stage `[AtlasMap]` trace **plus an on-screen panel** at `?atlasdebug=map` — DevTools is not required. Never exposes the token (presence, length, prefix only) and reduces request URLs to host+path so `access_token=` cannot be screenshotted. |
| `/debug/mapbox` isolation harness | 🟢 REAL | Six progressive levels: stock Standard → stock Dark → atlasNight minimal → atlasNight full → Atlas provider → provider + markers. Unlinked, `noindex`, production-reachable by design (the bug only reproduces there). |
| Map error isolation | 🟢 REAL | `MapErrorBoundary` — a Mapbox exception degrades the environmental layer only and can no longer unmount the Command Center. |
| Layer ordering | 🟢 REAL | Explicit `z-0` map / `z-10` scrims / `z-20` chrome / `z-40` diagnostics / `z-50` sheet. The map can never cover Atlas controls. |
| Map failure states | 🟢 REAL | Distinct honest states for not-configured / rejected-by-service / graphics-unsupported / failed / unreachable / timeout. A rejected token prints the hostname that needs allowing. 15s watchdog guarantees the loading veil always resolves. |
| 3D buildings | 🟡 FUNCTIONAL, INCOMPLETE | Enabled only on devices with >4 cores and no reduced-motion preference. Not yet validated on a real phone. |
| Terrain / elevation | ⬜ Not started | Source wired, disabled by default. Most expensive feature here; adds little at city zooms. |
| Camera transitions | 🟢 REAL | `immediate` / `standard` / `cinematic`, the last using `flyTo` so long moves arc rather than interpolate. |
| User puck + destination marker | 🟢 REAL | Puck owned by `AtlasMap`, so identity survives a vendor change. |
| Route line / turn-by-turn / traffic / ETA | ⬜ Not started | A destination can be set; nothing computes a route. The UI says so. |
| **Map rendering with a real token** | 🔴 BLOCKED | **No Mapbox token available in this environment. The map has never rendered.** Everything above is verified by build, types, and tests only. |

## Location

| Item | Status | Notes |
|---|---|---|
| Browser geolocation | 🟢 REAL | Full permission state machine: unknown / prompt / granted / denied / unsupported, plus acquiring, timeout, position-unavailable. |
| Speed + heading | 🟢 REAL | Modeled as independently-unavailable readings. Renders `—`, never `0`. Most devices report `null` unless genuinely moving. |
| Secure-context handling | 🟢 REAL | Detected and surfaced rather than failing silently. |
| Follow-mode | 🟢 REAL | A hand gesture breaks follow; recenter restores it. |
| **Verified on a real device** | 🔴 BLOCKED | Not tested on a physical phone. |

## Atlas

| Item | Status | Notes |
|---|---|---|
| Command surface (search + commands unified) | 🟢 REAL | One input serves both. Full-screen so it never fights the mobile keyboard. |
| Rule-based intent parsing | 🟢 REAL | Genuinely deterministic. Handles home, work, "navigate to X", "where am I", "show my vehicles". |
| Honest failure on unrecognized input | 🟢 REAL | Reports `source: "unavailable"` and lists what it *can* do. Never improvises. Asserted by test. |
| Natural-language understanding | 🔴 BLOCKED | No model configured. `AtlasProvider` interface and `capabilities.naturalLanguage: false` are in place; the provider does not claim ability it lacks. |
| Voice input | 🟡 FUNCTIONAL, INCOMPLETE | Web Speech API is real where supported and genuinely transcribes. Unsupported on Firefox, unreliable on iOS Safari — **the hero browser**. The control renders as explicitly unavailable rather than dead. Server-backed STT boundary is defined. |
| Text-to-speech / spoken guidance | ⬜ Not started | |

## Destinations

| Item | Status | Notes |
|---|---|---|
| Unified `Destination` model | 🟢 REAL | Search, saved, recents, home, work, and Atlas all produce the same shape. |
| Place search | 🟡 FUNCTIONAL, INCOMPLETE | Real Mapbox Geocoding v6 call behind `/api/search`. Debounced, abortable, distance computed client-side. **Untested against the live API** — no token. Returns an explicit `not-configured` failure without one. |
| Saved + recent destinations | 🟢 REAL | Persisted, deduplicated by proximity, capped at 8 recents. |
| Home / Work anchors | 🟡 FUNCTIONAL, INCOMPLETE | Store supports them; no UI to set one yet. Atlas correctly says "you haven't set a home address" until then. |

## Vehicles

| Item | Status | Notes |
|---|---|---|
| Vehicle schema | 🟢 REAL | Zod. Anticipates the full Command Center — VIN, plate, purchase, photo, notes — so it will not need replacing. VIN validation excludes I/O/Q. |
| Create / list / delete | 🟢 REAL | Validated and persisted; survives reload. |
| Odometer as a timestamped reading | 🟢 REAL | Modeled as an observation, not a mutable number, so trip accumulation and service intervals compute later without migration. |
| Vehicle photos | 🔴 BLOCKED | `photoKey` modeled; no upload path and no blob storage. |
| Maintenance / service / receipts / trips | ⬜ Not started | Out of scope for this phase by instruction. |

## Persistence & Auth

| Item | Status | Notes |
|---|---|---|
| `VehicleStore` / `DestinationStore` interfaces | 🟢 REAL | `durability` is part of the interface, so the UI can disclose it. |
| Browser-local implementation | 🟢 REAL | Genuine persistence. **Not synced, not backed up, not authenticated** — disclosed in the Garage UI. |
| Server persistence | 🔴 BLOCKED | Needs a database provider decision + credentials. See ARCHITECTURE.md. |
| Authentication | 🔴 BLOCKED | Same. No accounts exist. |

---

## Inert-by-design controls

Every visible control either acts, enters an explicit state, or visibly reports
unavailability. The ones that are not fully functional:

| Control | Behavior |
|---|---|
| Map layers button | Rendered `disabled`, labeled "not available yet". |
| Microphone (unsupported browsers) | Replaced by a struck-through icon and the reason. |
| Destination banner | Sets a marker and flies the camera; explicitly states routing and ETA are unavailable. |
| Telemetry (no permission) | Becomes an "Enable location" button; explains denial when denied. |

## What has never been observed running

Stated plainly so nothing here is mistaken for verified:

- **The map has never rendered.** No Mapbox token exists in this environment,
  and this machine has no browser to run WebGL. The 2026-08-15 fixes are
  verified by typecheck, tests, mutation testing, and production build — **not**
  by observing a map.
- Geocoding has never returned a live result.
- Nothing has been opened on a physical phone.
- 3D buildings, camera flights, and the puck have not been seen in motion.
- The deployed Vercel application has not been observed at all.

Build, typecheck, tests, and server responses are verified. Visual, runtime,
and device behavior is not.
