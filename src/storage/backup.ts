import { z } from 'zod';
import { defaultSettings, nowIso } from '../data/defaults';
import type { Settings } from '../types';
import { getDB, SCHEMA_VERSION, type Tombstone } from './db';
import { normalizeChecklistItem, normalizeInventory, normalizeProfile, normalizeTrip } from './normalize';

export const BACKUP_FORMAT = 'milestone-roadtrip-backup';
export const APP_VERSION = '1.0.0';

const STORES = ['profiles', 'trips', 'checklist', 'inventory', 'reviews', 'stats', 'alwaysPack', 'savedPlaces', 'savedRoutes'] as const;
type BackupStore = (typeof STORES)[number];

const record = z.looseObject({ id: z.string().min(1) });
const statRecord = z.looseObject({ ruleId: z.string().min(1), qtyFactor: z.number().positive().max(10) });

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.number().int().min(1),
  appVersion: z.string().optional(),
  exportedAt: z.string(),
  data: z.object({
    settings: z.looseObject({}).optional(),
    profiles: z.array(record).default([]),
    trips: z.array(record).default([]),
    checklist: z.array(record.extend({ tripId: z.string().min(1) })).default([]),
    inventory: z.array(record).default([]),
    reviews: z.array(record.extend({ tripId: z.string() })).default([]),
    stats: z.array(statRecord).default([]),
    alwaysPack: z.array(record).default([]),
    savedPlaces: z.array(record.extend({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })).default([]),
    savedRoutes: z.array(record).default([]),
    mapRegions: z.array(z.looseObject({})).default([]),
    tombstones: z.array(z.object({ store: z.string(), id: z.string(), deletedAt: z.string() })).default([]),
  }),
});

export type BackupFile = z.infer<typeof backupSchema>;

export async function exportBackup(): Promise<BackupFile> {
  const db = await getDB();
  const data: Record<string, unknown[]> = {};
  for (const s of STORES) data[s] = await db.getAll(s);
  // Map regions are listed for reference only: tile data is too large for a JSON backup.
  const regions = await db.getAll('mapRegions');
  const settings = (await db.get('meta', 'settings')) ?? defaultSettings();
  // Deletions older than 180 days have reached every device that synced since; forget them.
  const cutoff = new Date(Date.now() - 180 * 86400000).toISOString();
  const tombstones = (await db.getAll('tombstones')).filter((t) => t.deletedAt >= cutoff);
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: nowIso(),
    data: {
      settings: settings as unknown as Record<string, unknown>,
      ...(data as Record<BackupStore, { id: string }[]>),
      mapRegions: regions.map((r) => ({ id: r.id, name: r.name, bbox: r.bbox, note: 'Map data is not included in backups — download the region again.' })),
      tombstones,
    } as unknown as BackupFile['data'],
  };
}

export async function markBackedUp(): Promise<void> {
  const db = await getDB();
  const s = (await db.get('meta', 'settings')) ?? defaultSettings();
  await db.put('meta', { ...s, lastBackupAt: nowIso() });
}

export type ImportMode = 'replace' | 'merge';

export interface ImportReport {
  ok: boolean;
  errors: string[];
  counts: Partial<Record<BackupStore, number>>;
  skippedMapRegions: number;
  fromSchemaVersion?: number;
}

