# Test results

Run on 2026-10-22 in the development environment (Node v22.22.0, Chromium 153 headless).

```
$ npm run typecheck
tsc -p .   # no errors

$ npm test
 ✓ tests/integration/maps.test.ts > incremental SHA-256 > matches Node crypto across arbitrary chunk boundaries
 ✓ tests/integration/maps.test.ts > Scenario G — offline map coverage > downloads, survives interruption, verifies, then serves map, search and routes with no network
 ✓ tests/integration/maps.test.ts > Scenario G — offline map coverage > fails gracefully outside coverage and on disconnected or one-way roads
 ✓ tests/integration/maps.test.ts > Scenario G — offline map coverage > detects corruption, server file changes, missing range support and reports missing data
 ✓ tests/integration/maps.test.ts > Scenario G — offline map coverage > restarts when the server file changes between resumes (If-Range)
 ✓ tests/integration/maps.test.ts > Scenario G — offline map coverage > refuses to start downloads while offline and validates formats
 ✓ tests/integration/maps.test.ts > Scenario G — offline map coverage > rejects malformed catalogs with a readable error
 ✓ tests/integration/persistence.test.ts > Scenario F — offline restart keeps trips, inventory and progress > survives closing and reopening with the network unavailable
 ✓ tests/integration/persistence.test.ts > schema migrations > upgrades a version-1 database without losing trips or checklist items
 ✓ tests/integration/persistence.test.ts > backup and restore > round-trips the complete local dataset
 ✓ tests/integration/persistence.test.ts > backup and restore > rejects malformed, foreign, future-version and inconsistent files without writing
 ✓ tests/integration/persistence.test.ts > backup and restore > merge keeps the newer local copy of a record
 ✓ tests/integration/persistence.test.ts > backup and restore > imports older-format trips by filling new fields
 ✓ tests/unit/engine.scenarios.test.ts > every generated item is explainable > scenario A: positive quantity, unit, reason and unique key
 ✓ tests/unit/engine.scenarios.test.ts > every generated item is explainable > scenario B: positive quantity, unit, reason and unique key
 ✓ tests/unit/engine.scenarios.test.ts > every generated item is explainable > scenario C: positive quantity, unit, reason and unique key
 ✓ tests/unit/engine.scenarios.test.ts > every generated item is explainable > scenario D: positive quantity, unit, reason and unique key
 ✓ tests/unit/engine.scenarios.test.ts > every generated item is explainable > scenario E: positive quantity, unit, reason and unique key
 ✓ tests/unit/engine.scenarios.test.ts > Scenario A — short family trip (2 days, 1 night, 150 km, hotel) > derives driving facts from distance, not from guesses
 ✓ tests/unit/engine.scenarios.test.ts > Scenario A — short family trip (2 days, 1 night, 150 km, hotel) > calculates diapers from daily use + travel-day extras + reserve
 ✓ tests/unit/engine.scenarios.test.ts > Scenario A — short family trip (2 days, 1 night, 150 km, hotel) > packs outfits net of the outfit worn on departure
 ✓ tests/unit/engine.scenarios.test.ts > Scenario A — short family trip (2 days, 1 night, 150 km, hotel) > keeps the full vehicle-safety baseline even for a short trip
 ✓ tests/unit/engine.scenarios.test.ts > Scenario A — short family trip (2 days, 1 night, 150 km, hotel) > shares toiletries instead of duplicating them per person
 ✓ tests/unit/engine.scenarios.test.ts > Scenario A — short family trip (2 days, 1 night, 150 km, hotel) > does not add beach or camping modules
 ✓ tests/unit/engine.scenarios.test.ts > Scenario A — short family trip (2 days, 1 night, 150 km, hotel) > adds the hotel cot request for a toddler
 ✓ tests/unit/engine.scenarios.test.ts > Scenario B — weekend road trip (4 days, 3 nights, 600 km, resort, beach) > adds beach module items
 ✓ tests/unit/engine.scenarios.test.ts > Scenario B — weekend road trip (4 days, 3 nights, 600 km, resort, beach) > treats resort towels as optional
 ✓ tests/unit/engine.scenarios.test.ts > Scenario B — weekend road trip (4 days, 3 nights, 600 km, resort, beach) > does not duplicate ordinary clothing because of the beach
 ✓ tests/unit/engine.scenarios.test.ts > Scenario B — weekend road trip (4 days, 3 nights, 600 km, resort, beach) > adds a wet bag for swimwear
 ✓ tests/unit/engine.scenarios.test.ts > Scenario B — weekend road trip (4 days, 3 nights, 600 km, resort, beach) > scales diapers with duration and driving hours
 ✓ tests/unit/engine.scenarios.test.ts > Scenario C — long road trip (7 days, 6 nights, 1,500 km, overnight stops) > recognises a long multi-stop journey
 ✓ tests/unit/engine.scenarios.test.ts > Scenario C — long road trip (7 days, 6 nights, 1,500 km, overnight stops) > makes power, service and rest-stop planning essential
 ✓ tests/unit/engine.scenarios.test.ts > Scenario C — long road trip (7 days, 6 nights, 1,500 km, overnight stops) > covers 7 days of clothing without laundry
 ✓ tests/unit/engine.scenarios.test.ts > Scenario D — laundry available midway > reduces clothing to the laundry cycle
 ✓ tests/unit/engine.scenarios.test.ts > Scenario D — laundry available midway > leaves consumables such as diapers unchanged
 ✓ tests/unit/engine.scenarios.test.ts > Scenario D — laundry available midway > adds detergent sachets for the planned wash
 ✓ tests/unit/engine.scenarios.test.ts > Scenario E — remote route with limited resupply > adds explicit reserves derived from assumptions, not arbitrary multipliers
 ✓ tests/unit/engine.scenarios.test.ts > Scenario E — remote route with limited resupply > upgrades vehicle preparation for self-reliance
 ✓ tests/unit/engine.scenarios.test.ts > Scenario E — remote route with limited resupply > every reserve explanation names its source
 ✓ tests/unit/engine.scenarios.test.ts > Scenario E — remote route with limited resupply > does not change clothing just because the route is remote
 ✓ tests/unit/engine.rules.test.ts > distance and duration are independent variables > hours drive child consumables and comfort the same way
 ✓ tests/unit/engine.rules.test.ts > distance and duration are independent variables > kilometres drive vehicle preparation, tolls and cash
 ✓ tests/unit/engine.rules.test.ts > distance and duration are independent variables > kilometres never increase clothing or toiletries
 ✓ tests/unit/engine.rules.test.ts > child age changes recommendations > uses the age bracket for diapers per day
 ✓ tests/unit/engine.rules.test.ts > child age changes recommendations > replaces sunscreen with shade for babies under six months
 ✓ tests/unit/engine.rules.test.ts > child age changes recommendations > switches to underwear and a potty when the profile says trained
 ✓ tests/unit/engine.rules.test.ts > child age changes recommendations > suggests audio rather than screens under two and never recommends unapproved seat accessories
 ✓ tests/unit/engine.rules.test.ts > child age changes recommendations > computes age in months at the trip start date
 ✓ tests/unit/engine.rules.test.ts > weather and activities > auto weather follows a South-India seasonal heuristic
 ✓ tests/unit/engine.rules.test.ts > weather and activities > cold weather adds warm layers; monsoon makes rain gear essential
 ✓ tests/unit/engine.rules.test.ts > weather and activities > photography and drone modules add gear and legal checks
 ✓ tests/unit/engine.rules.test.ts > weather and activities > camping adds a self-contained stay kit
 ✓ tests/unit/engine.rules.test.ts > inventory reuse > marks enough stock as owned with nothing to buy
 ✓ tests/unit/engine.rules.test.ts > inventory reuse > flags a shortfall precisely
 ✓ tests/unit/engine.rules.test.ts > inventory reuse > ignores expired stock
 ✓ tests/unit/engine.rules.test.ts > deterministic personalisation > learns from a trip review with capped increases
 ✓ tests/unit/engine.rules.test.ts > deterministic personalisation > applies ran-out, forgotten and not-needed rules but never demotes safety items
 ✓ tests/unit/engine.rules.test.ts > deterministic personalisation > adds always-pack items for each matching traveller
 ✓ tests/unit/engine.rules.test.ts > assumptions > clamps invalid overrides to their documented range
 ✓ tests/unit/engine.rules.test.ts > assumptions > per-trip overrides change quantities and the explanation
 ✓ tests/unit/engine.rules.test.ts > assumptions > is fully deterministic
 ✓ tests/unit/engine.rules.test.ts > date and duration boundaries > handles a same-day trip with no nights
 ✓ tests/unit/engine.rules.test.ts > date and duration boundaries > clamps nights to days and tolerates zero distance
 ✓ tests/unit/engine.rules.test.ts > date and duration boundaries > uses explicit drive legs when entered
 ✓ tests/unit/engine.rules.test.ts > regenerating keeps user work > preserves packed state, overrides, notes and custom items; drops untouched removed items
 ✓ tests/unit/engine.rules.test.ts > regenerating keeps user work > never emits duplicate keys even if the generator repeats one
 ✓ tests/unit/engine.rules.test.ts > progress, readiness and schedule > excludes unavailable items from progress
 ✓ tests/unit/engine.rules.test.ts > progress, readiness and schedule > is not ready while safety items remain
 ✓ tests/unit/engine.rules.test.ts > progress, readiness and schedule > builds a dated schedule and a valid iCalendar file
 ✓ tests/unit/engine.rules.test.ts > progress, readiness and schedule > clamps reminders that would fall in the past
 Test Files  4 passed (4)
      Tests  70 passed (70)

$ npm run build
✓ built in 612ms
precache  65 entries (3340.31 KiB)

$ npm run test:e2e   # CHROMIUM_PATH set to a headless Chromium
ok 1 - app installs its service worker and precaches the shell
ok 2 - Scenario F: create and edit a checklist, then reopen in airplane mode
ok 3 - Scenario G: download a region, go offline, render map, search and route
ok 4 - no unexpected console errors
# tests 4
# pass 4
# fail 0
```

