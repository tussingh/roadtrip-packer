/**
 * Save the map along a trip route for offline use. Tiles come from
 * OpenFreeMap (free, no key) and are stored in Cache Storage, where the
 * service worker serves them when there is no signal. Kept well inside
 * OpenFreeMap's fair-use guidance: at most 3000 tiles, 4 requests at a time.
 */
import type { LonLat } from '../maps/geo';
import { haversine } from '../maps/geo';

export const OFM_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
export const OFM_ATTRIBUTION = 'OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors';
const TILE_CACHE = 'ofm-tiles';
const META_CACHE = 'ofm-meta';
export const MAX_TILES = 3000;
const MAX_BYTES = 50 * 1024 * 1024;

export function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

/** Tiles covering the route corridor (z5–zMax) and the destination area (up to z15). */
export function corridorTiles(line: LonLat[], dest: LonLat, zMax: number): string[] {
  const set = new Set<string>();
  const add = (z: number, x: number, y: number) => {
    const n = 2 ** z;
    if (x >= 0 && y >= 0 && x < n && y < n) set.add(`${z}/${x}/${y}`);
  };
  for (let z = 5; z <= zMax; z++) {
    const tileM = (40075016 * Math.cos((12 * Math.PI) / 180)) / 2 ** z;
    const step = tileM / 3;
    const pad = z <= 11 ? 1 : 0;
    for (let i = 0; i < line.length; i++) {
      const pts: LonLat[] = [line[i]];
      if (i > 0) {
        const d = haversine(line[i - 1], line[i]);
        const k = Math.ceil(d / step);
        for (let j = 1; j < k; j++) pts.push([line[i - 1][0] + ((line[i][0] - line[i - 1][0]) * j) / k, line[i - 1][1] + ((line[i][1] - line[i - 1][1]) * j) / k]);
      }
      for (const p of pts) {
        const [x, y] = lonLatToTile(p[0], p[1], z);
        for (let dx = -pad; dx <= pad; dx++) for (let dy = -pad; dy <= pad; dy++) add(z, x + dx, y + dy);
      }
    }
  }
  for (let z = zMax + 1; z <= 15; z++) {
    const [x, y] = lonLatToTile(dest[0], dest[1], z);
    const r = z <= 13 ? 2 : 1;
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) add(z, x + dx, y + dy);
  }
  return [...set];
}

/** Highest corridor zoom that keeps the tile count within the fair-use cap. */
export function planTiles(line: LonLat[], dest: LonLat): { zMax: number; tiles: string[] } {
  for (let z = 14; z >= 9; z--) {
    const tiles = corridorTiles(line, dest, z);
    if (tiles.length <= MAX_TILES) return { zMax: z, tiles };
  }
  return { zMax: 8, tiles: corridorTiles(line, dest, 8).slice(0, MAX_TILES) };
}

interface StyleJson {
  sprite?: string | { id: string; url: string }[];
  glyphs?: string;
  sources: Record<string, { type: string; url?: string; tiles?: string[] }>;
  layers: { layout?: Record<string, unknown> }[];
}

export interface SaveProgress {
  done: number;
  total: number;
  bytes: number;
}

export async function saveRouteMap(line: LonLat[], dest: LonLat, onProgress: (p: SaveProgress) => void, signal?: AbortSignal): Promise<{ tiles: number; bytes: number; zMax: number }> {
  if (!('caches' in window)) throw new Error('This browser cannot store maps offline.');
  const meta = await caches.open(META_CACHE);
  const store = await caches.open(TILE_CACHE);
  const get = async (url: string, cache: Cache) => {
    const res = await fetch(url, { mode: 'cors', signal });
    if (!res.ok) throw new Error(`Map server answered ${res.status}`);
    await cache.put(url, res.clone());
    return res;
  };
  const style = (await (await get(OFM_STYLE, meta)).json()) as StyleJson;
  const vector = Object.values(style.sources).find((s) => s.type === 'vector');
  let template = vector?.tiles?.[0];
  if (!template && vector?.url) {
    const tj = (await (await get(vector.url, meta)).json()) as { tiles: string[] };
    template = tj.tiles[0];
  }
  if (!template) throw new Error('Map style has no tile source.');

  const extras: string[] = [];
  const sprites = typeof style.sprite === 'string' ? [style.sprite] : (style.sprite ?? []).map((s) => s.url);
  for (const s of sprites) extras.push(`${s}.json`, `${s}.png`, `${s}@2x.json`, `${s}@2x.png`);
  if (style.glyphs) {
    const stacks = new Set<string>();
    for (const l of style.layers) {
      const f = l.layout?.['text-font'];
      if (Array.isArray(f) && f.every((x) => typeof x === 'string')) stacks.add((f as string[]).join(','));
    }
    for (const st of stacks) for (const range of ['0-255', '256-511', '8192-8447']) extras.push(style.glyphs.replace('{fontstack}', encodeURIComponent(st)).replace('{range}', range));
  }

  const { tiles, zMax } = planTiles(line, dest);
  const urls = [...extras, ...tiles.map((t) => { const [z, x, y] = t.split('/'); return template!.replace('{z}', z).replace('{x}', x).replace('{y}', y); })];
  let done = 0;
  let bytes = 0;
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (bytes > MAX_BYTES) return;
      const url = urls[next++];
      try {
        const hit = await store.match(url);
        if (hit) {
          bytes += Number(hit.headers.get('content-length') ?? 0);
        } else {
          const res = await fetch(url, { mode: 'cors', signal });
          if (res.ok) {
            const buf = await res.clone().arrayBuffer();
            bytes += buf.byteLength;
            await store.put(url, res);
          }
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        /* a missing tile just shows blank; keep going */
      }
      done++;
      if (done % 10 === 0 || done === urls.length) onProgress({ done, total: urls.length, bytes });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (navigator.storage?.persist) void navigator.storage.persist();
  return { tiles: done, bytes, zMax };
}
