import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS, resolveAssumptions } from '../../src/rules/assumptions';
import { ageInMonths, autoWeather, deriveFacts } from '../../src/rules/context';
import { findItem, generate, type GeneratedItem } from '../../src/rules/engine';
import { updateStatsFromReview } from '../../src/rules/learning';
import { mergeChecklist } from '../../src/rules/merge';
import { buildSchedule, progressOf, readiness, remindersToIcs } from '../../src/rules/progress';
import type { ChecklistItem, InventoryItem, ItemStats, Trip, TripReview } from '../../src/types';
import { TODAY, family, scenarioA, scenarioB, scenarioC, trip } from '../fixtures/family';

const run = (t: Trip, extra: Partial<Parameters<typeof generate>[0]> = {}) =>
  generate({ trip: t, profiles: family(), today: TODAY, ...extra });
const q = (items: GeneratedItem[], id: string, who?: string) => findItem(items, id, who)?.recommendedQty;

describe('distance and duration are independent variables', () => {
  // Same day count. A: 100 km crawling through traffic for 6 h. B: 500 km of highway in 6 h.
  const traffic = run(trip({ days: 1, nights: 0, totalKm: 100, drivingDays: 1, totalDriveHours: 6 })).items;
  const highway = run(trip({ days: 1, nights: 0, totalKm: 500, drivingDays: 1, totalDriveHours: 6 })).items;

  it('hours drive child consumables and comfort the same way', () => {
    for (const id of ['child-diapers', 'child-snacks', 'child-toys']) expect(q(traffic, id, 'kid'), id).toBe(q(highway, id, 'kid'));
    expect(q(traffic, 'plan-rest-stops')).toBe(q(highway, 'plan-rest-stops'));
    expect(findItem(traffic, 'shared-power-bank')!.necessity).toBe('essential');
  });

  it('kilometres drive vehicle preparation, tolls and cash', () => {
    expect(q(highway, 'car-emergency-cash')!).toBeGreaterThan(q(traffic, 'car-emergency-cash')!);
    expect(findItem(highway, 'car-puncture-kit')).toBeDefined();
    expect(findItem(traffic, 'car-puncture-kit')).toBeUndefined();
    expect(findItem(highway, 'check-service')).toBeDefined();
    expect(findItem(traffic, 'check-service')).toBeUndefined();
  });

  it('kilometres never increase clothing or toiletries', () => {
    const short = run(trip({ days: 3, nights: 2, totalKm: 150, drivingDays: 2 })).items;
    const long = run(trip({ days: 3, nights: 2, totalKm: 1500, drivingDays: 2 })).items;
    for (const [id, who] of [['adult-outfits', 'me'], ['child-outfits', 'kid'], ['adult-innerwear', 'wife'], ['shared-toothpaste', 'shared']] as const) {
      expect(q(short, id, who), id).toBe(q(long, id, who));
    }
  });
});

describe('child age changes recommendations', () => {
  const at = (birth: string) => generate({ trip: scenarioA(), profiles: family(birth), today: TODAY }).items;

  it('uses the age bracket for diapers per day', () => {
    const infant = at('2026-03-01'); // 8 months
    const toddler = at('2025-02-15'); // 20 months
    expect(q(infant, 'child-diapers', 'kid')!).toBeGreaterThan(q(toddler, 'child-diapers', 'kid')!);
  });

  it('replaces sunscreen with shade for babies under six months', () => {
    const baby = generate({ trip: { ...scenarioA(), activities: ['beach'] }, profiles: family('2026-07-01'), today: TODAY }).items;
    expect(findItem(baby, 'child-sunscreen', 'kid')!.name).toMatch(/no sunscreen under 6 months/);
  });

  it('switches to underwear and a potty when the profile says trained', () => {
    const p = family('2022-06-01');
    p[2].child = { ...p[2].child!, diaperStatus: 'trained' };
    const items = generate({ trip: scenarioA(), profiles: p, today: TODAY }).items;
    expect(findItem(items, 'child-diapers', 'kid')).toBeUndefined();
    expect(findItem(items, 'child-underwear', 'kid')).toBeDefined();
    expect(findItem(items, 'child-travel-potty', 'kid')).toBeDefined();
  });

  it('suggests audio rather than screens under two and never recommends unapproved seat accessories', () => {
    const items = at('2025-02-15');
    expect(findItem(items, 'child-offline-audio', 'kid')!.name).toMatch(/audio/);
    const seat = findItem(items, 'child-car-seat', 'kid')!;
    expect(seat.safetyCritical).toBe(true);
    expect(seat.reasons.join(' ')).toMatch(/Do not add aftermarket head supports/);
    expect(items.some((i) => /head support|neck support/i.test(i.name))).toBe(false);
  });

  it('computes age in months at the trip start date', () => {
    expect(ageInMonths('2025-02-15', new Date('2026-10-22T00:00:00'))).toBe(20);
    expect(ageInMonths('2025-01-31', new Date('2025-02-28T00:00:00'))).toBe(0);
    expect(ageInMonths('2025-01-31', new Date('2025-03-31T00:00:00'))).toBe(2);
    expect(ageInMonths('not-a-date', new Date())).toBeNull();
    const facts = deriveFacts(trip({ startDate: '2027-02-15' }), family(), DEFAULT_ASSUMPTIONS, TODAY);
    expect(facts.children[0].ageMonths).toBe(24);
  });
});

