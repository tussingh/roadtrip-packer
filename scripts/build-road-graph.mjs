#!/usr/bin/env node
// Convert OpenStreetMap roads (Overpass JSON or GeoJSON) into the app's offline road graph.
//   node scripts/build-road-graph.mjs --in data/ka-roads.json --out dist-data/karnataka.graph [--bbox w,s,e,n] [--simplify 25]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { die, parseArgs, parseBBox } from './lib/args.mjs';
import { buildGraph, waysFromGeoJSON, waysFromOverpass } from './lib/graph-builder.mjs';

const args = parseArgs();
const input = args.in ?? die('--in is required');
const out = args.out ?? die('--out is required');
// Several inputs (e.g. a large area fetched in pieces) can be given comma-separated.
const ways = [];
for (const file of input.split(',')) {
  const json = JSON.parse(await readFile(file.trim(), 'utf8'));
  ways.push(...(json.type === 'FeatureCollection' ? waysFromGeoJSON(json) : waysFromOverpass(json)));
}
if (ways.length === 0) die('no road ways found in input');
const bytes = buildGraph(ways, {
  bbox: parseBBox(args.bbox),
  simplifyM: args.simplify ? Number(args.simplify) : 25,
  generated: new Date().toISOString().slice(0, 10),
});
await mkdir(dirname(out), { recursive: true });
await writeFile(out, bytes);
const dv = new DataView(bytes.buffer, bytes.byteOffset);
console.log(`Road graph: ${dv.getUint32(8, true)} nodes, ${dv.getUint32(12, true)} directed edges, ${(bytes.length / 1048576).toFixed(1)} MiB → ${out}`);
