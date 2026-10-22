import { describe, expect, it } from 'vitest';
import { departureAdvice, fuelCost, googleDirectionsUrl, hospitalsAlong, locatePlaces, planStops, restaurantScore, restaurantsEvery, sightsAlong, summariseForecast, sunTimes, fuelGaps } from '../../src/features/planner/analyze';
import { addPlaces, applyPlanToTrip, buildRoutePlan } from '../../src/features/planner/planner';
import { fetchRoutes, searchPlaces, ServiceError, toRouteOptions } from '../../src/features/planner/services';
import { DEFAULT_ASSUMPTIONS } from '../../src/rules/assumptions';
import { deriveFacts } from '../../src/rules/context';
import type { GeoPoint } from '../../src/types';
import { TODAY, family, trip } from '../fixtures/family';

/* A straight 300 km "highway" heading north from (77.6, 12.9), ~5 h. */
const BLR: GeoPoint = { name: 'Bengaluru', lat: 12.9, lon: 77.6 };
const DEST: GeoPoint = { name: 'Testpur Hills', lat: 15.6, lon: 77.6 };
const coords: [number, number][] = Array.from({ length: 301 }, (_, i) => [77.6, 12.9 + (2.7 * i) / 300]);
const osrm = (dist = 300000, dur = 4 * 3600, ref = 'NH 48') => ({
  distance: dist,
  duration: dur,
  geometry: { coordinates: coords },
  legs: [{ distance: dist, duration: dur, steps: [{ distance: dist * 0.9, duration: dur * 0.9, name: 'Highway', ref }, { distance: dist * 0.1, duration: dur * 0.1, name: 'Town Road' }] }],
});

function fakeNet(handlers: Record<string, (url: URL, init?: RequestInit) => unknown>) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.host);
    const h = Object.entries(handlers).find(([k]) => url.href.includes(k));
    if (!h) return new Response('nope', { status: 503 });
    const body = h[1](url, init);
    if (body instanceof Response) return body;
    return Response.json(body);
  }) as typeof fetch;
  return { f, calls };
}

const at = (km: number, off = 0): [number, number] => [77.6 + off / 108, 12.9 + (2.7 * km) / 300];
const el = (id: number, km: number, tags: Record<string, string>, off = 0) => {
  const [lon, lat] = at(km, off);
  return { type: 'node', id, lat, lon, tags };
};
const PLACES = [
  el(1, 40, { amenity: 'restaurant', name: 'Kamat Upachar', cuisine: 'south_indian;vegetarian', 'diet:vegetarian': 'only', toilets: 'yes' }),
  el(2, 45, { amenity: 'fast_food', name: 'Burger Shack' }, 2),
  el(3, 120, { amenity: 'restaurant', name: 'Highway Dhaba', cuisine: 'north_indian' }),
  el(4, 121, { amenity: 'fuel', brand: 'Indian Oil' }),
  el(5, 122, { amenity: 'toilets' }),
  el(6, 150, { amenity: 'hospital', name: 'District Hospital', emergency: 'yes' }),
  el(7, 200, { amenity: 'restaurant', name: 'A2B', brand: 'Adyar Ananda Bhavan', cuisine: 'indian' }),
  el(8, 210, { waterway: 'waterfall', name: 'Big Falls', wikidata: 'Q1' }, 3),
  el(9, 260, { amenity: 'restaurant', name: 'Far Away Cafe' }, 20),
];

describe('route options from the router', () => {
  it('labels fastest vs most-highway and computes highway share', () => {
    const opts = toRouteOptions([osrm(300000, 4 * 3600, 'NH 48'), osrm(280000, 4.5 * 3600, 'SH 20')], [BLR, DEST], 1.25);
    expect(opts[0].label).toMatch(/^Fastest, most national highway via NH 48/);
    expect(opts[1].label).toMatch(/^Shortest/);
    expect(opts[0].highwayPct).toBe(90);
    expect(opts[1].highwayPct).toBe(0);
    expect(opts[0].durationH).toBe(5); // 4 h × 1.25 real-world factor
    expect(opts[0].cumKm.at(-1)).toBeCloseTo(300, 0);
  });

  it('falls back to the second router and reports offline clearly', async () => {
    const net = fakeNet({ 'router.project-osrm.org': () => ({ code: 'Ok', routes: [osrm()] }) });
    const r = await fetchRoutes([BLR, DEST], net.f);
    expect(r).toHaveLength(1);
    expect(net.calls).toEqual(['routing.openstreetmap.de', 'router.project-osrm.org']);
    const off = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(fetchRoutes([BLR, DEST], off)).rejects.toBeInstanceOf(ServiceError);
  });

  it('searches places with Photon and falls back to Nominatim', async () => {
    const photon = fakeNet({ 'photon.komoot.io': () => ({ features: [{ geometry: { coordinates: [75.74, 12.42] }, properties: { name: 'Madikeri', state: 'Karnataka', county: 'Kodagu' } }] }) });
    expect(await searchPlaces('madik', undefined, photon.f)).toEqual([{ name: 'Madikeri', detail: 'Kodagu, Karnataka', lat: 12.42, lon: 75.74 }]);
    const nomi = fakeNet({ 'photon.komoot.io': () => new Response('x', { status: 500 }), 'nominatim.openstreetmap.org': () => [{ lat: '12.42', lon: '75.74', name: 'Madikeri', display_name: 'Madikeri, Kodagu, Karnataka, India' }] });
    expect((await searchPlaces('madikeri', undefined, nomi.f))[0]).toMatchObject({ name: 'Madikeri', detail: 'Kodagu, Karnataka' });
    expect(await searchPlaces('ab', undefined, nomi.f)).toEqual([]);
  });
});

