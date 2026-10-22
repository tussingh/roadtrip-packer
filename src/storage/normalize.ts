import { defaultAdultPrefs, defaultChildPrefs } from '../data/defaults';
import type { ChecklistItem, InventoryItem, TravellerProfile, Trip } from '../types';

type Raw = Record<string, unknown>;

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const bool = (v: unknown, d = false) => (typeof v === 'boolean' ? v : d);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);

/** Fill fields added in later schema versions with safe defaults. */
export function normalizeTrip(raw: Raw): Trip {
  const days = Math.max(1, Math.round(num(raw.days, 1)));
  const now = new Date().toISOString();
  const place = (p: unknown) => {
    const o = (p && typeof p === 'object' ? p : {}) as Raw;
    return { name: str(o.name), lat: typeof o.lat === 'number' ? o.lat : undefined, lon: typeof o.lon === 'number' ? o.lon : undefined };
  };
  return {
    id: str(raw.id),
    name: str(raw.name, 'Untitled trip'),
    startDate: typeof raw.startDate === 'string' && raw.startDate ? raw.startDate : undefined,
    endDate: typeof raw.endDate === 'string' && raw.endDate ? raw.endDate : undefined,
    days,
    nights: Math.max(0, Math.min(days, Math.round(num(raw.nights, days - 1)))),
    origin: place(raw.origin),
    destination: place(raw.destination),
    stops: arr<Raw>(raw.stops).map((s, i) => ({ ...place(s), id: str(s.id, `stop-${i}`), overnight: bool(s.overnight) })),
    returnSameRoute: bool(raw.returnSameRoute, true),
    totalKm: Math.max(0, num(raw.totalKm, 0)),
    kmSource: oneOf(raw.kmSource, ['manual', 'offline-route', 'online-route', 'none'] as const, num(raw.totalKm, 0) > 0 ? 'manual' : 'none'),
    drivingDays: Math.max(0, Math.round(num(raw.drivingDays, days > 1 ? 2 : 1))),
    totalDriveHours: typeof raw.totalDriveHours === 'number' && raw.totalDriveHours > 0 ? raw.totalDriveHours : undefined,
    legs: arr<Raw>(raw.legs).map((l, i) => ({ id: str(l.id, `leg-${i}`), label: str(l.label, `Day ${i + 1}`), km: Math.max(0, num(l.km, 0)), hours: typeof l.hours === 'number' ? l.hours : undefined })),
    travellerIds: arr<unknown>(raw.travellerIds).filter((x): x is string => typeof x === 'string'),
    accommodation: oneOf(raw.accommodation, ['hotel', 'resort', 'homestay', 'camping', 'family'] as const, 'hotel'),
    activities: arr<string>(raw.activities).filter((a) =>
      ['beach', 'swimming', 'hill-station', 'wildlife', 'hiking', 'photography', 'drone', 'religious', 'sightseeing', 'work'].includes(a),
    ) as Trip['activities'],
    laundry: oneOf(raw.laundry, ['none', 'midway', 'anytime'] as const, 'none'),
    temperature: oneOf(raw.temperature, ['auto', 'hot', 'warm', 'mild', 'cool', 'cold'] as const, 'auto'),
    rain: oneOf(raw.rain, ['auto', 'dry', 'showers', 'monsoon'] as const, 'auto'),
    remote: bool(raw.remote),
    mountains: bool(raw.mountains),
    overnightDriving: bool(raw.overnightDriving),
    resupply: oneOf(raw.resupply, ['good', 'limited', 'poor'] as const, 'good'),
    plan: raw.plan && typeof raw.plan === 'object' && Array.isArray((raw.plan as Raw).options) ? (raw.plan as Trip['plan']) : undefined,
    assumptionOverrides: raw.assumptionOverrides && typeof raw.assumptionOverrides === 'object' ? (raw.assumptionOverrides as Trip['assumptionOverrides']) : {},
    status: oneOf(raw.status, ['planning', 'completed', 'archived'] as const, 'planning'),
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : undefined,
    engineVersion: typeof raw.engineVersion === 'string' ? raw.engineVersion : undefined,
    notes: str(raw.notes),
    createdAt: str(raw.createdAt, now),
    updatedAt: str(raw.updatedAt, now),
  };
}

