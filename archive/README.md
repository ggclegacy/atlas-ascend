# Archive

## `swift-foundation/`

The original Atlas Ascend foundation, built as native SwiftUI before the
decision to ship as a Vercel-hosted web application.

**It is archived, not deleted, and it is not built by anything.** The web app's
`tsconfig.json` excludes this directory and no build step touches it.

### Why it is kept

The Swift code contains the product decisions the web implementation is derived
from, expressed with more supporting commentary than the ports carry:

| Swift source | What it established | Where it now lives |
|---|---|---|
| `Sources/AtlasDesign/Tokens/AtlasColor.swift` | Obsidian depth ladder; the three color rules | `src/app/globals.css` |
| `Sources/AtlasDesign/Materials/AtlasMaterials.swift` | Gold as a material; scrims over the map | `src/app/globals.css` |
| `Sources/AtlasDesign/Tokens/AtlasTypography.swift` | Display tightens / labels open; tabular telemetry | `src/app/globals.css` |
| `Sources/AtlasDesign/Tokens/AtlasMotion.swift` | The five motion curves | `src/app/globals.css` |
| `Sources/AtlasMap/MapProvider.swift` | Vendor-neutral map boundary; provider maturity | `src/map/provider.ts` |
| `Sources/AtlasMap/MapTypes.swift` | Coordinate / camera / perspective model | `src/map/types.ts` |
| `Sources/AtlasMap/MapUserPuck.swift` | Puck composition (violet core, gold ring) | `src/map/mapbox/markers.ts` |
| `Sources/AtlasCommandCenter/CommandCenterModel.swift` | `DataSource` provenance philosophy | `src/lib/provenance.ts` |
| `Sources/AtlasCommandCenter/CommandCenterView.swift` | "The map is the screen" composition | `src/features/command-center/` |

One deliberate divergence: canonical gold moved from `#C9A544` to **`#C4912F`**,
and the metallic ramp was rederived around it.

### Reviving it

Nothing here is wired to a build. It targeted iOS 17+ / Swift 6 and was verified
against the macOS SDK via `swift-foundation/Scripts/verify.sh`. If native
clients (CarPlay, Apple Watch) are ever revisited, this is the starting point —
but the web app is the product.
