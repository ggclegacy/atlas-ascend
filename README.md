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

## Deploying to Vercel

1. Push to GitHub.
2. Import the repository in Vercel — it detects Next.js with no configuration.
3. Add **one** environment variable (Project → Settings → Environment Variables):
   - `NEXT_PUBLIC_MAPBOX_TOKEN` — a public `pk.` token. This is the only
     variable the map reads, from a single function in `src/lib/env.ts`.
   - `MAPBOX_TOKEN` is **optional and unrelated to the map** — it only overrides
     the geocoding token used by `/api/search`. If you are debugging a blank
     map, delete it; it is a red herring.
4. Deploy.

Restrict the public token to your production domain in the Mapbox dashboard.
It ships to the browser by design; URL restriction is how it is protected, not
secrecy.

**Required token scopes.** A default public token has these already. If you
created a dedicated token and unchecked scopes:

| Scope | Needed? | Consequence if missing |
|---|---|---|
| `styles:tiles` | **Yes** | Vector tiles never load — **the map renders black** |
| `fonts:read` | **Yes** | Map labels disappear; geography still draws |
| `styles:read` | No | `atlasNight` is authored in-repo; no hosted style is fetched |

## Diagnosing the map

Two tools, both production-safe and unlinked from the product:

- **`/debug/mapbox`** — isolation harness. Six levels from a stock Mapbox style
  on the raw SDK up through the full Atlas provider. The first level that goes
  black identifies the broken layer.
- **`?atlasdebug=map`** — on-screen diagnostic panel over the Command Center:
  token presence, WebGL, container size, every init stage, canvas dimensions,
  style/layer counts, and the last Mapbox error with HTTP status.

Neither exposes the token — only its presence, length, and `pk.`/`sk.` prefix.
Request URLs are reduced to host and path, so the `access_token=` query string
can never be screenshotted.

---

## Adding to your home screen

On iOS Safari: Share → Add to Home Screen. The app launches standalone with no
browser chrome, the map running under the status bar.

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for design decisions and the
persistence path.
