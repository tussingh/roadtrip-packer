# Third-party licences and attribution

## Map data

Map data © OpenStreetMap contributors, available under the [Open Database Licence (ODbL 1.0)](https://opendatacommons.org/licenses/odbl/1-0/). The app displays this attribution on the map and in Settings → About. No map data is included in this repository. See [MAP-DATA.md](MAP-DATA.md) for obligations when sharing derived places indexes or road graphs.

## Bundled assets

| Asset | Source | Licence |
|---|---|---|
| Overpass variable font (`@fontsource-variable/overpass`) | Overpass project (Red Hat, Delve Fonts) | SIL Open Font License 1.1 |
| Noto Sans glyph ranges (`public/map-assets/fonts/`) | protomaps/basemaps-assets, Noto Project | SIL Open Font License 1.1 (`fonts/OFL.txt`) |
| Map sprites (`public/map-assets/sprites/`) | protomaps/basemaps-assets, derived from Tangrams icons | MIT (`sprites/LICENSE-tangrams-icons.md`) |
| App icons | made for this project (`scripts/make-icons.py`) | MIT, with the app |

## Runtime dependencies (production)

Generated with `npm run licenses`:

| Package | Version | Licence |
|---|---|---|
| @fontsource-variable/overpass | 5.3.0 | OFL-1.1 |
| @mapbox/jsonlint-lines-primitives | 2.0.3 | MIT |
| @mapbox/point-geometry | 1.1.0 | ISC |
| @mapbox/tiny-sdf | 2.3.0 | BSD-2-Clause |
| @mapbox/unitbezier | 1.0.0 | BSD-2-Clause |
| @mapbox/vector-tile | 3.0.0 | BSD-3-Clause |
| @maplibre/geojson-vt | 6.3.0 | ISC |
| @maplibre/maplibre-gl-style-spec | 26.4.4 | ISC |
| @maplibre/mlt | 1.3.0 | (MIT OR Apache-2.0) |
| @maplibre/vt-pbf | 4.3.2 | MIT |
| @protomaps/basemaps | 5.7.2 | BSD-3-Clause |
| @types/geojson | 7946.0.16 | MIT |
| bidi-js | 1.1.0 | MIT |
| earcut | 3.2.4 | ISC |
| fflate | 0.8.3 | MIT |
| gl-matrix | 3.4.4 | MIT |
| idb | 8.0.4 | ISC |
| json-stringify-pretty-compact | 4.0.0 | MIT |
| kdbush | 4.1.0 | ISC |
| maplibre-gl | 6.15.0 | BSD-3-Clause |
| minimist | 1.2.8 | MIT |
| murmurhash-js | 1.0.0 | MIT |
| pbf | 5.1.2 | BSD-3-Clause |
| pmtiles | 4.5.0 | BSD-3-Clause |
| potpack | 2.1.0 | ISC |
| protocol-buffers-schema | 3.6.1 | MIT |
| quickselect | 3.0.0 | ISC |
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| require-from-string | 2.0.2 | MIT |
| resolve-protobuf-schema | 2.1.0 | MIT |
| scheduler | 0.28.0 | MIT |
| tinyqueue | 3.0.0 | ISC |
| zod | 4.6.7 | MIT |

All runtime dependencies are free and open source (MIT, ISC, BSD-2/3-Clause, Apache-2.0, OFL). Development-only tools (Vite, Vitest, Playwright, TypeScript, Workbox build, fake-indexeddb) are not shipped to the phone; their licences are in `node_modules/*/LICENSE`.
