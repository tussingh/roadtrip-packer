import { defaultSettings, nowIso, starterFamily } from '../data/defaults';
import type {
  AlwaysPackItem,
  ChecklistItem,
  InventoryItem,
  ItemStats,
  SavedPlace,
  SavedRoute,
  Settings,
  TravellerProfile,
  Trip,
  TripReview,
} from '../types';
import { getDB, type Tombstone } from './db';

/** Remember deletions so family sync removes the record on the other phone too. */
function tomb(store: string, id: string): Tombstone {
  return { store, id, deletedAt: nowIso() };
}
async function deleteWithTombstone(store: 'profiles' | 'inventory' | 'alwaysPack' | 'savedPlaces' | 'savedRoutes' | 'checklist', id: string) {
  const db = await getDB();
  const tx = db.transaction([store, 'tombstones'], 'readwrite');
  await tx.objectStore(store).delete(id);
  await tx.objectStore('tombstones').put(tomb(store, id));
  await tx.done;
}

/* ---------------- settings & seeding ---------------- */

export async function getSettings(): Promise<Settings> {
  const db = await getDB();
  return (await db.get('meta', 'settings')) ?? defaultSettings();
}

export async function saveSettings(s: Settings): Promise<void> {
  const db = await getDB();
  await db.put('meta', { ...s, updatedAt: nowIso() });
}

/** First run: create settings and the starter family (all editable). */
export async function ensureSeeded(today = new Date()): Promise<boolean> {
  const db = await getDB();
  const tx = db.transaction(['meta', 'profiles'], 'readwrite');
  const existing = await tx.objectStore('meta').get('settings');
  if (existing) {
    await tx.done;
    return false;
  }
  await tx.objectStore('meta').put(defaultSettings());
  if ((await tx.objectStore('profiles').count()) === 0) {
    for (const p of starterFamily(today)) await tx.objectStore('profiles').put(p);
  }
  await tx.done;
  return true;
}

/* ---------------- profiles ---------------- */

export async function listProfiles(): Promise<TravellerProfile[]> {
  const all = await (await getDB()).getAll('profiles');
  return all.sort((a, b) => (a.kind === b.kind ? a.createdAt.localeCompare(b.createdAt) : a.kind === 'adult' ? -1 : 1));
}

export async function saveProfile(p: TravellerProfile): Promise<void> {
  await (await getDB()).put('profiles', { ...p, updatedAt: nowIso() });
}

export async function deleteProfile(id: string): Promise<void> {
  await deleteWithTombstone('profiles', id);
}

/* ---------------- trips & checklists ---------------- */

export async function listTrips(): Promise<Trip[]> {
  const all = await (await getDB()).getAll('trips');
  return all.sort((a, b) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999') || b.createdAt.localeCompare(a.createdAt));
}

export async function getTrip(id: string): Promise<Trip | undefined> {
  return (await getDB()).get('trips', id);
}

export async function saveTrip(t: Trip): Promise<void> {
  await (await getDB()).put('trips', { ...t, updatedAt: nowIso() });
}

export async function deleteTrip(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['trips', 'checklist', 'reviews', 'tombstones'], 'readwrite');
  const tombs = tx.objectStore('tombstones');
  await tx.objectStore('trips').delete(id);
  await tombs.put(tomb('trips', id));
  for (const key of await tx.objectStore('checklist').index('tripId').getAllKeys(id)) {
    await tx.objectStore('checklist').delete(key);
    await tombs.put(tomb('checklist', key));
  }
  for (const key of await tx.objectStore('reviews').index('tripId').getAllKeys(id)) {
    await tx.objectStore('reviews').delete(key);
    await tombs.put(tomb('reviews', key));
  }
  await tx.done;
}

export async function getChecklist(tripId: string): Promise<ChecklistItem[]> {
  const items = await (await getDB()).getAllFromIndex('checklist', 'tripId', tripId);
  return items.sort((a, b) => a.order - b.order);
}