/** Parse + validate without touching the database. */
export function validateBackup(text: string, opts: { allowOrphans?: boolean } = {}): { file?: BackupFile; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { errors: ['This file is not valid JSON. Choose a backup exported from this app.'] };
  }
  if (!json || typeof json !== 'object' || (json as { format?: unknown }).format !== BACKUP_FORMAT) {
    return { errors: ['This is not a Milestone backup file.'] };
  }
  const v = (json as { schemaVersion?: unknown }).schemaVersion;
  if (typeof v === 'number' && v > SCHEMA_VERSION) {
    return { errors: [`This backup was made by a newer version of the app (data version ${v}; this app supports up to ${SCHEMA_VERSION}). Update the app, then import again.`] };
  }
  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) {
    return {
      errors: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || 'file'}: ${i.message}`),
    };
  }
  const f = parsed.data;
  const errors: string[] = [];
  const tripIds = new Set(f.data.trips.map((t) => t.id));
  const orphan = f.data.checklist.filter((c) => !tripIds.has(c.tripId)).length;
  if (orphan && !opts.allowOrphans) errors.push(`${orphan} checklist item(s) refer to trips that are not in the file.`);
  for (const s of STORES) {
    const list = f.data[s] as { id?: string; ruleId?: string }[];
    const ids = list.map((r) => r.id ?? r.ruleId);
    if (new Set(ids).size !== ids.length) errors.push(`Duplicate records found in “${s}”.`);
  }
  return errors.length ? { errors } : { file: f, errors: [] };
}

/**
 * `sync: true` is used by family sync: merge newest-wins per record, apply
 * deletions (tombstones) from both sides, tolerate and clean up checklist
 * items whose trip was deleted on the other phone.
 */
export async function importBackup(text: string, mode: ImportMode, opts: { sync?: boolean } = {}): Promise<ImportReport> {
  const { file, errors } = validateBackup(text, { allowOrphans: opts.sync });
  if (!file) return { ok: false, errors, counts: {}, skippedMapRegions: 0 };
  const d = file.data;
  const normalised = {
    profiles: d.profiles.map((r) => normalizeProfile(r)),
    trips: d.trips.map((r) => normalizeTrip(r)),
    checklist: d.checklist.map((r) => normalizeChecklistItem(r)),
    inventory: d.inventory.map((r) => normalizeInventory(r)),
    reviews: d.reviews,
    stats: d.stats,
    alwaysPack: d.alwaysPack,
    savedPlaces: d.savedPlaces,
    savedRoutes: d.savedRoutes,
  } as Record<BackupStore, { id?: string; ruleId?: string; updatedAt?: string }[]>;

  const db = await getDB();
  const tx = db.transaction([...STORES, 'meta', 'tombstones'] as (BackupStore | 'meta' | 'tombstones')[], 'readwrite');
  const tombStore = tx.objectStore('tombstones');
  // Union of deletions known here and in the file.
  const tombs = new Map<string, Tombstone>();
  for (const t of mode === 'replace' ? [] : await tombStore.getAll()) tombs.set(`${t.store}|${t.id}`, t);
  for (const t of d.tombstones) {
    const k = `${t.store}|${t.id}`;
    const prev = tombs.get(k);
    if (!prev || prev.deletedAt < t.deletedAt) tombs.set(k, t);
  }
  if (mode === 'replace') await tombStore.clear();
  const counts: ImportReport['counts'] = {};
  for (const s of STORES) {
    const store = tx.objectStore(s);
    if (mode === 'replace') await store.clear();
    let n = 0;
    for (const rec of normalised[s]) {
      const key = (rec.id ?? rec.ruleId) as string;
      const dead = tombs.get(`${s}|${key}`);
      if (dead && (!rec.updatedAt || rec.updatedAt <= dead.deletedAt)) continue; // deleted after this version
      if (mode === 'merge') {
        const existing = (await store.get(key as never)) as { updatedAt?: string } | undefined;
        if (existing?.updatedAt && rec.updatedAt && existing.updatedAt > rec.updatedAt) continue; // keep newer local copy
      }
      await store.put(rec as never);
      n++;
    }
    counts[s] = n;
  }
  // Apply deletions to local records that are not newer than the deletion.
  for (const t of tombs.values()) {
    await tombStore.put(t);
    if (!(STORES as readonly string[]).includes(t.store)) continue;
    const store = tx.objectStore(t.store as BackupStore);
    const existing = (await store.get(t.id as never)) as { updatedAt?: string } | undefined;
    if (existing && (!existing.updatedAt || existing.updatedAt <= t.deletedAt)) await store.delete(t.id as never);
  }
  if (opts.sync) {
    // A trip deleted on one phone while the other ticked its items: drop the orphans.
    const tripIds = new Set(await tx.objectStore('trips').getAllKeys());
    // Same item generated independently on both phones: keep the most recently edited copy.
    const newest = new Map<string, { id: string; updatedAt: string }>();
    for (const i of await tx.objectStore('checklist').getAll()) {
      const k = `${i.tripId}|${i.key}`;
      const p = newest.get(k);
      if (!p || i.updatedAt > p.updatedAt) newest.set(k, { id: i.id, updatedAt: i.updatedAt });
    }
    let c = await tx.objectStore('checklist').openCursor();
    while (c) {
      if (!tripIds.has(c.value.tripId) || newest.get(`${c.value.tripId}|${c.value.key}`)?.id !== c.value.id) await c.delete();
      c = await c.continue();
    }
  }
  if (d.settings) {
    const current = (await tx.objectStore('meta').get('settings')) ?? defaultSettings();
    const incoming = { ...defaultSettings(), ...(d.settings as Partial<Settings>), id: 'settings' as const };
    let next: Settings;
    if (mode === 'replace') next = { ...incoming, theme: current.theme, lastBackupAt: current.lastBackupAt, onboarded: true };
    else if (opts.sync) next = incoming.updatedAt > current.updatedAt ? { ...current, assumptions: incoming.assumptions, homeCity: incoming.homeCity, car: incoming.car ?? current.car, updatedAt: incoming.updatedAt } : current;
    else next = { ...current, assumptions: { ...current.assumptions, ...incoming.assumptions } };
    await tx.objectStore('meta').put(next);
  }
  await tx.done;
  return { ok: true, errors: [], counts, skippedMapRegions: d.mapRegions.length, fromSchemaVersion: file.schemaVersion };
}
