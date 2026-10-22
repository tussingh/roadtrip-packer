import type { RangeResponse, Source } from 'pmtiles';
import type { MapAssetKind } from '../../types';
import { getChunk } from './regionStore';

/**
 * PMTiles `Source` that reads byte ranges from chunks stored in IndexedDB.
 * This is what makes the map work with no network: MapLibre asks PMTiles for
 * a tile, PMTiles asks us for bytes, we read them from the device.
 */
export class IdbChunkSource implements Source {
  private cache = new Map<number, Promise<Uint8Array>>();
  private readonly maxCached: number;

  constructor(
    private readonly regionId: string,
    private readonly totalBytes: number,
    private readonly chunkSize: number,
    private readonly kind: MapAssetKind = 'tiles',
    private readonly read: (regionId: string, kind: MapAssetKind, i: number) => Promise<ArrayBuffer | undefined> = getChunk,
    maxCachedChunks = 12,
  ) {
    this.maxCached = maxCachedChunks;
  }

  getKey(): string {
    return `idb://${this.regionId}`;
  }

  private chunk(i: number): Promise<Uint8Array> {
    const hit = this.cache.get(i);
    if (hit) {
      // refresh LRU position
      this.cache.delete(i);
      this.cache.set(i, hit);
      return hit;
    }
    const p = this.read(this.regionId, this.kind, i).then((buf) => {
      if (!buf) {
        this.cache.delete(i);
        throw new Error(`Offline map data is incomplete (chunk ${i} missing). Re-download this region.`);
      }
      return new Uint8Array(buf);
    });
    this.cache.set(i, p);
    while (this.cache.size > this.maxCached) {
      const oldest = this.cache.keys().next().value as number;
      this.cache.delete(oldest);
    }
    return p;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const start = Math.max(0, offset);
    const end = Math.min(this.totalBytes, offset + length); // PMTiles over-reads the header: clamp at EOF
    if (end <= start) return { data: new ArrayBuffer(0) };
    const out = new Uint8Array(end - start);
    const first = Math.floor(start / this.chunkSize);
    const last = Math.floor((end - 1) / this.chunkSize);
    const parts = await Promise.all(Array.from({ length: last - first + 1 }, (_, k) => this.chunk(first + k)));
    let written = 0;
    for (let k = 0; k < parts.length; k++) {
      const chunkStart = (first + k) * this.chunkSize;
      const from = Math.max(start, chunkStart) - chunkStart;
      const to = Math.min(end, chunkStart + parts[k].length) - chunkStart;
      out.set(parts[k].subarray(from, to), written);
      written += to - from;
    }
    return { data: out.buffer };
  }
}
