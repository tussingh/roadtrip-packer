# Milestone — family road-trip packer

An installable, offline-first web app (PWA) that builds a personalised packing checklist for family car trips in India, remembers what you own and what you forgot, and adds offline maps, place search and road routing for regions you download.

- **No AI, no account, no server of our own, no tracking.** Every calculation is a deterministic, inspectable rule running on your phone. Route planning uses free public OpenStreetMap services and sends only place names/coordinates — never family details.
- **Works in airplane mode** once installed. Map regions are a separate, explicit download.
- **Everything stays on the device** (IndexedDB). Backups are JSON files you export yourself. Optional family sync shares data between two phones through an end-to-end encrypted file in your own private GitHub repository.

Built for one family — two adults and a toddler (20 months at the time of writing) starting from Bengaluru — but every profile, age, preference and assumption is editable.

## What it does

| Area | Highlights |
|---|---|
| Packing engine | ~195 rules across vehicle, adults, child, shared, health, activities and stay types. Quantities come from trip days/nights, driving days and hours, kilometres, laundry, weather, remoteness, accommodation, activities, child age, inventory and past trips. Every item shows *why* and *how the number was worked out*. |
| Checklist | Tick, edit quantities, add/delete your own items, search, filter (person, category, priority, bag, unpacked, to-buy, essentials), group by stage / category / person / bag, bulk “Pack all”, undo, progress by person and category, departure-readiness screen. |
| Stages and reminders | Pack in advance → night before → departure morning → in the cabin → verify. A dated schedule, exportable as calendar events (.ics) with alerts, because phone browsers cannot reliably notify when closed. |
| Inventory | Quantities, storage location, expiry, replenish flags, owner. Trips mark owned items and list only the shortfall to buy; expired stock is ignored. |
| Learning without AI | Post-trip review: used / not needed / ran out / forgot. Ran-out consumables grow (capped), forgotten items go to top priority, items unused twice become optional — **safety-critical items are never demoted**. |
| Automatic trip planner | Type “from” and “to” — the app finds 2–3 road routes (fastest / most national highway / shortest) with km, realistic driving time (×1.25 for Indian roads), roads used, overnight-split for long drives, ghat detection from altitude, a 16-day weather forecast that feeds the packing list, a departure time that beats city traffic and sunset, timed breaks matched to meals, **the best family-friendly restaurant in every 100 km** (with Google Maps buttons for reviews), sights on the way and at the destination, hospitals every 50 km, fuel gaps, fuel cost and a WhatsApp-shareable plan. Free OpenStreetMap services, no keys. |
| Route map offline | “Save map for offline” stores the map along the route (and the destination town at street level) on the phone, within OpenFreeMap’s fair-use limits. |
| Separate lists | One tap each: Car, the baby, each adult, family/shared — with counts left. |
| Buy or bring | Every item sorted into: buy before you leave, bring (hard to find on the road), carry some and buy the rest on the way, provided by the hotel, bring from home, or optional — with a reason and a shareable shopping list. |
| Offline maps (advanced) | PMTiles vector maps from IndexedDB, offline place search, nearby fuel/hospitals/pharmacies/food/toilets, offline road routing on major roads, towns and main roads on a route, toddler break suggestions, saved places and routes. Clear separation between “app installed” and “map data downloaded”. |
| Family sync | Optional: you and your partner run the app on your own phones and share one family dataset through an **encrypted file in a private GitHub repository**. Per-item merge, deletions propagate, works offline and syncs when back online. |
| Backup | Export/import JSON (merge or replace), validated, version-aware. Delete-everything option. |

## Quick start (development)

```bash
npm ci
npm run dev          # http://localhost:5173
npm test             # unit + integration tests (75)
npm run build        # production build in dist/
npx playwright install chromium   # once
npm run test:e2e     # real-browser tests against dist/
```

Node 22 is used in CI.

## Install on your phone

1. Deploy (below) or run `npm run build && npx vite preview --host` on your network.
2. **iPhone:** open the URL in **Safari** → Share → **Add to Home Screen**. Open it once from the Home Screen while online so the offline cache is created.
3. **Android:** open in Chrome → menu → **Install app**.
4. In the app, go to *Settings and backup* → *Ask the browser to keep data*, and export a first backup.

