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

**Phase:** 2 — web application foundation
**Last updated:** 2026-08-14
**Deployable to Vercel:** Yes. Builds clean; runs without any environment variable, with the map in a designed blocked state until a Mapbox token is set.

---

## Platform

| Item | Status | Notes |
|---|---|---|
| Next.js 16 / React 19 / TypeScript app | 🟢 REAL | Builds clean, no warnings. Strict TS with `noUncheckedIndexedAccess`. |
| Tailwind v4 design system | 🟢 REAL | Atlas tokens in `globals.css`. Canonical gold `#C4912F`. |
| Vercel deployment config | 🟢 REAL | Zero-config. `.env.example` documents every variable. |
| PWA manifest + generated icons | 🟢 REAL | `display: standalone`, `viewport-fit: cover`, `black-translucent` status bar. Icons generated as real PNGs at build time. |
| Service worker / offline shell | ⬜ Not started | Deliberately deferred — see ARCHITECTURE.md. |
| Test suite (51 tests) | 🟢 REAL | Vitest. Covers provenance, geometry, Atlas rules, vehicle schema, map style discipline. |

## Map

| Item | Status | Notes |
|---|---|---|
| Atlas-owned map abstraction | 🟢 REAL | `MapProvider` / `MapHandle`. Nothing outside `src/map/mapbox/` imports `mapbox-gl`. |
| Mapbox GL JS v3 provider | 🟢 REAL | Code-split — the SDK and its CSS load only when the map mounts. |
| `atlasNight` style | 🟢 REAL | Full style spec authored in-repo (`src/map/mapbox/atlas-night.ts`), not a Studio URL. Obsidian world, seven-step neutral road ladder, violet atmosphere, filtered POIs. Asserted by tests. |
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

- The map has never rendered — no Mapbox token in this environment.
- Geocoding has never returned a live result.
- Nothing has been opened on a physical phone.
- 3D buildings, camera flights, and the puck have not been seen in motion.

Build, typecheck, tests, and server responses are verified. Visual and
device behavior is not.
