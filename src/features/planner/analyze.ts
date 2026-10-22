/**
 * Pure, deterministic trip-planning logic on top of the fetched route and
 * places. No ratings exist in OpenStreetMap, so restaurants are chosen by
 * explainable signals (vegetarian/Indian cuisine, toilets, chains, distance
 * off the highway) and each comes with a Google Maps link for reviews.
 */
import type { GeoPoint, PlannedPlace, RouteOption } from '../../types';
import { haversine, locateOnLine, type LonLat } from '../maps/geo';
import { thinLine } from './services';

export type RawPlace = Omit<PlannedPlace, 'alongKm' | 'offKm'>;

/** Position every place relative to the chosen route. */
export function locatePlaces(option: RouteOption, places: RawPlace[], maxOffKm = 8): PlannedPlace[] {
  const line = thinLine(option.geometry, 800);
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversine(line[i - 1], line[i]));
  const scale = cum[cum.length - 1] ? (option.distanceKm * 1000) / cum[cum.length - 1] : 1;
  const out: PlannedPlace[] = [];
  for (const p of places) {
    const loc = locateOnLine([p.lon, p.lat], line, cum);
    const offKm = loc.offRoute / 1000;
    if (offKm > maxOffKm) continue;
    out.push({ ...p, alongKm: Math.round(((loc.along * scale) / 1000) * 10) / 10, offKm: Math.round(offKm * 10) / 10 });
  }
  return out.sort((a, b) => a.alongKm - b.alongKm);
}

export function hoursAt(option: RouteOption, km: number): number {
  const { cumKm, cumH } = option;
  for (let i = 1; i < cumKm.length; i++) {
    if (cumKm[i] >= km) {
      const seg = cumKm[i] - cumKm[i - 1];
      const t = seg ? (km - cumKm[i - 1]) / seg : 0;
      return cumH[i - 1] + t * (cumH[i] - cumH[i - 1]);
    }
  }
  return option.durationH;
}

export function kmAt(option: RouteOption, h: number): number {
  const { cumKm, cumH } = option;
  for (let i = 1; i < cumH.length; i++) {
    if (cumH[i] >= h) {
      const seg = cumH[i] - cumH[i - 1];
      const t = seg ? (h - cumH[i - 1]) / seg : 0;
      return cumKm[i - 1] + t * (cumKm[i] - cumKm[i - 1]);
    }
  }
  return option.distanceKm;
}

/* ---------------- restaurants ---------------- */

const FAMILY_CUISINE = /indian|vegetarian|south_indian|north_indian|udupi|kerala|karnataka|andhra|tamil|chettinad|punjabi|thali|dosa|biryani|regional|coffee_shop/i;

export function restaurantScore(p: PlannedPlace): { score: number; why: string[] } {
  const t = p.tags;
  let score = 0;
  const why: string[] = [];
  if (p.kind === 'restaurant') score += 2;
  if (t.cuisine) {
    score += 1;
    if (FAMILY_CUISINE.test(t.cuisine)) {
      score += 2;
      why.push(t.cuisine.replace(/_/g, ' ').replace(/;/g, ', '));
    }
  }
  if (t['diet:vegetarian'] === 'yes' || t['diet:vegetarian'] === 'only') {
    score += 2;
    why.push(t['diet:vegetarian'] === 'only' ? 'pure vegetarian' : 'vegetarian options');
  }
  if (t.brand) {
    score += 2;
    why.push(`${t.brand} chain`);
  }
  if (t.toilets === 'yes') {
    score += 2;
    why.push('toilets');
  }
  if (t.changing_table === 'yes' || t.highchair === 'yes') {
    score += 2;
    why.push(t.highchair === 'yes' ? 'high chairs' : 'baby changing');
  }
  if (t.air_conditioning === 'yes') {
    score += 1;
    why.push('air-conditioned');
  }
  if (t.opening_hours) score += 1;
  if (t.phone || t['contact:phone']) score += 0.5;
  if (t.wikidata) score += 1;
  score -= p.offKm * 1.5;
  why.push(p.offKm < 0.3 ? 'right on the route' : `${p.offKm} km off the route`);
  return { score: Math.round(score * 10) / 10, why };
}

