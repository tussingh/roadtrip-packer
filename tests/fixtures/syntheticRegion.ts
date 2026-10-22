/**
 * TEST-ONLY synthetic map data. Never shipped in the app and never shown as
 * real geography: names are deliberately fictional ("Testpur").
 */
import { zxyToTileId } from 'pmtiles';
// @ts-expect-error plain JS module without types
import { buildGraph } from '../../scripts/lib/graph-builder.mjs';
// @ts-expect-error plain JS module without types
import { buildPoiFile } from '../../scripts/lib/poi-builder.mjs';
import { sha256Hex } from '../../src/features/maps/sha256';

function varint(n: number, out: number[]) {
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
}

/** Minimal valid PMTiles v3 writer (no compression, single root directory). */
export function writePmtiles(tiles: { z: number; x: number; y: number; data: Uint8Array }[], bounds: [number, number, number, number], minZ: number, maxZ: number): Uint8Array {
  const entries = tiles.map((t) => ({ id: zxyToTileId(t.z, t.x, t.y), data: t.data })).sort((a, b) => a.id - b.id);
  const dir: number[] = [];
  varint(entries.length, dir);
  let last = 0;
  for (const e of entries) {
    varint(e.id - last, dir);
    last = e.id;
  }
  for (let i = 0; i < entries.length; i++) varint(1, dir); // run lengths
  for (const e of entries) varint(e.data.length, dir);
  for (let i = 0; i < entries.length; i++) varint(i === 0 ? 1 : 0, dir); // offset+1, then contiguous
  const meta = new TextEncoder().encode('{"name":"synthetic test tiles"}');
  const tileBytes = entries.reduce((s, e) => s + e.data.length, 0);
  const H = 127;
  const total = H + dir.length + meta.length + tileBytes;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode('PMTiles'), 0);
  out[7] = 3;
  const u64 = (o: number, v: number) => {
    dv.setUint32(o, v >>> 0, true);
    dv.setUint32(o + 4, Math.floor(v / 2 ** 32), true);
  };
  const rootOff = H;
  const metaOff = rootOff + dir.length;
  const dataOff = metaOff + meta.length;
  u64(8, rootOff);
  u64(16, dir.length);
  u64(24, metaOff);
  u64(32, meta.length);
  u64(40, 0);
  u64(48, 0);
  u64(56, dataOff);
  u64(64, tileBytes);
  u64(72, entries.length);
  u64(80, entries.length);
  u64(88, entries.length);
  out[96] = 1; // clustered
  out[97] = 1; // internal compression: none
  out[98] = 1; // tile compression: none
  out[99] = 1; // tile type: mvt
  out[100] = minZ;
  out[101] = maxZ;
  dv.setInt32(102, Math.round(bounds[0] * 1e7), true);
  dv.setInt32(106, Math.round(bounds[1] * 1e7), true);
  dv.setInt32(110, Math.round(bounds[2] * 1e7), true);
  dv.setInt32(114, Math.round(bounds[3] * 1e7), true);
  out[118] = minZ;
  dv.setInt32(119, Math.round(((bounds[0] + bounds[2]) / 2) * 1e7), true);
  dv.setInt32(123, Math.round(((bounds[1] + bounds[3]) / 2) * 1e7), true);
  out.set(new Uint8Array(dir), rootOff);
  out.set(meta, metaOff);
  let o = dataOff;
  for (const e of entries) {
    out.set(e.data, o);
    o += e.data.length;
  }
  return out;
}

export const SYN_BBOX: [number, number, number, number] = [77.0, 12.0, 78.0, 13.0];

/**
 * A 6×6 grid of fictional roads, 0.15° apart, inside SYN_BBOX. Row 2 is a
 * fast "NH 900" highway; one diagonal one-way link; one isolated road island
 * that is deliberately unreachable.
 */
export function syntheticWays() {
  const ways: { coords: [number, number][]; tags: Record<string, string> }[] = [];
  const x0 = 77.1;
  const y0 = 12.1;
  const step = 0.15;
  for (let r = 0; r < 6; r++) {
    const y = y0 + r * step;
    const coords: [number, number][] = [];
    for (let c = 0; c < 6; c++) {
      coords.push([x0 + c * step, y]);
      if (c < 5) coords.push([x0 + c * step + step / 2, y + 0.0004]); // shape point
    }
    ways.push({ coords, tags: r === 2 ? { highway: 'trunk', ref: 'NH 900', name: 'Testpur Highway' } : { highway: 'secondary', name: `Row Road ${r}` } });
  }
  for (let c = 0; c < 6; c++) {
    const x = x0 + c * step;
    ways.push({ coords: Array.from({ length: 6 }, (_, r) => [x, y0 + r * step] as [number, number]), tags: { highway: 'tertiary', name: `Column Road ${c}` } });
  }
  ways.push({ coords: [[x0, y0], [x0 + step, y0 + step]], tags: { highway: 'primary', oneway: 'yes', name: 'Diagonal One-way' } });
  // isolated island (not connected to anything)
  ways.push({ coords: [[77.95, 12.95], [77.98, 12.98]], tags: { highway: 'secondary', name: 'Island Road' } });
  return ways;
}

