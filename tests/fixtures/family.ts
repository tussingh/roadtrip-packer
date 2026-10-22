import { blankTrip, defaultAdultPrefs, defaultChildPrefs } from '../../src/data/defaults';
import type { TravellerProfile, Trip } from '../../src/types';

export const TODAY = new Date('2026-10-22T09:00:00');
const T = '2026-10-22T00:00:00.000Z';

export function family(childBirth = '2025-02-15'): TravellerProfile[] {
  return [
    { id: 'me', name: 'Me', kind: 'adult', gender: 'male', adult: defaultAdultPrefs('male'), createdAt: T, updatedAt: T },
    { id: 'wife', name: 'Wife', kind: 'adult', gender: 'female', adult: defaultAdultPrefs('female'), createdAt: T, updatedAt: T },
    { id: 'kid', name: 'Daughter', kind: 'child', gender: 'female', birthDate: childBirth, child: defaultChildPrefs(20), createdAt: T, updatedAt: T },
  ];
}

export function trip(overrides: Partial<Trip> = {}): Trip {
  const t = blankTrip(['me', 'wife', 'kid']);
  return {
    ...t,
    id: 'trip-1',
    name: 'Test trip',
    startDate: '2026-11-06',
    temperature: 'warm',
    rain: 'dry',
    ...overrides,
  };
}

export const scenarioA = () =>
  trip({ name: 'A short', days: 2, nights: 1, totalKm: 150, drivingDays: 2, accommodation: 'hotel' });
export const scenarioB = () =>
  trip({ name: 'B beach', days: 4, nights: 3, totalKm: 600, drivingDays: 2, accommodation: 'resort', activities: ['beach'] });
export const scenarioC = () =>
  trip({
    name: 'C long',
    days: 7,
    nights: 6,
    totalKm: 1500,
    drivingDays: 4,
    accommodation: 'hotel',
    stops: [
      { id: 's1', name: 'Hubballi', overnight: true },
      { id: 's2', name: 'Kolhapur', overnight: true },
    ],
  });
export const scenarioD = () => ({ ...scenarioC(), name: 'D laundry', laundry: 'midway' as const });
export const scenarioE = () => ({ ...scenarioC(), name: 'E remote', remote: true, resupply: 'poor' as const });
