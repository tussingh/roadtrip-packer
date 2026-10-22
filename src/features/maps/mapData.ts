import type { BBox, MapRegion } from '../../types';
import { inBBox, type LonLat } from './geo';
import { PoiIndex } from './poiIndex';
import { listRegions, readAsset } from './regionStore';
import { parseGraph, type RoadGraph } from './routing/graph';
import { computeRoute, type RouteFailure, type RouteResult, type Waypoint } from './routing/route';

const poiCache = new Map<string, Promise<PoiIndex>>();

export function getPoiIndex(regionId: string): Promise<PoiIndex> {
  let p = poiCache.get(regionId);
  if (!p) {
    p = readAsset(regionId, 'poi').then((b) => PoiIndex.fromBytes(b));
    p.catch(() => poiCache.delete(regionId));
    poiCache.set(regionId, p);
  }
  return p;
}

export function forgetRegion(regionId: string) {
  poiCache.delete(regionId);
  loadedGraphs.delete(regionId);
  mainGraphs.delete(regionId);
}

export const ready = (r: MapRegion, kind: 'tiles' | 'poi' | 'graph') => r.assets[kind]?.status === 'ready';

export async function readyRegions(kind: 'tiles' | 'poi' | 'graph'): Promise<MapRegion[]> {
  return (await listRegions()).filter((r) => ready(r, kind));
}

export function regionFor(regions: MapRegion[], points: LonLat[], kind: 'tiles' | 'poi' | 'graph'): MapRegion | undefined {
  return regions.filter((r) => ready(r, kind)).find((r) => points.every((p) => inBBox(p, r.bbox as BBox, 0.02)));
}

/* ---------------- routing (worker with main-thread fallback) ---------------- */

let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const loadedGraphs = new Set<string>();
const mainGraphs = new Map<string, RoadGraph>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./routing/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('Routing worker failed'));
      pending.clear();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

function call<T>(msg: object, transfer: Transferable[] = []): Promise<T> {
  const w = getWorker()!;
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ ...msg, id }, transfer);
  });
}

export async function routeOffline(regionId: string, waypoints: Waypoint[]): Promise<RouteResult | RouteFailure> {
  const w = getWorker();
  if (w) {
    if (!loadedGraphs.has(regionId)) {
      const bytes = await readAsset(regionId, 'graph');
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      await call({ type: 'load', regionId, bytes: buf }, [buf]);
      loadedGraphs.add(regionId);
    }
    return call<RouteResult | RouteFailure>({ type: 'route', regionId, waypoints });
  }
  let g = mainGraphs.get(regionId);
  if (!g) {
    g = parseGraph(await readAsset(regionId, 'graph'));
    mainGraphs.set(regionId, g);
  }
  return computeRoute(g, waypoints);
}
