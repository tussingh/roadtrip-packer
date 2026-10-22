import type { Category, Necessity, PackLocation, Priority, Stage } from '../types';
import type { TravellerFacts, TripFacts } from './context';

export type Scope = 'shared' | 'car' | 'each-adult' | 'each-child';

export interface RuleQty {
  qty: number;
  unit: string;
  /** Human-readable calculation steps. */
  why: string[];
}

type Dyn<T> = T | ((f: TripFacts, t?: TravellerFacts) => T);

export interface ItemRule {
  id: string;
  name: Dyn<string>;
  category: Category;
  scope: Scope;
  /**
   * Return a short reason string to include the item, or false to skip it.
   * The reason is shown first in the item's explanation.
   */
  when: (f: TripFacts, t?: TravellerFacts) => string | false;
  qty?: (f: TripFacts, t?: TravellerFacts) => RuleQty;
  necessity: Dyn<Necessity>;
  priority?: Dyn<Priority>;
  reusable: boolean;
  consumable?: boolean;
  location: Dyn<PackLocation>;
  stage: Dyn<Stage>;
  accessibleEnRoute?: Dyn<boolean>;
  safetyCritical?: boolean;
  isCheck?: boolean;
  conditions?: (f: TripFacts, t?: TravellerFacts) => string[];
  /** Advisory text shown with the item (safety caveats, compatibility notes). */
  note?: Dyn<string>;
}

export function resolveDyn<T>(v: Dyn<T>, f: TripFacts, t?: TravellerFacts): T {
  return typeof v === 'function' ? (v as (f: TripFacts, t?: TravellerFacts) => T)(f, t) : v;
}

/* ---------- small helpers used across catalogue files ---------- */

export const one = (unit = 'item', why: string[] = []): RuleQty => ({ qty: 1, unit, why });
export const n = (qty: number, unit: string, why: string[] = []): RuleQty => ({ qty, unit, why });

export function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
}

export function pl(count: number, word: string, plural = word + 's'): string {
  return `${fmt(count)} ${count === 1 ? word : plural}`;
}

export const hasChild = (f: TripFacts) => f.children.length > 0;
export const isWarmish = (f: TripFacts) => f.temperature === 'hot' || f.temperature === 'warm';
export const isColdish = (f: TripFacts) => f.temperature === 'cool' || f.temperature === 'cold';
export const isWet = (f: TripFacts) => f.rain !== 'dry';
export const act = (f: TripFacts, a: Parameters<TripFacts['activities']['has']>[0]) => f.activities.has(a);
export const drives = (f: TripFacts) => f.drivingDays > 0 && f.totalKm > 0;

/** Days at the destination that involve an activity (at least one). */
export function activityDays(f: TripFacts): number {
  return Math.max(1, f.days - Math.max(0, f.drivingDays - 1));
}

/** Days to cover with clothing before a wash, minus the outfit worn on departure. */
export function clothingDays(f: TripFacts): number {
  return f.laundryCycleDays;
}

export function laundryText(f: TripFacts): string {
  if (f.laundryCycleDays >= f.days) return `no laundry planned → cover all ${pl(f.days, 'day')}`;
  return `laundry available → cover ${pl(f.laundryCycleDays, 'day')} between washes (trip is ${pl(f.days, 'day')})`;
}

export function remoteReserve(f: TripFacts): number {
  return f.resupply === 'good' ? 0 : f.a.remoteReserveDays;
}
