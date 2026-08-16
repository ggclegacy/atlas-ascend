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

**Phase:** 2 — web application foundation (+ blank-map incident, + fresh-deploy readiness)
**Last updated:** 2026-08-16
**Deployable to Vercel:** Yes, zero-config. Requires exactly one environment variable (`NEXT_PUBLIC_MAPBOX_TOKEN`), and deploys successfully without even that — showing an explicit MAP SERVICE NOT CONFIGURED state.

---

## Verification tiers

Three distinct levels of confidence. Nothing may be promoted between them
without the corresponding evidence.

| Tier | Meaning | Current state |
|---|---|---|
| ✅ **BUILD VERIFIED** | Typecheck, tests, production build, local production serve all pass | **Yes** — 84 tests, clean build, verified both with and without a token present |
| ⬜ **RUNTIME VERIFIED** | A real browser executed the code and WebGL rendered a frame | **No** — this machine has no browser; no WebGL has ever executed here |
| 🟡 **PRODUCTION OBSERVED** | The deployed Vercel app was inspected | **Partially (2026-08-16)** — the live deployment was fetched and inspected at the HTTP level. Visual rendering still unobserved. |

**What production observation established (2026-08-16).** The deployment was
fetched and inspected directly:

- All routes return 200, including `/debug/mapbox`
- The deployed client bundle contains the current commit (verified by the new
  motorway color `#78788c` and the `atlasdebug` flag)
- **`NEXT_PUBLIC_MAPBOX_TOKEN` is present in the production client bundle**
- That exact token was then tested against every Mapbox endpoint the map uses

What it did **not** establish: whether WebGL draws a frame in a real browser.
That still requires a human looking at a screen.

---

## ⚠️ Open incident: map not visibly rendering in production

**Reported:** deployment succeeds, Command Center shell and search render, the
map area is blank/dark. `NEXT_PUBLIC_MAPBOX_TOKEN` is set in Vercel.

**Ruled out by direct evidence** (2026-08-15):

| Suspect | Verdict | How it was proven |
|---|---|---|
| Token not reaching the client | **Not the cause** | Built with a probe token; found inlined in a client chunk |
| `atlasNight` style invalid | **Not the cause** | 0 errors from Mapbox's own style-spec validator, all 4 capability configs |
| Mapbox CSS lost by the dynamic import | **Not the cause** | CSS chunk is emitted and referenced by a Turbopack loader stub present in the page graph |
| Container sizing | **Not the cause** | `absolute inset-0` inside a `position: relative`, `100dvh` viewport; now additionally guarded |

**Confirmed defects — fixed:** the loading veil was opaque with no timeout, so
any failure to reach `load` rendered exactly the reported blank rectangle;
`ready`/`error` emitted before the consumer subscribed were dropped with no
replay; error classification regex-matched messages and mislabeled a 401 as
"no token configured"; a `maritime`-vs-string filter silently suppressed all
admin boundaries.

**Second pass (2026-08-15, after report of a still-black screen).** Additional
suspects ruled out by direct inspection of the built output:

| Suspect | Verdict | How it was checked |
|---|---|---|
| Tailwind not generating utilities | **Not the cause** | `bg-obsidian`, `text-ink`, `atlas-glass`, `atlas-viewport`, `atlas-scrim-top`, `bg-raised` all present in the emitted stylesheet |
| z-index / stacking conflict | **Not the cause** | No z-index anywhere in the Command Center tree; chrome follows the map in DOM order. Explicit `z-0/10/20` layering added anyway to make it structural |
| Map covering Atlas chrome | **Not possible now** | Map pinned to `z-0` beneath scrims (`z-10`) and controls (`z-20`) |
| Mapbox exception unmounting the page | **Now impossible** | `MapErrorBoundary` isolates the map subtree |
| `MAPBOX_TOKEN` interfering | **Could not affect the map** | The map read `NEXT_PUBLIC_MAPBOX_TOKEN` only. `MAPBOX_TOKEN` has since been removed entirely — the app now requires exactly one variable |

**Both account-level hypotheses are now DISPROVEN (2026-08-16).** The token was
extracted from the deployed production bundle and tested directly against every
Mapbox endpoint the map depends on, with and without a `Referer` header for the
deployment hostname:

| Resource | With Referer | No Referer | Meaning |
|---|---|---|---|
| TileJSON (`/v4/mapbox.mapbox-streets-v8.json`) | **200** | 200 | `styles:tiles` present |
| Vector tile (`/v4/…/12/935/1686.mvt`) | **200** | 200 | tiles genuinely load |
| Glyphs (`/fonts/v1/…/DIN Pro Medium`) | **200** | 200 | `fonts:read` present |
| Geocoding (`/search/geocode/v6`) | **200** | 200 | search would work |
| Stock style (`/styles/v1/mapbox/dark-v11`) | **200** | 200 | token fully valid |

