import { localDateIso } from '../../data/defaults';
import type { TravellerProfile, Trip } from '../../types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
}

export function dateRange(t: Trip): string {
  if (!t.startDate) return `${t.days} day${t.days === 1 ? '' : 's'}`;
  if (!t.endDate || t.endDate === t.startDate) return fmtDate(t.startDate);
  return `${fmtDate(t.startDate)} – ${fmtDate(t.endDate)}`;
}

export function daysUntil(iso?: string, today = localDateIso()): number | null {
  if (!iso) return null;
  const a = new Date(today + 'T00:00:00Z').getTime();
  const b = new Date(iso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

export function countdown(t: Trip): string {
  const d = daysUntil(t.startDate);
  if (d === null) return 'No date set';
  if (d === 0) return 'Leaving today';
  if (d === 1) return 'Leaving tomorrow';
  if (d > 1) return `In ${d} days`;
  const end = daysUntil(t.endDate ?? t.startDate);
  if (end !== null && end >= 0) return 'On the road';
  return 'Finished';
}

export function tripTitle(t: Trip): string {
  return t.name || t.destination.name || 'Untitled trip';
}

export function destLabel(t: Trip): string {
  const n = t.destination.name || t.name || 'Trip';
  return n.split(/[,(]/)[0].trim();
}

export function isUpcoming(t: Trip, today = localDateIso()): boolean {
  if (t.status !== 'planning') return false;
  if (!t.startDate) return true;
  return (t.endDate ?? t.startDate) >= today;
}

/** The trip to put on the dashboard: soonest upcoming, else most recently edited planning trip. */
export function pickNextTrip(trips: Trip[]): Trip | undefined {
  const up = trips.filter((t) => isUpcoming(t));
  const dated = up.filter((t) => t.startDate).sort((a, b) => a.startDate!.localeCompare(b.startDate!));
  if (dated.length) return dated[0];
  return up.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function nameOf(id: string, profiles: TravellerProfile[]): string {
  if (id === 'shared') return 'Family';
  if (id === 'car') return 'Car';
  return profiles.find((p) => p.id === id)?.name ?? 'Removed traveller';
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
