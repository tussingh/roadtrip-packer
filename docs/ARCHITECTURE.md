# Architecture

## Stack and why

| Choice | Reason |
|---|---|
| **React 19 + TypeScript + Vite** | As requested; fast static build, code-splitting keeps MapLibre (≈1 MB) out of the packing screens. |
| **Static PWA, no backend** | Hosting is only needed for first install, updates and optional map downloads. |
| **IndexedDB via `idb`** | Structured, transactional, large-capacity storage available on iOS and Android browsers. LocalStorage is too small and synchronous. |
| **Workbox (vite-plugin-pwa)** | Battle-tested precaching; generated `sw.js` precaches the shell, fonts, map glyphs and sprites. Updates wait for the user (“Reload”). |
| **Hash routing** | Works on any static host (GitHub Pages has no SPA rewrites) and keeps nothing sensitive in URLs — only record ids. |
| **Zod** | Validates backups and map catalogs before anything is written. |
| **MapLibre GL JS + PMTiles + Protomaps basemap style** | Open-source vector maps that read a single-file archive; the archive is served from IndexedDB through a custom PMTiles `Source`. |
| **Own road graph + A\*** | The strongest offline routing that is reliable in a phone browser (see “Maps”). |
| **No UI framework** | One hand-written stylesheet with design tokens: smaller, fully offline, no CDN. |

Main bundle ≈156 KB gzip; the maps chunk loads only on the Maps tab.

## Data model (`src/types/index.ts`)

- `TravellerProfile` — adult or child; child age is computed from `birthDate` **on the trip start date**. Adult and child preference blocks drive which items appear.
- `Trip` — dates or days/nights, origin/destination/stops, total km + source (`manual` / `offline-route`), driving days, optional total hours or per-day legs, accommodation, activities, laundry, temperature/rain (or `auto`), remote/mountains/overnight flags, resupply level, per-trip assumption overrides.
- `ChecklistItem` — every field the brief lists: name, category, assignee (person / family / car), recommended and user quantity, unit, reasons, priority, necessity, reusable/consumable, pack location, stage, reachable-en-route, safety-critical, owned/packed/unavailable/needs-purchase, notes, stable `key`.
- `InventoryItem`, `TripReview`, `ItemStats` (learning counters), `AlwaysPackItem`, `Settings` (theme, home city, family-wide assumptions, last backup).
- Maps: `MapRegion` with per-asset state (`tiles`, `poi`, `graph`: url, bytes, sha256, ETag, chunk progress, status, verified), `SavedPlace`, `SavedRoute`; chunk records `[regionId, kind, index] → ArrayBuffer`.

## Rules engine (`src/rules/`)

```
Trip + profiles + assumptions ──► deriveFacts() ──► TripFacts
                                                     │
ALL_RULES (catalog/*.ts) ── for each rule × scope ───┘  when() → include? + reason
                                                         qty()  → number, unit, calculation steps
                                                     ▼
                                   alwaysPack items appended
                                   applyPersonalisation(stats)   (ran-out ×factor, forgotten → P1, unused → optional; safety never demoted)
                                   applyInventory(inventory)     (owned / partial / buy, expiry-aware)
                                                     ▼
                                    mergeChecklist(existing, generated)  (keeps ticks, overrides, notes, custom items)
```

- **Pure and deterministic.** `generate()` takes `today` as an argument; the same input always yields identical output (tested).
- **Duration vs distance.** Hours in the car drive diapers, snacks, toys, power, rest stops; kilometres drive vehicle checks, puncture kit, emergency cash and service checks; days and laundry drive clothing. Kilometres never change clothing or toiletries (tested).
- **Assumptions** (`assumptions.ts`) have labels, units, ranges and help text; they are clamped, overridable family-wide (Settings) and per trip (Trip → Assumptions).
- Rule reference: [RULES.md](RULES.md).

## Persistence (`src/storage/`)

- Database `milestone-roadtrip`, schema **v4**. Migrations in `db.ts` are additive and idempotent; data fix-ups run through `normalize.ts`, the same normalisers used by backup import, so old data and old backups take the same path.
- Writes that must be consistent (replace a checklist and save its trip; save a review with its stats and inventory updates; import) use single multi-store transactions.
- `backup.ts`: export of every store except map chunks; import validates format, version, referential integrity (checklist → trip) and duplicates **before** writing; merge keeps the newer `updatedAt`.

## Family sync (`src/sync/`)

