import { createHash } from 'node:crypto';
import { PMTiles } from 'pmtiles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkFormat, DownloadError, downloadAsset, importAssetFile } from '../../src/features/maps/downloader';
import { haversine } from '../../src/features/maps/geo';
import { IdbChunkSource } from '../../src/features/maps/idbSource';
import { parseCatalog, regionFromManifest } from '../../src/features/maps/manifest';
import { PoiIndex } from '../../src/features/maps/poiIndex';
import { countChunks, deleteRegion, getRegion, readAsset, saveRegion } from '../../src/features/maps/regionStore';
import { parseGraph } from '../../src/features/maps/routing/graph';
import { computeRoute, suggestBreaks, townsAlong } from '../../src/features/maps/routing/route';
import { Sha256, sha256Hex } from '../../src/features/maps/sha256';
import { deleteDatabase, resetDBConnection } from '../../src/storage/db';
import { buildSyntheticRegion, rangeServer, writePmtiles, SYN_BBOX } from '../fixtures/syntheticRegion';

const BASE = 'https://maps.example.test/regions/catalog.json';

let n = 0;
beforeEach(async () => {
  await resetDBConnection(`maps-db-${++n}-${Date.now()}`);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await deleteDatabase();
});

describe('incremental SHA-256', () => {
  it('matches Node crypto across arbitrary chunk boundaries', () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 1000, 200_003]) {
      const data = new Uint8Array(size).map((_, i) => (i * 31 + size) & 255);
      const expected = createHash('sha256').update(data).digest('hex');
      expect(sha256Hex(data)).toBe(expected);
      const h = new Sha256();
      for (let o = 0; o < size; o += 7919) h.update(data.subarray(o, o + 7919));
      expect(h.digestHex()).toBe(expected);
    }
  });
});

async function registerRegion(manifest: ReturnType<typeof buildSyntheticRegion>['manifest']) {
  const { regions, error } = parseCatalog({ format: 'milestone-region-catalog', version: 1, regions: [manifest] }, BASE);
  expect(error).toBeUndefined();
  const r = regionFromManifest(regions[0]);
  await saveRegion(r);
  return r;
}

/** Large tiles so the archive spans several 1 MiB chunks and two range requests. */
function bigRegion() {
  const base = buildSyntheticRegion();
  const tiles = [];
  for (let z = 0; z <= 2; z++) for (let x = 0; x < 2 ** z; x++) for (let y = 0; y < 2 ** z; y++) tiles.push({ z, x, y, data: new Uint8Array(500_000).fill((z * 16 + x * 4 + y) & 255) });
  const pmtiles = writePmtiles(tiles, SYN_BBOX, 0, 2);
  base.manifest.assets.tiles = { url: 'synthetic.pmtiles', bytes: pmtiles.length, sha256: sha256Hex(pmtiles) };
  return { ...base, pmtiles };
}

