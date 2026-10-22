#!/usr/bin/env node
/**
 * End-to-end tests in a real Chromium against the production build (dist/).
 *
 *   npm run build && npm run test:e2e
 *
 * Covers Scenario F (offline restart with the service worker) and
 * Scenario G (download a region, go offline, map + search + route).
 * The map region is SYNTHETIC test data generated here — fictional names,
 * never shipped in the app.
 *
 * Browser: Playwright's Chromium (`npx playwright install chromium`), or set
 * CHROMIUM_PATH to any Chromium binary.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { buildGraph } from '../../scripts/lib/graph-builder.mjs';
import { buildPoiFile } from '../../scripts/lib/poi-builder.mjs';
import { landTile, writePmtiles } from '../fixtures/pmtiles-writer.mjs';
import { syntheticPois, syntheticWays } from '../fixtures/synthetic-data.mjs';

const ROOT = new URL('../../dist/', import.meta.url).pathname;
if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

/* ---------------- synthetic region served at /test-regions/ ---------------- */
const BBOX = [77.0, 12.0, 78.0, 13.0];
const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
const tiles = [];
const land = landTile();
for (let z = 0; z <= 8; z++) {
  for (let x = lon2x(BBOX[0], z); x <= lon2x(BBOX[2], z); x++) for (let y = lat2y(BBOX[3], z); y <= lat2y(BBOX[1], z); y++) tiles.push({ z, x, y, data: land });
}
const files = {
  'synthetic.pmtiles': writePmtiles(tiles, BBOX, 0, 8),
  'synthetic.graph': buildGraph(syntheticWays(), { bbox: BBOX, generated: 'e2e' }),
  'synthetic.poi.json': new TextEncoder().encode(JSON.stringify(buildPoiFile(syntheticPois(), { bbox: BBOX, generated: 'e2e' }))),
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const catalog = {
  format: 'milestone-region-catalog',
  version: 1,
  regions: [
    {
      id: 'e2e-synthetic',
      name: 'Testpur synthetic region',
      description: 'Automated-test data. Not a real place.',
      bbox: BBOX,
      maxZoom: 8,
      attribution: 'Synthetic test data',
      assets: Object.fromEntries(
        Object.entries({ tiles: 'synthetic.pmtiles', poi: 'synthetic.poi.json', graph: 'synthetic.graph' }).map(([k, f]) => [k, { url: f, bytes: files[f].length, sha256: sha(files[f]) }]),
      ),
    },
  ],
};
files['catalog.json'] = new TextEncoder().encode(JSON.stringify(catalog));

/* ---------------- static server with Range support ---------------- */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.pbf': 'application/x-protobuf' };
function send(req, res, body, type) {
  const etag = `"${sha(body).slice(0, 16)}"`;
  const range = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
  const headers = { 'Content-Type': type, ETag: etag, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (range && (!req.headers['if-range'] || req.headers['if-range'] === etag)) {
    const start = Number(range[1]);
    const end = Math.min(body.length - 1, range[2] ? Number(range[2]) : body.length - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1 });
    return res.end(Buffer.from(body.subarray(start, end + 1)));
  }
  res.writeHead(200, { ...headers, 'Content-Length': body.length });
  res.end(Buffer.from(body));
}
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.startsWith('/test-regions/')) {
    const f = files[path.slice('/test-regions/'.length)];
    if (!f) return res.writeHead(404).end();
    return send(req, res, f, TYPES[extname(path)] ?? 'application/octet-stream');
  }
  let file = normalize(join(ROOT, path === '/' ? 'index.html' : path));
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(file).pipe(res);
});

