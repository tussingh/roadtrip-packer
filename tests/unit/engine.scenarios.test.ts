import { describe, expect, it } from 'vitest';
import { findItem, generate, type GeneratedItem } from '../../src/rules/engine';
import type { Trip } from '../../src/types';
import { TODAY, family, scenarioA, scenarioB, scenarioC, scenarioD, scenarioE } from '../fixtures/family';

const run = (t: Trip, profiles = family()) => generate({ trip: t, profiles, today: TODAY });
const qty = (items: GeneratedItem[], ruleId: string, who?: string) => {
  const i = findItem(items, ruleId, who);
  if (!i) throw new Error(`missing ${ruleId}@${who ?? '*'}`);
  return i.recommendedQty;
};
const has = (items: GeneratedItem[], ruleId: string, who?: string) => Boolean(findItem(items, ruleId, who));

const SAFETY_BASELINE = ['car-first-aid', 'car-triangle', 'car-spare-tyre', 'car-jack', 'car-torch', 'car-emergency-water', 'check-tyres', 'check-car-seat', 'child-car-seat'];

describe('every generated item is explainable', () => {
  for (const [name, t] of [['A', scenarioA()], ['B', scenarioB()], ['C', scenarioC()], ['D', scenarioD()], ['E', scenarioE()]] as const) {
    it(`scenario ${name}: positive quantity, unit, reason and unique key`, () => {
      const { items } = run(t);
      expect(items.length).toBeGreaterThan(60);
      const keys = new Set<string>();
      for (const i of items) {
        expect(i.recommendedQty, i.key).toBeGreaterThan(0);
        expect(Number.isFinite(i.recommendedQty), i.key).toBe(true);
        expect(i.unit, i.key).not.toBe('');
        expect(i.reasons.length, i.key).toBeGreaterThan(0);
        expect(i.reasons[0].length, i.key).toBeGreaterThan(3);
        expect(keys.has(i.key), `duplicate ${i.key}`).toBe(false);
        keys.add(i.key);
      }
    });
  }
});

describe('Scenario A — short family trip (2 days, 1 night, 150 km, hotel)', () => {
  const { items, facts } = run(scenarioA());

  it('derives driving facts from distance, not from guesses', () => {
    expect(facts.drivingDays).toBe(2);
    expect(facts.totalKm).toBe(150);
    expect(facts.maxDriveHours).toBe(1.5); // 75 km / 50 km/h
    expect(facts.children[0].ageMonths).toBe(20);
  });

  it('calculates diapers from daily use + travel-day extras + reserve', () => {
    // 6/day × 2 days = 12; +1 extra per drive day (1.5 h / 2.5 h → 1) × 2 = 14; reserve max(4, 20% = 3) = 4 → 18
    expect(qty(items, 'child-diapers', 'kid')).toBe(18);
    // cabin portion: ceil(1.5/2.5)=1 + ceil(6/3)=2 + 2 = 5
    expect(qty(items, 'child-diapers-cabin', 'kid')).toBe(5);
  });

  it('packs outfits net of the outfit worn on departure', () => {
    expect(qty(items, 'adult-outfits', 'me')).toBe(2); // 2×1 −1 +1
    expect(qty(items, 'child-outfits', 'kid')).toBe(6); // 2×2.5 = 5 −1 +2
    expect(qty(items, 'adult-sleepwear', 'wife')).toBe(1);
  });

  it('keeps the full vehicle-safety baseline even for a short trip', () => {
    for (const id of SAFETY_BASELINE) expect(has(items, id), id).toBe(true);
    expect(findItem(items, 'car-first-aid')!.necessity).toBe('essential');
  });

  it('shares toiletries instead of duplicating them per person', () => {
    expect(items.filter((i) => i.ruleId === 'shared-toothpaste')).toHaveLength(1);
    expect(items.filter((i) => i.ruleId === 'adult-toothbrush')).toHaveLength(2);
  });

  it('does not add beach or camping modules', () => {
    expect(has(items, 'act-swimwear', 'me')).toBe(false);
    expect(has(items, 'camp-tent')).toBe(false);
  });

  it('adds the hotel cot request for a toddler', () => {
    expect(has(items, 'child-request-cot', 'kid')).toBe(true);
  });
});

describe('Scenario B — weekend road trip (4 days, 3 nights, 600 km, resort, beach)', () => {
  const b = run(scenarioB()).items;
  const noBeach = run({ ...scenarioB(), activities: [] }).items;

  it('adds beach module items', () => {
    expect(has(b, 'act-swimwear', 'me')).toBe(true);
    expect(has(b, 'act-child-swimwear', 'kid')).toBe(true);
    expect(has(b, 'act-swim-diapers', 'kid')).toBe(true);
    expect(has(b, 'act-water-shoes')).toBe(true);
    expect(findItem(b, 'child-sunscreen', 'kid')!.necessity).toBe('essential');
    expect(findItem(b, 'shared-sunscreen')!.necessity).toBe('essential');
  });

  it('treats resort towels as optional', () => {
    expect(findItem(b, 'act-beach-towels')!.necessity).toBe('optional');
  });

  it('does not duplicate ordinary clothing because of the beach', () => {
    expect(qty(b, 'adult-outfits', 'me')).toBe(qty(noBeach, 'adult-outfits', 'me'));
    expect(qty(b, 'child-outfits', 'kid')).toBe(qty(noBeach, 'child-outfits', 'kid'));
  });

  it('adds a wet bag for swimwear', () => {
    expect(qty(b, 'child-wet-bags', 'kid')).toBe(qty(noBeach, 'child-wet-bags', 'kid') + 1);
  });

  it('scales diapers with duration and driving hours', () => {
    // 6×4 = 24; drive days 2 × 6 h → ceil(6/2.5)=3 each = 6 → 30; reserve ceil(30×0.2)=6 → 36
    expect(qty(b, 'child-diapers', 'kid')).toBe(36);
  });
});

