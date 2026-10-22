import type {
  Activity,
  AdultPrefs,
  Assumptions,
  ChildPrefs,
  Gender,
  Rain,
  Temperature,
  TravellerProfile,
  Trip,
} from '../types';

export type LifeStage = 'infant' | 'toddler' | 'preschool' | 'child' | 'teen' | 'adult';

export interface TravellerFacts {
  id: string;
  name: string;
  kind: 'adult' | 'child';
  gender: Gender;
  ageMonths: number | null;
  stage: LifeStage;
  adult?: AdultPrefs;
  child?: ChildPrefs;
}

export interface DriveDay {
  label: string;
  km: number;
  hours: number;
}

export interface TripFacts {
  days: number;
  nights: number;
  totalKm: number;
  drivingDays: number;
  driveDays: DriveDay[];
  totalDriveHours: number;
  maxDriveHours: number;
  maxDayKm: number;
  /** Days spent at the destination without a long drive. */
  stayDays: number;
  adults: TravellerFacts[];
  children: TravellerFacts[];
  everyone: TravellerFacts[];
  occupants: number;
  temperature: Exclude<Temperature, 'auto'>;
  temperatureAuto: boolean;
  rain: Exclude<Rain, 'auto'>;
  rainAuto: boolean;
  month: number | null;
  /** Days of clothing to carry before a wash is possible. */
  laundryCycleDays: number;
  activities: Set<Activity>;
  remote: boolean;
  mountains: boolean;
  overnightDriving: boolean;
  resupply: Trip['resupply'];
  accommodation: Trip['accommodation'];
  overnightStops: number;
  longJourney: boolean;
  hasLongDriveDay: boolean;
  hasYoungChild: boolean;
  a: Assumptions;
}

export function ageInMonths(birthDate: string | undefined, onDate: Date): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate + 'T00:00:00');
  if (Number.isNaN(b.getTime())) return null;
  let months = (onDate.getFullYear() - b.getFullYear()) * 12 + (onDate.getMonth() - b.getMonth());
  if (onDate.getDate() < b.getDate()) months -= 1;
  return Math.max(0, months);
}

export function lifeStage(kind: 'adult' | 'child', ageMonths: number | null): LifeStage {
  if (kind === 'adult') return 'adult';
  if (ageMonths === null) return 'toddler';
  if (ageMonths < 12) return 'infant';
  if (ageMonths < 36) return 'toddler';
  if (ageMonths < 72) return 'preschool';
  if (ageMonths < 156) return 'child';
  return 'teen';
}

export function describeAge(ageMonths: number | null): string {
  if (ageMonths === null) return 'age not set';
  if (ageMonths < 24) return `${ageMonths} months`;
  const y = Math.floor(ageMonths / 12);
  const m = ageMonths % 12;
  return m ? `${y} y ${m} m` : `${y} years`;
}

/**
 * Seasonal heuristic for South India when the user leaves weather on "auto".
 * Deliberately coarse and always shown to the user as an assumption.
 */
export function autoWeather(
  month: number | null,
  mountains: boolean,
  activities: Set<Activity>,
): { temperature: Exclude<Temperature, 'auto'>; rain: Exclude<Rain, 'auto'> } {
  const hill = mountains || activities.has('hill-station');
  if (month === null) return { temperature: hill ? 'cool' : 'warm', rain: 'dry' };
  let temperature: Exclude<Temperature, 'auto'>;
  if (hill) temperature = month === 12 || month <= 2 ? 'cold' : 'cool';
  else if (month >= 3 && month <= 5) temperature = 'hot';
  else if (month === 12 || month <= 2) temperature = 'mild';
  else temperature = 'warm';
  let rain: Exclude<Rain, 'auto'> = 'dry';
  if (month >= 6 && month <= 9) rain = 'monsoon';
  else if (month === 10 || month === 11) rain = 'showers';
  return { temperature, rain };
}

