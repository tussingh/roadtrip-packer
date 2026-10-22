#!/usr/bin/env node
// Convert OpenStreetMap places (Overpass JSON or GeoJSON points) into the app's offline places index.
//   node scripts/build-poi-index.mjs --in data/ka-pois.json --out dist-data/karnataka.poi.json [--bbox w,s,e,n]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { die, parseArgs, parseBBox } from './lib/args.mjs';
import { buildPoiFile, poisFromGeoJSON, poisFromOverpass } from './lib/poi-builder.mjs';

const args = parseArgs();
const input = args.in ?? die('--in is required');
const out = args.out ?? die('--out is required');
// Several inputs (e.g. a large area fetched in pieces) can be given comma-separated.
const pois = [];
for (const file of input.split(',')) {
  const json = JSON.parse(await readFile(file.trim(), 'utf8'));
  pois.push(...(json.type === 'FeatureCollection' ? poisFromGeoJSON(json) : poisFromOverpass(json)));
}
const file = buildPoiFile(pois, { bbox: parseBBox(args.bbox), generated: new Date().toISOString().slice(0, 10) });
await mkdir(dirname(out), { recursive: true });
const text = JSON.stringify(file);
await writeFile(out, text);
const counts = {};
for (const p of file.places) counts[file.kinds[p[2]]] = (counts[file.kinds[p[2]]] ?? 0) + 1;
console.log(`Places index: ${file.places.length} places, ${(text.length / 1048576).toFixed(1)} MiB → ${out}`);
console.log(counts);
