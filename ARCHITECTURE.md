# Atlas Ascend — Architecture

Decisions that are expensive to reverse, and why they were made.

---

## 1. Next.js on Vercel, not a SPA

Vercel deployment is the source of truth, which makes Next.js the default rather
than a fashion choice. Three things earned it specifically:

- **Server routes** let the geocoding token stay server-side. A pure SPA would
  have to ship every API key to the browser.
- **File-based metadata** generates the PWA icons as real PNGs at build time
  from the same gold ramp the app uses, so the icon cannot drift from the brand.
- **Server components** keep the initial payload small; only surfaces that need
  interactivity become client components.

React Server Components are used sparingly. The Command Center is inherently
stateful and interactive, so it is a client component — pretending otherwise
would add ceremony for no benefit.

## 2. The map vendor boundary

`src/map/provider.ts` defines `MapProvider` and `MapHandle`. **Nothing outside
`src/map/mapbox/` may import `mapbox-gl`.**

Feature code speaks `Coordinate`, `MapCamera`, `MapPerspective` — never
`LngLat`, never `mapboxgl.Map`. The cost is one thin translation layer; the
benefit is that a licensing, pricing, or capability change does not become a
rewrite.

**The handle is imperative on purpose.** Map SDKs own a canvas and a render
loop. Driving the camera through React state produces dropped frames and fights
the SDK's own animation system, so the map mounts once and is commanded
directly afterward.

## 3. `atlasNight` lives in the repo, not in Mapbox Studio

`src/map/mapbox/atlas-night.ts` is a complete Mapbox style specification.

A Studio style is a URL pointing at a mutable document in a web console. The map
is central to the product identity, so its visual definition belongs in version
control where it can be reviewed, diffed, rolled back, and tested. It is tested:
`tests/atlas-night.test.ts` asserts the road ladder brightens monotonically and
that **no road is ever painted gold**.

Color discipline: the basemap is obsidian. Gold is reserved for route and
precision information added at runtime; violet appears only in the atmospheric
fog. Painting the road network gold would spend the accent on permanent chrome
and leave nothing to signify the active route.

## 4. Provenance as a type, not a convention

`Reading<T>` is a discriminated union where the unavailable case carries no
value. This makes the honesty standard structural: a developer cannot render a
fabricated number, because there is no number to render.

`Metric` takes a `Reading<T>` rather than a raw value, so the em-dash rule is
impossible to bypass at the presentation layer.

There is no `valueOr(default)` helper, and that omission is deliberate —
defaulting an unknown sensor reading to a plausible number is precisely the
failure the module exists to prevent.

## 5. Persistence — current state and the path forward

**Today:** `VehicleStore` and `DestinationStore` interfaces with
browser-local implementations. This is *real* persistence — data survives
reloads — but it is not synced, backed up, or authenticated. `durability` is
part of the interface so the UI discloses this rather than hiding it.

**The production path**, when you are ready:

| Concern | Recommendation | Why |
|---|---|---|
| Database | **Neon Postgres** (via Vercel Marketplace) | Serverless Postgres, scales to zero, no connection-pool problems on serverless. Relational is correct here — vehicles, trips, and service records are deeply relational. |
| ORM | **Drizzle** | TypeScript-first, no codegen step, SQL-shaped |
| Auth | **Auth.js** | Runs on Vercel, no per-MAU pricing, owns its own tables |
| Blob storage | **Vercel Blob** | Vehicle photos and receipt scans |

This requires **your decision and your credentials** — it is a paid-service
choice with cost implications, so it stops at that boundary rather than being
made unilaterally.

The migration is additive: implement `PostgresVehicleStore` against the existing
interface, return `durability: "account-synced"`, and no feature code changes.

## 6. Voice is a progressive enhancement, never a dependency

Findings from investigating what browsers actually do:

- The Web Speech API is prefixed (`webkitSpeechRecognition`) everywhere it exists.
- Chrome supports it but streams audio to Google's servers — a real privacy
  characteristic, not an implementation detail.
- **iOS Safari — this product's hero browser — is inconsistent across versions.**
- Firefox does not support it at all.

So voice can never be assumed. `SpeechInputProvider` exists so a server-backed
transcription service can replace the browser implementation without the UI
changing. Until then the control reports its own unavailability rather than
sitting dead.

## 7. Performance decisions

| Decision | Reason |
|---|---|
| `mapbox-gl` behind a dynamic `import()` | ~800KB SDK stays out of the initial bundle; the shell is interactive first |
| Mapbox CSS also dynamically imported | Removed ~40KB of render-blocking CSS (64.5KB → 23.8KB initial) |
| System font stack, no webfont | On iPhone this resolves to SF Pro — the exact face the design was specified in — at zero network cost and with no swap flash |
| 3D buildings gated on `hardwareConcurrency > 4` | A phone dropping frames while navigating is a worse product than one without extruded buildings |
| Terrain off by default | Most expensive feature available; adds little at city navigation zooms |
| Blur confined to `.atlas-glass` | Backdrop blur is expensive; it earns its cost only over the map, where opacity would kill the spatial illusion |
| `renderWorldCopies: false` | Saves draw calls for a case a driver never encounters |

## 8. Mobile-first, deliberately not a website

- `100dvh`, which tracks collapsing browser chrome — `100vh` famously does not.
- `viewport-fit=cover` + `env(safe-area-inset-*)`, without which the map cannot
  extend into the notch and home-indicator regions.
- `black-translucent` status bar — any other value makes iOS reserve an opaque
  strip, and the full-bleed map is the core of the identity.
- `overscroll-behavior: none` and suppressed tap highlights and long-press
  callouts — the three things that most immediately betray a web app as a page.
- The search surface is full-screen rather than a half sheet, so it never fights
  the mobile keyboard for vertical space.

## 9. No service worker yet

An offline shell for a live-map navigation product is mostly theater, and a
badly-scoped service worker is a reliable way to serve users a stale build. The
manifest gives standalone launch and home-screen installation — the parts that
actually matter — without that risk. Revisit when there is genuinely
offline-useful content (saved destinations, vehicle records) to cache.

---

## Recommended next phase

1. **Provide a Mapbox token** and validate `atlasNight` on a real phone. Nothing
   about the map's appearance has been observed; the style will need tuning
   passes against real tiles.
2. **Routing.** The `Route` boundary is the missing piece of the navigation
   pillar — Mapbox Directions behind an Atlas-owned interface, then the gold
   route line, ETA, and distance remaining. This is where the reserved accent
   finally gets spent.
3. **Home/Work UI**, so the Atlas commands that already work have data to act on.
4. **Persistence + auth**, once you have chosen a provider.
5. **Model-backed Atlas**, behind the existing `AtlasProvider` interface, with
   the rule-based parser retained as the fast offline path.
