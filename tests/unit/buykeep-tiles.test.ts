import { describe, expect, it } from 'vitest';
import { buyKeepAdvice } from '../../src/rules/buyKeep';
import { corridorTiles, lonLatToTile, MAX_TILES, planTiles } from '../../src/features/planner/offlineTiles';
import type { ChecklistItem, Trip } from '../../src/types';

const item = (p: Partial<ChecklistItem>): ChecklistItem => ({
  id: p.name ?? 'x', tripId: 't', key: p.name ?? 'x', source: 'rule', name: 'Thing', category: 'comfort', assigneeId: 'shared', recommendedQty: 1, unit: '', reasons: [], conditions: [],
  necessity: 'recommended', priority: 2, reusable: true, consumable: false, location: 'boot', stage: 'night-before', accessibleEnRoute: false, safetyCritical: false, isCheck: false,
  packed: false, owned: 'unknown', unavailable: false, needsPurchase: false, notes: '', order: 0, updatedAt: '2026-01-01T00:00:00Z', ...p,
});

describe('buy or bring advice', () => {
  const trip: Pick<Trip, 'resupply' | 'accommodation' | 'remote'> = { resupply: 'good', accommodation: 'hotel', remote: false };
  const groupOf = (p: Partial<ChecklistItem>, t = trip) => buyKeepAdvice([item(p)], t)[0]?.group;

  it('sorts everyday consumables, hard-to-find items, hotel-provided and not-owned items', () => {
    expect(groupOf({ name: 'Diapers', category: 'baby-care', consumable: true, reusable: false })).toBe('buy-there');
    expect(groupOf({ name: 'Child car seat', category: 'baby-gear', safetyCritical: true })).toBe('bring-hard-to-find');
    expect(groupOf({ name: 'Paracetamol syrup (child)', category: 'health', consumable: true })).toBe('bring-hard-to-find');
    expect(groupOf({ name: 'Shampoo', category: 'toiletries', consumable: true })).toBe('provided');
    expect(groupOf({ name: 'Tyre inflator', category: 'vehicle-tools', needsPurchase: true })).toBe('buy-before');
    expect(groupOf({ name: 'Board game', category: 'entertainment', necessity: 'optional' })).toBe('skip');
    expect(groupOf({ name: 'T-shirts', category: 'clothing' })).toBe('bring');
  });

  it('carries everything when shops are limited, and skips checks', () => {
    expect(groupOf({ name: 'Diapers', category: 'baby-care', consumable: true }, { resupply: 'limited', accommodation: 'homestay', remote: true })).toBe('bring');
    expect(buyKeepAdvice([item({ isCheck: true })], trip)).toHaveLength(0);
  });
});

describe('offline route map tiles', () => {
  it('converts coordinates to slippy tiles', () => {
    expect(lonLatToTile(0, 0, 1)).toEqual([1, 1]);
    expect(lonLatToTile(77.59, 12.97, 10)).toEqual([732, 474]);
  });

  it('covers a 300 km corridor within the fair-use cap, at good zoom', () => {
    const line: [number, number][] = Array.from({ length: 61 }, (_, i) => [77.6, 12.9 + (2.7 * i) / 60]);
    const { zMax, tiles } = planTiles(line, line[60]);
    expect(tiles.length).toBeLessThanOrEqual(MAX_TILES);
    expect(zMax).toBeGreaterThanOrEqual(12);
    expect(new Set(tiles).size).toBe(tiles.length);
    // destination area goes to street level
    expect(tiles.some((t) => t.startsWith('15/'))).toBe(true);
    expect(corridorTiles(line, line[60], 9).length).toBeLessThan(tiles.length);
  });

  it('lowers the zoom for very long routes instead of exceeding the cap', () => {
    const line: [number, number][] = Array.from({ length: 401 }, (_, i) => [72 + (16 * i) / 400, 8 + (20 * i) / 400]);
    const { zMax, tiles } = planTiles(line, line[400]);
    expect(tiles.length).toBeLessThanOrEqual(MAX_TILES);
    expect(zMax).toBeLessThan(14);
  });
});

describe('paperwork is never a shopping item', () => {
  it('puts documents in bring', () => {
    const [a] = buyKeepAdvice([item({ name: 'Vehicle registration certificate (RC)', category: 'documents', safetyCritical: true })], { resupply: 'good', accommodation: 'hotel', remote: false });
    expect(a.group).toBe('bring');
  });
});
