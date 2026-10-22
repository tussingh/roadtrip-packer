import type { ChecklistItem } from '../types';
import type { GeneratedItem } from './engine';

export interface MergeResult {
  items: ChecklistItem[];
  added: number;
  removed: number;
  kept: number;
  qtyChanged: number;
  staleKept: number;
}

function touched(i: ChecklistItem): boolean {
  return i.packed || i.userQty !== undefined || i.unavailable || i.notes.trim() !== '';
}

/**
 * Regenerate a checklist without losing user work:
 *  - packed / unavailable flags, quantity overrides and notes survive;
 *  - custom items are never removed;
 *  - items the rules no longer produce are dropped unless the user touched
 *    them, in which case they are kept and marked `stale`.
 */
export function mergeChecklist(
  existing: ChecklistItem[],
  generated: GeneratedItem[],
  tripId: string,
  now: string,
  newId: () => string,
): MergeResult {
  const prevByKey = new Map(existing.map((i) => [i.key, i]));
  const seen = new Set<string>();
  const out: ChecklistItem[] = [];
  let added = 0;
  let qtyChanged = 0;
  let kept = 0;

  for (const g of generated) {
    if (seen.has(g.key)) continue; // defensive: never emit duplicate keys
    seen.add(g.key);
    const prev = prevByKey.get(g.key);
    if (prev) {
      kept++;
      if (prev.recommendedQty !== g.recommendedQty) qtyChanged++;
      const owned = g.owned !== 'unknown' ? g.owned : prev.owned;
      out.push({
        ...g,
        id: prev.id,
        tripId,
        userQty: prev.userQty,
        packed: prev.packed,
        unavailable: prev.unavailable,
        notes: prev.notes,
        owned,
        ownedQty: g.ownedQty ?? prev.ownedQty,
        needsPurchase: g.owned !== 'unknown' ? g.needsPurchase : prev.needsPurchase,
        purchaseReason: g.owned !== 'unknown' ? g.purchaseReason : prev.purchaseReason,
        stale: false,
        updatedAt: prev.updatedAt,
      });
    } else {
      added++;
      out.push({ ...g, id: newId(), tripId, packed: false, unavailable: false, notes: '', stale: false, updatedAt: now });
    }
  }

  let removed = 0;
  let staleKept = 0;
  let order = generated.length;
  for (const prev of existing) {
    if (seen.has(prev.key)) continue;
    if (prev.source === 'custom') {
      out.push({ ...prev, order: prev.order >= 0 ? order++ : order++ });
      continue;
    }
    if (touched(prev)) {
      staleKept++;
      out.push({ ...prev, stale: true, order: order++ });
    } else {
      removed++;
    }
  }
  return { items: out, added, removed, kept, qtyChanged, staleKept };
}

export const effectiveQty = (i: Pick<ChecklistItem, 'userQty' | 'recommendedQty'>) => i.userQty ?? i.recommendedQty;