describe('weather and activities', () => {
  it('auto weather follows a South-India seasonal heuristic', () => {
    expect(autoWeather(7, false, new Set())).toEqual({ temperature: 'warm', rain: 'monsoon' });
    expect(autoWeather(1, true, new Set())).toEqual({ temperature: 'cold', rain: 'dry' });
    expect(autoWeather(4, false, new Set())).toEqual({ temperature: 'hot', rain: 'dry' });
  });

  it('cold weather adds warm layers; monsoon makes rain gear essential', () => {
    const cold = run(trip({ temperature: 'cold', days: 3, nights: 2, totalKm: 300 })).items;
    expect(findItem(cold, 'adult-thermals', 'me')).toBeDefined();
    expect(findItem(cold, 'child-woollen-cap', 'kid')).toBeDefined();
    const wet = run(trip({ rain: 'monsoon', days: 3, nights: 2, totalKm: 300 })).items;
    expect(findItem(wet, 'adult-rainwear', 'me')!.necessity).toBe('essential');
    expect(findItem(wet, 'car-umbrella')!.necessity).toBe('essential');
    expect(findItem(wet, 'check-monsoon-car')).toBeDefined();
  });

  it('photography and drone modules add gear and legal checks', () => {
    const items = run(trip({ activities: ['photography', 'drone'], days: 4, nights: 3, totalKm: 400 })).items;
    for (const id of ['act-camera', 'act-camera-batteries', 'act-memory-cards', 'act-drone', 'act-drone-rules']) expect(findItem(items, id), id).toBeDefined();
  });

  it('camping adds a self-contained stay kit', () => {
    const items = run(trip({ accommodation: 'camping', days: 3, nights: 2, totalKm: 300 })).items;
    for (const id of ['camp-tent', 'camp-sleeping', 'camp-headlamps', 'stay-towels']) expect(findItem(items, id), id).toBeDefined();
    expect(q(items, 'camp-sleeping')).toBe(3);
  });
});

describe('inventory reuse', () => {
  const inv = (over: Partial<InventoryItem>): InventoryItem => ({
    id: 'inv', name: 'Diapers', ruleId: 'child-diapers', qty: 50, unit: 'diapers', location: 'Cupboard',
    needsReplenish: false, assignedTo: 'kid', forgottenCount: 0, notes: '', updatedAt: '', ...over,
  });

  it('marks enough stock as owned with nothing to buy', () => {
    const d = findItem(run(scenarioA(), { inventory: [inv({})] }).items, 'child-diapers', 'kid')!;
    expect(d.owned).toBe('owned');
    expect(d.needsPurchase).toBe(false);
  });

  it('flags a shortfall precisely', () => {
    const d = findItem(run(scenarioA(), { inventory: [inv({ qty: 10 })] }).items, 'child-diapers', 'kid')!;
    expect(d.owned).toBe('partial');
    expect(d.needsPurchase).toBe(true);
    expect(d.purchaseReason).toBe('Inventory has 10, trip needs 18 → buy 8');
  });

  it('ignores expired stock', () => {
    const d = findItem(run(scenarioA(), { inventory: [inv({ expiry: '2026-01-01' })] }).items, 'child-diapers', 'kid')!;
    expect(d.owned).toBe('not-owned');
    expect(d.purchaseReason).toMatch(/expired/);
  });
});

