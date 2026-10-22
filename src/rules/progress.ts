import type { ChecklistItem, Stage, Trip } from '../types';

export interface Progress {
  done: number;
  total: number;
  pct: number;
}

const counts = (i: ChecklistItem) => !i.unavailable;

export function progressOf(items: ChecklistItem[]): Progress {
  const relevant = items.filter(counts);
  const done = relevant.filter((i) => i.packed).length;
  const total = relevant.length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

export function groupProgress<K extends string>(items: ChecklistItem[], keyOf: (i: ChecklistItem) => K): Map<K, Progress> {
  const groups = new Map<K, ChecklistItem[]>();
  for (const i of items) {
    const k = keyOf(i);
    const arr = groups.get(k);
    if (arr) arr.push(i);
    else groups.set(k, [i]);
  }
  const out = new Map<K, Progress>();
  for (const [k, v] of groups) out.set(k, progressOf(v));
  return out;
}

export interface Readiness {
  ready: boolean;
  pct: number;
  essentialsLeft: ChecklistItem[];
  safetyLeft: ChecklistItem[];
  unavailableEssentials: ChecklistItem[];
  toBuy: ChecklistItem[];
  checksLeft: ChecklistItem[];
}

export function readiness(items: ChecklistItem[]): Readiness {
  const active = items.filter((i) => !i.stale);
  const essentialsLeft = active.filter((i) => i.necessity === 'essential' && !i.packed && !i.unavailable);
  const safetyLeft = active.filter((i) => i.safetyCritical && !i.packed && !i.unavailable);
  const unavailableEssentials = active.filter((i) => (i.necessity === 'essential' || i.safetyCritical) && i.unavailable);
  const toBuy = active.filter((i) => i.needsPurchase && !i.packed && !i.unavailable);
  const checksLeft = active.filter((i) => i.isCheck && i.stage === 'verify' && !i.packed);
  const essentials = active.filter((i) => i.necessity === 'essential' || i.safetyCritical);
  const doneEss = essentials.filter((i) => i.packed).length;
  return {
    ready: essentialsLeft.length === 0 && safetyLeft.length === 0 && checksLeft.length === 0,
    pct: essentials.length ? Math.round((doneEss / essentials.length) * 100) : 0,
    essentialsLeft,
    safetyLeft,
    unavailableEssentials,
    toBuy,
    checksLeft,
  };
}

/* ------------------------------------------------------------------ */
/* Packing schedule & calendar export                                  */
/* ------------------------------------------------------------------ */

export interface Reminder {
  id: string;
  stage: Stage | 'shopping' | 'vehicle';
  title: string;
  /** Local date-time, yyyy-mm-ddThh:mm */
  at: string;
  itemNames: string[];
}

const STAGE_TITLES: Record<Stage, string> = {
  advance: 'Pack in advance',
  'night-before': 'Pack the night before',
  morning: 'Pack on departure morning',
  cabin: 'Set up the cabin',
  verify: 'Verify before leaving',
};

export const STAGE_LABEL = STAGE_TITLES;

function addDays(iso: string, d: number): string {
  const dt = new Date(iso + 'T12:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + d);
  return dt.toISOString().slice(0, 10);
}

export function buildSchedule(trip: Trip, items: ChecklistItem[], today: string): Reminder[] {
  if (!trip.startDate) return [];
  const start = trip.startDate;
  const open = items.filter((i) => !i.packed && !i.unavailable && !i.stale);
  const names = (pred: (i: ChecklistItem) => boolean) => open.filter(pred).map((i) => i.name);
  const clamp = (d: string) => (d < today ? today : d);
  const r: Reminder[] = [];
  const toBuy = names((i) => i.needsPurchase);
  if (toBuy.length) r.push({ id: 'shopping', stage: 'shopping', title: `Buy ${toBuy.length} missing item(s)`, at: `${clamp(addDays(start, -7))}T18:00`, itemNames: toBuy });
  const vehicle = names((i) => i.category === 'vehicle-checks' && i.stage === 'advance');
  if (vehicle.length) r.push({ id: 'vehicle', stage: 'vehicle', title: 'Vehicle checks and service', at: `${clamp(addDays(start, -5))}T10:00`, itemNames: vehicle });
  const stages: [Stage, string, string][] = [
    ['advance', addDays(start, -3), '19:00'],
    ['night-before', addDays(start, -1), '19:30'],
    ['morning', start, '06:00'],
    ['cabin', start, '06:30'],
    ['verify', start, '06:45'],
  ];
  for (const [stage, date, time] of stages) {
    const list = names((i) => i.stage === stage);
    if (list.length) r.push({ id: stage, stage, title: STAGE_TITLES[stage], at: `${clamp(date)}T${time}`, itemNames: list });
  }
  return r.sort((a, b) => a.at.localeCompare(b.at));
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold lines to 75 octets as RFC 5545 requires (approximated by characters). */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74));
    rest = ' ' + rest.slice(74);
  }
  parts.push(rest);
  return parts.join('\r\n');
}

/** Floating local times so the phone's calendar uses its own time zone. */
export function remindersToIcs(tripName: string, reminders: Reminder[], stamp: string): string {
  const dt = (at: string) => at.replace(/[-:]/g, '') + '00';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Roadtrip Packer//EN', 'CALSCALE:GREGORIAN'];
  for (const r of reminders) {
    const desc = r.itemNames.slice(0, 40).join('\n') + (r.itemNames.length > 40 ? `\n…and ${r.itemNames.length - 40} more` : '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${r.id}-${dt(r.at)}@roadtrip-packer.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${dt(r.at)}`,
      'DURATION:PT15M',
      fold(`SUMMARY:${icsEscape(`${tripName}: ${r.title}`)}`),
      fold(`DESCRIPTION:${icsEscape(desc)}`),
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:PT0M',
      fold(`DESCRIPTION:${icsEscape(r.title)}`),
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
