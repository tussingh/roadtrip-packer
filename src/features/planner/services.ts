/**
 * Free online services (no keys, no accounts). Only places and route lines
 * are sent — never family details. Every call is user-initiated or part of
 * building a trip, and results are saved on the phone for offline use.
 *
 *  - Place search: Photon (komoot), Nominatim fallback — OpenStreetMap data
 *  - Routing: OSRM (FOSSGIS servers, project-osrm demo fallback)
 *  - Places along a route: Overpass API (OpenStreetMap)
 *  - Weather forecast and elevation: Open-Meteo
 */
import type { DayForecast, GeoPoint, PlannedPlace, RouteOption } from '../../types';
import { haversine, type LonLat } from '../maps/geo';

export class ServiceError extends Error {
  constructor(message: string, readonly offline = false) {
    super(message);
  }
}

type F = typeof fetch;

async function getJson<T>(url: string, f: F, init: RequestInit = {}, timeoutMs = 20000): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ServiceError('You are offline. Connect to the internet to look this up.', true);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await f(url, { ...init, signal: ctl.signal });
    if (res.status === 429) throw new ServiceError('The free map service is busy. Try again in a minute.');
    if (!res.ok) throw new ServiceError(`Map service error (HTTP ${res.status}).`);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    if ((e as { name?: string }).name === 'AbortError') throw new ServiceError('The map service took too long to answer. Try again.');
    throw new ServiceError('Could not reach the map service. Check your internet connection.', true);
  } finally {
    clearTimeout(t);
  }
}

/* ---------------- place search ---------------- */

const INDIA_BBOX = '68.0,6.0,97.5,37.5';

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; city?: string; district?: string; county?: string; state?: string; country?: string; osm_value?: string; type?: string; street?: string; housenumber?: string };
}

function label(p: PhotonFeature['properties']): { name: string; detail: string } {
  const name = p.name ?? [p.housenumber, p.street].filter(Boolean).join(' ') ?? 'Place';
  const parts = [p.city ?? p.district ?? p.county, p.state].filter((x) => x && x !== name);
  return { name, detail: [...new Set(parts)].join(', ') };
}

export async function searchPlaces(q: string, near: LonLat | undefined, f: F = fetch): Promise<GeoPoint[]> {
  const query = q.trim();
  if (query.length < 3) return [];
  try {
    const u = new URL('https://photon.komoot.io/api/');
    u.searchParams.set('q', query);
    u.searchParams.set('limit', '8');
    u.searchParams.set('lang', 'en');
    u.searchParams.set('bbox', INDIA_BBOX);
    if (near) {
      u.searchParams.set('lon', String(near[0]));
      u.searchParams.set('lat', String(near[1]));
    }
    const j = await getJson<{ features: PhotonFeature[] }>(u.toString(), f, {}, 10000);
    const out = j.features.map((x) => ({ ...label(x.properties), lon: x.geometry.coordinates[0], lat: x.geometry.coordinates[1] }));
    if (out.length) return dedupe(out);
  } catch (e) {
    if (e instanceof ServiceError && e.offline) throw e;
  }
  // Fallback: Nominatim (1 request per second policy; we only call after typing pauses).
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('q', query);
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('countrycodes', 'in');
  u.searchParams.set('limit', '8');
  u.searchParams.set('accept-language', 'en');
  const j = await getJson<{ lat: string; lon: string; name?: string; display_name: string }[]>(u.toString(), f, {}, 10000);
  return dedupe(
    j.map((x) => {
      const parts = x.display_name.split(',').map((s) => s.trim());
      return { name: x.name || parts[0], detail: parts.slice(1, 3).join(', '), lat: Number(x.lat), lon: Number(x.lon) };
    }),
  );
}

