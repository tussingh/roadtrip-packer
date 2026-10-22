# Offline map data: build, host, install

The app needs up to three files per region. Each is optional; the app reports exactly what is missing.

| File | Gives you | Built with | Format |
|---|---|---|---|
| `<region>.pmtiles` | Map display, pan and zoom | `pmtiles extract` from a Protomaps basemap build | PMTiles v3 (vector, Protomaps schema) |
| `<region>.poi.json` | Offline search; fuel, hospitals, clinics, pharmacies, food, toilets, rest areas, ATMs, hotels, sights, towns | `scripts/fetch-overpass.mjs` + `scripts/build-poi-index.mjs` | `milestone-poi` v1 JSON |
| `<region>.graph` | Offline road routes, distances, main roads, towns on the way, break suggestions | `scripts/fetch-overpass.mjs` + `scripts/build-road-graph.mjs` | `MRG1` binary road graph |

A `catalog.json` (from `scripts/make-region-manifest.mjs`) lists regions with byte sizes and SHA-256 checksums so the app can show sizes before downloading, resume, and verify integrity.

> The development environment for this project could not reach OpenStreetMap or Protomaps servers, so no real region was produced or tested against live data. The pipeline was tested end to end with synthetic data (unit, integration and browser tests). Expect to do the steps below once on a computer.

## 0. Pick a bounding box

`west,south,east,north` in degrees. Examples (approximate — adjust to your routes):

| Region | bbox |
|---|---|
| Bengaluru + weekend radius (Mysuru, Coorg, Chikmagalur, Ooty) | `75.2,11.2,78.4,14.0` |
| Karnataka | `74.0,11.5,78.6,18.5` |
| Karnataka + Goa + Kerala + Tamil Nadu | `74.0,8.0,80.4,18.5` |

Routes only work inside a single region, so pick one that covers the whole journey including the return.

## 1. Map tiles (PMTiles)

1. Install the `pmtiles` command-line tool from <https://github.com/protomaps/go-pmtiles/releases>.
2. Find a current Protomaps basemap build URL on <https://docs.protomaps.com/basemaps/downloads> (daily planet builds, `YYYYMMDD.pmtiles`). Check its terms on that page.
3. Measure first, then extract only your area:

```bash
pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles dist-data/karnataka.pmtiles \
  --bbox=74.0,11.5,78.6,18.5 --maxzoom=13 --dry-run      # prints the size
pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles dist-data/karnataka.pmtiles \
  --bbox=74.0,11.5,78.6,18.5 --maxzoom=13
```

The extract downloads only the needed byte ranges, not the planet.

**Choosing max zoom.** 11–12 shows highways and towns (best for route overview, smallest). 13 adds most roads. 14–15 adds town streets and buildings but is several times larger. Each extra level typically multiplies the size by roughly 2–4×. Always check `--dry-run`.

## 2. Places index and road graph

```bash
# Places (Overpass API). Split large areas into pieces if the server times out.
node scripts/fetch-overpass.mjs --what pois  --bbox 74.0,11.5,78.6,18.5 --out data/ka-pois.json
node scripts/build-poi-index.mjs --in data/ka-pois.json --bbox 74.0,11.5,78.6,18.5 --out dist-data/karnataka.poi.json

# Roads: motorway, trunk, primary, secondary, tertiary (+ links)
node scripts/fetch-overpass.mjs --what roads --bbox 74.0,11.5,76.3,18.5 --out data/ka-roads-west.json
node scripts/fetch-overpass.mjs --what roads --bbox 76.3,11.5,78.6,18.5 --out data/ka-roads-east.json
node scripts/build-road-graph.mjs --in data/ka-roads-west.json,data/ka-roads-east.json \
  --bbox 74.0,11.5,78.6,18.5 --out dist-data/karnataka.graph
```

Pieces are joined automatically: shared OSM nodes have identical coordinates, so roads crossing the split connect. Each script prints counts and the output size.

**Overpass etiquette:** the public server is shared and rate-limited ([usage policy](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)). Run these occasionally, not on every build; use `--endpoint` for another instance or your own.

**Alternative without Overpass:** download an extract from Geofabrik (e.g. `asia/india/southern-zone`), filter with `osmium tags-filter`, and export with `osmium export -f geojson`. Both builders accept a GeoJSON `FeatureCollection` (lines for roads, points for places; areas such as hospital buildings need a point — Overpass `out center` handles this for you).

### What the road graph contains

