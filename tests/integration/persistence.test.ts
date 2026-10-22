import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { regenerateTrip } from '../../src/app/tripService';
import { blankTrip, uid } from '../../src/data/defaults';
import { exportBackup, importBackup, validateBackup } from '../../src/storage/backup';
import { deleteDatabase, getDB, openMilestoneDB, resetDBConnection, SCHEMA_VERSION } from '../../src/storage/db';
import {
  ensureSeeded,
  getChecklist,
  getTrip,
  listInventory,
  listProfiles,
  listTrips,
  putChecklistItems,
  saveInventoryItem,
  saveTrip,
} from '../../src/storage/repo';
import type { ChecklistItem, Trip } from '../../src/types';

let n = 0;
beforeEach(async () => {
  await resetDBConnection(`test-db-${++n}-${Date.now()}`);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await deleteDatabase();
});

async function makeTrip(): Promise<Trip> {
  await ensureSeeded(new Date('2026-10-22T09:00:00'));
  const profiles = await listProfiles();
  const t: Trip = { ...blankTrip(profiles.map((p) => p.id)), name: 'Chikmagalur weekend', startDate: '2026-11-06', days: 3, nights: 2, totalKm: 500, drivingDays: 2, destination: { name: 'Chikmagalur' } };
  await saveTrip(t);
  await regenerateTrip(t.id, new Date('2026-10-22T09:00:00'));
  return (await getTrip(t.id))!;
}