## What each suite covers

| Suite | Covers |
|---|---|
| `tests/unit/engine.scenarios.test.ts` | Required scenarios **A** (short trip), **B** (beach weekend), **C** (long multi-stop), **D** (laundry midway), **E** (remote route); every item explainable with unique keys; safety baseline on short trips. |
| `tests/unit/engine.rules.test.ts` | Distance vs duration independence; km never changes clothing; child age brackets, under-6-month sunscreen, toilet-trained switch, car-seat safety text; weather and activity modules; inventory (owned, shortfall, expiry); learning (ran out cap, forgotten, not-needed, safety never demoted); assumption clamping; determinism; date boundaries (same-day trips, nights > days, zero km, explicit legs, month-end ages); merge keeps user work, no duplicate keys; readiness; schedule and RFC 5545 calendar output. |
| `tests/integration/persistence.test.ts` | **Scenario F** at the storage level (close + reopen with network failing, regenerate offline); v1 → v3 database migration; backup round trip; rejection of malformed / foreign / future-version / orphaned / duplicate / out-of-range files without writing; merge keeps newer records; importing an old-format backup. |
| `tests/integration/maps.test.ts` | Streaming SHA-256 vs Node crypto; **Scenario G**: resumable range download after a dropped connection, verification, offline PMTiles reads from IndexedDB, places search/nearby, road routing, towns and breaks; graceful failures (outside coverage, unreachable island, no road nearby, one-way respected); checksum mismatch cleanup; hosts without Range; file import; If-Range restart; refusing downloads offline; malformed catalogs. |
| `tests/e2e/run-e2e.mjs` | Real Chromium against the production build: service worker install and control; **Scenario F** in the UI with a true airplane-mode reload; **Scenario G** in the UI: catalog → download with checksum verification → offline reload → map rendered from IndexedDB with precached glyphs → offline search → offline route with breaks → outside-coverage message; no unexpected console errors. |

Map tests use synthetic, fictional data generated in `tests/fixtures/` — it is never shipped or presented as a real map.