function dedupe(list: GeoPoint[]): GeoPoint[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    const k = `${p.name}|${p.detail}|${p.lat.toFixed(3)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ---------------- routing ---------------- */

interface OsrmStep {
  distance: number;
  duration: number;
  name?: string;
  ref?: string;
}
interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
  legs: { distance: number; duration: number; steps: OsrmStep[] }[];
}

const ROUTERS = ['https://routing.openstreetmap.de/routed-car/route/v1/driving/', 'https://router.project-osrm.org/route/v1/driving/'];

export async function fetchRoutes(points: GeoPoint[], f: F = fetch): Promise<OsrmRoute[]> {
  if (points.length < 2) throw new ServiceError('Choose where you start and where you are going.');
  const coords = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const params = `?overview=full&geometries=geojson&steps=true&alternatives=${points.length === 2 ? 'true' : 'false'}`;
  let last: unknown;
  for (const base of ROUTERS) {
    try {
      const j = await getJson<{ code: string; message?: string; routes: OsrmRoute[] }>(base + coords + params, f, {}, 25000);
      if (j.code === 'NoRoute') throw new ServiceError('No road route found between these places.');
      if (j.code !== 'Ok' || !j.routes?.length) throw new ServiceError(j.message ?? 'The route service could not plan this trip.');
      return j.routes;
    } catch (e) {
      last = e;
      if (e instanceof ServiceError && (e.offline || /No road route/.test(e.message))) throw e;
    }
  }
  throw last instanceof Error ? last : new ServiceError('Route service unavailable.');
}

const isHighwayRef = (ref: string) => /^(NH|AH|NE)\b|^NH\s?\d|^AH\d/i.test(ref.trim());

/** Keep one vertex every ~minM metres. */
export function thinLine(line: LonLat[], minM: number): LonLat[] {
  if (line.length < 3) return line;
  const out: LonLat[] = [line[0]];
  for (let i = 1; i < line.length - 1; i++) if (haversine(out[out.length - 1], line[i]) >= minM) out.push(line[i]);
  out.push(line[line.length - 1]);
  return out;
}

/** Turns router output into compact, explainable route options. */
export function toRouteOptions(routes: OsrmRoute[], points: GeoPoint[], timeFactor: number): RouteOption[] {
  const opts = routes.map((r, idx) => {
    const roadKm = new Map<string, number>();
    let hwy = 0;
    for (const leg of r.legs) {
      for (const s of leg.steps) {
        const ref = (s.ref ?? '').split(';')[0].trim();
        const name = ref ? `${ref}${s.name && s.name !== ref ? ` (${s.name})` : ''}` : s.name ?? '';
        if (ref && isHighwayRef(ref)) hwy += s.distance;
        if (name) roadKm.set(name, (roadKm.get(name) ?? 0) + s.distance / 1000);
      }
    }
    const geometry = thinLine(r.geometry.coordinates, 150);
    // Distribute time along the line proportionally to distance (good enough for stop planning).
    const cumKm = [0];
    for (let i = 1; i < geometry.length; i++) cumKm.push(cumKm[i - 1] + haversine(geometry[i - 1], geometry[i]) / 1000);
    const totalKm = r.distance / 1000;
    const totalH = (r.duration / 3600) * timeFactor;
    const scale = cumKm[cumKm.length - 1] > 0 ? totalKm / cumKm[cumKm.length - 1] : 1;
    const ckm = cumKm.map((k) => Math.round(k * scale * 10) / 10);
    const cumH = ckm.map((k) => Math.round((totalKm ? (k / totalKm) * totalH : 0) * 100) / 100);
    return {
      id: `r${idx}`,
      label: '',
      distanceKm: Math.round(totalKm * 10) / 10,
      durationH: Math.round(totalH * 100) / 100,
      highwayPct: r.distance ? Math.round((hwy / r.distance) * 100) : 0,
      roads: [...roadKm.entries()].map(([name, km]) => ({ name, km: Math.round(km) })).filter((x) => x.km >= 5).sort((a, b) => b.km - a.km).slice(0, 8),
      legs: r.legs.map((l, i) => ({ from: points[i]?.name ?? '', to: points[i + 1]?.name ?? '', km: Math.round(l.distance / 100) / 10, h: Math.round((l.duration / 3600) * timeFactor * 100) / 100 })),
      geometry,
      cumKm: ckm,
      cumH,
    } satisfies RouteOption;
  });
  return labelOptions(opts);
}

export function labelOptions(opts: RouteOption[]): RouteOption[] {
  if (!opts.length) return opts;
  const fastest = opts.reduce((a, b) => (b.durationH < a.durationH ? b : a));
  const shortest = opts.reduce((a, b) => (b.distanceKm < a.distanceKm ? b : a));
  const highway = opts.reduce((a, b) => (b.highwayPct > a.highwayPct ? b : a));
  return opts.map((o) => {
    const tags: string[] = [];
    if (o === fastest) tags.push('Fastest');
    if (o === shortest && o !== fastest) tags.push('Shortest');
    if (opts.length > 1 && o === highway && o.highwayPct > 0) tags.push(tags.length ? 'most national highway' : 'Most national highway');
    const via = o.roads[0]?.name ? ` via ${o.roads[0].name.split(' (')[0]}` : '';
    return { ...o, label: `${tags.join(', ') || 'Alternative'}${via}` };
  });
}

/* ---------------- places along the route ---------------- */

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

export const PLACE_KINDS = {
  food: ['restaurant', 'fast_food', 'cafe'],
  fuel: ['fuel'],
  toilets: ['toilets', 'rest_area', 'services'],
  medical: ['hospital', 'clinic'],
  pharmacy: ['pharmacy'],
  sights: ['attraction', 'viewpoint', 'museum', 'zoo', 'theme_park', 'waterfall', 'fort', 'monument', 'castle', 'ruins', 'archaeological_site', 'temple', 'lake', 'dam', 'park'],
};

interface OverpassEl {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function kindOf(t: Record<string, string>): string | undefined {
  if (t.amenity && ['restaurant', 'fast_food', 'cafe', 'fuel', 'toilets', 'hospital', 'clinic', 'pharmacy'].includes(t.amenity)) return t.amenity;
  if (t.highway === 'rest_area' || t.highway === 'services') return t.highway;
  if (t.tourism && ['attraction', 'viewpoint', 'museum', 'zoo', 'theme_park'].includes(t.tourism)) return t.tourism;
  if (t.waterway === 'waterfall' || t.natural === 'waterfall') return 'waterfall';
  if (t.historic && ['fort', 'monument', 'castle', 'ruins', 'archaeological_site'].includes(t.historic)) return t.historic;
  if (t.amenity === 'place_of_worship' && (t.wikidata || t.wikipedia)) return 'temple';
  if (t.water === 'lake' && t.name && (t.wikidata || t.wikipedia)) return 'lake';
  if (t.waterway === 'dam' && t.name && (t.wikidata || t.wikipedia)) return 'dam';
  if (t.leisure === 'park' && t.name && (t.wikidata || t.wikipedia)) return 'park';
  return undefined;
}

const KEEP_TAGS = ['cuisine', 'diet:vegetarian', 'brand', 'opening_hours', 'phone', 'contact:phone', 'website', 'toilets', 'changing_table', 'highchair', 'air_conditioning', 'wikidata', 'wikipedia', 'emergency', 'healthcare:speciality', 'fee', 'description', 'name:en', 'name', 'operator'];

function toPlaces(els: OverpassEl[]): Omit<PlannedPlace, 'alongKm' | 'offKm'>[] {
  const out: Omit<PlannedPlace, 'alongKm' | 'offKm'>[] = [];
  const seen = new Set<string>();
  for (const e of els) {
    const t = e.tags ?? {};
    const kind = kindOf(t);
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!kind || lat === undefined || lon === undefined) continue;
    const name = t['name:en'] || t.name || t.brand || '';
    if (!name && !['fuel', 'toilets', 'rest_area', 'services'].includes(kind)) continue;
    const key = `${kind}|${name}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tags: Record<string, string> = {};
    for (const k of KEEP_TAGS) if (t[k]) tags[k] = t[k];
    out.push({ id: `${e.type[0]}${e.id}`, name, kind, lat, lon, tags });
  }
  return out;
}