Optional and off by default. Each phone keeps a full local database; `sync.ts` pulls one file from a private GitHub repository (contents API, fine-grained token), decrypts it (`crypto.ts`: gzip → AES-256-GCM, PBKDF2-SHA-256 key from a family passphrase), merges it with the backup importer in `sync` mode, then encrypts and pushes the merged result with the previous blob `sha` (optimistic concurrency; a 409 triggers pull-merge-retry).

- **Per-record merge, newest `updatedAt` wins.** Every edit stamps `updatedAt`; checklist ticks are per item, so two people packing never clobber each other.
- **Deletions propagate** through tombstones (`tombstones` store, schema v4) written in the same transaction as the delete; pruned after 180 days.
- **Deterministic ids** for generated checklist items (`<tripId>:<ruleId>@<assignee>`), so both phones regenerating a list produce the same records; a post-merge pass removes any duplicate (trip, key) pairs and items whose trip was deleted.
- **Device-only data** (`device` store: token, passphrase, sync position) is never exported or synced. Map regions are per device.
- No push when neither side changed (content hash), so the repository only gets commits for real edits.

## UI (`src/features/`)

Mobile-first single column, bottom tab bar (Home, Pack, Maps, Inventory, More), bottom sheets for details, big right-hand check targets for one-handed use, sticky group headers, quantities in tabular figures, essential and safety items marked with a red edge and tags. The identity borrows Indian highway signage: direction-sign green, the yellow-domed NH milestone (used as the progress marker), and Overpass, a libre typeface derived from highway-sign lettering. Light and dark themes; `prefers-reduced-motion` respected.

## PWA and security

- `vite-plugin-pwa` generates `sw.js` (precache ~3.3 MB: JS, CSS, fonts, MapLibre worker, glyphs, sprites, icons). `navigateFallback` serves the shell offline.
- Content-Security-Policy (meta): `default-src 'self'`; scripts only from self; `worker-src 'self' blob:` (MapLibre); `connect-src 'self' https:` so a user-chosen map host and (if enabled) api.github.com can be reached; `object-src 'none'`; `form-action 'none'`; `referrer no-referrer`. No third-party scripts, fonts or analytics.
- No logging of personal data; nothing personal leaves the device except in a backup file the user exports, or — only if family sync is turned on — as ciphertext sent to the user's own private GitHub repository.

## Maps subsystem (`src/features/maps/`)

Isolated: the packing app never imports it (MapsView is lazy-loaded), so map problems cannot affect checklists.

| Piece | File | Notes |
|---|---|---|
| Region catalog / manifest | `manifest.ts` | JSON listing assets with byte size and SHA-256; URLs relative to the catalog. |
| Downloader | `downloader.ts` | HTTP Range in 8 MiB blocks → 1 MiB chunks in IndexedDB; progress persisted per block; resume; `If-Range` ETag check restarts if the file changed; falls back to streaming when a host ignores Range; verifies size, format magic and **streaming SHA-256** (`sha256.ts`); corrupt data is deleted. File import path for side-loading without internet. |
| Tile source | `idbSource.ts` | Implements PMTiles `Source.getBytes` over the chunks with a small LRU cache. Registered with the `pmtiles://` protocol in MapLibre. |
| Map | `MapCanvas.tsx` | Protomaps basemap layers (English labels), bundled Noto Sans glyphs (Latin ranges) and sprites, route/points overlays. |
| Places index | `poiIndex.ts` | JSON from OSM: towns/villages, fuel, hospitals, clinics, pharmacies, food, toilets, rest areas, ATMs, police, hotels, sights. Prefix search, grid-indexed nearby and along-route queries. |
| Road graph | `routing/graph.ts` | Binary CSR graph (`MRG1`) of motorway → tertiary roads with lengths, class speeds, one-way handling, road names/refs; A\* on travel time; nearest-node snapping (≤5 km). Runs in a Web Worker (`routing/worker.ts`). |
| Route analysis | `routing/route.ts` | Legs, main roads, towns along the route, break suggestions at the toddler break interval, mapped medical facilities, saved places near the route; graceful, specific failures (outside coverage, no road nearby, not connected). |

Why not a “real” routing engine: OSRM/Valhalla/GraphHopper need native processes or very large WASM builds and multi-hundred-MB preprocessed data; none is maintained for mobile browsers. A pre-built major-road graph is comparatively small (expect roughly 5–25 MB for a state-sized region; the build script prints the exact size), fast, and honest about its limits.
