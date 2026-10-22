/// <reference lib="webworker" />
import { parseGraph, type RoadGraph } from './graph';
import { computeRoute, type Waypoint } from './route';

type Msg = { id: number; type: 'load'; regionId: string; bytes: ArrayBuffer } | { id: number; type: 'route'; regionId: string; waypoints: Waypoint[] };

const graphs = new Map<string, RoadGraph>();

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      graphs.set(m.regionId, parseGraph(new Uint8Array(m.bytes)));
      const g = graphs.get(m.regionId)!;
      (self as unknown as Worker).postMessage({ id: m.id, ok: true, result: { nodes: g.n, edges: g.e, bbox: g.bbox } });
    } else {
      const g = graphs.get(m.regionId);
      if (!g) throw new Error('Road graph not loaded');
      (self as unknown as Worker).postMessage({ id: m.id, ok: true, result: computeRoute(g, m.waypoints) });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
