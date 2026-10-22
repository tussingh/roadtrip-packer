import type { Assumptions, GeoPoint, Trip, TripPlan } from '../../types';
import { fuelGaps, locatePlaces } from './analyze';
import { fetchElevations, fetchForecast, fetchPlacesAlong, fetchRoutes, fetchSightsNear, thinLine, toRouteOptions } from './services';

type F = typeof fetch;

/** Route options, forecast and elevation for From → (via) → To. */
export async function buildRoutePlan(points: { origin: GeoPoint; destination: GeoPoint; via: GeoPoint[] }, a: Assumptions, f: F = fetch): Promise<TripPlan> {
  const all = [points.origin, ...points.via, points.destination];
  const routes = await fetchRoutes(all, f);
  const options = toRouteOptions(routes, all, a.routeTimeFactor);
  const plan: TripPlan = { fetchedAt: new Date().toISOString(), origin: points.origin, destination: points.destination, via: points.via, options, chosen: 0 };
  const [forecast, elevation] = await Promise.allSettled([
    fetchForecast(points.destination, f),
    fetchElevations(thinLine(options[0].geometry, Math.max(2000, (options[0].distanceKm * 1000) / 95)), f),
  ]);
  if (forecast.status === 'fulfilled') {
    plan.forecast = forecast.value;
    plan.forecastFor = points.destination.name;
  }
  if (elevation.status === 'fulfilled' && elevation.value.length) {
    plan.elevation = { min: Math.round(Math.min(...elevation.value)), max: Math.round(Math.max(...elevation.value)) };
  }
  return plan;
}

/** Fetch food, fuel, toilets, hospitals and sights along the chosen route + around the destination. */
export async function addPlaces(plan: TripPlan, f: F = fetch, onProgress?: (msg: string) => void): Promise<TripPlan> {
  const opt = plan.options[plan.chosen] ?? plan.options[0];
  const next: TripPlan = { ...plan };
  const along = await Promise.allSettled([fetchPlacesAlong(opt.geometry, f, onProgress)]).then((r) => r[0]);
  const near = await Promise.allSettled([fetchSightsNear(plan.destination, 20000, f)]).then((r) => r[0]);
  if (along.status === 'fulfilled') {
    next.places = locatePlaces(opt, along.value);
    next.placesFetchedAt = new Date().toISOString();
    next.placesError = undefined;
  } else {
    next.placesError = along.reason instanceof Error ? along.reason.message : String(along.reason);
  }
  if (near.status === 'fulfilled') next.destinationSights = near.value.map((p) => ({ ...p, alongKm: opt.distanceKm, offKm: 0 }));
  return next;
}

export function looksHilly(plan: TripPlan): boolean {
  return Boolean(plan.elevation && (plan.elevation.max >= 900 || plan.elevation.max - plan.elevation.min >= 600));
}

/**
 * Copy what the route tells us into the trip: kilometres, hours, driving
 * days (overnight stop when one way exceeds a long day), hills, remoteness.
 * The user can still override everything in the wizard.
 */
export function applyPlanToTrip(trip: Trip, plan: TripPlan): Trip {
  const opt = plan.options[plan.chosen] ?? plan.options[0];
  const oneWayKm = opt.distanceKm;
  const oneWayH = opt.durationH;
  const daysEachWay = oneWayH > 9 ? Math.ceil(oneWayH / 8) : 1;
  const legs: Trip['legs'] = [];
  for (let i = 0; i < daysEachWay; i++) legs.push({ id: `out-${i}`, label: daysEachWay > 1 ? `Outward day ${i + 1}` : 'Outward drive', km: Math.round(oneWayKm / daysEachWay), hours: Math.round((oneWayH / daysEachWay) * 10) / 10 });
  if (trip.returnSameRoute && trip.days > 1) {
    for (let i = 0; i < daysEachWay; i++) legs.push({ id: `ret-${i}`, label: daysEachWay > 1 ? `Return day ${i + 1}` : 'Return drive', km: Math.round(oneWayKm / daysEachWay), hours: Math.round((oneWayH / daysEachWay) * 10) / 10 });
  }
  const totalKm = legs.reduce((s, l) => s + l.km, 0);
  const next: Trip = {
    ...trip,
    origin: { name: plan.origin.name, lat: plan.origin.lat, lon: plan.origin.lon },
    destination: { name: plan.destination.name, lat: plan.destination.lat, lon: plan.destination.lon },
    plan,
    legs,
    totalKm,
    drivingDays: legs.length,
    totalDriveHours: Math.round(legs.reduce((s, l) => s + (l.hours ?? 0), 0) * 10) / 10,
    kmSource: 'online-route',
  };
  if (looksHilly(plan)) next.mountains = true;
  if (plan.places && fuelGaps(plan.places, opt, 100).length > 0 && !trip.remote) {
    next.remote = true;
    next.resupply = 'limited';
  }
  return next;
}

/* One places lookup per trip at a time, shared between the wizard and the route screen. */
const inflight = new Map<string, { promise: Promise<void>; message: string }>();
const listeners = new Set<() => void>();
export function placesJob(tripId: string) {
  return inflight.get(tripId);
}
export function onPlacesJob(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
export function runPlacesJob(tripId: string, work: (progress: (msg: string) => void) => Promise<void>): Promise<void> {
  const existing = inflight.get(tripId);
  if (existing) return existing.promise;
  const job = { message: 'Finding restaurants, fuel, hospitals and sights along the route…', promise: Promise.resolve() };
  const notify = () => listeners.forEach((l) => l());
  job.promise = work((msg) => {
    job.message = msg;
    notify();
  }).finally(() => {
    inflight.delete(tripId);
    notify();
  });
  inflight.set(tripId, job);
  notify();
  return job.promise;
}
