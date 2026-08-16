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

**Phase:** 2 — web application foundation (+ blank-map incident)
**Last updated:** 2026-08-15
**Deployable to Vercel:** Yes. Builds clean; runs without any environment variable, with the map in a designed blocked state until a Mapbox token is set.

---

## Verification tiers

Three distinct levels of confidence. Nothing may be promoted between them
without the corresponding evidence.

| Tier | Meaning | Current state |
|---|---|---|
| ✅ **BUILD VERIFIED** | Typecheck, tests, production build, local production serve all pass | **Yes** — 69 tests, clean build, all routes 200 |
| ⬜ **RUNTIME VERIFIED** | A real browser executed the code and WebGL rendered | **No** — this machine has no browser and no Mapbox token; no map has ever been rendered here |
| ⬜ **PRODUCTION OBSERVED** | The deployed Vercel app was observed working | **No** — the deployment has never been observed from this environment |

Everything below labeled 🟢 REAL is **BUILD VERIFIED** only, unless it says
otherwise. The map specifically is unverified at both higher tiers.

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
| `MAPBOX_TOKEN` interfering | **Cannot affect the map** | The map reads `NEXT_PUBLIC_MAPBOX_TOKEN` only, via one function. `MAPBOX_TOKEN` is used solely by `/api/search` |

**Remaining live hypotheses:**

1. Token lacks the **`styles:tiles`** scope → tiles never load → correct style,
   empty black canvas. **Account action — not fixable from code.**
2. Token URL restrictions exclude `atlas-ascend-8kez.vercel.app` → 401/403.
   **Account action — not fixable from code.**
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

**Hypotheses 1 and 2 remain decidable from a screenshot** via `/debug/mapbox`
(six-level isolation, stock style ↔ atlasNight A/B) and `?atlasdebug=map`
(on-screen canvas dimensions, style/layer counts, last error with HTTP status).

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
