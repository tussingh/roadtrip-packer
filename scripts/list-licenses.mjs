#!/usr/bin/env node
// Print the licence of every production dependency (and their dependencies).
import { readFile } from 'node:fs/promises';
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const rows = [];
for (const [path, info] of Object.entries(lock.packages ?? {})) {
  if (!path || info.dev || info.devOptional) continue;
  rows.push([path.replace(/^.*node_modules\//, ''), info.version, info.license ?? '(see package)']);
}
rows.sort((a, b) => a[0].localeCompare(b[0]));
for (const r of rows) console.log(r.join('\t'));
const counts = {};
for (const r of rows) counts[r[2]] = (counts[r[2]] ?? 0) + 1;
console.error('\nSummary:', counts);
