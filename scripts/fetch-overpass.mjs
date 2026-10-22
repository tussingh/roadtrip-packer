#!/usr/bin/env node
// Download OpenStreetMap roads or places for a bounding box from an Overpass API server.
// Run this on your own computer (not in the app). Respect the server's usage policy:
// https://dev.overpass-api.de/overpass-doc/en/preface/commons.html — split very large areas.
//
//   node scripts/fetch-overpass.mjs --what roads --bbox 74.0,11.5,78.6,15.5 --out data/ka-roads.json
//   node scripts/fetch-overpass.mjs --what pois  --bbox 74.0,11.5,78.6,15.5 --out data/ka-pois.json
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { die, parseArgs, parseBBox } from './lib/args.mjs';
import { roadsQuery } from './lib/graph-builder.mjs';
import { poisQuery } from './lib/poi-builder.mjs';

const args = parseArgs();
const bbox = parseBBox(args.bbox) ?? die('--bbox is required');
const what = args.what ?? die('--what roads|pois is required');
const out = args.out ?? die('--out is required');
const endpoint = args.endpoint ?? 'https://overpass-api.de/api/interpreter';
const query = what === 'roads' ? roadsQuery(bbox) : what === 'pois' ? poisQuery(bbox) : die('--what must be roads or pois');

console.log(`Querying ${endpoint} for ${what} in ${bbox.join(',')} … this can take several minutes.`);
const res = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'milestone-roadtrip-data-builder/1.0' },
  body: 'data=' + encodeURIComponent(query),
});
if (!res.ok) die(`Overpass returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
const text = await res.text();
await mkdir(dirname(out), { recursive: true });
await writeFile(out, text);
const json = JSON.parse(text);
console.log(`Saved ${json.elements?.length ?? 0} elements to ${out}`);