/* ---------------- mocked free online services (no real network in CI) ---------------- */
const LINE = Array.from({ length: 301 }, (_, i) => [77.6, 12.9 + (2.7 * i) / 300]);
const atKm = (km, offKm = 0) => ({ lon: 77.6 + offKm / 108, lat: 12.9 + (2.7 * km) / 300 });
const PLACES = [
  { id: 1, km: 48, tags: { amenity: 'restaurant', name: 'Highway Dhaba', cuisine: 'indian;vegetarian', toilets: 'yes' } },
  { id: 2, km: 49, tags: { amenity: 'fuel', name: 'Indian Oil' } },
  { id: 3, km: 120, tags: { amenity: 'restaurant', name: 'Udupi Grand', cuisine: 'south_indian', 'diet:vegetarian': 'yes' } },
  { id: 4, km: 121, tags: { amenity: 'fuel', name: 'HP Petrol' } },
  { id: 5, km: 205, tags: { amenity: 'restaurant', name: 'Kamat Upachar', brand: 'Kamat', cuisine: 'indian' } },
  { id: 6, km: 206, tags: { amenity: 'fuel', name: 'BPCL' } },
  { id: 7, km: 160, tags: { amenity: 'hospital', name: 'Testpur District Hospital', emergency: 'yes', phone: '+91 80 1234 5678' } },
  { id: 8, km: 240, tags: { natural: 'waterfall', waterway: 'waterfall', name: 'Mock Falls', wikidata: 'Q1' } },
  { id: 9, km: 299, tags: { tourism: 'viewpoint', name: 'Sunset Point', wikidata: 'Q2' } },
].map((p) => ({ type: 'node', id: p.id, ...atKm(p.km, 0.2), tags: p.tags }));
const MOCKS = {
  'photon.komoot.io': (u) => {
    const q = u.searchParams.get('q').toLowerCase();
    const feats = [];
    if ('bengaluru'.startsWith(q.slice(0, 4))) feats.push({ properties: { name: 'Bengaluru', state: 'Karnataka', country: 'India', osm_value: 'city' }, geometry: { coordinates: [77.6, 12.9] } });
    if (q.startsWith('testp')) feats.push({ properties: { name: 'Testpur Hills', state: 'Karnataka', country: 'India', osm_value: 'town' }, geometry: { coordinates: [77.6, 15.6] } });
    return { features: feats };
  },
  'nominatim.openstreetmap.org': () => [],
  'routing.openstreetmap.de': () => ({
    code: 'Ok',
    routes: [
      { distance: 300000, duration: 4 * 3600, geometry: { coordinates: LINE }, legs: [{ distance: 300000, duration: 4 * 3600, steps: [{ distance: 280000, duration: 13000, name: 'Highway', ref: 'NH 48' }, { distance: 20000, duration: 1400, name: 'Town Road' }] }] },
      { distance: 320000, duration: 4.6 * 3600, geometry: { coordinates: LINE.map(([x, y]) => [x + 0.05, y]) }, legs: [{ distance: 320000, duration: 4.6 * 3600, steps: [{ distance: 320000, duration: 16560, name: 'State Highway', ref: 'SH 17' }] }] },
    ],
  }),
  'api.open-meteo.com': (u) =>
    u.pathname.includes('elevation')
      ? { elevation: u.searchParams.get('latitude').split(',').map((_, i) => 900 + i * 5) }
      : { daily: { time: Array.from({ length: 16 }, (_, i) => new Date(Date.now() + i * 86400000).toISOString().slice(0, 10)), temperature_2m_max: Array(16).fill(24), temperature_2m_min: Array(16).fill(14), precipitation_sum: Array(16).fill(0), precipitation_probability_max: Array(16).fill(10), weather_code: Array(16).fill(1) } },
  'overpass-api.de': () => ({ elements: PLACES }),
  'tiles.openfreemap.org': (u) => (u.pathname.startsWith('/styles/') ? { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8efe9' } }] } : {}),
};
async function installServiceMocks(context) {
  await context.route(/^https:\/\//, async (route) => {
    const u = new URL(route.request().url());
    const h = MOCKS[u.hostname];
    if (!h) return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(h(u)) });
  });
}

let browser, ctx, page, base;
const consoleErrors = [];

before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'allow' });
  await installServiceMocks(ctx);
  page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));
});

import { afterEach } from 'node:test';
afterEach(async () => {
  await ctx?.setOffline(false);
});

after(async () => {
  await browser?.close();
  server.close();
});