export interface RestaurantWindow {
  fromKm: number;
  toKm: number;
  atHour: number;
  picks: { place: PlannedPlace; score: number; why: string[] }[];
}

export function restaurantsEvery(option: RouteOption, places: PlannedPlace[], everyKm = 100, perWindow = 3): RestaurantWindow[] {
  const food = places.filter((p) => ['restaurant', 'fast_food', 'cafe'].includes(p.kind) && p.name && p.offKm <= 3);
  const out: RestaurantWindow[] = [];
  for (let from = 0; from < option.distanceKm; from += everyKm) {
    const to = Math.min(option.distanceKm, from + everyKm);
    const picks = food
      .filter((p) => p.alongKm >= from && p.alongKm < to)
      .map((p) => ({ place: p, ...restaurantScore(p) }))
      .sort((a, b) => b.score - a.score || a.place.alongKm - b.place.alongKm)
      .slice(0, perWindow);
    out.push({ fromKm: Math.round(from), toKm: Math.round(to), atHour: hoursAt(option, (from + to) / 2), picks });
  }
  return out;
}

/* ---------------- breaks ---------------- */

export interface PlannedStop {
  atH: number;
  atKm: number;
  clock?: string;
  meal?: 'Breakfast' | 'Lunch' | 'Snack' | 'Dinner';
  main?: PlannedPlace;
  fuel?: PlannedPlace;
  toilets?: PlannedPlace;
  why: string;
}

export function fmtClock(h: number): string {
  const mins = Math.round(h * 60) % (24 * 60);
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  const ampm = hh >= 12 ? 'pm' : 'am';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
}

function mealFor(clock: number): PlannedStop['meal'] {
  if (clock >= 7.5 && clock < 10) return 'Breakfast';
  if (clock >= 12.25 && clock < 14.5) return 'Lunch';
  if (clock >= 16 && clock < 17.5) return 'Snack';
  if (clock >= 19.5 && clock < 21.5) return 'Dinner';
  return undefined;
}

/**
 * A stop roughly every `everyH` hours of driving. Each stop prefers a place
 * where food, fuel and toilets are close together, within ±20 minutes.
 */
export function planStops(option: RouteOption, places: PlannedPlace[], everyH: number, departHour?: number): PlannedStop[] {
  const stops: PlannedStop[] = [];
  const near = (kinds: string[], km: number, within: number) =>
    places.filter((p) => kinds.includes(p.kind) && Math.abs(p.alongKm - km) <= within && p.offKm <= 2).sort((a, b) => Math.abs(a.alongKm - km) + a.offKm - (Math.abs(b.alongKm - km) + b.offKm));
  for (let h = everyH; h < option.durationH - everyH * 0.35; h += everyH) {
    const targetKm = kmAt(option, h);
    const windowKm = Math.max(10, (option.distanceKm / Math.max(0.1, option.durationH)) * (20 / 60));
    const clock = departHour !== undefined ? departHour + h + (stops.length * 20) / 60 : undefined;
    const meal = clock !== undefined ? mealFor(clock) : undefined;
    const foods = near(['restaurant', 'fast_food', 'cafe'], targetKm, windowKm)
      .map((p) => ({ p, s: restaurantScore(p).score }))
      .sort((a, b) => b.s - a.s);
    const rest = near(['rest_area', 'services'], targetKm, windowKm);
    const main = (meal ? foods[0]?.p : rest[0] ?? foods[0]?.p) ?? rest[0];
    const anchorKm = main?.alongKm ?? targetKm;
    const fuel = near(['fuel'], anchorKm, 5)[0];
    const toilets = near(['toilets', 'rest_area', 'services'], anchorKm, 3)[0];
    let why = 'Stretch, change and feed the little one';
    if (meal) why = `${meal} stop`;
    if (!main && !fuel) why = 'No mapped food or fuel near this point — plan this break a little earlier or later';
    stops.push({ atH: Math.round(h * 100) / 100, atKm: Math.round(anchorKm), clock: clock !== undefined ? fmtClock(clock) : undefined, meal, main, fuel, toilets, why });
  }
  return stops;
}

