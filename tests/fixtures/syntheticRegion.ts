/**
 * TEST-ONLY synthetic map data. Never shipped in the app and never shown as
 * real geography: names are deliberately fictional ("Testpur").
 */
// @ts-expect-error plain JS module without types
import { buildGraph } from '../../scripts/lib/graph-builder.mjs';
// @ts-expect-error plain JS module without types
import { buildPoiFile } from '../../scripts/lib/poi-builder.mjs';
import { sha256Hex } from '../../src/features/maps/sha256';
// @ts-expect-error plain JS module without types
import { writePmtiles as writePm } from './pmtiles-writer.mjs';

export const writePmtiles = writePm as (tiles: { z: number; x: number; y: number; data: Uint8Array }[], bounds: [number, number, number, number], minZ: number, maxZ: number) => Uint8Array;

export const SYN_BBOX: [number, number, number, number] = [77.0, 12.0, 78.0, 13.0];

// @ts-expect-error plain JS module without types
import { syntheticPois as sp, syntheticWays as sw } from './synthetic-data.mjs';
export const syntheticWays = sw as () => { coords: [number, number][]; tags: Record<string, string> }[];
export const syntheticPois = sp as () => { lon: number; lat: number; tags: Record<string, string> }[];

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
