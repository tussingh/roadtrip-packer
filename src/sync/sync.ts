import { useSyncExternalStore } from 'react';
import { bump, onDataChange } from '../app/store';
import { Sha256 } from '../features/maps/sha256';
import { exportBackup, importBackup } from '../storage/backup';
import { getDB } from '../storage/db';
import { decrypt, encrypt, type Envelope } from './crypto';
import { checkRepo, GitHubError, readFile, writeFile, type RepoTarget } from './github';

/**
 * Optional family sync through a PRIVATE GitHub repository.
 * Each phone keeps its full local database and works offline; syncing pulls
 * the shared encrypted file, merges it record by record (newest edit wins,
 * deletions propagate), then pushes the merged result.
 */
export interface SyncConfig extends RepoTarget {
  id: 'sync';
  passphrase: string;
  deviceName: string;
  lastSyncedAt?: string;
  lastSha?: string;
  lastPushedHash?: string;
}

export type SyncStatus = { state: 'off' | 'idle' | 'syncing' | 'error'; message?: string; lastSyncedAt?: string };

let status: SyncStatus = { state: 'off' };
const listeners = new Set<() => void>();
function setStatus(s: SyncStatus) {
  status = s;
  listeners.forEach((l) => l());
}
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

export async function getSyncConfig(): Promise<SyncConfig | undefined> {
  return (await (await getDB()).get('device', 'sync')) as SyncConfig | undefined;
}

async function putSyncConfig(c: SyncConfig) {
  await (await getDB()).put('device', c as never);
}

export async function disconnectSync(): Promise<void> {
  await (await getDB()).delete('device', 'sync');
  setStatus({ state: 'off' });
}

function hashOf(s: string) {
  return new Sha256().update(new TextEncoder().encode(s)).digestHex();
}

/** Stable fingerprint of shareable data (ignores the export timestamp). */
async function snapshot(): Promise<{ json: string; hash: string }> {
  const b = await exportBackup();
  const { exportedAt: _ignored, ...rest } = b;
  void _ignored;
  const settings = { ...(rest.data.settings as Record<string, unknown>), lastBackupAt: undefined, theme: undefined };
  const stable = JSON.stringify({ ...rest, data: { ...rest.data, settings } });
  return { json: JSON.stringify(b), hash: hashOf(stable) };
}

export interface SetupInput {
  owner: string;
  repo: string;
  branch?: string;
  path?: string;
  token: string;
  passphrase: string;
  deviceName: string;
}

export interface SetupCheck {
  remoteExists: boolean;
  remoteWrittenBy?: string;
  remoteWrittenAt?: string;
}

/** Validates repository, token and passphrase before saving anything. */
export async function checkSetup(input: SetupInput, f: typeof fetch = fetch): Promise<SetupCheck> {
  const t = targetOf(input);
  if (input.passphrase.length < 10) throw new Error('Use a family passphrase of at least 10 characters. Both phones must use the same one.');
  const info = await checkRepo(t, f);
  if (!info.private) throw new Error('This repository is public. Family data must go in a PRIVATE repository — make it private or create a new private one.');
  if (!info.canPush) throw new Error('The token cannot write to this repository.');
  const remote = await readFile(t, f);
  if (!remote) return { remoteExists: false };
  const env = JSON.parse(remote.text) as Envelope;
  await decrypt(env, input.passphrase); // throws WrongPassphraseError
  return { remoteExists: true, remoteWrittenBy: env.writtenBy, remoteWrittenAt: env.writtenAt };
}

function targetOf(i: SetupInput): RepoTarget {
  return {
    owner: i.owner.trim(),
    repo: i.repo.trim(),
    branch: (i.branch ?? 'main').trim() || 'main',
    path: (i.path ?? 'milestone-family.json').trim() || 'milestone-family.json',
    token: i.token.trim(),
  };
}

export async function saveSetup(input: SetupInput): Promise<SyncConfig> {
  const c: SyncConfig = { id: 'sync', ...targetOf(input), passphrase: input.passphrase, deviceName: input.deviceName.trim() || 'Phone' };
  await putSyncConfig(c);
  setStatus({ state: 'idle' });
  return c;
}

