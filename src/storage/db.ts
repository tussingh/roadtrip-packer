import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import type {
  AlwaysPackItem,
  ChecklistItem,
  InventoryItem,
  ItemStats,
  MapAssetKind,
  MapRegion,
  SavedPlace,
  SavedRoute,
  Settings,
  TravellerProfile,
  Trip,
  TripReview,
} from '../types';
import { normalizeChecklistItem, normalizeTrip } from './normalize';

/**
 * Schema history
 *  v1  meta, profiles, trips, checklist(by tripId), inventory
 *  v2  reviews, stats, alwaysPack; trips gain legs/assumptionOverrides/stops
 *  v3  offline maps: mapRegions, mapChunks, savedPlaces, savedRoutes;
 *      checklist items gain isCheck/safetyCritical/conditions
 *  v4  family sync: tombstones (deletions to propagate), device (this phone's sync settings)
 * Each step is idempotent and only adds; nothing is ever dropped.
 */
export const SCHEMA_VERSION = 4;
export const DEFAULT_DB_NAME = 'milestone-roadtrip';

export interface MapChunk {
  regionId: string;
  kind: MapAssetKind;
  index: number;
  data: ArrayBuffer;
}

/** A deletion remembered so it can propagate to the other phone during sync. */
export interface Tombstone {
  store: string;
  id: string;
  deletedAt: string;
}

/** Per-device record (never backed up or synced). */
export interface DeviceRecord {
  id: string;
  [k: string]: unknown;
}

export interface MilestoneDB extends DBSchema {
  meta: { key: string; value: Settings };
  profiles: { key: string; value: TravellerProfile };
  trips: { key: string; value: Trip };
  checklist: { key: string; value: ChecklistItem; indexes: { tripId: string } };
  inventory: { key: string; value: InventoryItem };
  reviews: { key: string; value: TripReview; indexes: { tripId: string } };
  stats: { key: string; value: ItemStats };
  alwaysPack: { key: string; value: AlwaysPackItem };
  mapRegions: { key: string; value: MapRegion };
  mapChunks: { key: [string, MapAssetKind, number]; value: MapChunk; indexes: { asset: [string, MapAssetKind] } };
  savedPlaces: { key: string; value: SavedPlace };
  savedRoutes: { key: string; value: SavedRoute };
  tombstones: { key: [string, string]; value: Tombstone };
  device: { key: string; value: DeviceRecord };
}

export type DB = IDBPDatabase<MilestoneDB>;
type UpgradeTx = IDBPTransaction<MilestoneDB, StoreNames<MilestoneDB>[], 'versionchange'>;

let dbName = DEFAULT_DB_NAME;
let dbPromise: Promise<DB> | null = null;

export function upgradeSteps(db: IDBPDatabase<MilestoneDB>, oldVersion: number, tx: UpgradeTx): Promise<void>[] {
  const work: Promise<void>[] = [];
  if (oldVersion < 1) {
    db.createObjectStore('meta', { keyPath: 'id' });
    db.createObjectStore('profiles', { keyPath: 'id' });
    db.createObjectStore('trips', { keyPath: 'id' });
    db.createObjectStore('checklist', { keyPath: 'id' }).createIndex('tripId', 'tripId');
    db.createObjectStore('inventory', { keyPath: 'id' });
  }
  if (oldVersion < 2) {
    db.createObjectStore('reviews', { keyPath: 'id' }).createIndex('tripId', 'tripId');
    db.createObjectStore('stats', { keyPath: 'ruleId' });
    db.createObjectStore('alwaysPack', { keyPath: 'id' });
    if (oldVersion >= 1) {
      work.push(
        (async () => {
          let cursor = await tx.objectStore('trips').openCursor();
          while (cursor) {
            await cursor.update(normalizeTrip(cursor.value as unknown as Record<string, unknown>));
            cursor = await cursor.continue();
          }
        })(),
      );
    }
  }
  if (oldVersion < 3) {
    db.createObjectStore('mapRegions', { keyPath: 'id' });
    db.createObjectStore('mapChunks', { keyPath: ['regionId', 'kind', 'index'] }).createIndex('asset', ['regionId', 'kind']);
    db.createObjectStore('savedPlaces', { keyPath: 'id' });
    db.createObjectStore('savedRoutes', { keyPath: 'id' });
    if (oldVersion >= 1) {
      work.push(
        (async () => {
          let cursor = await tx.objectStore('checklist').openCursor();
          while (cursor) {
            await cursor.update(normalizeChecklistItem(cursor.value as unknown as Record<string, unknown>));
            cursor = await cursor.continue();
          }
        })(),
      );
    }
  }
  if (oldVersion < 4) {
    db.createObjectStore('tombstones', { keyPath: ['store', 'id'] });
    db.createObjectStore('device', { keyPath: 'id' });
  }
  return work;
}

export function openMilestoneDB(name = dbName, version = SCHEMA_VERSION): Promise<DB> {
  return openDB<MilestoneDB>(name, version, {
    upgrade(db, oldVersion, _newVersion, tx) {
      // Promises run inside the upgrade transaction; it stays open while they have pending requests.
      void Promise.all(upgradeSteps(db, oldVersion, tx));
    },
    blocking() {
      // Another tab is upgrading: close so it can proceed, then reopen lazily.
      dbPromise?.then((d) => d.close());
      dbPromise = null;
    },
  });
}

export function getDB(): Promise<DB> {
  if (!dbPromise) dbPromise = openMilestoneDB();
  return dbPromise;
}

/** Tests and "delete all data" use this to switch or reset databases. */
export async function resetDBConnection(name?: string): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
  if (name) dbName = name;
}

export async function deleteDatabase(): Promise<void> {
  await resetDBConnection();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
