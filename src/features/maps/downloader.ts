import type { MapChunk } from '../../storage/db';
import type { MapAssetKind, MapRegion } from '../../types';
import { Sha256 } from './sha256';
import { CHUNK_SIZE, deleteAssetChunks, getChunk, getRegion, putChunks, updateAsset } from './regionStore';

/** Chunks fetched per HTTP range request (8 MiB). Progress is saved after each block. */
const CHUNKS_PER_REQUEST = 8;

export interface ProgressEvent {
  regionId: string;
  kind: MapAssetKind;
  phase: 'downloading' | 'verifying';
  done: number;
  total: number;
}

export interface DownloadOptions {
  regionId: string;
  kind: MapAssetKind;
  signal?: AbortSignal;
  onProgress?: (e: ProgressEvent) => void;
  fetchImpl?: typeof fetch;
}

export class DownloadError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

function isAbort(e: unknown) {
  return e instanceof DOMException ? e.name === 'AbortError' : (e as { name?: string })?.name === 'AbortError';
}

/**
 * Download (or resume) one asset of a region into IndexedDB using HTTP range
 * requests. Interrupted downloads resume from the last completed block. If
 * the server reports a different file (ETag change via If-Range → 200), the
 * download restarts cleanly rather than mixing two versions.
 */
export async function downloadAsset(opts: DownloadOptions): Promise<MapRegion> {
  const { regionId, kind, signal, onProgress } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const region = await getRegion(regionId);
  const asset = region?.assets[kind];
  if (!region || !asset?.url) throw new DownloadError('Nothing to download for this region.', false);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new DownloadError('You are offline. Connect to the internet to download map data.', true);
  }
  const total = asset.bytes;
  const chunkSize = asset.chunkSize || CHUNK_SIZE;
  const chunkCount = Math.ceil(total / chunkSize);
  let done = Math.min(asset.chunksDone, chunkCount);
  let etag = asset.etag;
  await updateAsset(regionId, kind, { status: 'downloading', error: undefined, chunkSize });

  try {
    while (done < chunkCount) {
      if (signal?.aborted) throw new DOMException('Paused', 'AbortError');
      const first = done;
      const lastChunk = Math.min(chunkCount, first + CHUNKS_PER_REQUEST) - 1;
      const start = first * chunkSize;
      const end = Math.min(total, (lastChunk + 1) * chunkSize) - 1;
      const headers: Record<string, string> = { Range: `bytes=${start}-${end}` };
      if (etag && first > 0) headers['If-Range'] = etag;
      let res: Response;
      try {
        res = await doFetch(asset.url, { headers, signal, cache: 'no-store' });
      } catch (e) {
        if (isAbort(e)) throw e;
        throw new DownloadError('Network connection lost. Progress is saved — resume when you are back online.', true);
      }
      if (res.status === 200) {
        if (first > 0) {
          // File changed on the server, or the server ignores ranges: start again from zero.
          await deleteAssetChunks(regionId, kind);
          done = 0;
          etag = res.headers.get('ETag') ?? undefined;
          await updateAsset(regionId, kind, { chunksDone: 0, etag });
          if (!res.body) throw new DownloadError('Server sent no data.', true);
          await res.body.cancel();
          continue;
        }
        // Server without range support: stream the full body, chunk it as it arrives.
        await streamWhole(res, regionId, kind, chunkSize, total, (n) => {
          done = n;
          onProgress?.({ regionId, kind, phase: 'downloading', done: Math.min(total, n * chunkSize), total });
        });
        await updateAsset(regionId, kind, { chunksDone: chunkCount });
        done = chunkCount;
        break;
      }
      if (res.status !== 206) {
        throw new DownloadError(`Download failed (HTTP ${res.status}).`, res.status >= 500 || res.status === 429);
      }
      if (first === 0) etag = res.headers.get('ETag') ?? undefined;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length !== end - start + 1) {
        throw new DownloadError(`Server returned ${buf.length} bytes, expected ${end - start + 1}. Try again.`, true);
      }
      const chunks: MapChunk[] = [];
      for (let i = first; i <= lastChunk; i++) {
        const o = (i - first) * chunkSize;
        chunks.push({ regionId, kind, index: i, data: buf.slice(o, Math.min(buf.length, o + chunkSize)).buffer });
      }
      await putChunks(chunks);
      done = lastChunk + 1;
      await updateAsset(regionId, kind, { chunksDone: done, ...(etag ? { etag } : {}) });
      onProgress?.({ regionId, kind, phase: 'downloading', done: Math.min(total, done * chunkSize), total });
    }
  } catch (e) {
    if (isAbort(e)) {
      await updateAsset(regionId, kind, { status: 'paused' });
      throw e;
    }
    const msg = e instanceof Error ? e.message : String(e);
    await updateAsset(regionId, kind, { status: 'error', error: msg });
    throw e;
  }
  return verifyAsset(regionId, kind, onProgress);
}