Identical results with and without the `Referer` header prove there are **no URL
restrictions** on this token. **No Mapbox account action is required.**

~~1. Token lacks the `styles:tiles` scope.~~ **Disproven — 200.**
~~2. Token URL restrictions exclude the hostname.~~ **Disproven — 200 either way.**

3. ~~The map renders correctly but **reads as black**.~~ → **FIXED IN CODE
   (2026-08-16).** This was the only candidate addressable from the repository,
   and on inspection the numbers were damning: roads ran `#191920`–`#525263`
   against a `#05050A` ground (≈12% luminance separation at the widest point),
   fog began compressing toward near-black at `range: [0.8, …]` under a 62°
   pitch, and the scrims laid 0.82/0.93 black over ~65% of a phone viewport.
   A perfectly functioning map would have read as a black rectangle.

**Legibility revision (2026-08-16)** — a correction against the original
atlasNight brief, which specified "highly legible, built for navigation":

| Element | Before | After |
|---|---|---|
| Road ladder | `#191920` → `#525263` | `#2A2A33` → `#78788C` |
| Water | `#0A0917` | `#12102A` |
| Buildings | `#101017` | `#191922` |
| Road labels | `#8F8C99` | `#ADAAB6` |
| Fog range / color | `[0.8, 9]` / `#0A0912` | `[1.6, 14]` / `#191630` |
| Scrims | 0.82 / 0.93 black | 0.68 / 0.82 black |

The ground stays near-black — obsidian is about depth, not invisibility. A test
now enforces a minimum luminance separation for every road class against the
background, so the map cannot silently become unreadable again.

**Where this leaves the incident.** Token, scopes, restrictions, style validity,
CSS wiring, stacking, and Tailwind output are all eliminated by direct evidence.
The legibility defect — the one candidate that was both real and fixable from
code — has been fixed and deployed. The remaining unknown is narrow: whether a
real browser draws a frame.

`/debug/mapbox` now answers that objectively. It mounts each layer in turn and
**samples the actual framebuffer**, which distinguishes the two failures that
look identical in a screenshot:

- `flat` — one uniform color: the style applied, tiles never drew
- `unreadable` — real structure present, nothing above the visible threshold
- `rendered` — genuine geography

That distinction is what kept this incident alive for three passes.

---

## Fresh-deployment readiness (2026-08-16)

A pass to remove every avoidable source of deployment ambiguity before a new
Vercel project is created.

**Verified by building twice**, which is the only way to prove both halves of
the fresh-deploy contract:

| Build | Result |
|---|---|
| **No environment variables at all** | Builds clean. `/`, `/vehicles`, `/debug/mapbox`, `/manifest.webmanifest`, `/icon` all 200. `/api/search` returns `503 {"failure":"not-configured"}` — honest, not a crash. **Zero token literals in the bundle.** |
| **With a probe token** | Builds clean. Token inlined into client chunks (statically analyzable access confirmed). All routes 200. **No full token in any HTML.** |

**Changes:**

| Area | Before | After |
|---|---|---|
| Mapbox env variables | 2 (`NEXT_PUBLIC_MAPBOX_TOKEN` + optional `MAPBOX_TOKEN`) | **1** — `MAPBOX_TOKEN` removed; `/api/search` uses the public token |
| Token accessor | `getMapboxToken()` | `getPublicMapboxToken()` — one statically-analyzable literal access |
| Mapbox CSS | dynamic `import()` (worked, but relied on bundler internals) | **static import** in `MapSurface` — determinism over 40KB |
| Failure taxonomy | 6 reasons; every 401/403 collapsed to "unauthorized" | **10 reasons**, each implying a different action: `missing-token`, `invalid-token`, `forbidden`, `tile-access-denied`, `style-access-denied`, `request-rejected`, `network`, `timeout`, `webgl-unsupported`, `unknown` |
| Default camera | module-private literal | exported `DEFAULT_CAMERA` + `isValidCamera()`, with tests for lat/lon order, null-island, and zoom sanity |
| Old hostname | referenced in docs | removed; diagnostics read `window.location.hostname` live |

**Confirmed for a fresh import:** Next.js auto-detected, root `./`, default
build/install commands, no `vercel.json`, no `.vercel` committed, no stale
deployment metadata, `engines.node >=20.9.0` (permissive — Vercel picks its
default), single `mapbox-gl@3.28.1` with no duplicates, no secrets in tracked
or untracked files.

**Map rendering does not depend on geolocation.** The configuration memo has
empty dependencies and there are zero location-conditional renders; the camera
only moves once a genuine fix arrives.

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