describe('deterministic personalisation', () => {
  const stat = (over: Partial<ItemStats>): ItemStats => ({ ruleId: 'x', qtyFactor: 1, used: 0, notNeeded: 0, ranOut: 0, forgotten: 0, updatedAt: '', ...over });

  it('learns from a trip review with capped increases', () => {
    const review: TripReview = {
      id: 'r', tripId: 't', tripName: 'Coorg', completedAt: '', notes: '',
      outcomes: {
        a: { ruleId: 'child-snacks', name: 'Snacks', outcome: 'ran-out' },
        b: { ruleId: 'shared-neck-pillow', name: 'Pillow', outcome: 'not-needed' },
        c: { ruleId: 'car-first-aid', name: 'First aid', outcome: 'not-needed' },
        d: { ruleId: 'adult-phone-cable', name: 'Cable', outcome: 'forgotten' },
      },
    };
    let stats = updateStatsFromReview([], review, DEFAULT_ASSUMPTIONS, 'now');
    expect(stats.find((s) => s.ruleId === 'child-snacks')!.qtyFactor).toBe(1.25);
    for (let i = 0; i < 6; i++) stats = updateStatsFromReview(stats, review, DEFAULT_ASSUMPTIONS, 'now');
    expect(stats.find((s) => s.ruleId === 'child-snacks')!.qtyFactor).toBe(2);
  });

  it('applies ran-out, forgotten and not-needed rules but never demotes safety items', () => {
    const base = run(scenarioA()).items;
    const stats = [
      stat({ ruleId: 'child-snacks', ranOut: 1, qtyFactor: 1.25 }),
      stat({ ruleId: 'adult-phone-cable', forgotten: 1 }),
      stat({ ruleId: 'child-books', notNeeded: 2 }),
      stat({ ruleId: 'car-first-aid', notNeeded: 5 }),
      stat({ ruleId: 'shared-wet-wipes', notNeeded: 2 }),
    ];
    const items = run(scenarioA(), { stats }).items;
    expect(q(items, 'child-snacks', 'kid')).toBe(Math.ceil(q(base, 'child-snacks', 'kid')! * 1.25));
    const cable = findItem(items, 'adult-phone-cable', 'me')!;
    expect(cable.forgottenBefore).toBe(true);
    expect(cable.priority).toBe(1);
    expect(findItem(items, 'shared-wet-wipes')!.necessity).toBe('optional');
    const aid = findItem(items, 'car-first-aid')!;
    expect(aid.necessity).toBe('essential');
    expect(aid.reasons.join(' ')).toMatch(/never demoted/);
  });

  it('adds always-pack items for each matching traveller', () => {
    const items = run(scenarioA(), {
      alwaysPack: [{ id: 'ap1', name: 'Kindle', category: 'electronics', assignee: 'each-adult', qty: 1, unit: 'item', location: 'cabin', stage: 'night-before', notes: '', updatedAt: '' }],
    }).items;
    expect(items.filter((i) => i.name === 'Kindle')).toHaveLength(2);
  });
});

describe('assumptions', () => {
  it('clamps invalid overrides to their documented range', () => {
    const a = resolveAssumptions({ diapersPerDay12to24m: 999 }, { avgSpeedKmh: Number.NaN, childSpareOutfits: -3 });
    expect(a.diapersPerDay12to24m).toBe(12);
    expect(a.avgSpeedKmh).toBe(DEFAULT_ASSUMPTIONS.avgSpeedKmh);
    expect(a.childSpareOutfits).toBe(0);
  });

  it('per-trip overrides change quantities and the explanation', () => {
    const items = run({ ...scenarioA(), assumptionOverrides: { diapersPerDay12to24m: 8 } }).items;
    const d = findItem(items, 'child-diapers', 'kid')!;
    expect(d.reasons[1]).toMatch(/^8\/day/);
  });

  it('is fully deterministic', () => {
    expect(JSON.stringify(run(scenarioC()).items)).toBe(JSON.stringify(run(scenarioC()).items));
  });
});