- Roads tagged `motorway` to `tertiary` and their links. Local streets are excluded to keep the file small, so starts and ends “snap” to the nearest included road (up to 5 km; the app warns when the gap is over 1 km).
- One-way rules (`oneway=yes/-1`, motorways, roundabouts).
- Planning speeds per road class (`DEFAULT_SPEEDS` in `scripts/lib/graph-builder.mjs`, e.g. trunk 65 km/h, primary 50, secondary 40); a tagged `maxspeed` is used but capped near the class speed because posted limits overstate real averages.
- Names and refs (`NH 48 (…)`) for the “main roads” summary.
- Not included: turn restrictions, tolls, traffic, closures, access restrictions, ferries, road quality.

## 3. Catalog with sizes and checksums

```bash
node scripts/make-region-manifest.mjs --id karnataka --name "Karnataka" \
  --bbox 74.0,11.5,78.6,18.5 --maxzoom 13 --date 2026-10-20 \
  --tiles dist-data/karnataka.pmtiles --poi dist-data/karnataka.poi.json \
  --graph dist-data/karnataka.graph --out dist-data/catalog.json
```

Run it once per region; it adds or replaces that region in `catalog.json`. Asset URLs are written relative to the catalog.

## 4a. Host it (download over the internet)

Upload `catalog.json` and the files to any static HTTPS host that supports **HTTP Range requests**.

- **Same site as the app** (simplest — no CORS): copy into `public/regions/` before building, so they deploy with the app and the default catalog address `regions/catalog.json` just works. GitHub Pages refuses files over 100 MB and sites over 1 GB, so this suits small regions or lower max zooms. Do not commit large map files to git casually (`.gitignore` excludes `*.pmtiles`); publish them from CI or a separate branch if you do.
- **Another host** (object storage such as Cloudflare R2, S3, or your own server): enter the full catalog URL in the app. Configure CORS for your app’s origin:
  - `Access-Control-Allow-Origin: https://<you>.github.io`
  - `Access-Control-Allow-Headers: Range, If-Range`
  - `Access-Control-Expose-Headers: ETag, Content-Range, Content-Length`
- GitHub Release assets generally do not send CORS headers, so browser downloads from them fail — use the file-import route instead.

In the app: *Maps → Regions → Show available regions → choose → Download*. Sizes are shown first. Keep the app open; progress is saved every 8 MB and you can resume.

## 4b. Or copy files to the phone (no hosting, works offline)

1. Copy `catalog.json` and the region files to the phone (AirDrop, Files app, USB, cloud drive).
2. *Maps → Regions → Region file from device* → pick `catalog.json`.
3. For each file, tap **From file** and pick it. Size and checksum are verified when the catalog provides them.

## Storage on the phone

Data is stored inside the browser’s storage for the app (IndexedDB), counted against the browser’s quota (shown in Settings and Maps). Indicative sizes — measure yours with `--dry-run` and the script outputs:

| Asset | State-sized region (e.g. Karnataka) |
|---|---|
| Tiles, max zoom 11–12 | tens of MB |
| Tiles, max zoom 13 | roughly 100–300 MB |
| Tiles, max zoom 14–15 | several hundred MB to over 1 GB |
| Places index | a few MB |
| Road graph | roughly 5–25 MB |

Downloading the whole of India at high zoom is deliberately not offered by default.

## Updating

OSM changes daily. Rebuild every few months (or before a big trip), regenerate the catalog with a new `--date`, and upload. In the app, open *Show available regions* and download the region again: assets whose URL, size or checksum changed are re-downloaded; unchanged ones are kept. A resumed download that detects a changed file (ETag) restarts automatically.

## Licences and attribution

- **OpenStreetMap data** is © OpenStreetMap contributors under the **Open Database Licence (ODbL 1.0)**. The app shows “© OpenStreetMap contributors” in the map attribution and in Settings → About; keep it.
- The places index and road graph are **derived databases**. If you distribute them publicly, you must do so under the ODbL (or make the derived data available under it) — keep the `source` field and this documentation with them. Private use for your family does not trigger share-alike.
- **Protomaps basemap** tiles contain OSM data (ODbL); the style code (`@protomaps/basemaps`) is BSD-3-Clause. Check the current terms for daily builds on the Protomaps downloads page.
- **Fonts and sprites** in `public/map-assets/` come from `protomaps/basemaps-assets`: Noto Sans under the SIL Open Font License 1.1 (licence file included); sprites derived from Tangrams icons, MIT (licence included).
- Never bulk-download or cache tiles from `tile.openstreetmap.org` or any proprietary map service — their policies forbid it. This app does not.

## Coverage and accuracy

OpenStreetMap coverage in India is good for national and state highways and towns, and patchier for rural businesses, toilets and opening details. The app only knows what was mapped when you built the region. Missing places do not mean they do not exist; mapped places may have closed. Confirm hospitals, fuel and stays by phone where it matters.
