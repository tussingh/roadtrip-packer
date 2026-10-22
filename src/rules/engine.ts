import type {
  AlwaysPackItem,
  Assumptions,
  ChecklistItem,
  InventoryItem,
  ItemStats,
  Necessity,
  Priority,
  TravellerProfile,
  Trip,
} from '../types';
import { resolveAssumptions } from './assumptions';
import { activityRules } from './catalog/activities';
import { adultRules } from './catalog/adults';
import { childRules } from './catalog/child';
import { sharedRules } from './catalog/shared';
import { vehicleRules } from './catalog/vehicle';
import { deriveFacts, type TravellerFacts, type TripFacts } from './context';
import { resolveDyn, type ItemRule } from './ruleTypes';

export const ENGINE_VERSION = 'rules-2026.10.1';

export const ALL_RULES: ItemRule[] = [
  ...vehicleRules,
  ...adultRules,
  ...childRules,
  ...sharedRules,
  ...activityRules,
];

/** A generated recommendation before any user state is attached. */
export type GeneratedItem = Omit<
  ChecklistItem,
  'id' | 'tripId' | 'packed' | 'unavailable' | 'userQty' | 'notes' | 'updatedAt' | 'stale'
>;

export interface EngineInput {
  trip: Trip;
  profiles: TravellerProfile[];
  globalAssumptions?: Partial<Assumptions>;
  inventory?: InventoryItem[];
  stats?: ItemStats[];
  alwaysPack?: AlwaysPackItem[];
  /** Injected for determinism (age calculations, expiry checks). */
  today: Date;
}

export interface EngineOutput {
  facts: TripFacts;
  items: GeneratedItem[];
  assumptions: Assumptions;
}

const NECESSITY_RANK: Record<Necessity, number> = { essential: 0, activity: 1, recommended: 2, optional: 3 };

function defaultPriority(n: Necessity): Priority {
  return n === 'essential' ? 1 : n === 'optional' ? 3 : 2;
}

function expandRule(rule: ItemRule, f: TripFacts): { t?: TravellerFacts; assigneeId: string }[] {
  switch (rule.scope) {
    case 'shared':
      return [{ assigneeId: 'shared' }];
    case 'car':
      return [{ assigneeId: 'car' }];
    case 'each-adult':
      return f.adults.map((t) => ({ t, assigneeId: t.id }));
    case 'each-child':
      return f.children.map((t) => ({ t, assigneeId: t.id }));
  }
}

function conditionsFor(rule: ItemRule, f: TripFacts, t?: TravellerFacts): string[] {
  const c = rule.conditions ? rule.conditions(f, t) : [];
  return c.filter(Boolean);
}