export interface SyncResult {
  pulled: boolean;
  pushed: boolean;
  changedLocally: boolean;
}

let running: Promise<SyncResult> | null = null;

/**
 * @param first 'join' replaces this phone's data with the shared file (use on
 *        the second phone); 'combine' merges both. Later syncs always merge.
 */
export function syncNow(opts: { first?: 'join' | 'combine'; fetchImpl?: typeof fetch } = {}): Promise<SyncResult> {
  if (running) return running;
  running = doSync(opts).finally(() => {
    running = null;
  });
  return running;
}

async function doSync({ first, fetchImpl = fetch }: { first?: 'join' | 'combine'; fetchImpl?: typeof fetch }): Promise<SyncResult> {
  const cfg = await getSyncConfig();
  if (!cfg) throw new Error('Family sync is not set up on this phone.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus({ state: 'idle', lastSyncedAt: cfg.lastSyncedAt, message: 'Offline — will sync when connected' });
    return { pulled: false, pushed: false, changedLocally: false };
  }
  setStatus({ state: 'syncing', lastSyncedAt: cfg.lastSyncedAt });
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = await snapshot();
      const remote = await readFile(cfg, fetchImpl);
      let pulled = false;
      if (remote && remote.sha !== cfg.lastSha) {
        const plain = await decrypt(JSON.parse(remote.text) as Envelope, cfg.passphrase);
        const report = await importBackup(plain, first === 'join' && attempt === 0 ? 'replace' : 'merge', { sync: true });
        if (!report.ok) throw new Error(`The shared file could not be merged: ${report.errors.join(' ')}`);
        pulled = true;
      }
      const after = await snapshot();
      const changedLocally = after.hash !== before.hash;
      if (changedLocally) bump();
      // No unpushed edits on this phone: the shared file already has everything we have.
      const localDirty = before.hash !== cfg.lastPushedHash;
      if (remote && !localDirty) {
        const done = { ...cfg, lastSha: remote.sha, lastPushedHash: after.hash, lastSyncedAt: new Date().toISOString() };
        await putSyncConfig(done);
        setStatus({ state: 'idle', lastSyncedAt: done.lastSyncedAt });
        return { pulled, pushed: false, changedLocally };
      }
      const env = await encrypt(after.json, cfg.passphrase, cfg.deviceName);
      try {
        const sha = await writeFile(cfg, JSON.stringify(env), remote?.sha, `Sync from ${cfg.deviceName}`, fetchImpl);
        const done = { ...cfg, lastSha: sha, lastPushedHash: after.hash, lastSyncedAt: new Date().toISOString() };
        await putSyncConfig(done);
        setStatus({ state: 'idle', lastSyncedAt: done.lastSyncedAt });
        return { pulled, pushed: true, changedLocally };
      } catch (e) {
        if (e instanceof GitHubError && e.status === 409) {
          cfg.lastSha = undefined; // force a fresh pull and merge
          continue;
        }
        throw e;
      }
    }
    throw new Error('Both phones kept writing at the same moment. Try again in a few seconds.');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    setStatus({ state: 'error', message, lastSyncedAt: cfg.lastSyncedAt });
    throw e;
  }
}

/* ---------------- automatic sync ---------------- */

let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;

/** Sync on launch, when the connection returns, and 15 s after local edits. */
export function startAutoSync() {
  if (started) return;
  started = true;
  const kick = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!(await getSyncConfig())) return;
      if (running) return kick(5000);
      syncNow().catch(() => undefined);
    }, delay);
  };
  void getSyncConfig().then((c) => {
    if (c) {
      setStatus({ state: 'idle', lastSyncedAt: c.lastSyncedAt });
      kick(500);
    }
  });
  window.addEventListener('online', () => kick(1000));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kick(1000);
  });
  onDataChange(() => {
    if (!running && status.state !== 'off') kick(15000);
  });
}
