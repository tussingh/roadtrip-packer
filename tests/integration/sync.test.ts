import { afterEach, describe, expect, it } from 'vitest';
import { regenerateTrip } from '../../src/app/tripService';
import { blankTrip } from '../../src/data/defaults';
import { decrypt, encrypt } from '../../src/sync/crypto';
import { checkSetup, saveSetup, syncNow, type SetupInput } from '../../src/sync/sync';
import { deleteDatabase, resetDBConnection } from '../../src/storage/db';
import {
  deleteInventoryItem,
  deleteTrip,
  ensureSeeded,
  getChecklist,
  listInventory,
  listProfiles,
  listTrips,
  putChecklistItems,
  saveInventoryItem,
  saveTrip,
} from '../../src/storage/repo';
import type { Trip } from '../../src/types';

/** In-memory stand-in for the parts of the GitHub REST API the app uses. */
function fakeGitHub(opts: { private?: boolean } = {}) {
  const files = new Map<string, { text: string; sha: string }>();
  let n = 0;
  let conflictsToInject = 0;
  const calls = { put: 0, get: 0 };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get('Authorization');
    if (auth !== 'Bearer good-token') return new Response('{"message":"Bad credentials"}', { status: 401 });
    const m = /^\/repos\/([^/]+)\/([^/]+)(?:\/contents\/(.+))?$/.exec(url.pathname);
    if (!m) return new Response('{}', { status: 404 });
    if (!m[3]) return Response.json({ private: opts.private ?? true, permissions: { push: true } });
    const path = decodeURIComponent(m[3]);
    if ((init?.method ?? 'GET') === 'GET') {
      calls.get++;
      const f = files.get(path);
      if (!f) return new Response('{"message":"Not Found"}', { status: 404 });
      return Response.json({ sha: f.sha, size: f.text.length, encoding: 'base64', content: Buffer.from(f.text).toString('base64') });
    }
    calls.put++;
    const body = JSON.parse(String(init!.body)) as { content: string; sha?: string };
    const cur = files.get(path);
    if (conflictsToInject > 0) {
      conflictsToInject--;
      return new Response('{"message":"conflict"}', { status: 409 });
    }
    if ((cur && body.sha !== cur.sha) || (!cur && body.sha)) return new Response('{"message":"sha mismatch"}', { status: 409 });
    const sha = `sha${++n}`;
    files.set(path, { text: Buffer.from(body.content, 'base64').toString(), sha });
    return Response.json({ content: { sha } });
  }) as typeof fetch;
  return { fetchImpl, files, calls, injectConflict: (k = 1) => (conflictsToInject = k) };
}

const SETUP: Omit<SetupInput, 'deviceName'> = { owner: 'family', repo: 'milestone-family-data', token: 'good-token', passphrase: 'mango lassi at kodagu' };
const TODAY = new Date('2026-10-22T09:00:00');

const opened = new Map<string, string>();
/** Switch to (or create) a separate local database standing in for one phone. */
async function phone(name: string) {
  if (!opened.has(name)) opened.set(name, `sync-${name}-${Date.now()}-${Math.random()}`);
  await resetDBConnection(opened.get(name));
}

afterEach(async () => {
  for (const name of opened.keys()) {
    await phone(name);
    await deleteDatabase();
  }
  opened.clear();
});

describe('encryption', () => {
  it('round-trips, compresses, and rejects a wrong passphrase', async () => {
    const plain = JSON.stringify({ child: 'Daughter', born: '2025-02-15', pad: 'x'.repeat(5000) });
    const env = await encrypt(plain, 'correct horse battery', 'test');
    expect(env.data).not.toContain('Daughter');
    expect(env.compression).toBe('gzip');
    expect(env.data.length).toBeLessThan(plain.length);
    expect(await decrypt(env, 'correct horse battery')).toBe(plain);
    await expect(decrypt(env, 'wrong passphrase!!')).rejects.toThrow(/passphrase does not match/);
  });
});