async function overpass(query: string, f: F): Promise<OverpassEl[]> {
  let last: unknown;
  for (const url of OVERPASS) {
    try {
      const j = await getJson<{ elements: OverpassEl[] }>(url, f, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 90000);
      return j.elements ?? [];
    } catch (e) {
      last = e;
      if (e instanceof ServiceError && e.offline) throw e;
    }
  }
  throw last instanceof Error ? last : new ServiceError('Places service unavailable.');
}

/** Food, fuel, toilets, medical and sights near a route line. */
export async function fetchPlacesAlong(line: LonLat[], f: F = fetch): Promise<Omit<PlannedPlace, 'alongKm' | 'offKm'>[]> {
  // ~1 point per 5 km keeps the query small; Overpass buffers the polyline.
  let pts = thinLine(line, 5000);
  if (pts.length > 400) pts = pts.filter((_, i) => i % Math.ceil(pts.length / 400) === 0).concat([line[line.length - 1]]);
  const poly = pts.map(([lon, lat]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join(',');
  const q = `[out:json][timeout:80];
(
  nwr(around:1500,${poly})["amenity"~"^(restaurant|fast_food|cafe|fuel|toilets|hospital|clinic|pharmacy)$"];
  nwr(around:1500,${poly})["highway"~"^(rest_area|services)$"];
  nwr(around:6000,${poly})["tourism"~"^(attraction|viewpoint|museum|zoo|theme_park)$"]["name"];
  nwr(around:6000,${poly})["waterway"="waterfall"]["name"];
  nwr(around:6000,${poly})["historic"~"^(fort|monument|castle|ruins|archaeological_site)$"]["name"];
);
out center tags qt;`;
  return toPlaces(await overpass(q, f));
}

/** Notable sights around the destination. */
export async function fetchSightsNear(p: GeoPoint, radiusM: number, f: F = fetch): Promise<Omit<PlannedPlace, 'alongKm' | 'offKm'>[]> {
  const a = `around:${radiusM},${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  const q = `[out:json][timeout:60];
(
  nwr(${a})["tourism"~"^(attraction|viewpoint|museum|zoo|theme_park)$"]["name"];
  nwr(${a})["waterway"="waterfall"]["name"];
  nwr(${a})["historic"~"^(fort|monument|castle|ruins|archaeological_site)$"]["name"];
  nwr(${a})["amenity"="place_of_worship"]["name"]["wikidata"];
  nwr(${a})["leisure"="park"]["name"]["wikidata"];
  nwr(${a})["water"="lake"]["name"]["wikidata"];
  nwr(${a})["waterway"="dam"]["name"]["wikidata"];
  nwr(${a})["amenity"~"^(hospital|restaurant)$"]["name"];
);
out center tags qt;`;
  return toPlaces(await overpass(q, f));
}

/* ---------------- weather & elevation ---------------- */

export async function fetchForecast(p: GeoPoint, f: F = fetch): Promise<DayForecast[]> {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', p.lat.toFixed(4));
  u.searchParams.set('longitude', p.lon.toFixed(4));
  u.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code');
  u.searchParams.set('timezone', 'Asia/Kolkata');
  u.searchParams.set('forecast_days', '16');
  const j = await getJson<{ daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_sum: number[]; precipitation_probability_max: (number | null)[]; weather_code: number[] } }>(u.toString(), f);
  const d = j.daily;
  return d.time.map((date, i) => ({ date, tMax: d.temperature_2m_max[i], tMin: d.temperature_2m_min[i], rainMm: d.precipitation_sum[i] ?? 0, rainProb: d.precipitation_probability_max[i] ?? 0, code: d.weather_code[i] }));
}

export async function fetchElevations(points: LonLat[], f: F = fetch): Promise<number[]> {
  const pts = points.slice(0, 100);
  if (!pts.length) return [];
  const u = new URL('https://api.open-meteo.com/v1/elevation');
  u.searchParams.set('latitude', pts.map((p) => p[1].toFixed(4)).join(','));
  u.searchParams.set('longitude', pts.map((p) => p[0].toFixed(4)).join(','));
  const j = await getJson<{ elevation: number[] }>(u.toString(), f);
  return j.elevation ?? [];
}