describe('Scenario F — offline restart keeps trips, inventory and progress', () => {
  it('survives closing and reopening with the network unavailable', async () => {
    const trip = await makeTrip();
    const items = await getChecklist(trip.id);
    expect(items.length).toBeGreaterThan(50);

    // Edit: pack three items, override one quantity, add a custom item, add inventory.
    const edited: ChecklistItem[] = items.slice(0, 3).map((i) => ({ ...i, packed: true }));
    edited.push({ ...items[3], userQty: 9 });
    const custom: ChecklistItem = { ...items[4], id: uid(), key: 'custom:x', source: 'custom', ruleId: undefined, name: 'Coffee filter', packed: false, userQty: undefined };
    edited.push(custom);
    await putChecklistItems(edited);
    await saveInventoryItem({ id: 'inv1', name: 'Diapers', ruleId: 'child-diapers', qty: 40, unit: 'diapers', location: 'Wardrobe', needsReplenish: false, assignedTo: 'shared', forgottenCount: 0, notes: '', updatedAt: '' });

    // "Close the app" and go into airplane mode: any network call now fails.
    await resetDBConnection();
    const fetchSpy = vi.fn(() => Promise.reject(new TypeError('Network request failed (airplane mode)')));
    vi.stubGlobal('fetch', fetchSpy);

    // "Reopen": fresh connection, read everything back.
    const trips = await listTrips();
    expect(trips.map((t) => t.name)).toEqual(['Chikmagalur weekend']);
    const after = await getChecklist(trip.id);
    expect(after.filter((i) => i.packed).map((i) => i.id).sort()).toEqual(items.slice(0, 3).map((i) => i.id).sort());
    expect(after.find((i) => i.id === items[3].id)!.userQty).toBe(9);
    expect(after.find((i) => i.key === 'custom:x')!.name).toBe('Coffee filter');
    expect((await listInventory())[0].qty).toBe(40);

    // Regenerating offline still works (pure local rules) and keeps the edits.
    const res = await regenerateTrip(trip.id, new Date('2026-10-22T09:00:00'));
    expect(res.items.filter((i) => i.packed)).toHaveLength(3);
    expect(res.items.find((i) => i.key === 'custom:x')).toBeDefined();
    expect(res.items.find((i) => i.ruleId === 'child-diapers')!.owned).toBe('owned');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('schema migrations', () => {
  it('upgrades a version-1 database to the current version without losing trips or checklist items', async () => {
    const name = `legacy-${Date.now()}`;
    const v1 = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('meta', { keyPath: 'id' });
        db.createObjectStore('profiles', { keyPath: 'id' });
        db.createObjectStore('trips', { keyPath: 'id' });
        db.createObjectStore('checklist', { keyPath: 'id' }).createIndex('tripId', 'tripId');
        db.createObjectStore('inventory', { keyPath: 'id' });
      },
    });
    // v1 records lacked legs, stops, assumptionOverrides, isCheck, safetyCritical…
    await v1.put('trips', { id: 'old', name: 'Mysuru 2025', days: 2, nights: 1, totalKm: 290, travellerIds: ['a'], createdAt: '2025-01-01', updatedAt: '2025-01-01' });
    await v1.put('checklist', { id: 'c1', tripId: 'old', key: 'adult-outfits@a', name: 'Outfits', recommendedQty: 2, packed: true });
    v1.close();

    const db = await openMilestoneDB(name, SCHEMA_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(
      ['alwaysPack', 'checklist', 'device', 'inventory', 'mapChunks', 'mapRegions', 'meta', 'profiles', 'reviews', 'savedPlaces', 'savedRoutes', 'stats', 'tombstones', 'trips'].sort(),
    );
    const trip = await db.get('trips', 'old');
    expect(trip!.legs).toEqual([]);
    expect(trip!.stops).toEqual([]);
    expect(trip!.assumptionOverrides).toEqual({});
    expect(trip!.kmSource).toBe('manual');
    const item = await db.get('checklist', 'c1');
    expect(item!.packed).toBe(true);
    expect(item!.isCheck).toBe(false);
    expect(item!.reasons).toEqual([]);
    db.close();
    indexedDB.deleteDatabase(name);
  });
});

describe('backup and restore', () => {
  it('round-trips the complete local dataset', async () => {
    const trip = await makeTrip();
    const items = await getChecklist(trip.id);
    await putChecklistItems([{ ...items[0], packed: true }]);
    const before = { trips: await listTrips(), checklist: await getChecklist(trip.id), profiles: await listProfiles() };
    const json = JSON.stringify(await exportBackup());

    await deleteDatabase();
    await resetDBConnection(`restored-${Date.now()}`);
    const report = await importBackup(json, 'replace');
    expect(report.ok).toBe(true);
    expect(report.counts.checklist).toBe(before.checklist.length);
    expect(await listTrips()).toEqual(before.trips);
    expect(await getChecklist(trip.id)).toEqual(before.checklist);
    expect(await listProfiles()).toEqual(before.profiles);
  });

  it('rejects malformed, foreign, future-version and inconsistent files without writing', async () => {
    await makeTrip();
    const good = await exportBackup();
    const tripsBefore = await listTrips();

    expect(validateBackup('{not json').errors[0]).toMatch(/not valid JSON/);
    expect(validateBackup(JSON.stringify({ hello: 1 })).errors[0]).toMatch(/not a Milestone backup/);
    expect(validateBackup(JSON.stringify({ ...good, schemaVersion: SCHEMA_VERSION + 1 })).errors[0]).toMatch(/newer version/);

    const orphan = structuredClone(good);
    orphan.data.checklist.push({ ...orphan.data.checklist[0], id: 'zzz', tripId: 'missing-trip' });
    const r1 = await importBackup(JSON.stringify(orphan), 'replace');
    expect(r1.ok).toBe(false);
    expect(r1.errors[0]).toMatch(/refer to trips/);

    const dup = structuredClone(good);
    dup.data.trips.push(dup.data.trips[0]);
    expect((await importBackup(JSON.stringify(dup), 'replace')).errors.join(' ')).toMatch(/Duplicate/);

    const badPlace = structuredClone(good);
    badPlace.data.savedPlaces.push({ id: 'p', lat: 200, lon: 0 } as never);
    expect((await importBackup(JSON.stringify(badPlace), 'merge')).ok).toBe(false);

    expect(await listTrips()).toEqual(tripsBefore);
  });

  it('merge keeps the newer local copy of a record', async () => {
    const trip = await makeTrip();
    const backup = await exportBackup();
    const db = await getDB();
    await db.put('trips', { ...trip, name: 'Renamed locally', updatedAt: '2999-01-01T00:00:00.000Z' });
    const r = await importBackup(JSON.stringify(backup), 'merge');
    expect(r.ok).toBe(true);
    expect((await getTrip(trip.id))!.name).toBe('Renamed locally');
  });

  it('imports older-format trips by filling new fields', async () => {
    await ensureSeeded();
    const legacy = {
      format: 'milestone-roadtrip-backup',
      schemaVersion: 1,
      exportedAt: '2025-06-01T00:00:00Z',
      data: { trips: [{ id: 't1', name: 'Ooty', days: 3, nights: 2, travellerIds: [] }], checklist: [] },
    };
    const r = await importBackup(JSON.stringify(legacy), 'merge');
    expect(r.ok).toBe(true);
    expect(r.fromSchemaVersion).toBe(1);
    const t = await getTrip('t1');
    expect(t!.legs).toEqual([]);
    expect(t!.accommodation).toBe('hotel');
  });
});
