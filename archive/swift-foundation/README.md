# Atlas Ascend

**Grand Touring Intelligence** — NAVIGATE • OPTIMIZE • ASCEND

A personal mobility intelligence platform and mobile command center for life in
motion. Not a maps app, not a maintenance tracker, not a chatbot with navigation
attached.

> **Current state:** foundation. The design system and the Command Center screen
> are built and verified; the map is a placeholder and no iOS app has ever been
> run. See **[STATUS.md](STATUS.md)** for the honest per-feature ledger.

---

## Repository layout

```
Sources/
  AtlasDesign/          Design system — tokens, materials, motion, primitives
    Tokens/             Color, typography, spacing, radius, motion
    Materials/          Gold/violet gradients, surfaces, scrims
    Components/         Eyebrow, metric, controls, brand mark
  AtlasMap/             Vendor-neutral map abstraction + placeholder provider
  AtlasCommandCenter/   The hero screen
App/                    iOS app entry point (not yet in an Xcode project)
Tests/                  Design-system and model invariants
Scripts/verify.sh       Command-line build + test
```

Dependencies flow one way: `AtlasDesign` → `AtlasMap` → `AtlasCommandCenter`.

## Verifying

```bash
./Scripts/verify.sh
```

Builds and tests all modules against the **macOS** SDK under Swift 6 strict
concurrency. This exists so the core stays verifiable without a full Xcode
install — it is **not** a substitute for building the iOS app, and it cannot
catch iOS-only problems.

## Bringing up the iOS app

**Blocked on Xcode.** The machine currently has only Command Line Tools, so
there is no iOS SDK, no simulator, and no `.xcodeproj`. Once Xcode is installed:

1. Create an iOS App target named `Atlas Ascend` (iOS 17+, SwiftUI lifecycle).
2. Add this package as a local SPM dependency; link all three libraries.
3. Add `App/AtlasAscendApp.swift` and point the target at `App/Info.plist`.
4. Add a `LaunchBackground` color asset set to `#000000`.
5. Build and run — the Command Center appears with the placeholder map.
6. Then follow **[MAPBOX_INTEGRATION.md](MAPBOX_INTEGRATION.md)**.

## Design system

Three rules do most of the work. They are documented at length in
`Sources/AtlasDesign/Tokens/AtlasColor.swift`:

1. **Black is depth, not background.** Surfaces climb a ladder from true OLED
   black, each step gaining a little violet. Elevation should read as light
   gathering in a material, never as flat gray.
2. **Gold is a material, not a color.** Flat gold reads as yellow plastic
   instantly, so gold is defined as gradient stops with a shadow, a body, and a
   narrow specular band. `AtlasColor.gold` exists only for hairlines and small
   text.
3. **Violet is reserved.** It means Atlas intelligence or live system state.
   Spending it on ordinary chrome is what makes purple UI look like gaming
   decoration — the scarcity *is* the effect.

Use the system, not raw values: `.atlasType(AtlasType.eyebrow)`,
`.atlasSurface(.glass)`, `AtlasSpace.lg`, `AtlasMotion.considered`.

## Product integrity

The rule: **never invent fake production functionality.**

This is enforced structurally, not just by convention:

- `DataSource` (`.live` / `.sample` / `.unavailable`) is attached to every value
  the Command Center displays.
- `MapProviderMaturity` makes a provider declare whether it draws real geography.
- `SimulationBadge` renders on-screen whenever anything is not live, and
  disappears on its own once everything is.
- Unknown sensor values render as `—`, never as a plausible number. "0 mph" and
  "no GPS fix" are different facts and must look different.
- Tests assert the sample fixture reports itself as simulated and fabricates no
  sensor readings.

Anything mocked is marked `⚠️ MOCKED` in the source with a note on what the real
implementation must preserve.