const shot = async (name) => {
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` });
};

async function goto(hash) {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.waitForTimeout(400);
}

test('app installs its service worker and precaches the shell', async () => {
  await page.goto(base);
  await page.getByRole('heading', { name: /Milestone/ }).waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  assert.equal(controlled, true, 'page should be controlled by the service worker after reload');
});

test('Scenario F: create and edit a checklist, then reopen in airplane mode', async () => {
  await goto('/trips/new');
  await page.getByLabel('Going to').fill('Chikmagalur');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('textbox', { name: 'Total driving distance' }).fill('500');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create trip and list' }).click();
  await page.getByRole('link', { name: 'Open checklist' }).waitFor();
  const tripUrl = page.url();
  await page.getByRole('link', { name: 'Open checklist' }).click();
  await page.locator('.item').first().waitFor();
  const firstTwo = await page.locator('.item__name').evaluateAll((els) => els.slice(0, 2).map((e) => e.textContent));
  await page.locator('.check').nth(0).click();
  await page.locator('.check').nth(1).click();
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.getByLabel('Name').fill('Coffee filter');
  await page.getByRole('button', { name: 'Add item' }).last().click();
  await page.waitForTimeout(300);

  // Airplane mode, then a full reload: the shell must come from the service worker.
  await ctx.setOffline(true);
  await page.reload();
  await page.locator('.offline-flag').waitFor();
  await page.locator('.item').first().waitFor();
  const packed = await page.locator('.item--packed .item__name').allTextContents();
  for (const n of firstTwo) assert.ok(packed.includes(n), `“${n}” should still be packed`);
  await page.getByRole('searchbox', { name: 'Search items' }).fill('Coffee');
  assert.equal(await page.locator('.item__name', { hasText: 'Coffee filter' }).count(), 1);

  // Rebuilding the list offline keeps edits.
  await page.goto(`${tripUrl}/edit`);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Save now' }).click();
  await page.getByText(/Your ticks and edits were kept/).waitFor();
  await ctx.setOffline(false);
});

test('Scenario H: automatic route, stops, restaurants every 100 km, separate lists, buy or bring', async () => {
  await goto('/trips/new');
  await page.getByLabel('Starting from').fill('Bengalur');
  await page.getByRole('option', { name: /Bengaluru/ }).click();
  await page.getByLabel('Going to').fill('Testpur');
  await page.getByRole('option', { name: /Testpur Hills/ }).click();
  await shot('wizard-places');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText('Choose your route').waitFor({ timeout: 15000 });
  const routeText = await page.locator('main').innerText();
  assert.match(routeText, /Fastest/);
  assert.match(routeText, /300 km · 5 h/);
  assert.match(routeText, /hills\/ghats detected/);
  await shot('wizard-route');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create trip and list' }).click();
  await page.getByRole('link', { name: /Route, stops & restaurants/ }).click();
  await page.getByRole('heading', { name: 'Best food every 100 km' }).waitFor({ timeout: 20000 });
  const plan = await page.locator('main').innerText();
  assert.match(plan, /Highway Dhaba/);
  assert.match(plan, /Udupi Grand/);
  assert.match(plan, /Mock Falls/);
  assert.match(plan, /Leave by/);
  const g = await page.getByRole('link', { name: 'Reviews & photos' }).first().getAttribute('href');
  assert.match(g, /^https:\/\/www\.google\.com\/maps\/search\//);
  const nav = await page.getByRole('link', { name: /Navigate in Google Maps/ }).getAttribute('href');
  assert.match(nav, /google\.com\/maps\/dir\/.*origin=12\.9/);
  await shot('route-plan');
  await page.evaluate(() => window.scrollTo(0, 1400));
  await shot('route-plan-food');

  await page.goBack();
  await page.getByRole('link', { name: 'Open checklist' }).click();
  await page.getByRole('tab', { name: /Car/ }).click();
  await page.locator('.item').first().waitFor();
  await shot('checklist-car-tab');
  await page.getByRole('tab', { name: /Everything/ }).click();

  await page.getByRole('link', { name: /Buy or bring/ }).click();
  await page.getByRole('heading', { name: /Bring from home — hard to buy on the road/ }).waitFor();
  await shot('buy-or-bring');
});

test('Scenario G: download a region, go offline, render map, search and route', async () => {
  await goto('/maps');
  await page.getByRole('button', { name: 'Regions', exact: true }).click();
  await page.getByLabel('Region catalog address').fill(base + 'test-regions/catalog.json');
  await page.getByRole('button', { name: 'Show available regions' }).click();
  await page.getByText('Testpur synthetic region').click();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByText('1 complete region(s)', { exact: false }).waitFor({ timeout: 30000 });
  assert.equal(await page.getByText('checksum verified').count(), 3);

  await ctx.setOffline(true);
  await page.reload();
  await page.locator('.offline-flag').waitFor();
  // Map renders from IndexedDB tiles + precached glyphs/sprites.
  await page.locator('.maplibregl-canvas').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: 'Find places' }).click();
  await page.getByPlaceholder('Town, hospital, restaurant…').fill('testpur');
  await page.getByText('Testpur General Hospital').waitFor();
  await shot('maps-offline-search');

  await page.getByRole('button', { name: 'Route', exact: true }).click();
  await page.getByRole('button', { name: /Start/ }).click();
  await page.getByPlaceholder(/Search towns and places offline/).fill('Testpur');
  await page.locator('.sheet .list-link', { hasText: 'Town' }).first().click();
  await page.getByRole('button', { name: /Destination/ }).click();
  await page.getByPlaceholder(/Search towns and places offline/).fill('Mockanahalli');
  await page.locator('.sheet .list-link', { hasText: 'Mockanahalli' }).first().click();
  await page.getByRole('button', { name: 'Find road route' }).click();
  await page.getByText(/by road/).waitFor({ timeout: 15000 });
  const text = await page.locator('main').innerText();
  assert.match(text, /Straight-line: \d+/);
  assert.match(text, /Suggested breaks with a toddler/);
  await shot('maps-offline-route');
  await page.evaluate(() => window.scrollTo(0, 700));
  await shot('maps-offline-route-details');

  // Outside coverage → graceful, labelled straight-line only.
  await page.getByRole('button', { name: /Destination/ }).click();
  await page.getByRole('button', { name: 'Coordinates' }).click();
  await page.getByRole('textbox', { name: 'Latitude' }).fill('13.08');
  await page.getByRole('textbox', { name: 'Longitude' }).fill('80.27');
  await page.getByRole('button', { name: 'Use these coordinates' }).click();
  await page.getByRole('button', { name: 'Find road route' }).click();
  await page.getByText(/not a driving distance/).waitFor();
  await ctx.setOffline(false);
});

test('no unexpected console errors', () => {
  // Font ranges outside the bundled Latin glyphs are not shipped; MapLibre logs those misses.
  const unexpected = consoleErrors.filter((e) => !/Noto Sans Devanagari|glyph|Failed to load resource: net::ERR_INTERNET_DISCONNECTED/i.test(e));
  assert.deepEqual(unexpected, []);
});
