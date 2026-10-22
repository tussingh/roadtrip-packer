#!/usr/bin/env node
// Measure and checksum region files and write a catalog the app can download from.
//   node scripts/make-region-manifest.mjs --id karnataka --name "Karnataka" --bbox 74.0,11.5,78.6,18.5 \
//     --maxzoom 13 --tiles dist-data/karnataka.pmtiles --poi dist-data/karnataka.poi.json \
//     --graph dist-data/karnataka.graph --out dist-data/catalog.json [--date 2026-10-01]
// Asset URLs are written relative to the catalog, so upload the files next to catalog.json.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, relative } from 'node:path';
import { die, parseArgs, parseBBox } from './lib/args.mjs';

const args = parseArgs();
const out = args.out ?? die('--out is required');
const bbox = parseBBox(args.bbox) ?? die('--bbox is required');

async function describe(file) {
  if (!file) return undefined;
  const { size } = await stat(file);
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => createReadStream(file).on('data', (d) => hash.update(d)).on('end', resolve).on('error', reject));
  return { url: relative(dirname(out), file) || basename(file), bytes: size, sha256: hash.digest('hex') };
}

const region = {
  id: args.id ?? die('--id is required'),
  name: args.name ?? die('--name is required'),
  description: args.description ?? '',
  bbox,
  maxZoom: Number(args.maxzoom ?? 13),
  dataDate: args.date,
  attribution: args.attribution ?? '© OpenStreetMap contributors (ODbL) · Protomaps basemap',
  assets: Object.fromEntries(
    (await Promise.all([
      ['tiles', await describe(args.tiles)],
      ['poi', await describe(args.poi)],
      ['graph', await describe(args.graph)],
    ])).filter(([, v]) => v),
  ),
};

let catalog = { format: 'milestone-region-catalog', version: 1, regions: [] };
try {
  catalog = JSON.parse(await readFile(out, 'utf8'));
} catch {}
catalog.regions = catalog.regions.filter((r) => r.id !== region.id).concat(region);
await writeFile(out, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Catalog ${out} now lists: ${catalog.regions.map((r) => r.id).join(', ')}`);
for (const [k, v] of Object.entries(region.assets)) console.log(`  ${k}: ${(v.bytes / 1048576).toFixed(1)} MiB  sha256 ${v.sha256.slice(0, 16)}…`);
