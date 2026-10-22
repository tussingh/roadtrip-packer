import { cumulative, haversine, inBBox, pointAlong, type LonLat } from '../geo';
import type { PoiIndex } from '../poiIndex';
import { nearestNode, shortestPath, type RoadGraph } from './graph';

export interface Waypoint {
  name: string;
  lon: number;
  lat: number;
}

export interface RoadUse {
  name: string;
  distanceM: number;
}

export interface RouteLeg {
  from: string;
  to: string;
  distanceM: number;
  durationS: number;
  straightLineM: number;
}

export interface RouteResult {
  ok: true;
  geometry: LonLat[];
  distanceM: number;
  durationS: number;
  straightLineM: number;
  legs: RouteLeg[];
  roads: RoadUse[];
  snaps: { name: string; distM: number }[];
  warnings: string[];
}

export interface RouteFailure {
  ok: false;
  reason: 'outside-coverage' | 'no-road-nearby' | 'not-connected' | 'too-few-points';
  message: string;
  straightLineM?: number;
}

export const MAX_SNAP_M = 5000;

/**
 * Offline road route over the downloaded major-road graph.
 * Not turn-by-turn navigation: no turn restrictions, traffic or closures.
 */
export function computeRoute(g: RoadGraph, waypoints: Waypoint[]): RouteResult | RouteFailure {
  if (waypoints.length < 2) return { ok: false, reason: 'too-few-points', message: 'Choose a start and a destination.' };
  const straight = waypoints.slice(1).reduce((s, w, i) => s + haversine([waypoints[i].lon, waypoints[i].lat], [w.lon, w.lat]), 0);
  const outside = waypoints.filter((w) => !inBBox([w.lon, w.lat], g.bbox, 0.02));
  if (outside.length) {
    return {
      ok: false,
      reason: 'outside-coverage',
      message: `${outside.map((w) => w.name).join(', ')} ${outside.length === 1 ? 'is' : 'are'} outside the downloaded road data. Download a region that covers the whole route.`,
      straightLineM: straight,
    };
  }
  const snaps: { name: string; node: number; distM: number }[] = [];
  for (const w of waypoints) {
    const s = nearestNode(g, [w.lon, w.lat], MAX_SNAP_M);
    if (!s) {
      return {
        ok: false,
        reason: 'no-road-nearby',
        message: `No major road within ${MAX_SNAP_M / 1000} km of ${w.name} in the offline data (only highways and main roads are included).`,
        straightLineM: straight,
      };
    }
    snaps.push({ name: w.name, ...s });
  }
  const geometry: LonLat[] = [];
  const legs: RouteLeg[] = [];
  const roadMap = new Map<string, number>();
  const roadOrder: string[] = [];
  let distanceM = 0;
  let durationS = 0;
  for (let i = 1; i < snaps.length; i++) {
    const p = shortestPath(g, snaps[i - 1].node, snaps[i].node);
    if (!p) {
      return {
        ok: false,
        reason: 'not-connected',
        message: `No connected road path between ${snaps[i - 1].name} and ${snaps[i].name} in the downloaded data. The route may leave the region, or a connecting road may be missing from the extract.`,
        straightLineM: straight,
      };
    }
    for (let k = geometry.length && i > 1 ? 1 : 0; k < p.nodes.length; k++) geometry.push([g.lon[p.nodes[k]], g.lat[p.nodes[k]]]);
    for (const j of p.edges) {
      const name = g.meta.names[g.nameIdx[j]] ?? '';
      if (!name) continue;
      if (!roadMap.has(name)) roadOrder.push(name);
      roadMap.set(name, (roadMap.get(name) ?? 0) + g.lengthM[j]);
    }
    distanceM += p.distanceM;
    durationS += p.durationS;
    legs.push({
      from: snaps[i - 1].name,
      to: snaps[i].name,
      distanceM: p.distanceM,
      durationS: p.durationS,
      straightLineM: haversine([waypoints[i - 1].lon, waypoints[i - 1].lat], [waypoints[i].lon, waypoints[i].lat]),
    });
  }
  const warnings: string[] = [];
  for (const s of snaps) {
    if (s.distM > 1000) warnings.push(`${s.name} is ${(s.distM / 1000).toFixed(1)} km from the nearest major road in the data; the last stretch is not included.`);
  }
  const roads = roadOrder.map((name) => ({ name, distanceM: roadMap.get(name)! })).filter((r) => r.distanceM >= 2000);
  return {
    ok: true,
    geometry,
    distanceM,
    durationS,
    straightLineM: straight,
    legs,
    roads,
    snaps: snaps.map(({ name, distM }) => ({ name, distM })),
    warnings,
  };
}

export interface BreakSuggestion {
  targetAlongM: number;
  atHours: number;
  point: LonLat;
  options: { name: string; kind: string; alongM: number; offM: number; lon: number; lat: number }[];
}

/**
 * Suggest stops every `everyHours` of driving, choosing mapped fuel, food,
 * toilets and rest areas within `searchM` of the ideal point on the route.
 */
export function suggestBreaks(route: RouteResult, poi: PoiIndex, everyHours: number, searchM = 8000): BreakSuggestion[] {
  const cum = cumulative(route.geometry);
  const avgMs = route.distanceM / Math.max(1, route.durationS);
  const stepM = everyHours * 3600 * avgMs;
  const candidates = poi.alongRoute(route.geometry, 2000, ['fuel', 'restaurant', 'cafe', 'fast_food', 'toilets', 'rest_area', 'services']);
  const out: BreakSuggestion[] = [];
  for (let target = stepM; target < route.distanceM - stepM * 0.3; target += stepM) {
    const near = candidates
      .filter((c) => Math.abs(c.alongM - target) <= searchM)
      .sort((a, b) => Math.abs(a.alongM - target) - Math.abs(b.alongM - target))
      .slice(0, 4)
      .map((c) => ({ name: c.name, kind: c.kind, alongM: c.alongM, offM: c.offM, lon: c.lon, lat: c.lat }));
    out.push({ targetAlongM: target, atHours: target / avgMs / 3600, point: pointAlong(route.geometry, target, cum), options: near });
  }
  return out;
}

export function townsAlong(route: RouteResult, poi: PoiIndex): { name: string; kind: string; alongM: number }[] {
  return poi
    .alongRoute(route.geometry, 2500, ['city', 'town'])
    .filter((p) => p.name)
    .map((p) => ({ name: p.name, kind: p.kind, alongM: p.alongM }));
}
