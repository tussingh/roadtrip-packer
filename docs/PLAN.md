# Implementation plan and risks

## Environment inspected

- Linux, Node 22, npm, git, Python 3; npm registry and GitHub raw content reachable.
- OpenStreetMap/Protomaps/Geofabrik/Overpass hosts were **not** reachable from the build environment, so no real map extract could be produced here. The map pipeline is implemented and tested end to end with synthetic test data; producing real regions is a documented manual step ([MAP-DATA.md](MAP-DATA.md)).
- A headless Chromium was available, so the production build was exercised in a real browser (service worker, IndexedDB, WebGL map rendering, offline mode).

## Order of work (as executed)

1. Data model and assumptions → deterministic rules engine → scenario tests A–E.
2. IndexedDB schema with versioned migrations, repositories, JSON backup/restore with validation → scenario F and migration tests.
3. Mobile UI: dashboard, trip wizard, trip summary, checklist, readiness, inventory, profiles, history/review, essentials, settings.
4. PWA: Workbox precache of the shell, fonts, map glyphs and sprites; manifest; update prompt; CSP.
5. Offline maps as an isolated module: chunked PMTiles storage in IndexedDB, resumable verified downloads, places index, road graph + A* in a Web Worker, map UI → scenario G tests (Node and Chromium).
6. CI (type-check, unit, build, e2e, Pages deploy) and documentation.

## Technical risks and how they were handled

| Risk | Mitigation |
|---|---|
| iOS evicts web-app storage; quotas vary | Add-to-Home-Screen guidance, `navigator.storage.persist()` request, backup reminders on the dashboard, storage usage shown. Map data is re-downloadable and excluded from backups. |
| Large map files on phones | Regions are explicit downloads with sizes shown first; stored as 1 MiB chunks so no single huge allocation; resumable after interruption; deletable per region. |
| Background downloads are not possible in PWAs (esp. iOS) | Downloads run while the app is open; progress saved per 8 MiB block; `If-Range` prevents mixing file versions on resume. Documented. |
| Fully offline routing in a browser | No production routing engine (OSRM, Valhalla, GraphHopper) runs reliably in a mobile browser. Implemented a compact major-road graph built from OSM with A* in a worker. Clearly labelled as an approximate road route, not navigation. |
| Public tile servers forbid bulk/offline use | Never touches public tile servers. Uses PMTiles extracts that you build from a source that permits it and host yourself. |
| Fake offline claims | Capability matrix, in-app labels (“straight-line — not a driving distance”, “seasonal guess”, “online-only”), and real-browser offline tests. |
| Medical safety | No doses anywhere; medicines expressed as days of supply; paediatrician caveats; WHO screen-time note; no aftermarket car-seat accessories. |
| Losing user work when assumptions change | Merge algorithm keeps ticks, quantity overrides, notes and custom items; touched items the rules drop are kept and flagged “no longer suggested”. Undo for checklist edits. |
| Schema changes corrupting data | Additive, idempotent migrations (v1→v3 tested from a real v1 database); import normalisers fill new fields; newer-version backups are refused with a clear message. |