describe('Scenario C — long road trip (7 days, 6 nights, 1,500 km, overnight stops)', () => {
  const { items, facts } = run(scenarioC());

  it('recognises a long multi-stop journey', () => {
    expect(facts.longJourney).toBe(true);
    expect(facts.overnightStops).toBe(2);
    expect(facts.maxDriveHours).toBe(7.5);
    expect(has(items, 'plan-overnight-bag')).toBe(true);
  });

  it('makes power, service and rest-stop planning essential', () => {
    expect(findItem(items, 'shared-power-bank')!.necessity).toBe('essential');
    expect(findItem(items, 'check-service')!.necessity).toBe('essential');
    expect(findItem(items, 'plan-rest-stops')!.necessity).toBe('essential');
    // 4 drive days × (ceil(7.5/2) − 1 = 3) = 12 stops
    expect(qty(items, 'plan-rest-stops')).toBe(12);
  });

  it('covers 7 days of clothing without laundry', () => {
    expect(qty(items, 'adult-outfits', 'me')).toBe(7); // 7 −1 +1
    expect(qty(items, 'adult-sleepwear', 'me')).toBe(2); // 6 nights / 3
  });
});

describe('Scenario D — laundry available midway', () => {
  const c = run(scenarioC()).items;
  const d = run(scenarioD()).items;

  it('reduces clothing to the laundry cycle', () => {
    expect(qty(d, 'adult-outfits', 'me')).toBe(4); // ceil(7/2)=4 → 4 −1 +1
    expect(qty(d, 'adult-outfits', 'me')).toBeLessThan(qty(c, 'adult-outfits', 'me'));
    expect(qty(d, 'child-outfits', 'kid')).toBeLessThan(qty(c, 'child-outfits', 'kid'));
    expect(qty(d, 'adult-innerwear', 'wife')).toBeLessThan(qty(c, 'adult-innerwear', 'wife'));
  });

  it('leaves consumables such as diapers unchanged', () => {
    expect(qty(d, 'child-diapers', 'kid')).toBe(qty(c, 'child-diapers', 'kid'));
  });

  it('adds detergent sachets for the planned wash', () => {
    expect(has(d, 'shared-detergent')).toBe(true);
    expect(has(c, 'shared-detergent')).toBe(false);
  });
});

describe('Scenario E — remote route with limited resupply', () => {
  const c = run(scenarioC());
  const e = run(scenarioE());
  const a = e.assumptions;

  it('adds explicit reserves derived from assumptions, not arbitrary multipliers', () => {
    const perDay = a.diapersPerDay12to24m;
    expect(qty(e.items, 'child-diapers', 'kid') - qty(c.items, 'child-diapers', 'kid')).toBe(perDay * a.remoteReserveDays);
    // emergency water: occupants × 1 L, plus one reserve day of the same
    expect(qty(e.items, 'car-emergency-water')).toBe(3 * a.emergencyWaterLitresPerPerson * (1 + a.remoteReserveDays));
    expect(qty(c.items, 'car-emergency-water')).toBe(3);
    // cash: + one base amount per reserve day
    expect(qty(e.items, 'car-emergency-cash') - qty(c.items, 'car-emergency-cash')).toBe(a.emergencyCashBaseInr * a.remoteReserveDays);
  });

  it('upgrades vehicle preparation for self-reliance', () => {
    for (const id of ['car-inflator', 'car-jump', 'car-tool-kit', 'car-puncture-kit', 'plan-offline-map', 'plan-share-itinerary']) {
      expect(findItem(e.items, id)!.necessity, id).toBe('essential');
    }
    expect(has(e.items, 'car-tow-rope')).toBe(true);
    expect(has(c.items, 'car-tow-rope')).toBe(false);
    expect(findItem(e.items, 'check-fuel')!.name).toMatch(/half/);
  });

  it('every reserve explanation names its source', () => {
    for (const id of ['car-emergency-water', 'car-emergency-cash', 'car-emergency-food', 'child-diapers']) {
      const r = findItem(e.items, id)!.reasons.join(' ');
      expect(r, id).toMatch(/reserve|resupply/);
    }
  });

  it('does not change clothing just because the route is remote', () => {
    expect(qty(e.items, 'adult-outfits', 'me')).toBe(qty(c.items, 'adult-outfits', 'me'));
  });
});