export function runRules(f: TripFacts): GeneratedItem[] {
  const out: GeneratedItem[] = [];
  let order = 0;
  for (const rule of ALL_RULES) {
    for (const { t, assigneeId } of expandRule(rule, f)) {
      const reason = rule.when(f, t);
      if (!reason) continue;
      const q = rule.qty ? rule.qty(f, t) : { qty: 1, unit: 'item', why: [] };
      if (!(q.qty > 0)) continue;
      const necessity = resolveDyn(rule.necessity, f, t);
      const note = rule.note ? resolveDyn(rule.note, f, t) : undefined;
      const reasons = [reason, ...q.why.filter(Boolean)];
      if (note) reasons.push(`Note: ${note}`);
      out.push({
        key: `${rule.id}@${assigneeId}`,
        ruleId: rule.id,
        source: 'rule',
        name: resolveDyn(rule.name, f, t),
        category: rule.category,
        assigneeId,
        recommendedQty: q.qty,
        unit: q.unit,
        reasons,
        conditions: conditionsFor(rule, f, t),
        necessity,
        priority: rule.priority ? resolveDyn(rule.priority, f, t) : defaultPriority(necessity),
        reusable: rule.reusable,
        consumable: Boolean(rule.consumable),
        location: resolveDyn(rule.location, f, t),
        stage: resolveDyn(rule.stage, f, t),
        accessibleEnRoute: rule.accessibleEnRoute ? resolveDyn(rule.accessibleEnRoute, f, t) : false,
        safetyCritical: Boolean(rule.safetyCritical),
        isCheck: Boolean(rule.isCheck),
        owned: 'unknown',
        needsPurchase: false,
        order: order++,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Deterministic personalisation from past trips                       */
/* ------------------------------------------------------------------ */

export function applyPersonalisation(items: GeneratedItem[], stats: ItemStats[], a: Assumptions): GeneratedItem[] {
  const byRule = new Map(stats.map((s) => [s.ruleId, s]));
  return items.map((item) => {
    const s = item.ruleId ? byRule.get(item.ruleId) : undefined;
    if (!s) return item;
    const next = { ...item, reasons: [...item.reasons] };
    if (s.ranOut > 0 && item.consumable && s.qtyFactor > 1 && !item.isCheck) {
      const before = next.recommendedQty;
      next.recommendedQty = Math.ceil(before * s.qtyFactor);
      next.reasons.push(
        `Ran out on ${s.ranOut === 1 ? 'a previous trip' : `${s.ranOut} previous trips`} → × ${Math.round(s.qtyFactor * 100) / 100} = ${next.recommendedQty} (was ${before})`,
      );
    }
    if (s.forgotten > 0) {
      next.forgottenBefore = true;
      next.priority = 1;
      next.reasons.push(`Forgotten on ${s.forgotten === 1 ? 'a previous trip' : `${s.forgotten} trips`} — moved to top priority`);
    }
    if (s.notNeeded >= a.notNeededTripsBeforeOptional && s.used === 0) {
      if (item.safetyCritical || item.necessity === 'essential') {
        next.reasons.push(`Not used on ${s.notNeeded} trips but kept: ${item.safetyCritical ? 'safety-critical' : 'essential'} items are never demoted`);
      } else if (next.necessity !== 'optional') {
        next.necessity = 'optional';
        next.priority = 3;
        next.reasons.push(`Not needed on ${s.notNeeded} trips → shown as optional`);
      }
    }
    return next;
  });
}

/* ------------------------------------------------------------------ */
/* Inventory matching                                                  */
/* ------------------------------------------------------------------ */

export function applyInventory(items: GeneratedItem[], inventory: InventoryItem[], today: Date): GeneratedItem[] {
  const todayIso = today.toISOString().slice(0, 10);
  return items.map((item) => {
    if (item.isCheck) return { ...item, owned: 'unknown', needsPurchase: false, purchaseReason: undefined };
    const matches = inventory.filter(
      (inv) =>
        (item.ruleId && inv.ruleId === item.ruleId) &&
        (inv.assignedTo === 'shared' || inv.assignedTo === item.assigneeId || item.assigneeId === 'shared' || item.assigneeId === 'car'),
    );
    if (matches.length === 0) return { ...item, owned: 'unknown', needsPurchase: false };
    const valid = matches.filter((m) => !m.expiry || m.expiry >= todayIso);
    const expired = matches.filter((m) => m.expiry && m.expiry < todayIso);
    const ownedQty = valid.reduce((s, m) => s + m.qty, 0);
    const need = item.recommendedQty;
    const next = { ...item, ownedQty, reasons: [...item.reasons] };
    if (ownedQty <= 0) {
      next.owned = 'not-owned';
      next.needsPurchase = true;
      next.purchaseReason = expired.length ? `Inventory stock expired (${expired.map((e) => e.expiry).join(', ')})` : 'None left in inventory';
    } else if (ownedQty < need && item.consumable) {
      next.owned = 'partial';
      next.needsPurchase = true;
      next.purchaseReason = `Inventory has ${ownedQty}, trip needs ${need} → buy ${need - ownedQty}`;
    } else {
      next.owned = 'owned';
      next.needsPurchase = valid.some((m) => m.needsReplenish) && item.consumable;
      if (next.needsPurchase) next.purchaseReason = 'Marked “needs replenishing” in inventory';
    }
    if (expired.length) next.reasons.push(`Inventory: ${expired.length} expired item(s) excluded`);
    return next;
  });
}

/* ------------------------------------------------------------------ */
/* Always-pack items                                                   */
/* ------------------------------------------------------------------ */

export function alwaysPackItems(list: AlwaysPackItem[], f: TripFacts, startOrder: number): GeneratedItem[] {
  const out: GeneratedItem[] = [];
  let order = startOrder;
  for (const ap of list) {
    let assignees: string[];
    if (ap.assignee === 'each-adult') assignees = f.adults.map((t) => t.id);
    else if (ap.assignee === 'each-child') assignees = f.children.map((t) => t.id);
    else if (ap.assignee === 'shared' || ap.assignee === 'car') assignees = [ap.assignee];
    else assignees = f.everyone.some((t) => t.id === ap.assignee) ? [ap.assignee] : [];
    for (const assigneeId of assignees) {
      out.push({
        key: `personal:${ap.id}@${assigneeId}`,
        source: 'personal',
        name: ap.name,
        category: ap.category,
        assigneeId,
        recommendedQty: ap.qty,
        unit: ap.unit,
        reasons: ['From your “always pack” list', ...(ap.notes ? [ap.notes] : [])],
        conditions: [],
        necessity: 'recommended',
        priority: 2,
        reusable: true,
        consumable: false,
        location: ap.location,
        stage: ap.stage,
        accessibleEnRoute: ap.location === 'cabin' || ap.location === 'diaper-bag',
        safetyCritical: false,
        isCheck: false,
        owned: 'unknown',
        needsPurchase: false,
        order: order++,
      });
    }
  }
  return out;
}

export function sortItems<T extends Pick<GeneratedItem, 'necessity' | 'priority' | 'order'>>(items: T[]): T[] {
  return [...items].sort(
    (x, y) => x.priority - y.priority || NECESSITY_RANK[x.necessity] - NECESSITY_RANK[y.necessity] || x.order - y.order,
  );
}

export function generate(input: EngineInput): EngineOutput {
  const assumptions = resolveAssumptions(input.globalAssumptions, input.trip.assumptionOverrides);
  const facts = deriveFacts(input.trip, input.profiles, assumptions, input.today);
  let items = runRules(facts);
  items = items.concat(alwaysPackItems(input.alwaysPack ?? [], facts, items.length));
  items = applyPersonalisation(items, input.stats ?? [], assumptions);
  items = applyInventory(items, input.inventory ?? [], input.today);
  return { facts, items, assumptions };
}

export function findItem(items: GeneratedItem[], ruleId: string, assigneeId?: string): GeneratedItem | undefined {
  return items.find((i) => i.ruleId === ruleId && (assigneeId === undefined || i.assigneeId === assigneeId));
}