describe('trip plan end to end (mocked services)', () => {
  const net = fakeNet({
    'routing.openstreetmap.de': () => ({ code: 'Ok', routes: [osrm()] }),
    'api.open-meteo.com/v1/forecast': () => ({ daily: { time: ['2026-11-06', '2026-11-07', '2026-11-08'], temperature_2m_max: [24, 23, 25], temperature_2m_min: [14, 13, 15], precipitation_sum: [0, 4, 0], precipitation_probability_max: [10, 70, 20], weather_code: [1, 61, 2] } }),
    'api.open-meteo.com/v1/elevation': (u) => ({ elevation: u.searchParams.get('latitude')!.split(',').map((_, i) => 900 + i * 10) }),
    'overpass-api.de': (_u, init) => ({ elements: String(init?.body).includes('around%3A20000') ? [el(20, 300, { tourism: 'viewpoint', name: 'Sunset Point', wikidata: 'Q2' }, 2)] : PLACES }),
  });

  it('builds route, forecast, elevation and places, then fills the trip', async () => {
    let plan = await buildRoutePlan({ origin: BLR, destination: DEST, via: [] }, DEFAULT_ASSUMPTIONS, net.f);
    expect(plan.options[0].distanceKm).toBe(300);
    expect(plan.forecast).toHaveLength(3);
    expect(plan.elevation!.max).toBeGreaterThan(900);
    plan = await addPlaces(plan, net.f);
    expect(plan.places!.find((p) => p.name === 'Far Away Cafe')).toBeUndefined(); // 20 km off route
    expect(plan.places!.find((p) => p.name === 'Kamat Upachar')!.alongKm).toBeCloseTo(40, 0);
    expect(plan.destinationSights![0].name).toBe('Sunset Point');

    const t = applyPlanToTrip({ ...trip({ days: 3, nights: 2 }), returnSameRoute: true }, plan);
    expect(t.kmSource).toBe('online-route');
    expect(t.totalKm).toBe(600); // there and back
    expect(t.legs.map((l) => l.hours)).toEqual([5, 5]);
    expect(t.mountains).toBe(true); // elevation ≥ 900 m
    expect(t.remote).toBe(true); // > 100 km without mapped fuel

    // The packing engine now uses the real forecast instead of the seasonal guess.
    const facts = deriveFacts({ ...t, temperature: 'auto', rain: 'auto', startDate: '2026-11-06', endDate: '2026-11-08' }, family(), DEFAULT_ASSUMPTIONS, TODAY);
    expect(facts.weatherSource).toBe('forecast');
    expect(facts.temperature).toBe('cool');
    expect(facts.rain).toBe('showers');
  });
});