describe('date and duration boundaries', () => {
  it('handles a same-day trip with no nights', () => {
    const items = run(trip({ days: 1, nights: 0, totalKm: 120, drivingDays: 1 })).items;
    expect(findItem(items, 'adult-sleepwear', 'me')).toBeUndefined();
    expect(findItem(items, 'adult-toothbrush', 'me')).toBeUndefined();
    expect(findItem(items, 'car-first-aid')).toBeDefined();
    expect(q(items, 'adult-outfits', 'me')).toBe(1);
  });

  it('clamps nights to days and tolerates zero distance', () => {
    const f = deriveFacts(trip({ days: 2, nights: 5, totalKm: 0, drivingDays: 2 }), family(), DEFAULT_ASSUMPTIONS, TODAY);
    expect(f.nights).toBe(2);
    expect(f.drivingDays).toBe(0);
    const items = run(trip({ days: 2, nights: 1, totalKm: 0 })).items;
    expect(findItem(items, 'car-spare-tyre')).toBeUndefined();
    expect(findItem(items, 'car-first-aid')).toBeDefined(); // first aid is not tied to driving
  });

  it('uses explicit drive legs when entered', () => {
    const f = deriveFacts(
      trip({ legs: [{ id: 'l1', label: 'Out', km: 300, hours: 7 }, { id: 'l2', label: 'Back', km: 300 }], totalKm: 0 }),
      family(), DEFAULT_ASSUMPTIONS, TODAY,
    );
    expect(f.totalKm).toBe(600);
    expect(f.maxDriveHours).toBe(7);
    expect(f.driveDays[1].hours).toBe(6);
  });
});

/* ------------------------------------------------------------------ */

let idc = 0;
const newId = () => `id${++idc}`;
function materialise(items: GeneratedItem[]): ChecklistItem[] {
  return mergeChecklist([], items, 'trip-1', 't0', newId).items;
}

describe('regenerating keeps user work', () => {
  it('preserves packed state, overrides, notes and custom items; drops untouched removed items', () => {
    const first = materialise(run(scenarioB()).items);
    const swim = first.find((i) => i.ruleId === 'act-swimwear' && i.assigneeId === 'me')!;
    const sand = first.find((i) => i.ruleId === 'act-sand-toys')!;
    const diapers = first.find((i) => i.ruleId === 'child-diapers')!;
    swim.packed = true;
    diapers.userQty = 40;
    diapers.notes = 'Brand X';
    const custom: ChecklistItem = { ...diapers, id: 'c1', key: 'custom:c1', source: 'custom', ruleId: undefined, name: 'Kite', userQty: undefined, notes: '' };
    // regenerate without the beach
    const res = mergeChecklist([...first, custom], run({ ...scenarioB(), activities: [] }).items, 'trip-1', 't1', newId);
    const byKey = new Map(res.items.map((i) => [i.key, i]));
    expect(byKey.get(swim.key)!.stale).toBe(true);
    expect(byKey.get(swim.key)!.packed).toBe(true);
    expect(byKey.has(sand.key)).toBe(false);
    expect(byKey.get(diapers.key)!.userQty).toBe(40);
    expect(byKey.get(diapers.key)!.notes).toBe('Brand X');
    expect(byKey.get(diapers.key)!.id).toBe(diapers.id);
    expect(byKey.get('custom:c1')!.name).toBe('Kite');
    expect(res.staleKept).toBe(1);
    expect(res.removed).toBeGreaterThan(0);
    expect(new Set(res.items.map((i) => i.key)).size).toBe(res.items.length);
  });

  it('never emits duplicate keys even if the generator repeats one', () => {
    const g = run(scenarioA()).items;
    const res = mergeChecklist([], [...g, g[0]], 'trip-1', 't', newId);
    expect(res.items).toHaveLength(g.length);
  });
});

describe('progress, readiness and schedule', () => {
  const items = materialise(run(scenarioA()).items);

  it('excludes unavailable items from progress', () => {
    const copy = items.map((i, n) => ({ ...i, packed: n < 10, unavailable: n === 10 }));
    const p = progressOf(copy);
    expect(p.total).toBe(items.length - 1);
    expect(p.done).toBe(10);
  });

  it('is not ready while safety items remain', () => {
    const r = readiness(items);
    expect(r.ready).toBe(false);
    expect(r.safetyLeft.length).toBeGreaterThan(0);
    const all = readiness(items.map((i) => ({ ...i, packed: true })));
    expect(all.ready).toBe(true);
    expect(all.pct).toBe(100);
  });

  it('builds a dated schedule and a valid iCalendar file', () => {
    const rem = buildSchedule(scenarioA(), items, '2026-10-22');
    expect(rem.map((r) => r.id)).toContain('night-before');
    expect(rem.find((r) => r.id === 'night-before')!.at).toBe('2026-11-05T19:30');
    const ics = remindersToIcs('A, short; trip', rem, '20261022T000000Z');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('SUMMARY:A\\, short\\; trip: Pack the night before');
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(rem.length);
  });

  it('clamps reminders that would fall in the past', () => {
    const rem = buildSchedule({ ...scenarioA(), startDate: '2026-10-23' }, items, '2026-10-22');
    expect(rem.every((r) => r.at >= '2026-10-22')).toBe(true);
  });
});
