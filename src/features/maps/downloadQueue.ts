import { useSyncExternalStore } from 'react';
import { bump } from '../../app/store';
import type { MapAssetKind } from '../../types';
import { downloadAsset, type ProgressEvent } from './downloader';
import { getRegion } from './regionStore';

/**
 * Runs region downloads while the app is open. Browsers (especially iOS)
 * suspend pages in the background, so progress is saved after every block
 * and an interrupted download resumes from there.
 */
interface Job {
  regionId: string;
  controller: AbortController;
  current?: MapAssetKind;
  progress?: ProgressEvent;
  error?: string;
}

const jobs = new Map<string, Job>();
const listeners = new Set<() => void>();
let snapshot: Job[] = [];
const emit = () => {
  snapshot = [...jobs.values()].map((j) => ({ ...j }));
  listeners.forEach((l) => l());
};

export function useDownloads(): Job[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

export function isRunning(regionId: string) {
  return jobs.has(regionId);
}

export async function startDownload(regionId: string, kinds: MapAssetKind[] = ['tiles', 'poi', 'graph']): Promise<void> {
  if (jobs.has(regionId)) return;
  const job: Job = { regionId, controller: new AbortController() };
  jobs.set(regionId, job);
  emit();
  try {
    let lastEmit = 0;
    for (const kind of kinds) {
      const r = await getRegion(regionId);
      const a = r?.assets[kind];
      if (!a?.url || a.status === 'ready') continue;
      job.current = kind;
      emit();
      await downloadAsset({
        regionId,
        kind,
        signal: job.controller.signal,
        onProgress: (e) => {
          job.progress = e;
          const now = Date.now();
          if (now - lastEmit > 250 || e.done === e.total) {
            lastEmit = now;
            emit();
          }
        },
      });
      bump();
    }
  } catch (e) {
    job.error = e instanceof Error ? e.message : String(e);
  } finally {
    jobs.delete(regionId);
    emit();
    bump();
  }
}

export function pauseDownload(regionId: string) {
  jobs.get(regionId)?.controller.abort();
}