async function streamWhole(
  res: Response,
  regionId: string,
  kind: MapAssetKind,
  chunkSize: number,
  total: number,
  progress: (chunksDone: number) => void,
) {
  if (!res.body) throw new DownloadError('Server sent no data.', true);
  const reader = res.body.getReader();
  let pending = new Uint8Array(chunkSize);
  let fill = 0;
  let index = 0;
  let received = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.length;
    let off = 0;
    while (off < value.length) {
      const take = Math.min(chunkSize - fill, value.length - off);
      pending.set(value.subarray(off, off + take), fill);
      fill += take;
      off += take;
      if (fill === chunkSize) {
        await putChunks([{ regionId, kind, index, data: pending.buffer }]);
        index++;
        progress(index);
        pending = new Uint8Array(chunkSize);
        fill = 0;
      }
    }
  }
  if (fill > 0) {
    await putChunks([{ regionId, kind, index, data: pending.slice(0, fill).buffer }]);
    index++;
  }
  if (received !== total) throw new DownloadError(`Received ${received} bytes but the manifest says ${total}.`, true);
  progress(index);
}

/** Checks completeness, size, format and (when published) SHA-256. */
export async function verifyAsset(regionId: string, kind: MapAssetKind, onProgress?: DownloadOptions['onProgress']): Promise<MapRegion> {
  const region = await getRegion(regionId);
  const asset = region?.assets[kind];
  if (!region || !asset) throw new DownloadError('Region not found.', false);
  await updateAsset(regionId, kind, { status: 'verifying' });
  const n = Math.ceil(asset.bytes / asset.chunkSize);
  const hash = new Sha256();
  let size = 0;
  let head: Uint8Array | undefined;
  for (let i = 0; i < n; i++) {
    const c = await getChunk(regionId, kind, i);
    if (!c) {
      const msg = `Data incomplete: part ${i + 1} of ${n} is missing. Resume or re-download.`;
      return updateAsset(regionId, kind, { status: 'error', error: msg, chunksDone: i, verified: false });
    }
    const u = new Uint8Array(c);
    if (i === 0) head = u.subarray(0, 16);
    if (i < n - 1 && u.length !== asset.chunkSize) {
      return updateAsset(regionId, kind, { status: 'error', error: `Part ${i + 1} has the wrong size.`, chunksDone: i, verified: false });
    }
    size += u.length;
    if (asset.sha256) hash.update(u);
    if (i % 16 === 0) onProgress?.({ regionId, kind, phase: 'verifying', done: size, total: asset.bytes });
  }
  if (size !== asset.bytes) {
    return updateAsset(regionId, kind, { status: 'error', error: `Size mismatch: stored ${size} bytes, expected ${asset.bytes}.`, verified: false });
  }
  const formatError = checkFormat(kind, head);
  if (formatError) return updateAsset(regionId, kind, { status: 'error', error: formatError, verified: false });
  if (asset.sha256) {
    const got = hash.digestHex();
    if (got !== asset.sha256.toLowerCase()) {
      await deleteAssetChunks(regionId, kind);
      return updateAsset(regionId, kind, { status: 'error', error: 'Checksum mismatch — the data was corrupted or changed. It has been removed; download again.', chunksDone: 0, verified: false });
    }
  }
  return updateAsset(regionId, kind, { status: 'ready', verified: Boolean(asset.sha256), chunksDone: n, error: undefined });
}

const MAGIC = { tiles: 'PMTiles', graph: 'MRG1' } as const;

export function checkFormat(kind: MapAssetKind, head?: Uint8Array): string | undefined {
  if (!head) return 'File is empty.';
  const text = new TextDecoder().decode(head);
  if (kind === 'tiles' && (!text.startsWith(MAGIC.tiles) || head[7] !== 3)) return 'Not a PMTiles v3 archive.';
  if (kind === 'graph' && !text.startsWith(MAGIC.graph)) return 'Not a Milestone road-graph file.';
  if (kind === 'poi' && !text.trimStart().startsWith('{')) return 'Not a Milestone places index (JSON expected).';
  return undefined;
}

/** Copy a file the user picked (e.g. downloaded on a laptop and AirDropped) into storage. */
export async function importAssetFile(regionId: string, kind: MapAssetKind, file: Blob, onProgress?: DownloadOptions['onProgress']): Promise<MapRegion> {
  const region = await getRegion(regionId);
  if (!region) throw new DownloadError('Region not found.', false);
  await deleteAssetChunks(regionId, kind);
  const prev = region.assets[kind];
  const sha256 = prev && prev.bytes === file.size ? prev.sha256 : undefined;
  await updateAsset(regionId, kind, { bytes: file.size, chunkSize: CHUNK_SIZE, chunksDone: 0, status: 'downloading', source: 'file-import', sha256, verified: false });
  const n = Math.ceil(file.size / CHUNK_SIZE);
  for (let i = 0; i < n; i += CHUNKS_PER_REQUEST) {
    const chunks: MapChunk[] = [];
    for (let j = i; j < Math.min(n, i + CHUNKS_PER_REQUEST); j++) {
      const data = await file.slice(j * CHUNK_SIZE, Math.min(file.size, (j + 1) * CHUNK_SIZE)).arrayBuffer();
      chunks.push({ regionId, kind, index: j, data });
    }
    await putChunks(chunks);
    const done = Math.min(n, i + CHUNKS_PER_REQUEST);
    await updateAsset(regionId, kind, { chunksDone: done });
    onProgress?.({ regionId, kind, phase: 'downloading', done: Math.min(file.size, done * CHUNK_SIZE), total: file.size });
  }
  return verifyAsset(regionId, kind, onProgress);
}
