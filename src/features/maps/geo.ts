import type { BBox } from '../../types';

export type LonLat = [number, number];

const R = 6371008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle ("straight-line") distance in metres. Never a driving distance. */
export function haversine(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function inBBox(p: LonLat, b: BBox, marginDeg = 0): boolean {
  return p[0] >= b[0] - marginDeg && p[0] <= b[2] + marginDeg && p[1] >= b[1] - marginDeg && p[1] <= b[3] + marginDeg;
}

export function polylineLength(line: LonLat[]): number {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += haversine(line[i - 1], line[i]);
  return d;
}

export function cumulative(line: LonLat[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + haversine(line[i - 1], line[i]));
  return out;
}

/** Local equirectangular projection — accurate enough within a few km. */
function project(p: LonLat, lat0: number): [number, number] {
  return [rad(p[0]) * Math.cos(rad(lat0)) * R, rad(p[1]) * R];
}

/** Distance from p to segment ab in metres, and fraction t along it. */
export function pointSegment(p: LonLat, a: LonLat, b: LonLat): { dist: number; t: number } {
  const lat0 = p[1];
  const [px, py] = project(p, lat0);
  const [ax, ay] = project(a, lat0);
  const [bx, by] = project(b, lat0);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), t };
}

/** Closest position on a polyline: distance off-route and distance along route (metres). */
export function locateOnLine(p: LonLat, line: LonLat[], cum = cumulative(line)): { offRoute: number; along: number } {
  let best = { offRoute: Infinity, along: 0 };
  for (let i = 1; i < line.length; i++) {
    const { dist, t } = pointSegment(p, line[i - 1], line[i]);
    if (dist < best.offRoute) best = { offRoute: dist, along: cum[i - 1] + t * (cum[i] - cum[i - 1]) };
  }
  return best;
}

/** Point at a given distance along a polyline. */
export function pointAlong(line: LonLat[], target: number, cum = cumulative(line)): LonLat {
  if (target <= 0) return line[0];
  for (let i = 1; i < line.length; i++) {
    if (cum[i] >= target) {
      const seg = cum[i] - cum[i - 1];
      const t = seg === 0 ? 0 : (target - cum[i - 1]) / seg;
      return [line[i - 1][0] + t * (line[i][0] - line[i - 1][0]), line[i - 1][1] + t * (line[i][1] - line[i - 1][1])];
    }
  }
  return line[line.length - 1];
}

export function bboxOf(points: LonLat[]): BBox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of points) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

export const km = (m: number) => Math.round(m / 100) / 10;

export function formatKm(m: number): string {
  const k = m / 1000;
  return k < 10 ? `${k.toFixed(1)} km` : `${Math.round(k)} km`;
}

export function formatHours(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  if (hh === 0) return `${mm} min`;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}
