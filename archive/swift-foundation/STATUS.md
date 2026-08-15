# Atlas Ascend — Implementation Status

The product-integrity rule requires that we always know what is real. This file
is the ledger. **Update it in the same commit as the code it describes.**

Legend:

| Status | Meaning |
|---|---|
| 🟢 **Production** | Real implementation, works, ready to depend on |
| 🟡 **Functional, incomplete** | Real but missing capability or polish |
| 🔵 **Prototype** | Real code, design not settled |
| 🟠 **Mocked** | Interface exists, behavior is fake or hard-coded |
| 🔴 **Blocked** | Cannot proceed without an external dependency |

Last updated: 2026-08-14

---

## Foundation

| Item | Status | Notes |
|---|---|---|
| Design system (`AtlasDesign`) | 🟢 Production | Tokens, materials, motion, primitives. Builds under Swift 6 strict concurrency; 15 invariant tests pass. |
| Modular package structure | 🟢 Production | `AtlasDesign` → `AtlasMap` → `AtlasCommandCenter`. No cyclic deps. |
| CLI verification (`Scripts/verify.sh`) | 🟡 Functional, incomplete | Builds/tests against **macOS**. Cannot catch iOS-only issues and never runs on a simulator. |
| iOS app target | 🔴 Blocked | **No Xcode installed.** `App/AtlasAscendApp.swift` and `App/Info.plist` are written and ready; no `.xcodeproj` exists. Nothing has ever run on a device or simulator. |

## Navigation

| Item | Status | Notes |
|---|---|---|
| Map provider abstraction (`MapProvider`) | 🟢 Production | Vendor-neutral. `MapCoordinate`/`MapCamera`/`MapConfiguration` keep Mapbox types out of feature code. |
| `PlaceholderMapProvider` | 🟠 Mocked | **Shows no real geography.** Abstract perspective grid for composition work only. Reports `.developmentPlaceholder`, which drives the on-screen badge. |
| Mapbox integration | 🔴 Blocked | Needs Xcode + an access token. See `MAPBOX_INTEGRATION.md`. |
| `atlasNight` / `atlasDaylight` map styles | 🔴 Blocked | Must be authored in Mapbox Studio to the Atlas palette. A stock dark style is not an acceptable substitute. |
| Location services | 🔴 Blocked | No CoreLocation code yet. Permission strings written in `Info.plist` but nothing requests them. Speed and trip distance render as `—` by design. |
| Routing, turn-by-turn, traffic, ETA | ⬜ Not started | |
| Search / geocoding | ⬜ Not started | |

## Atlas (intelligence)

| Item | Status | Notes |
|---|---|---|
| Prompt bar UI | 🟡 Functional, incomplete | Idle / listening / thinking states render correctly. |
| Microphone | 🟠 Mocked | `toggleListening()` moves UI state only. **No speech recognizer, no audio session, no transcription.** |
| Listening waveform | 🟠 Mocked | Decorative animation, **not audio-reactive**. Documented in-line. |
| LLM / intent handling | ⬜ Not started | No model client. Provider abstraction not yet designed. |

## Vehicle, trips, maintenance, documents

| Item | Status | Notes |
|---|---|---|
| `VehicleSummary` (display shape only) | 🟠 Mocked | Sample "Range Rover" fixture for design review. No persistence, no real model. |
| Vehicle Command Center | ⬜ Not started | Vehicle chip's tap action is an empty closure. |
| Trip / mileage history | ⬜ Not started | |
| Maintenance + service records | ⬜ Not started | |
| Receipt / document intelligence | ⬜ Not started | |

## Ecosystem

| Item | Status | Notes |
|---|---|---|
| iPhone | 🔵 Prototype | One screen. |
| iPad / CarPlay / Apple Watch | ⬜ Not started | Provider injection point exists to support them later. |

---

## Inert controls on the Command Center

These render and respond to touch but intentionally do nothing yet. Listed so
none of them is mistaken for working:

- Vehicle chip → Vehicle Command Center (not built)
- Map layers button (not built)
- Recenter button (needs location services)
- Destination pills → routing (not built)
- Prompt bar text field → Atlas text entry (not built)
