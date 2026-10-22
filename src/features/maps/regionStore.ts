import { getDB, type MapChunk } from '../../storage/db';
import type { MapAssetKind, MapAssetState, MapRegion } from '../../types';

export const CHUNK_SIZE = 1024 * 1024; // 1 MiB per stored chunk

export async function listRegions(): Promise<MapRegion[]> {
  return (await getDB()).getAll('mapRegions');
}

export async function getRegion(id: string): Promise<MapRegion | undefined> {
  return (await getDB()).get('mapRegions', id);
}

export async function saveRegion(r: MapRegion): Promise<void> {
  await (await getDB()).put('mapRegions', { ...r, updatedAt: new Date().toISOString() });
}

export async function updateAsset(regionId: string, kind: MapAssetKind, patch: Partial<MapAssetState>): Promise<MapRegion> {
  const db = await getDB();
  const tx = db.transaction('mapRegions', 'readwrite');
  const r = await tx.store.get(regionId);
  if (!r) throw new Error(`Region ${regionId} not found`);
  const prev = r.assets[kind] ?? {
    kind, bytes: 0, chunkSize: CHUNK_SIZE, chunksDone: 0, status: 'absent', verified: false, source: 'download', updatedAt: '',
  };
  r.assets[kind] = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  const allReady = Object.values(r.assets).every((a) => a?.status === 'ready');
  if (allReady && !r.installedAt) r.installedAt = new Date().toISOString();
  if (!allReady) r.installedAt = undefined;
  r.updatedAt = new Date().toISOString();
  await tx.store.put(r);
  await tx.done;
  return r;
}

export async function putChunks(chunks: MapChunk[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('mapChunks', 'readwrite');
  for (const c of chunks) await tx.store.put(c);
  await tx.done;
}

export async function getChunk(regionId: string, kind: MapAssetKind, index: number): Promise<ArrayBuffer | undefined> {
  const c = await (await getDB()).get('mapChunks', [regionId, kind, index]);
  return c?.data;
}

export async function countChunks(regionId: string, kind: MapAssetKind): Promise<number> {
  return (await getDB()).countFromIndex('mapChunks', 'asset', [regionId, kind]);
}

export async function deleteAssetChunks(regionId: string, kind: MapAssetKind): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('mapChunks', 'readwrite');
  const range = IDBKeyRange.bound([regionId, kind, 0], [regionId, kind, Number.MAX_SAFE_INTEGER]);
  await tx.store.delete(range);
  await tx.done;
}

export async function deleteRegion(id: string): Promise<void> {
  for (const k of ['tiles', 'poi', 'graph'] as MapAssetKind[]) await deleteAssetChunks(id, k);
  await (await getDB()).delete('mapRegions', id);
}

/** Read a whole (small) asset into memory: POI index or road graph. */
export async function readAsset(regionId: string, kind: MapAssetKind): Promise<Uint8Array> {
  const r = await getRegion(regionId);
  const a = r?.assets[kind];
  if (!a || a.status !== 'ready') throw new Error(`${kind} data for this region is not installed`);
  const out = new Uint8Array(a.bytes);
  const n = Math.ceil(a.bytes / a.chunkSize);
  for (let i = 0; i < n; i++) {
    const c = await getChunk(regionId, kind, i);
    if (!c) throw new Error(`${kind} data is incomplete (chunk ${i} missing) — delete and download again`);
    out.set(new Uint8Array(c), i * a.chunkSize);
  }
  return out;
}

export async function regionBytes(r: MapRegion): Promise<number> {
  let total = 0;
  for (const a of Object.values(r.assets)) if (a) total += Math.min(a.bytes, a.chunksDone * a.chunkSize);
  return total;
}

export interface StorageInfo {
  usage?: number;
  quota?: number;
  persisted?: boolean;
}

export async function storageInfo(): Promise<StorageInfo> {
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!s?.estimate) return {};
  const est = await s.estimate();
  const persisted = s.persisted ? await s.persisted() : undefined;
  return { usage: est.usage, quota: est.quota, persisted };
}

export async function requestPersistence(): Promise<boolean> {
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!s?.persist) return false;
  return s.persist();
}