## Deploy (GitHub Pages)

1. Push this repository to GitHub (public).
2. Pushing to `main` runs `.github/workflows/ci.yml`: type-check, unit tests, build, Chromium end-to-end tests, then publishes `dist/` to the `gh-pages` branch.
3. GitHub Pages serves that branch. If the site does not appear, open *Settings → Pages* and set *Source: Deploy from a branch → `gh-pages` / root*.

The app will be at **`https://<your-github-username>.github.io/<repository-name>/`** — for example `https://yourname.github.io/roadtrip-packer/`. Both of you open that same address and install it. (GitHub Pages is free for public repositories; the app repository contains no personal data. Family data goes in a separate private repository — see [docs/FAMILY-SYNC.md](docs/FAMILY-SYNC.md).)

The build uses relative paths, so it works at a domain root or a project path without configuration. Any static host works; it only needs to serve files over HTTPS.

## Offline maps need data you publish

The app ships **no map data** (that would be large and is licensed separately). To use maps you build a region once on a computer and either host it or copy it to the phone. Step-by-step: [docs/MAP-DATA.md](docs/MAP-DATA.md).

## Documentation

- [docs/PLAN.md](docs/PLAN.md) — implementation plan and the main technical risks
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack choices, data model, rules engine, persistence, service worker, map subsystem
- [docs/OFFLINE-CAPABILITIES.md](docs/OFFLINE-CAPABILITIES.md) — what works offline, online-only, and after manual setup
- [docs/RULES.md](docs/RULES.md) — how quantities are calculated and how to change rules
- [docs/MAP-DATA.md](docs/MAP-DATA.md) — building, hosting and licensing offline regions; storage sizes
- [docs/FAMILY-SYNC.md](docs/FAMILY-SYNC.md) — sharing data between two phones via a private GitHub repository
- [docs/BACKUP.md](docs/BACKUP.md) — backup, restore, migration
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
- [docs/LICENSES.md](docs/LICENSES.md) — third-party licences and attribution
- [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md) — latest test run

## Project layout

```
src/
  app/            App shell, hash router, data store, PWA registration, trip service
  components/     UI primitives, icons, the milestone progress marker
  features/       dashboard, trips, checklists, inventory, history, profiles, essentials, settings, maps
  features/maps/  PMTiles-in-IndexedDB source, downloader, places index, routing (worker), map UI
  rules/          deterministic packing engine, catalogue, assumptions, merge, learning, schedule
  storage/        IndexedDB schema + migrations, repositories, backup/import, normalisers
  sync/           optional family sync: encryption, GitHub contents API, merge
  data/           defaults, labels, starter family
  types/          data model
scripts/          map-data builders (Overpass → places index / road graph), manifest, icons, licences
public/           icons, map glyphs and sprites, empty region catalog
tests/unit        rules engine scenarios A–E and edge cases
tests/integration persistence (scenario F), migrations, backup, offline maps (scenario G)
tests/e2e         Chromium tests: service worker, airplane-mode restart, region download, offline map/search/route
docs/
```

## Honest limitations (summary)

- Not turn-by-turn navigation. Offline routes use major roads with estimated speeds and ignore traffic, closures, tolls and turn restrictions.
- No live traffic or road closures (use the Google Maps button). Restaurant picks use OpenStreetMap tags, not star ratings — check reviews via the Google Maps button. Free services can be slow or rate-limited; the app retries a backup server and always lets you enter distances by hand.
- Offline search covers mapped towns and points of interest, not street addresses.
- iOS may clear data for web apps that are not added to the Home Screen; downloads pause when the app is in the background. Back up regularly.
- Health items never include doses. Ask your paediatrician.

Full details: [docs/OFFLINE-CAPABILITIES.md](docs/OFFLINE-CAPABILITIES.md).

## Licence

App code: MIT (see `LICENSE`). Bundled fonts, sprites and libraries keep their licences ([docs/LICENSES.md](docs/LICENSES.md)). Map data © OpenStreetMap contributors, ODbL.
