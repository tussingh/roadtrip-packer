import type { Assumptions, ItemStats, TripReview } from '../types';

const MAX_FACTOR = 2;

/**
 * Deterministic learning: counts outcomes per rule and adjusts a capped
 * quantity multiplier for consumables that ran out. No statistics beyond
 * counting — fully explainable and reversible (Settings → reset learning).
 */
export function updateStatsFromReview(
  stats: ItemStats[],
  review: TripReview,
  a: Assumptions,
  now: string,
): ItemStats[] {
  const map = new Map(stats.map((s) => [s.ruleId, { ...s }]));
  for (const o of Object.values(review.outcomes)) {
    if (!o.ruleId) continue;
    const s =
      map.get(o.ruleId) ??
      ({ ruleId: o.ruleId, qtyFactor: 1, used: 0, notNeeded: 0, ranOut: 0, forgotten: 0, updatedAt: now } as ItemStats);
    switch (o.outcome) {
      case 'used':
        s.used++;
        break;
      case 'not-needed':
        s.notNeeded++;
        break;
      case 'ran-out':
        s.ranOut++;
        s.qtyFactor = Math.min(MAX_FACTOR, Math.round(s.qtyFactor * (1 + a.ranOutIncreasePct / 100) * 100) / 100);
        break;
      case 'forgotten':
        s.forgotten++;
        break;
    }
    s.lastTripName = review.tripName;
    s.updatedAt = now;
    map.set(o.ruleId, s);
  }
  return [...map.values()];
}