describe('planning logic', () => {
  const opt = toRouteOptions([osrm()], [BLR, DEST], 1.25)[0];
  const raw = PLACES.map((e) => ({ id: String(e.id), name: e.tags.name ?? e.tags.brand ?? '', kind: e.tags.amenity ?? (e.tags.waterway ? 'waterfall' : ''), lat: e.lat, lon: e.lon, tags: e.tags }));
  const places = locatePlaces(opt, raw);

  it('picks family-friendly restaurants about every 100 km, with reasons', () => {
    const w = restaurantsEvery(opt, places, 100);
    expect(w.map((x) => [x.fromKm, x.toKm])).toEqual([[0, 100], [100, 200], [200, 300]]);
    expect(w[0].picks[0].place.name).toBe('Kamat Upachar');
    expect(w[0].picks[0].why).toEqual(expect.arrayContaining(['pure vegetarian', 'toilets', 'right on the route']));
    expect(w[1].picks[0].place.name).toBe('Highway Dhaba');
    expect(w[2].picks[0].place.name).toBe('A2B');
    expect(restaurantScore(places.find((p) => p.name === 'Burger Shack')!).score).toBeLessThan(restaurantScore(places.find((p) => p.name === 'Kamat Upachar')!).score);
  });

  it('plans toddler breaks every 2 hours and labels meals from the departure time', () => {
    const stops = planStops(opt, places, 2, 6);
    expect(stops.map((s) => s.atH)).toEqual([2, 4]);
    expect(stops[0].clock).toBe('8:00 am');
    expect(stops[0].meal).toBe('Breakfast');
    expect(stops[0].main?.name).toBe('Highway Dhaba');
    expect(stops[0].fuel?.name).toBe('Indian Oil');
    expect(stops[0].toilets).toBeDefined();
  });

  it('finds sights, hospitals and fuel gaps', () => {
    expect(sightsAlong(places).map((p) => p.name)).toEqual(['Big Falls']);
    expect(hospitalsAlong(places, opt).map((p) => p.name)).toEqual(['District Hospital']);
    expect(fuelGaps(places, opt, 100)).toEqual([{ fromKm: 121, toKm: 300 }]);
  });

  it('advises departure so you arrive well before sunset', () => {
    const s = sunTimes(12.97, 77.59, '2026-11-06');
    expect(s.sunset).toBeGreaterThan(17.6);
    expect(s.sunset).toBeLessThan(18.1);
    const short = departureAdvice({ durationH: 5, breakEveryH: 2, originName: 'Bengaluru, Karnataka', date: '2026-11-06', dest: DEST, mountains: false, hasChild: true });
    expect(short.departH).toBe(6);
    expect(short.breaks).toBe(2);
    expect(short.overnightSuggested).toBe(false);
    const long = departureAdvice({ durationH: 13, breakEveryH: 2, originName: 'Bengaluru', date: '2026-11-06', dest: DEST, mountains: true, hasChild: true });
    expect(long.departH).toBe(5);
    expect(long.overnightSuggested).toBe(true);
  });

  it('summarises forecast, fuel cost and Google Maps links', () => {
    expect(summariseForecast([{ date: '2026-11-06', tMax: 36, tMin: 24, rainMm: 0, rainProb: 0, code: 0 }], '2026-11-06')).toMatchObject({ temperature: 'hot', rain: 'dry' });
    expect(summariseForecast([{ date: '2026-07-06', tMax: 26, tMin: 20, rainMm: 25, rainProb: 90, code: 63 }], '2026-07-06')!.rain).toBe('monsoon');
    expect(summariseForecast([], '2026-07-06')).toBeUndefined();
    expect(fuelCost(600, 15, 102)).toEqual({ litres: 40, rupees: 4100 });
    const u = new URL(googleDirectionsUrl(BLR, DEST, [{ name: 'X', lat: 14, lon: 77.6 }]));
    expect(u.searchParams.get('waypoints')).toBe('14,77.6');
    expect(u.searchParams.get('travelmode')).toBe('driving');
  });
});

describe('places fallback when Overpass is overloaded', () => {
  it('falls back to Nominatim box searches and still finds restaurants and fuel', async () => {
    const { fetchPlacesAlong, setNominatimGap } = await import('../../src/features/planner/services');
    setNominatimGap(0);
    const seen: string[] = [];
    const { f } = fakeNet({
      'overpass-api.de': () => new Response('busy', { status: 502 }),
      'maps.mail.ru': () => new Response('busy', { status: 504 }),
      'nominatim.openstreetmap.org': (u) => {
        const q = u.searchParams.get('q')!;
        seen.push(q);
        const [w, n, , s] = u.searchParams.get('viewbox')!.split(',').map(Number);
        const lat = (n + s) / 2;
        if (q === 'restaurant') return [{ osm_type: 'node', osm_id: Math.round(lat * 1000), lat: String(lat), lon: String(w + 0.015), name: `Dhaba ${lat.toFixed(2)}`, category: 'amenity', type: 'restaurant', extratags: { cuisine: 'indian' } }];
        if (q === 'fuel') return [{ osm_type: 'node', osm_id: Math.round(lat * 1000) + 1, lat: String(lat), lon: String(w + 0.015), name: 'Indian Oil', category: 'amenity', type: 'fuel', extratags: null }];
        return [];
      },
    });
    const msgs: string[] = [];
    const places = await fetchPlacesAlong(coords, f, (m) => msgs.push(m));
    expect(places.filter((p) => p.kind === 'restaurant').length).toBeGreaterThanOrEqual(10);
    expect(places.some((p) => p.kind === 'fuel')).toBe(true);
    expect(places.find((p) => p.kind === 'restaurant')!.tags.cuisine).toBe('indian');
    expect(seen).toContain('waterfall');
    expect(msgs[0]).toMatch(/backup/);
  });
});