describe('family sync between two phones', () => {
  it('shares trips and ticks both ways, propagates deletions, and never uploads readable data', async () => {
    const gh = fakeGitHub();
    const f = gh.fetchImpl;

    // ---- My phone: plan a trip, start sync
    await phone('me');
    await ensureSeeded(TODAY);
    const ids = (await listProfiles()).map((p) => p.id);
    const trip: Trip = { ...blankTrip(ids), name: 'Coorg', startDate: '2026-11-06', days: 3, nights: 2, totalKm: 540, drivingDays: 2 };
    await saveTrip(trip);
    await regenerateTrip(trip.id, TODAY);
    await saveInventoryItem({ id: 'inv-diapers', name: 'Diapers', ruleId: 'child-diapers', qty: 40, unit: 'diapers', location: 'Cupboard', needsReplenish: false, assignedTo: 'shared', forgottenCount: 0, notes: '', updatedAt: '' });
    expect((await checkSetup({ ...SETUP, deviceName: 'Me' }, f)).remoteExists).toBe(false);
    await saveSetup({ ...SETUP, deviceName: 'Me' });
    expect(await syncNow({ first: 'combine', fetchImpl: f })).toMatchObject({ pushed: true });
    const stored = [...gh.files.values()][0].text;
    expect(stored).not.toMatch(/Coorg|Daughter|Diapers/);
    const myIds = { profiles: (await listProfiles()).map((p) => p.id).sort() };

    // ---- Wife's phone: fresh install has its own starter family; joins and gets ours
    await phone('wife');
    await ensureSeeded(TODAY);
    const check = await checkSetup({ ...SETUP, deviceName: 'Wife' }, f);
    expect(check).toMatchObject({ remoteExists: true, remoteWrittenBy: 'Me' });
    await saveSetup({ ...SETUP, deviceName: 'Wife' });
    await syncNow({ first: 'join', fetchImpl: f });
    expect((await listTrips()).map((t) => t.name)).toEqual(['Coorg']);
    expect((await listProfiles()).map((p) => p.id).sort()).toEqual(myIds.profiles); // no duplicate family
    const wifeItems = await getChecklist(trip.id);
    expect(wifeItems.length).toBeGreaterThan(50);

    // She packs the first two items and removes the inventory entry.
    const later = new Date(Date.now() + 1000).toISOString();
    await putChecklistItems(wifeItems.slice(0, 2).map((i) => ({ ...i, packed: true, updatedAt: later })));
    await deleteInventoryItem('inv-diapers');
    await syncNow({ fetchImpl: f });

    // ---- My phone, meanwhile, packed item #3 offline, before hearing about her changes
    await phone('me');
    const mineBefore = await getChecklist(trip.id);
    const third = mineBefore.find((i) => i.id === wifeItems[2].id)!;
    await putChecklistItems([{ ...third, packed: true, updatedAt: new Date(Date.now() + 2000).toISOString() }]);
    await syncNow({ fetchImpl: f });
    const mine = await getChecklist(trip.id);
    const expected = [...wifeItems.slice(0, 3).map((i) => i.id)].sort();
    expect(mine.filter((i) => i.packed).map((i) => i.id).sort()).toEqual(expected); // both phones' ticks
    expect(await listInventory()).toEqual([]); // her deletion arrived

    // ---- Her phone picks up my tick
    await phone('wife');
    await syncNow({ fetchImpl: f });
    expect((await getChecklist(trip.id)).filter((i) => i.packed).map((i) => i.id).sort()).toEqual(expected);
    const putsBefore = gh.calls.put;
    await syncNow({ fetchImpl: f });
    await phone('me');
    await syncNow({ fetchImpl: f });
    // Nothing changed: sync reads but does not write a new commit.
    await syncNow({ fetchImpl: f });
    expect(gh.calls.put).toBe(putsBefore);
  });

  it('merges concurrent edits made offline on both phones', async () => {
    const gh = fakeGitHub();
    const f = gh.fetchImpl;
    await phone('a');
    await ensureSeeded(TODAY);
    const trip: Trip = { ...blankTrip((await listProfiles()).map((p) => p.id)), name: 'Gokarna', days: 3, nights: 2, totalKm: 900, drivingDays: 2 };
    await saveTrip(trip);
    await regenerateTrip(trip.id, TODAY);
    await saveSetup({ ...SETUP, deviceName: 'A' });
    await syncNow({ first: 'combine', fetchImpl: f });
    const fileAfterA = new Map(gh.files);

    await phone('b');
    await saveSetup({ ...SETUP, deviceName: 'B' });
    await syncNow({ first: 'join', fetchImpl: f });
    const items = await getChecklist(trip.id);
    // B ticks item 0 and edits quantity of item 1, then syncs.
    const t1 = new Date(Date.now() + 1000).toISOString();
    await putChecklistItems([{ ...items[0], packed: true, updatedAt: t1 }, { ...items[1], userQty: 9, updatedAt: t1 }]);
    gh.injectConflict(1); // the other phone writes at the same moment once
    await syncNow({ fetchImpl: f });
    expect(gh.files.size).toBe(1);
    expect(fileAfterA).not.toEqual(gh.files);

    // B then regenerates (both phones produce identical ids → no duplicates after merge)
    await regenerateTrip(trip.id, TODAY);
    await syncNow({ fetchImpl: f });
    const keys = (await getChecklist(trip.id)).map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('deleting a trip on one phone removes it and its items on the other', async () => {
    const gh = fakeGitHub();
    const f = gh.fetchImpl;
    await phone('x');
    await ensureSeeded(TODAY);
    const trip: Trip = { ...blankTrip((await listProfiles()).map((p) => p.id)), name: 'Ooty', days: 2, nights: 1, totalKm: 560, drivingDays: 2 };
    await saveTrip(trip);
    await regenerateTrip(trip.id, TODAY);
    await saveSetup({ ...SETUP, deviceName: 'X' });
    await syncNow({ first: 'combine', fetchImpl: f });
    await new Promise((r) => setTimeout(r, 5));
    await deleteTrip(trip.id);
    await syncNow({ fetchImpl: f });

    await phone('y');
    await saveSetup({ ...SETUP, deviceName: 'Y' });
    await syncNow({ first: 'combine', fetchImpl: f });
    expect(await listTrips()).toEqual([]);
    expect(await getChecklist(trip.id)).toEqual([]);
  });

  it('refuses public repositories, bad tokens and a wrong passphrase', async () => {
    await phone('z');
    await expect(checkSetup({ ...SETUP, deviceName: 'Z' }, fakeGitHub({ private: false }).fetchImpl)).rejects.toThrow(/public/);
    await expect(checkSetup({ ...SETUP, token: 'nope', deviceName: 'Z' }, fakeGitHub().fetchImpl)).rejects.toThrow(/token/);
    await expect(checkSetup({ ...SETUP, passphrase: 'short', deviceName: 'Z' }, fakeGitHub().fetchImpl)).rejects.toThrow(/10 characters/);
    const gh = fakeGitHub();
    await ensureSeeded(TODAY);
    await saveSetup({ ...SETUP, deviceName: 'Z' });
    await syncNow({ first: 'combine', fetchImpl: gh.fetchImpl });
    await phone('z2');
    await expect(checkSetup({ ...SETUP, passphrase: 'a different family passphrase', deviceName: 'Z2' }, gh.fetchImpl)).rejects.toThrow(/passphrase does not match/);
  });
});