export function syntheticPois() {
  const p = (lon: number, lat: number, tags: Record<string, string>) => ({ lon, lat, tags });
  return [
    p(77.1, 12.1, { place: 'town', name: 'Testpur' }),
    p(77.85, 12.85, { place: 'town', name: 'Mockanahalli', 'name:en': 'Mockanahalli' }),
    p(77.475, 12.4, { place: 'village', name: 'Sampleville' }),
    p(77.32, 12.402, { amenity: 'fuel', brand: 'Example Fuels' }),
    p(77.55, 12.401, { amenity: 'restaurant', name: 'Highway Dosa Corner' }),
    p(77.7, 12.399, { amenity: 'toilets' }),
    p(77.4, 12.42, { amenity: 'hospital', name: 'Testpur General Hospital' }),
    p(77.62, 12.38, { amenity: 'pharmacy', name: 'Care Pharmacy' }),
    p(77.25, 12.405, { highway: 'rest_area', name: 'NH 900 Rest Stop' }),
    p(80.5, 15.0, { amenity: 'fuel', name: 'Outside the box' }), // filtered by bbox
  ];
}

export function buildSyntheticRegion() {
  const tiles = [];
  for (let z = 0; z <= 2; z++) for (let x = 0; x < 2 ** z; x++) for (let y = 0; y < 2 ** z; y++) tiles.push({ z, x, y, data: new TextEncoder().encode(`tile ${z}/${x}/${y} `.repeat(40)) });
  const pmtiles = writePmtiles(tiles, SYN_BBOX, 0, 2);
  const graph: Uint8Array = buildGraph(syntheticWays(), { bbox: SYN_BBOX, generated: 'test' });
  const poi = new TextEncoder().encode(JSON.stringify(buildPoiFile(syntheticPois(), { bbox: SYN_BBOX, generated: 'test' })));
  return {
    pmtiles,
    graph,
    poi,
    manifest: {
      id: 'synthetic-test',
      name: 'Synthetic test region (not real map data)',
      description: 'Used only by automated tests.',
      bbox: SYN_BBOX,
      maxZoom: 2,
      attribution: 'Synthetic test data',
      assets: {
        tiles: { url: 'synthetic.pmtiles', bytes: pmtiles.length, sha256: sha256Hex(pmtiles) },
        poi: { url: 'synthetic.poi.json', bytes: poi.length, sha256: sha256Hex(poi) },
        graph: { url: 'synthetic.graph', bytes: graph.length, sha256: sha256Hex(graph) },
      },
    },
  };
}

/** fetch() stand-in that serves files with HTTP Range support, like a static host. */
export function rangeServer(files: Record<string, Uint8Array>, opts: { failAfterRequests?: number; etag?: string; ignoreRange?: boolean } = {}) {
  let requests = 0;
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests++;
    if (opts.failAfterRequests !== undefined && requests > opts.failAfterRequests) throw new TypeError('Failed to fetch');
    const url = String(input);
    const name = Object.keys(files).find((k) => url.endsWith(k));
    if (!name) return new Response('not found', { status: 404 });
    const body = files[name];
    const headers = new Headers(init?.headers);
    const range = headers.get('Range');
    const etag = opts.etag ?? '"v1"';
    if (!range || opts.ignoreRange || (headers.get('If-Range') && headers.get('If-Range') !== etag)) {
      return new Response(body.slice(), { status: 200, headers: { ETag: etag, 'Content-Length': String(body.length) } });
    }
    const m = /bytes=(\d+)-(\d+)/.exec(range)!;
    const start = Number(m[1]);
    const end = Math.min(body.length - 1, Number(m[2]));
    return new Response(body.slice(start, end + 1), { status: 206, headers: { ETag: etag, 'Content-Range': `bytes ${start}-${end}/${body.length}` } });
  };
  return { fetch: fn as typeof fetch, count: () => requests };
}