export function buildTravellerFacts(p: TravellerProfile, onDate: Date): TravellerFacts {
  const ageMonths = ageInMonths(p.birthDate, onDate);
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    gender: p.gender,
    ageMonths,
    stage: lifeStage(p.kind, ageMonths),
    adult: p.adult,
    child: p.child,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function deriveDriveDays(trip: Trip, a: Assumptions): DriveDay[] {
  if (trip.legs.length > 0) {
    return trip.legs.map((l) => ({
      label: l.label || 'Drive',
      km: Math.max(0, l.km),
      hours: round1(l.hours && l.hours > 0 ? l.hours : l.km / a.avgSpeedKmh),
    }));
  }
  const n = Math.max(0, Math.round(trip.drivingDays));
  if (n === 0 || trip.totalKm <= 0) return [];
  const totalHours =
    trip.totalDriveHours && trip.totalDriveHours > 0 ? trip.totalDriveHours : trip.totalKm / a.avgSpeedKmh;
  return Array.from({ length: n }, (_, i) => ({
    label: n === 1 ? 'Drive day' : i === n - 1 && trip.returnSameRoute ? 'Return drive' : `Drive day ${i + 1}`,
    km: round1(trip.totalKm / n),
    hours: round1(totalHours / n),
  }));
}

export function deriveFacts(
  trip: Trip,
  profiles: TravellerProfile[],
  a: Assumptions,
  today: Date,
): TripFacts {
  const onDate = trip.startDate ? new Date(trip.startDate + 'T00:00:00') : today;
  const travellers = trip.travellerIds
    .map((id) => profiles.find((p) => p.id === id))
    .filter((p): p is TravellerProfile => Boolean(p))
    .map((p) => buildTravellerFacts(p, onDate));
  const adults = travellers.filter((t) => t.kind === 'adult');
  const children = travellers.filter((t) => t.kind === 'child');
  const days = Math.max(1, Math.round(trip.days));
  const nights = Math.max(0, Math.min(days, Math.round(trip.nights)));
  const driveDays = deriveDriveDays(trip, a);
  const totalKm = driveDays.length ? round1(driveDays.reduce((s, d) => s + d.km, 0)) : Math.max(0, trip.totalKm);
  const totalDriveHours = round1(driveDays.reduce((s, d) => s + d.hours, 0));
  const maxDriveHours = driveDays.reduce((m, d) => Math.max(m, d.hours), 0);
  const maxDayKm = driveDays.reduce((m, d) => Math.max(m, d.km), 0);
  const activities = new Set(trip.activities);
  const month = trip.startDate ? Number(trip.startDate.slice(5, 7)) : null;
  const auto = autoWeather(month, trip.mountains, activities);
  const temperature = trip.temperature === 'auto' ? auto.temperature : trip.temperature;
  const rain = trip.rain === 'auto' ? auto.rain : trip.rain;
  let laundryCycleDays = days;
  if (trip.laundry === 'midway') laundryCycleDays = Math.ceil(days / 2);
  if (trip.laundry === 'anytime') laundryCycleDays = Math.min(days, a.laundryEveryDays);
  const overnightStops = trip.stops.filter((s) => s.overnight).length;
  const drivingDays = driveDays.length;
  const stayDays = Math.max(0, days - drivingDays);
  const hasLongDriveDay = maxDriveHours >= a.longDriveDayHours;
  return {
    days,
    nights,
    totalKm,
    drivingDays,
    driveDays,
    totalDriveHours,
    maxDriveHours,
    maxDayKm,
    stayDays,
    adults,
    children,
    everyone: travellers,
    occupants: travellers.length,
    temperature,
    temperatureAuto: trip.temperature === 'auto',
    rain,
    rainAuto: trip.rain === 'auto',
    month,
    laundryCycleDays,
    activities,
    remote: trip.remote || trip.resupply !== 'good',
    mountains: trip.mountains || activities.has('hill-station'),
    overnightDriving: trip.overnightDriving,
    resupply: trip.remote && trip.resupply === 'good' ? 'limited' : trip.resupply,
    accommodation: trip.accommodation,
    overnightStops,
    longJourney: drivingDays >= 3 || overnightStops >= 2,
    hasLongDriveDay,
    hasYoungChild: children.some((c) => c.ageMonths === null || c.ageMonths < 48),
    a,
  };
}