/* ---------------- sights, medical, gaps ---------------- */

const SIGHT_KINDS = new Set(['attraction', 'viewpoint', 'museum', 'zoo', 'theme_park', 'waterfall', 'fort', 'monument', 'castle', 'ruins', 'archaeological_site', 'temple', 'lake', 'dam', 'park']);

export function sightScore(p: PlannedPlace): number {
  let s = 0;
  if (p.tags.wikidata) s += 3;
  if (p.tags.wikipedia) s += 2;
  if (['waterfall', 'viewpoint', 'zoo', 'theme_park', 'fort', 'museum'].includes(p.kind)) s += 1;
  if (p.tags.description) s += 0.5;
  return s - p.offKm * 0.3;
}

export function sightsAlong(places: PlannedPlace[], limit = 8): PlannedPlace[] {
  return places
    .filter((p) => SIGHT_KINDS.has(p.kind) && p.name && p.offKm <= 6)
    .map((p) => ({ p, s: sightScore(p) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.p)
    .sort((a, b) => a.alongKm - b.alongKm);
}

export function rankDestinationSights(places: RawPlace[], dest: GeoPoint, limit = 10): (RawPlace & { distKm: number })[] {
  return places
    .filter((p) => SIGHT_KINDS.has(p.kind) && p.name)
    .map((p) => ({ ...p, distKm: Math.round(haversine([dest.lon, dest.lat], [p.lon, p.lat]) / 100) / 10 }))
    .map((p) => ({ p, s: sightScore({ ...p, alongKm: 0, offKm: p.distKm / 4 }) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.p);
}

/** Nearest hospital in each 50 km stretch, for peace of mind with a toddler. */
export function hospitalsAlong(places: PlannedPlace[], option: RouteOption, everyKm = 50): PlannedPlace[] {
  const out: PlannedPlace[] = [];
  for (let from = 0; from < option.distanceKm; from += everyKm) {
    const h = places
      .filter((p) => p.kind === 'hospital' && p.alongKm >= from && p.alongKm < from + everyKm && p.name)
      .sort((a, b) => Number(Boolean(b.tags.emergency === 'yes')) - Number(Boolean(a.tags.emergency === 'yes')) || a.offKm - b.offKm)[0];
    if (h) out.push(h);
  }
  return out;
}

/** Stretches with no mapped fuel station: suggests "remote / limited resupply". */
export function fuelGaps(places: PlannedPlace[], option: RouteOption, gapKm = 80): { fromKm: number; toKm: number }[] {
  const fuel = places.filter((p) => p.kind === 'fuel' && p.offKm <= 2).map((p) => p.alongKm);
  // You leave home with a full tank, so the stretch before the first pump does not count.
  const marks = [...fuel, option.distanceKm].sort((a, b) => a - b);
  if (!fuel.length) return option.distanceKm >= gapKm ? [{ fromKm: 0, toKm: Math.round(option.distanceKm) }] : [];
  const gaps: { fromKm: number; toKm: number }[] = [];
  for (let i = 1; i < marks.length; i++) if (marks[i] - marks[i - 1] >= gapKm) gaps.push({ fromKm: Math.round(marks[i - 1]), toKm: Math.round(marks[i]) });
  return gaps;
}

/* ---------------- timing ---------------- */

const BIG_CITIES = /bengaluru|bangalore|chennai|hyderabad|mumbai|pune|delhi|gurgaon|gurugram|noida|kolkata|kochi|ahmedabad|coimbatore/i;

/** Sunrise/sunset in local IST hours (NOAA approximation, ±2 min). */
export function sunTimes(lat: number, lon: number, dateIso: string): { sunrise: number; sunset: number } {
  const d = new Date(dateIso + 'T12:00:00Z');
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const n = Math.floor((d.getTime() - start) / 86400000);
  const g = ((2 * Math.PI) / 365) * (n - 1);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const rad = (x: number) => (x * Math.PI) / 180;
  const ha = Math.acos(Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(decl)) - Math.tan(rad(lat)) * Math.tan(decl));
  const haDeg = (ha * 180) / Math.PI;
  const tz = 5.5;
  const noon = 720 - 4 * lon - eqt;
  return { sunrise: (noon - 4 * haDeg) / 60 + tz, sunset: (noon + 4 * haDeg) / 60 + tz };
}

export interface DepartureAdvice {
  departH: number;
  arriveH: number;
  breaks: number;
  sunsetH?: number;
  overnightSuggested: boolean;
  notes: string[];
}

export function departureAdvice(args: { durationH: number; breakEveryH: number; breakMinutes?: number; originName: string; date?: string; dest: GeoPoint; mountains: boolean; hasChild: boolean }): DepartureAdvice {
  const { durationH, breakEveryH, originName, date, dest, mountains, hasChild } = args;
  const breakMin = args.breakMinutes ?? (hasChild ? 25 : 15);
  const breaks = Math.max(0, Math.ceil(durationH / breakEveryH) - 1);
  const total = durationH + (breaks * breakMin) / 60;
  const notes: string[] = [];
  const bigCity = BIG_CITIES.test(originName);
  let depart = bigCity ? 6 : 7;
  if (bigCity) notes.push(`Leaving ${originName.split(',')[0]} by ${fmtClock(depart)} avoids most city traffic.`);
  const sun = date ? sunTimes(dest.lat, dest.lon, date) : undefined;
  // Aim to arrive at least an hour before sunset (ghats: 90 minutes).
  const margin = mountains ? 1.5 : 1;
  if (sun && depart + total > sun.sunset - margin) {
    const earliest = 5;
    const needed = sun.sunset - margin - total;
    depart = Math.max(earliest, Math.floor(needed * 4) / 4);
  }
  const arrive = depart + total;
  const overnight = sun ? arrive > sun.sunset - margin + 0.01 : total > 11;
  if (overnight) notes.push(`About ${total.toFixed(1)} h on the road with breaks — consider an overnight stop so you are not driving after dark${mountains ? ' on ghat roads' : ''}.`);
  if (hasChild) notes.push('If your toddler naps in the car, a start 30–45 minutes before nap time gives a quiet first stretch.');
  if (mountains) notes.push('Ghat sections: cross them in daylight and use low gears downhill.');
  notes.push('Times are estimates without traffic. Check live traffic in Google Maps the evening before.');
  return { departH: depart, arriveH: arrive, breaks, sunsetH: sun?.sunset, overnightSuggested: overnight, notes };
}

/* ---------------- weather ---------------- */

export { summariseForecast } from '../../rules/weather';

/* ---------------- links & money ---------------- */

export function googleDirectionsUrl(origin: GeoPoint, dest: GeoPoint, via: GeoPoint[] = []): string {
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('origin', `${origin.lat},${origin.lon}`);
  u.searchParams.set('destination', `${dest.lat},${dest.lon}`);
  if (via.length) u.searchParams.set('waypoints', via.map((v) => `${v.lat},${v.lon}`).join('|'));
  u.searchParams.set('travelmode', 'driving');
  return u.toString();
}

export function googlePlaceUrl(p: { name: string; lat: number; lon: number }): string {
  const u = new URL('https://www.google.com/maps/search/');
  u.searchParams.set('api', '1');
  u.searchParams.set('query', p.name ? `${p.name} ${p.lat.toFixed(5)},${p.lon.toFixed(5)}` : `${p.lat},${p.lon}`);
  return u.toString();
}

export function fuelCost(km: number, mileageKmpl: number, pricePerLitre: number): { litres: number; rupees: number } {
  const litres = mileageKmpl > 0 ? km / mileageKmpl : 0;
  return { litres: Math.round(litres), rupees: Math.round((litres * pricePerLitre) / 50) * 50 };
}

export function straightKm(a: LonLat, b: LonLat) {
  return haversine(a, b) / 1000;
}