describe('Scenario G — offline map coverage', () => {
  it('downloads, survives interruption, verifies, then serves map, search and routes with no network', async () => {
    const data = bigRegion();
    const files = { 'synthetic.pmtiles': data.pmtiles, 'synthetic.poi.json': data.poi, 'synthetic.graph': data.graph };
    const region = await registerRegion(data.manifest);
    expect(region.assets.tiles!.url).toBe('https://maps.example.test/regions/synthetic.pmtiles');
    expect(Math.ceil(data.pmtiles.length / 1048576)).toBeGreaterThan(8);

    // 1. Connection drops after the first 8 MiB block.
    const flaky = rangeServer(files, { failAfterRequests: 1 });
    await expect(downloadAsset({ regionId: region.id, kind: 'tiles', fetchImpl: flaky.fetch })).rejects.toBeInstanceOf(DownloadError);
    let r = await getRegion(region.id);
    expect(r!.assets.tiles!.status).toBe('error');
    expect(r!.assets.tiles!.chunksDone).toBe(8);
    expect(r!.installedAt).toBeUndefined();

    // 2. Resume: only the remaining block is requested.
    const good = rangeServer(files);
    const progress: number[] = [];
    r = await downloadAsset({ regionId: region.id, kind: 'tiles', fetchImpl: good.fetch, onProgress: (e) => e.phase === 'downloading' && progress.push(e.done) });
    expect(good.count()).toBe(1);
    expect(r.assets.tiles!.status).toBe('ready');
    expect(r.assets.tiles!.verified).toBe(true);
    expect(progress.at(-1)).toBe(data.pmtiles.length);

    await downloadAsset({ regionId: region.id, kind: 'poi', fetchImpl: good.fetch });
    r = await downloadAsset({ regionId: region.id, kind: 'graph', fetchImpl: good.fetch });
    expect(r.installedAt).toBeDefined();

    // 3. Airplane mode from here on.
    const offline = vi.fn(() => Promise.reject(new TypeError('offline')));
    vi.stubGlobal('fetch', offline);

    const src = new IdbChunkSource(region.id, r.assets.tiles!.bytes, r.assets.tiles!.chunkSize);
    const pm = new PMTiles(src);
    const header = await pm.getHeader();
    expect(header.maxZoom).toBe(2);
    const tile = await pm.getZxy(2, 1, 3);
    expect(tile!.data.byteLength).toBe(500_000);
    expect(new Uint8Array(tile!.data)[0]).toBe((2 * 16 + 1 * 4 + 3) & 255);
    expect(await pm.getZxy(5, 1, 1)).toBeUndefined(); // beyond max zoom: not in archive

    const poi = PoiIndex.fromBytes(await readAsset(region.id, 'poi'));
    expect(poi.size).toBe(9); // the out-of-bbox place was filtered by the builder
    expect(poi.search('testpur').map((p) => p.name)).toEqual(['Testpur', 'Testpur General Hospital']);
    expect(poi.search('dosa')[0].kind).toBe('restaurant');
    expect(poi.search('example')[0].name).toBe('Example Fuels'); // unnamed fuel uses its brand
    expect(poi.nearby([77.33, 12.4], 3000, ['fuel'])[0].name).toBe('Example Fuels');
    expect(poi.covers([80.5, 15])).toBe(false);

    const graph = parseGraph(await readAsset(region.id, 'graph'));
    const route = computeRoute(graph, [
      { name: 'Testpur', lon: 77.1, lat: 12.1 },
      { name: 'Mockanahalli', lon: 77.85, lat: 12.85 },
    ]);
    if (!route.ok) throw new Error(route.message);
    const straight = haversine([77.1, 12.1], [77.85, 12.85]);
    expect(route.straightLineM).toBeCloseTo(straight, 0);
    expect(route.distanceM).toBeGreaterThan(straight);
    expect(route.distanceM).toBeLessThan(straight * 1.5);
    expect(route.durationS).toBeGreaterThan(0);
    expect(route.legs).toHaveLength(1);
    expect(route.roads.length).toBeGreaterThan(0);

    const towns = townsAlong(route, poi).map((t) => t.name);
    expect(towns[0]).toBe('Testpur');
    const breaks = suggestBreaks(route, poi, 0.5, 20_000);
    expect(breaks.length).toBeGreaterThan(0);
    expect(offline).not.toHaveBeenCalled();
  });

  it('fails gracefully outside coverage and on disconnected or one-way roads', async () => {
    const data = buildSyntheticRegion();
    const g = parseGraph(data.graph);
    const outside = computeRoute(g, [
      { name: 'Testpur', lon: 77.1, lat: 12.1 },
      { name: 'Chennai', lon: 80.27, lat: 13.08 },
    ]);
    expect(outside.ok).toBe(false);
    if (!outside.ok) {
      expect(outside.reason).toBe('outside-coverage');
      expect(outside.message).toMatch(/Chennai is outside the downloaded road data/);
      expect(outside.straightLineM).toBeGreaterThan(300_000); // offered as straight-line only
    }
    const island = computeRoute(g, [
      { name: 'Testpur', lon: 77.1, lat: 12.1 },
      { name: 'Island', lon: 77.96, lat: 12.96 },
    ]);
    expect(island.ok || island.reason).toBe('not-connected');
    const noRoad = computeRoute(g, [
      { name: 'Testpur', lon: 77.1, lat: 12.1 },
      { name: 'Field', lon: 77.5, lat: 12.97 },
    ]);
    // Within the bbox but > 5 km from any road node in the graph
    expect(noRoad.ok || noRoad.reason).toBe('no-road-nearby');

    const fwd = computeRoute(g, [{ name: 'A', lon: 77.1, lat: 12.1 }, { name: 'B', lon: 77.25, lat: 12.25 }]);
    const back = computeRoute(g, [{ name: 'B', lon: 77.25, lat: 12.25 }, { name: 'A', lon: 77.1, lat: 12.1 }]);
    if (!fwd.ok || !back.ok) throw new Error('expected routes');
    expect(fwd.roads.map((r) => r.name)).toContain('Diagonal One-way');
    expect(back.roads.map((r) => r.name)).not.toContain('Diagonal One-way');
    expect(back.distanceM).toBeGreaterThan(fwd.distanceM);
  });

  it('detects corruption, server file changes, missing range support and reports missing data', async () => {
    const data = buildSyntheticRegion();
    const files = { 'synthetic.pmtiles': data.pmtiles, 'synthetic.poi.json': data.poi, 'synthetic.graph': data.graph };
    const corrupted = { ...files, 'synthetic.graph': data.graph.slice().fill(7, 100, 200) };
    const region = await registerRegion(data.manifest);

    let r = await downloadAsset({ regionId: region.id, kind: 'graph', fetchImpl: rangeServer(corrupted).fetch });
    expect(r.assets.graph!.status).toBe('error');
    expect(r.assets.graph!.error).toMatch(/Checksum mismatch/);
    expect(await countChunks(region.id, 'graph')).toBe(0);
    await expect(readAsset(region.id, 'graph')).rejects.toThrow(/not installed/);

    r = await downloadAsset({ regionId: region.id, kind: 'graph', fetchImpl: rangeServer(files, { ignoreRange: true }).fetch });
    expect(r.assets.graph!.status).toBe('ready');

    await expect(importAssetFile(region.id, 'poi', new Blob([data.poi.slice()]))).resolves.toMatchObject({ assets: { poi: { status: 'ready', source: 'file-import' } } });
    const notPm = await importAssetFile(region.id, 'tiles', new Blob([new TextEncoder().encode('hello world, not a map')]));
    expect(notPm.assets.tiles!.status).toBe('error');
    expect(notPm.assets.tiles!.error).toMatch(/PMTiles/);

    await deleteRegion(region.id);
    expect(await getRegion(region.id)).toBeUndefined();
    expect(await countChunks(region.id, 'poi')).toBe(0);
  });

  it('restarts when the server file changes between resumes (If-Range)', async () => {
    const data = bigRegion();
    const region = await registerRegion(data.manifest);
    const files = { 'synthetic.pmtiles': data.pmtiles };
    await expect(downloadAsset({ regionId: region.id, kind: 'tiles', fetchImpl: rangeServer(files, { failAfterRequests: 1, etag: '"old"' }).fetch })).rejects.toThrow();
    const server = rangeServer(files, { etag: '"new"' });
    const r = await downloadAsset({ regionId: region.id, kind: 'tiles', fetchImpl: server.fetch });
    expect(r.assets.tiles!.status).toBe('ready');
    expect(server.count()).toBe(3); // 200 (changed) → restart: two range blocks
  });

  it('refuses to start downloads while offline and validates formats', async () => {
    const data = buildSyntheticRegion();
    const region = await registerRegion(data.manifest);
    vi.stubGlobal('navigator', { onLine: false });
    await expect(downloadAsset({ regionId: region.id, kind: 'poi', fetchImpl: rangeServer({}).fetch })).rejects.toThrow(/offline/);
    expect(checkFormat('graph', new TextEncoder().encode('MRG1'))).toBeUndefined();
    expect(checkFormat('poi', new TextEncoder().encode('<html>'))).toMatch(/places index/);
  });

  it('rejects malformed catalogs with a readable error', () => {
    expect(parseCatalog({ format: 'milestone-region-catalog', version: 1, regions: [{ id: 'Bad ID' }] }, BASE).error).toMatch(/Not a valid region catalog/);
    expect(parseCatalog(42, BASE).regions).toEqual([]);
  });
});
