# Atlas Ascend

**Grand Touring Intelligence** — NAVIGATE • OPTIMIZE • ASCEND

A personal mobility intelligence platform and mobile command center for life in
motion, delivered through the web. Not a maps app, not a maintenance tracker,
not a chatbot with navigation attached.

> **Current state:** the web foundation is built and the Command Center is real.
> The map has not yet rendered because no Mapbox token exists in this
> environment. See **[STATUS.md](STATUS.md)** for the honest per-feature ledger.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # add your Mapbox token
npm run dev                    # http://localhost:3000
```

The app runs without any environment variable. Without a Mapbox token the map
renders a designed "unavailable" state rather than failing — everything else
(Atlas commands, vehicles, location permissions) still works.

### Verify

```bash
npm run verify    # typecheck + tests + production build
```

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | Vercel-native; server routes for secrets; file-based metadata generates PWA icons |
| UI | React 19 + TypeScript (strict) | `noUncheckedIndexedAccess` on |
| Styling | Tailwind CSS v4 | CSS-first `@theme` keeps design tokens in CSS, not a JS config |
| Map | Mapbox GL JS v3 | Behind an Atlas-owned abstraction |
| Validation | Zod | Schemas double as the persisted-data contract |
| Tests | Vitest | 51 tests |

TypeScript is pinned to 5.x rather than the newly-released 7.x — the type
ecosystem has not been validated against it, and this is not the place to spend
risk.

---

## Repository layout

```
src/
  app/                    Routes, layout, PWA manifest, generated icons
    api/search/           Geocoding proxy (keeps the geocoding token server-side)
  components/atlas/       Design-system primitives
  features/
    command-center/       The hero surface
    vehicles/             The garage
  map/
    types.ts              Vendor-neutral coordinate/camera model
    provider.ts           The map vendor boundary
    mapbox/               The ONLY place mapbox-gl may be imported
      atlas-night.ts      The Atlas map style, authored in-repo
  atlas/                  Intelligence + speech boundaries
  destinations/           One destination model, search, storage
  vehicles/               Schema + persistence
  location/               Browser geolocation state machine
  lib/provenance.ts       The honesty system
tests/                    Vitest
archive/swift-foundation/ The original SwiftUI foundation (not built)
```

---

## The three visual rules

Documented at length in `src/app/globals.css`. They are what separate this from
a generic dark-mode web app:

1. **Obsidian — black is depth, not background.** Six elevations climb from true
   black, each gaining a little violet. Elevation reads as light gathering in a
   material, never as flat grey.
2. **Ascend gold is a material, not a color.** `#C4912F` with a shadow side, a
   body, a lit face, and a narrow specular band. Flat gold reads as yellow
   plastic instantly, so it is confined to hairlines and small text.
3. **Atlas violet is reserved.** Intelligence and live state only. Spending it on
   ordinary chrome is what makes purple UI look like gaming decoration. The
   scarcity *is* the effect.

Use the system: `.atlas-glass`, `.atlas-gold-metal`, `.atlas-telemetry`,
`.atlas-eyebrow`, `--ease-atlas-cinematic`.

---

## The honesty system

**Never make the product appear more functional than it actually is.** This is
enforced structurally rather than by discipline:

- **`Reading<T>`** (`src/lib/provenance.ts`) is a discriminated union. An
  unavailable reading carries *no value* — you cannot read a number off it,
  because there isn't one. There is deliberately no `valueOr(default)` helper.
- **The em-dash rule.** Unknown values render `—`, never `0`. "0 mph" and "no GPS
  fix" are different facts and must look different. A genuine zero still renders
  as `0`; both directions are tested.
- **`MapProviderMaturity`** forces a map provider to declare whether it draws
  real geography.
- **`StoreDurability`** is part of the persistence interface, so the UI can tell
  the user their data lives in one browser.
- **Atlas never improvises.** Unrecognized input returns `source: "unavailable"`
  and lists what Atlas can actually do.
- **No dead controls.** Every control acts, enters an explicit state, or visibly
  reports why it is unavailable.

---

## Fresh Vercel Deployment

1. Import the GitHub repository into Vercel.
2. Framework: **Next.js** (auto-detected).
3. Root directory: **`./`**
4. Add environment variable: **`NEXT_PUBLIC_MAPBOX_TOKEN`**
5. Paste a Mapbox public **`pk.`** token.
6. Deploy.
7. If the token uses URL restrictions, allow the deployed production hostname.

Build command, install command, and output directory are all Vercel defaults —
leave them untouched. There is no `vercel.json`, and none is needed.

**That one variable is all the application reads.** It serves the browser map,
server-side geocoding, and routing. If it is absent the app still deploys and
runs, showing an explicit **MAP SERVICE NOT CONFIGURED** state rather than a
blank canvas.

`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, and `ELEVENLABS_VOICE_ID` may also be
present. They are provisioned for the Atlas intelligence and voice layers and
**no code in this repository reads them yet** — the app builds and behaves
identically with or without them. All three are server-only: none carries a
`NEXT_PUBLIC_` prefix, so none reaches the browser, and none ever should. See
`.env.example`.

> The token is inlined at **build** time, not read at runtime. Adding or
> changing it requires a rebuild — redeploying the same artifact will not pick
> it up.

### Required token capabilities

A default Mapbox public token already has all of these. They only matter if you
created a restricted token and unchecked boxes:

| Capability | Needed | Consequence if missing |
|---|---|---|
| `styles:tiles` | **Yes** | Vector tiles never load — **the map renders empty** |
| `fonts:read` | **Yes** | Map labels vanish; geography still draws |
| `styles:read` | Only for `/debug/mapbox` | The diagnostic route's stock-style comparison fails. `atlasNight` is authored in this repo, so the production map never fetches a hosted style. |

Nothing else is required — no datasets, no uploads, no secret token.

## Diagnosing the map

Two tools, both production-safe, unlinked from the product, and `noindex`. Both
read the hostname live, so they work on any deployment.

- **`/debug/mapbox`** — isolation harness. One button mounts six layers in turn
  (stock Mapbox style → atlasNight → atmosphere/3D → Atlas provider → provider +
  puck → the real `MapSurface`), **samples the actual framebuffer**, and prints
  a pass/fail table plus a one-sentence conclusion. It distinguishes *nothing
  drew* from *everything drew but is too dark to see* — which a screenshot
  cannot.
- **`?atlasdebug=map`** — on-screen panel over the Command Center: hostname,
  token presence and prefix, WebGL, container size, every init stage, canvas
  dimensions, style/layer counts, and the last Mapbox error with HTTP status.

Neither exposes the token — only presence, length, and the `pk.` prefix.
Request URLs are reduced to host and path, so the `access_token=` query string
can never be screenshotted.

Production always uses `atlasNight`. The stock Mapbox style is reachable **only**
through `/debug/mapbox`; the app never silently falls back to it, because a
stock map that looks fine would hide a real failure.

---

## Adding to your home screen

On iOS Safari: Share → Add to Home Screen. The app launches standalone with no
browser chrome, the map running under the status bar.

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for design decisions and the
persistence path.
