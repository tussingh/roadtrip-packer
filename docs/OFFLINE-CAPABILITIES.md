# Offline capability matrix

“Offline” = airplane mode after the app has been installed and opened once online. “Region data” = a map region downloaded or imported in *Offline Maps → Regions*.

## Packing app (never depends on maps)

| Feature | Offline | Notes |
|---|---|---|
| Open the app | ✅ | Shell precached by the service worker. First visit must be online. |
| Create / edit trips, generate and regenerate lists | ✅ | Pure local rules. |
| Checklist: tick, quantities, custom items, filters, undo, readiness | ✅ | |
| Profiles, inventory, history, learning, always-pack | ✅ | |
| Packing schedule | ✅ | Shown in the app. |
| Reminders while the app is closed | ⚠️ | Not reliable from a web app (especially iOS). Use **Add to calendar** (.ics); your calendar app alerts you, offline. |
| Backup export / import | ✅ | Saves/reads a file on the device. |
| Family sync between two phones | 🌐 | Optional. Edits made offline are kept and synced when online. |
| App updates | 🌐 | Checked when online; applied when you tap **Reload**. |
| Live weather | ❌ | Not in the app. “Auto” weather is a seasonal guess and labelled as such. |

## Maps

| Feature | Offline, region data present | Without region data |
|---|---|---|
| Map display, pan, zoom | ✅ up to the region’s max zoom (over-zoom beyond, less detail) | ❌ “No map tiles on this device” |
| Labels | ✅ Latin-script names (English where mapped) | — |
| Offline search | ✅ towns, villages and mapped points of interest by name | ❌ |
| Street-address search | ❌ not supported | ❌ |
| Nearby fuel / hospitals / pharmacies / food / toilets / rest areas / ATMs | ✅ mapped in OpenStreetMap at extract time | ❌ |
| Road route between points (with stops) | ✅ major roads (motorway → tertiary), estimated time, legs, main roads, towns on the way | ❌ straight-line distance only, labelled “not a driving distance” |
| Toddler break suggestions along a route | ✅ from mapped fuel, food, toilets and rest areas | ❌ |
| Medical facilities along a route | ✅ mapped ones; services and hours must be confirmed | ❌ |
| Saved places and saved routes | ✅ view, draw, delete | ✅ listed (map needs tiles) |
| My location (GPS) | ✅ GPS works without data; permission asked only on tap | ✅ |
| Turn-by-turn navigation, rerouting, voice | ❌ not provided | ❌ |
| Live traffic, closures, current opening hours, new businesses, tolls | ❌ online-only, not in the app | ❌ |
| Routing across two separately downloaded regions | ❌ download one region that covers the whole route | — |
| Download / resume a region | 🌐 needs internet; or import files from the device offline | — |

## Requires manual setup

1. **Hosting** the app (GitHub Pages workflow included) — or running a local preview.
2. **Building map regions** on a computer and either hosting them or copying files to the phone — [MAP-DATA.md](MAP-DATA.md).
3. **Adding to the Home Screen** on iPhone to reduce the risk of storage eviction, and asking the browser to persist data (Settings).
4. **Regular backups** — browsers can clear site data.

## Platform caveats

- **iOS / Safari:** web-app data not used for a while can be cleared unless the app is on the Home Screen; storage quotas depend on iOS version and free space; downloads stop when the app is backgrounded (progress is kept); service-worker updates apply on next launch.
- **Android / Chrome:** generous storage; installed apps can be granted persistent storage.
- **Private / incognito windows** may block IndexedDB — the app shows a clear message.
