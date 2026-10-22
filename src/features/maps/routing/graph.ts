import { haversine, type LonLat } from '../geo';

/**
 * Compact road graph ("MRG1") built from OpenStreetMap major roads by
 * scripts/build-road-graph.mjs. Layout (little-endian):
 *
 *   0  "MRG1"  4  u32 version  8  u32 nodes N  12 u32 edges E  16 u32 metaBytes
 *   20 f64 west,south,east,north   52 u32 reserved
 *   56 i32 lonE6[N]  i32 latE6[N]  u32 firstEdge[N+1]  u32 target[E]
 *      u32 lengthDm[E]  u16 nameIdx[E]  u8 speedKmh[E]  pad→4  metadata JSON
 */
export const GRAPH_HEADER_BYTES = 56;

export interface GraphMeta {
  names: string[];
  source: string;
  generated?: string;
  speeds?: Record<string, number>;
  classes?: string[];
}

export interface RoadGraph {
  n: number;
  e: number;
  bbox: [number, number, number, number];
  lon: Float64Array;
  lat: Float64Array;
  first: Uint32Array;
  target: Uint32Array;
  lengthM: Float32Array;
  nameIdx: Uint16Array;
  speed: Uint8Array;
  meta: GraphMeta;
  maxSpeedMs: number;
  grid: Map<string, number[]>;
}

const GRID = 0.02;

export function parseGraph(bytes: Uint8Array): RoadGraph {
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('Big-endian devices are not supported');
  const buf = bytes.byteOffset % 8 === 0 ? bytes : bytes.slice();
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== 'MRG1') throw new Error('Not a Milestone road-graph file.');
  const version = dv.getUint32(4, true);
  if (version !== 1) throw new Error(`Unsupported road-graph version ${version}.`);
  const n = dv.getUint32(8, true);
  const e = dv.getUint32(12, true);
  const metaBytes = dv.getUint32(16, true);
  const bbox: RoadGraph['bbox'] = [dv.getFloat64(20, true), dv.getFloat64(28, true), dv.getFloat64(36, true), dv.getFloat64(44, true)];
  let o = buf.byteOffset + GRAPH_HEADER_BYTES;
  const take32 = (count: number, Ctor: typeof Int32Array | typeof Uint32Array) => {
    const arr = new Ctor(buf.buffer as ArrayBuffer, o, count);
    o += count * 4;
    return arr;
  };
  const lonE6 = take32(n, Int32Array) as Int32Array;
  const latE6 = take32(n, Int32Array) as Int32Array;
  const first = take32(n + 1, Uint32Array) as Uint32Array;
  const target = take32(e, Uint32Array) as Uint32Array;
  const lengthDm = take32(e, Uint32Array) as Uint32Array;
  const nameIdx = new Uint16Array(buf.buffer, o, e);
  o += e * 2;
  const speed = new Uint8Array(buf.buffer, o, e);
  o += e;
  o += (4 - ((o - buf.byteOffset) % 4)) % 4;
  const expectedEnd = o - buf.byteOffset + metaBytes;
  if (expectedEnd > buf.byteLength) throw new Error('Road-graph file is truncated.');
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf.buffer, o, metaBytes))) as GraphMeta;
  if (first[n] !== e) throw new Error('Road-graph file is corrupt (edge index mismatch).');

  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    lon[i] = lonE6[i] / 1e6;
    lat[i] = latE6[i] / 1e6;
    const k = `${Math.floor(lon[i] / GRID)}:${Math.floor(lat[i] / GRID)}`;
    const a = grid.get(k);
    if (a) a.push(i);
    else grid.set(k, [i]);
  }
  const lengthM = new Float32Array(e);
  let maxSpeed = 1;
  for (let j = 0; j < e; j++) {
    lengthM[j] = lengthDm[j] / 10;
    if (speed[j] > maxSpeed) maxSpeed = speed[j];
  }
  return { n, e, bbox, lon, lat, first, target, lengthM, nameIdx, speed, meta, maxSpeedMs: maxSpeed / 3.6, grid };
}

export function nearestNode(g: RoadGraph, p: LonLat, maxM: number): { node: number; distM: number } | null {
  const cx = Math.floor(p[0] / GRID);
  const cy = Math.floor(p[1] / GRID);
  let best = null as { node: number; distM: number } | null;
  const maxRing = Math.ceil(maxM / 1800) + 1;
  for (let r = 0; r <= maxRing; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        for (const i of g.grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const d = haversine(p, [g.lon[i], g.lat[i]]);
          if (d <= maxM && (!best || d < best.distM)) best = { node: i, distM: d };
        }
      }
    }
    // Cells are ≥1.8 km wide (up to ~35° latitude): nothing in ring r+1 is closer than r × 1.8 km.
    if (best && r * 1800 >= best.distM) break;
  }
  return best;
}

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

export interface PathResult {
  nodes: number[];
  edges: number[];
  distanceM: number;
  durationS: number;
  settled: number;
}

/** A* on travel time with an admissible straight-line / max-speed heuristic. */
export function shortestPath(g: RoadGraph, from: number, to: number): PathResult | null {
  const dist = new Float64Array(g.n).fill(Infinity);
  const prevEdge = new Int32Array(g.n).fill(-1);
  const prevNode = new Int32Array(g.n).fill(-1);
  const closed = new Uint8Array(g.n);
  const tLon = g.lon[to];
  const tLat = g.lat[to];
  const h = (i: number) => haversine([g.lon[i], g.lat[i]], [tLon, tLat]) / g.maxSpeedMs;
  const heap = new MinHeap();
  dist[from] = 0;
  heap.push(h(from), from);
  let settled = 0;
  while (heap.size) {
    const u = heap.pop();
    if (closed[u]) continue;
    closed[u] = 1;
    settled++;
    if (u === to) break;
    for (let j = g.first[u]; j < g.first[u + 1]; j++) {
      const v = g.target[j];
      if (closed[v]) continue;
      const cost = dist[u] + g.lengthM[j] / (g.speed[j] / 3.6);
      if (cost < dist[v]) {
        dist[v] = cost;
        prevEdge[v] = j;
        prevNode[v] = u;
        heap.push(cost + h(v), v);
      }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const nodes: number[] = [];
  const edges: number[] = [];
  for (let c = to; c !== -1; c = prevNode[c]) {
    nodes.push(c);
    if (prevEdge[c] !== -1) edges.push(prevEdge[c]);
  }
  nodes.reverse();
  edges.reverse();
  let distanceM = 0;
  for (const j of edges) distanceM += g.lengthM[j];
  return { nodes, edges, distanceM, durationS: dist[to], settled };
}