export async function putChecklistItems(items: ChecklistItem[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['checklist', 'tombstones'], 'readwrite');
  for (const i of items) {
    await tx.objectStore('checklist').put(i);
    await tx.objectStore('tombstones').delete(['checklist', i.id]); // restored by undo
  }
  await tx.done;
}

export async function deleteChecklistItem(id: string): Promise<void> {
  await deleteWithTombstone('checklist', id);
}

/** Atomically replace a trip's checklist and save the trip. */
export async function replaceChecklist(trip: Trip, items: ChecklistItem[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['trips', 'checklist', 'tombstones'], 'readwrite');
  const store = tx.objectStore('checklist');
  const keep = new Set(items.map((i) => i.id));
  for (const key of await store.index('tripId').getAllKeys(trip.id)) {
    if (keep.has(key)) continue;
    await store.delete(key);
    await tx.objectStore('tombstones').put(tomb('checklist', key));
  }
  for (const i of items) {
    await store.put(i);
    await tx.objectStore('tombstones').delete(['checklist', i.id]);
  }
  await tx.objectStore('trips').put({ ...trip, updatedAt: nowIso() });
  await tx.done;
}

/* ---------------- inventory ---------------- */

export async function listInventory(): Promise<InventoryItem[]> {
  const all = await (await getDB()).getAll('inventory');
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveInventoryItem(i: InventoryItem): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['inventory', 'tombstones'], 'readwrite');
  await tx.objectStore('inventory').put({ ...i, updatedAt: nowIso() });
  await tx.objectStore('tombstones').delete(['inventory', i.id]);
  await tx.done;
}

export async function deleteInventoryItem(id: string): Promise<void> {
  await deleteWithTombstone('inventory', id);
}

/* ---------------- history & learning ---------------- */

export async function listReviews(): Promise<TripReview[]> {
  const all = await (await getDB()).getAll('reviews');
  return all.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

export async function listStats(): Promise<ItemStats[]> {
  return (await getDB()).getAll('stats');
}

export async function clearStats(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['stats', 'tombstones'], 'readwrite');
  for (const key of await tx.objectStore('stats').getAllKeys()) await tx.objectStore('tombstones').put(tomb('stats', key));
  await tx.objectStore('stats').clear();
  await tx.done;
}

export async function saveReviewAndStats(review: TripReview, stats: ItemStats[], trip: Trip, inventoryUpdates: InventoryItem[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['reviews', 'stats', 'trips', 'inventory'], 'readwrite');
  await tx.objectStore('reviews').put(review);
  for (const s of stats) await tx.objectStore('stats').put(s);
  for (const i of inventoryUpdates) await tx.objectStore('inventory').put(i);
  await tx.objectStore('trips').put({ ...trip, status: 'completed', updatedAt: nowIso() });
  await tx.done;
}

export async function listAlwaysPack(): Promise<AlwaysPackItem[]> {
  return (await getDB()).getAll('alwaysPack');
}

export async function saveAlwaysPack(i: AlwaysPackItem): Promise<void> {
  await (await getDB()).put('alwaysPack', { ...i, updatedAt: nowIso() });
}

export async function deleteAlwaysPack(id: string): Promise<void> {
  await deleteWithTombstone('alwaysPack', id);
}

/* ---------------- saved places / routes ---------------- */

export async function listSavedPlaces(): Promise<SavedPlace[]> {
  return (await getDB()).getAll('savedPlaces');
}
export async function saveSavedPlace(p: SavedPlace): Promise<void> {
  await (await getDB()).put('savedPlaces', { ...p, updatedAt: nowIso() });
}
export async function deleteSavedPlace(id: string): Promise<void> {
  await deleteWithTombstone('savedPlaces', id);
}
export async function listSavedRoutes(): Promise<SavedRoute[]> {
  return (await getDB()).getAll('savedRoutes');
}
export async function saveSavedRoute(r: SavedRoute): Promise<void> {
  await (await getDB()).put('savedRoutes', r);
}
export async function deleteSavedRoute(id: string): Promise<void> {
  await deleteWithTombstone('savedRoutes', id);
}
