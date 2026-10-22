import { nowIso, uid } from '../data/defaults';

import { resolveAssumptions } from '../rules/assumptions';
import { ENGINE_VERSION, generate } from '../rules/engine';
import { updateStatsFromReview } from '../rules/learning';
import { mergeChecklist, type MergeResult } from '../rules/merge';
import {
  getChecklist,
  getSettings,
  getTrip,
  listAlwaysPack,
  listInventory,
  listProfiles,
  listStats,
  replaceChecklist,
  saveAlwaysPack,
  saveReviewAndStats,
} from '../storage/repo';
import type { AlwaysPackItem, Outcome, Trip, TripReview } from '../types';

export async function regenerateTrip(tripOrId: Trip | string, today = new Date()): Promise<MergeResult & { trip: Trip }> {
  const trip = typeof tripOrId === 'string' ? await getTrip(tripOrId) : tripOrId;
  if (!trip) throw new Error('Trip not found');
  const [profiles, settings, inventory, stats, alwaysPack, existing] = await Promise.all([
    listProfiles(),
    getSettings(),
    listInventory(),
    listStats(),
    listAlwaysPack(),
    getChecklist(trip.id),
  ]);
  const { items } = generate({ trip, profiles, globalAssumptions: settings.assumptions, inventory, stats, alwaysPack, today });
  const now = nowIso();
  // Deterministic ids: both phones generate the same id for the same item, so family sync merges instead of duplicating.
  const merged = mergeChecklist(existing, items, trip.id, now, (key) => `${trip.id}:${key}`);
  const saved: Trip = { ...trip, generatedAt: now, engineVersion: ENGINE_VERSION };
  await replaceChecklist(saved, merged.items);
  return { ...merged, trip: saved };
}

export interface ReviewInput {
  trip: Trip;
  outcomes: Record<string, { ruleId?: string; name: string; outcome: Outcome }>;
  addNextTime: Omit<AlwaysPackItem, 'id' | 'updatedAt'>[];
  notes: string;
}

export async function completeReview(input: ReviewInput): Promise<TripReview> {
  const [settings, stats, inventory] = await Promise.all([getSettings(), listStats(), listInventory()]);
  const a = resolveAssumptions(settings.assumptions, input.trip.assumptionOverrides);
  const review: TripReview = {
    id: uid(),
    tripId: input.trip.id,
    tripName: input.trip.name,
    completedAt: nowIso(),
    outcomes: input.outcomes,
    notes: input.notes,
  };
  const nextStats = updateStatsFromReview(stats, review, a, review.completedAt);
  const forgottenRules = new Set(Object.values(input.outcomes).filter((o) => o.outcome === 'forgotten' && o.ruleId).map((o) => o.ruleId));
  const invUpdates = inventory
    .filter((i) => i.ruleId && forgottenRules.has(i.ruleId))
    .map((i) => ({ ...i, forgottenCount: i.forgottenCount + 1, updatedAt: review.completedAt }));
  await saveReviewAndStats(review, nextStats, input.trip, invUpdates);
  for (const ap of input.addNextTime) await saveAlwaysPack({ ...ap, id: uid(), updatedAt: review.completedAt });
  return review;
}