export function normalizeChecklistItem(raw: Raw): ChecklistItem {
  const recommendedQty = Math.max(0, num(raw.recommendedQty, 1));
  return {
    id: str(raw.id),
    tripId: str(raw.tripId),
    key: str(raw.key, `custom:${str(raw.id)}`),
    ruleId: typeof raw.ruleId === 'string' ? raw.ruleId : undefined,
    source: oneOf(raw.source, ['rule', 'custom', 'personal'] as const, 'custom'),
    name: str(raw.name, 'Item'),
    category: str(raw.category, 'comfort') as ChecklistItem['category'],
    assigneeId: str(raw.assigneeId, 'shared'),
    recommendedQty,
    userQty: typeof raw.userQty === 'number' && raw.userQty >= 0 ? raw.userQty : undefined,
    unit: str(raw.unit, 'item'),
    reasons: arr<unknown>(raw.reasons).filter((r): r is string => typeof r === 'string'),
    conditions: arr<unknown>(raw.conditions).filter((r): r is string => typeof r === 'string'),
    necessity: oneOf(raw.necessity, ['essential', 'recommended', 'optional', 'activity'] as const, 'recommended'),
    priority: oneOf(raw.priority as never, [1, 2, 3] as never, 2 as never),
    reusable: bool(raw.reusable, true),
    consumable: bool(raw.consumable),
    location: str(raw.location, 'suitcase') as ChecklistItem['location'],
    stage: oneOf(raw.stage, ['advance', 'night-before', 'morning', 'cabin', 'verify'] as const, 'advance'),
    accessibleEnRoute: bool(raw.accessibleEnRoute),
    safetyCritical: bool(raw.safetyCritical),
    isCheck: bool(raw.isCheck),
    packed: bool(raw.packed),
    owned: oneOf(raw.owned, ['unknown', 'owned', 'partial', 'not-owned'] as const, 'unknown'),
    ownedQty: typeof raw.ownedQty === 'number' ? raw.ownedQty : undefined,
    unavailable: bool(raw.unavailable),
    needsPurchase: bool(raw.needsPurchase),
    purchaseReason: typeof raw.purchaseReason === 'string' ? raw.purchaseReason : undefined,
    forgottenBefore: raw.forgottenBefore === true ? true : undefined,
    stale: bool(raw.stale),
    notes: str(raw.notes),
    order: num(raw.order, 0),
    updatedAt: str(raw.updatedAt, new Date().toISOString()),
  };
}

export function normalizeProfile(raw: Raw): TravellerProfile {
  const kind = oneOf(raw.kind, ['adult', 'child'] as const, 'adult');
  const gender = oneOf(raw.gender, ['male', 'female', 'unspecified'] as const, 'unspecified');
  const now = new Date().toISOString();
  const p: TravellerProfile = {
    id: str(raw.id),
    name: str(raw.name, kind === 'adult' ? 'Adult' : 'Child'),
    kind,
    gender,
    birthDate: typeof raw.birthDate === 'string' && raw.birthDate ? raw.birthDate : undefined,
    createdAt: str(raw.createdAt, now),
    updatedAt: str(raw.updatedAt, now),
  };
  if (kind === 'adult') p.adult = { ...defaultAdultPrefs(gender), ...((raw.adult as object) ?? {}) };
  else p.child = { ...defaultChildPrefs(20), ...((raw.child as object) ?? {}) };
  return p;
}

export function normalizeInventory(raw: Raw): InventoryItem {
  return {
    id: str(raw.id),
    name: str(raw.name, 'Item'),
    ruleId: typeof raw.ruleId === 'string' && raw.ruleId ? raw.ruleId : undefined,
    qty: Math.max(0, num(raw.qty, 0)),
    unit: str(raw.unit, 'item'),
    location: str(raw.location),
    expiry: typeof raw.expiry === 'string' && raw.expiry ? raw.expiry : undefined,
    needsReplenish: bool(raw.needsReplenish),
    assignedTo: str(raw.assignedTo, 'shared'),
    forgottenCount: Math.max(0, num(raw.forgottenCount, 0)),
    notes: str(raw.notes),
    updatedAt: str(raw.updatedAt, new Date().toISOString()),
  };
}
