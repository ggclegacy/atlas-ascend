# Mapbox Integration

**Status: 🔴 Blocked** — requires Xcode and a Mapbox account.

`PlaceholderMapProvider` currently stands in for the real map. This document is
the handoff for replacing it.

## What already exists

The vendor boundary is designed and built. Nothing above `MapProvider` imports
Mapbox, and nothing needs to change in `AtlasCommandCenter` when the real
provider lands:

- `MapCoordinate`, `MapCamera`, `MapConfiguration`, `MapAnnotation` — Atlas's own
  vendor-neutral types
- `MapPerspective` — driving / oriented / overview, each with a pitch
- `MapProvider` — the single protocol a vendor must satisfy
- `MapUserPuck` — the location puck, deliberately owned by `AtlasMap` rather than
  by a provider, so it looks identical regardless of vendor
- `\.mapProvider` environment key — the one injection point

## Steps

1. **Account and token.** Create a Mapbox account, then generate two tokens:
   - a *public* token (`pk.…`) for the app at runtime
   - a *secret* token (`sk.…`) with the `DOWNLOADS:READ` scope, needed to fetch
     the SDK

2. **Store the secret token outside the repo.** It goes in `~/.netrc`, which is
   where the Mapbox SPM resolver looks:

   ```
   machine api.mapbox.com
     login mapbox
     password sk.YOUR_SECRET_TOKEN
   ```

3. **Store the public token outside the repo too.** Put it in
   `Secrets.xcconfig` (already gitignored) and reference it from `Info.plist`
   as `MBXAccessToken`. **Do not hard-code it in source** — a token in git
   history is a token that has to be rotated.

4. **Add the SDK** via Swift Package Manager:
   `https://github.com/mapbox/mapbox-maps-ios` (v11+).

5. **Author the Atlas styles in Mapbox Studio.** `MapStyleID.atlasNight` and
   `.atlasDaylight` must be real custom styles built to the Atlas palette —
   near-black land, violet-tinted water, gold arterials. Shipping a stock dark
   style would not match the product, and the map is too central to the identity
   to compromise here. Record the resulting style URIs against the enum cases.

6. **Write `MapboxMapProvider`** in `Sources/AtlasMap/`, conforming to
   `MapProvider`:
   - `maturity` returns `.production` — this is what removes the on-screen badge
   - `makeMapView(configuration:)` wraps Mapbox's `MapView`
   - `moveCamera(to:transition:)` maps `MapCameraTransition` onto Mapbox's own
     camera animation API. **Do not** let SwiftUI animate the coordinate — that
     interpolates linearly across the globe instead of flying properly.

7. **Switch the provider** in `AtlasAscendApp.makeMapProvider()`. Keep the
   placeholder available for previews and UI tests so neither burns map loads
   nor requires network access.

8. **Update `STATUS.md`.**

## Watch out for

- **Billing.** Mapbox bills per map load. Wire the placeholder into previews and
  tests deliberately, or CI will quietly cost money.
- **Binary size.** The Maps SDK is large; check the impact on app thinning.
- **The puck is ours.** Disable Mapbox's built-in location puck and render
  `MapUserPuck` instead, or the product identity changes with the vendor.
