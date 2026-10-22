import { useEffect, useState } from 'react';
import { bump, showToast, useOnline } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Notice, Sheet, TextInput, Toggle } from '../../components/ui';
import { getSyncConfig, checkSetup, disconnectSync, saveSetup, syncNow, useSyncStatus, type SetupCheck, type SetupInput, type SyncConfig } from '../../sync/sync';

export function timeAgo(iso?: string): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Small status + button used on the dashboard. */
export function SyncBadge() {
  const st = useSyncStatus();
  const online = useOnline();
  if (st.state === 'off') return null;
  return (
    <button
      className="chip"
      style={{ marginBottom: 12 }}
      onClick={() => syncNow().catch((e: unknown) => showToast(e instanceof Error ? e.message : String(e)))}
      aria-label="Sync with family now"
    >
      <Icon name="refresh" size={16} />
      {st.state === 'syncing' ? 'Syncing…' : st.state === 'error' ? 'Sync problem — tap to retry' : !online ? 'Offline — will sync later' : `Family sync: ${timeAgo(st.lastSyncedAt)}`}
    </button>
  );
}

export function FamilySync() {
  const [cfg, setCfg] = useState<SyncConfig>();
  const [setupOpen, setSetupOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const st = useSyncStatus();
  const online = useOnline();
  useEffect(() => {
    void getSyncConfig().then(setCfg);
  }, [st.state, setupOpen]);

  return (
    <section className="section">
      <div className="section-head">
        <h2>Family sync</h2>
      </div>
      {!cfg ? (
        <>
          <p className="small mt0">
            Share trips, checklists, inventory and history between your phone and your partner’s. Each phone keeps working offline; changes sync through a <strong>private GitHub repository</strong> when online. Data is encrypted on the phone with a family passphrase before it is uploaded, so GitHub stores only scrambled data.
          </p>
          <button className="btn btn--primary" onClick={() => setSetupOpen(true)} disabled={!online}>
            <Icon name="users" /> Set up family sync
          </button>
          {!online && <p className="muted small">Connect to the internet to set up sync.</p>}
        </>
      ) : (
        <div className="card card--pad">
          <dl className="kv">
            <dt>Repository</dt>
            <dd>
              {cfg.owner}/{cfg.repo} (private)
            </dd>
            <dt>This phone</dt>
            <dd>{cfg.deviceName}</dd>
            <dt>Last synced</dt>
            <dd>{timeAgo(cfg.lastSyncedAt)}</dd>
            <dt>Status</dt>
            <dd>{st.state === 'syncing' ? 'Syncing…' : st.state === 'error' ? st.message : !online ? 'Offline — syncs when connected' : 'Up to date when last checked'}</dd>
          </dl>
          <p className="muted small">Syncs automatically when the app opens, when you come back online, and shortly after changes. Both phones editing the same item: the most recent edit wins.</p>
          <div className="row-actions">
            <button
              className="btn btn--primary"
              disabled={!online || st.state === 'syncing'}
              onClick={async () => {
                try {
                  const r = await syncNow();
                  showToast(r.pulled || r.pushed ? 'Synced with your family.' : 'Already up to date.');
                } catch (e) {
                  showToast(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              <Icon name="refresh" /> Sync now
            </button>
            <button className="btn btn--danger" onClick={() => setConfirmStop(true)}>
              Stop syncing on this phone
            </button>
          </div>
        </div>
      )}
      {setupOpen && <SetupSheet onClose={() => setSetupOpen(false)} />}
      {confirmStop && (
        <Sheet title="Stop syncing on this phone?" onClose={() => setConfirmStop(false)}>
          <p>This phone keeps all its data but stops sending and receiving changes. The access token and passphrase are removed from this phone. The shared file on GitHub and the other phone are not affected.</p>
          <div className="row-actions">
            <button className="btn" onClick={() => setConfirmStop(false)}>
              Keep syncing
            </button>
            <button
              className="btn btn--danger"
              onClick={async () => {
                await disconnectSync();
                setCfg(undefined);
                setConfirmStop(false);
                showToast('Sync stopped on this phone.');
              }}
            >
              Stop syncing
            </button>
          </div>
        </Sheet>
      )}
    </section>
  );
}

function SetupSheet({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState<SetupInput>({ owner: '', repo: 'milestone-family-data', token: '', passphrase: '', deviceName: '', branch: 'main', path: 'milestone-family.json' });
  const [show, setShow] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState<SetupCheck>();
  const set = (p: Partial<SetupInput>) => {
    setF((x) => ({ ...x, ...p }));
    setCheck(undefined);
  };

  const runCheck = async () => {
    setError('');
    if (!f.owner.trim() || !f.repo.trim() || !f.token.trim()) return setError('Fill in the GitHub username, repository and token.');
    setBusy(true);
    try {
      setCheck(await checkSetup(f));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async (first: 'join' | 'combine') => {
    setBusy(true);
    setError('');
    try {
      await saveSetup(f);
      await syncNow({ first });
      bump();
      showToast(first === 'join' ? 'This phone now has your family’s shared data.' : 'Family sync is on.');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Set up family sync" onClose={onClose}>
      <ol className="small" style={{ paddingLeft: 18, marginTop: 0 }}>
        <li>On GitHub, create a new <strong>private</strong> repository (for example “milestone-family-data”). Leave it empty.</li>
        <li>
          Create a <strong>fine-grained personal access token</strong>: Settings → Developer settings → Personal access tokens → Fine-grained. Repository access: only that repository. Permissions: <em>Contents: Read and write</em>. Make one token for each phone.
        </li>
        <li>Choose a family passphrase and use the same one on both phones. Keep it somewhere safe — without it the shared data cannot be read.</li>
      </ol>
      {error && (
        <Notice kind="safety">
          <p>{error}</p>
        </Notice>
      )}
      <TextInput label="GitHub username" value={f.owner} onChange={(v) => set({ owner: v })} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <TextInput label="Private repository name" value={f.repo} onChange={(v) => set({ repo: v })} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <TextInput label="Access token" type={show ? 'text' : 'password'} value={f.token} onChange={(v) => set({ token: v })} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" hint="Stored only on this phone." />
      <TextInput label="Family passphrase" type={show ? 'text' : 'password'} value={f.passphrase} onChange={(v) => set({ passphrase: v })} autoComplete="new-password" hint="At least 10 characters. Same on both phones." />
      <Toggle label="Show token and passphrase" checked={show} onChange={setShow} />
      <TextInput label="Name for this phone" placeholder="e.g. Tushar’s phone" value={f.deviceName} onChange={(v) => set({ deviceName: v })} hint="Appears in the repository’s history." />
      <Toggle label="Advanced" checked={advanced} onChange={setAdvanced} />
      {advanced && (
        <div className="two-col">
          <TextInput label="Branch" value={f.branch ?? 'main'} onChange={(v) => set({ branch: v })} />
          <TextInput label="File" value={f.path ?? ''} onChange={(v) => set({ path: v })} />
        </div>
      )}
      {!check ? (
        <button className="btn btn--primary btn--block" onClick={runCheck} disabled={busy}>
          {busy ? 'Checking…' : 'Check connection'}
        </button>
      ) : check.remoteExists ? (
        <>
          <Notice>
            <p>
              Connected. The repository already has your family’s data (last written by {check.remoteWrittenBy ?? 'another phone'}, {timeAgo(check.remoteWrittenAt)}).
            </p>
          </Notice>
          <ul className="list card">
            <li>
              <button className="list-link" onClick={() => void start('join')} disabled={busy}>
                <span className="list-link__body">
                  <span className="list-link__title">Use the shared family data on this phone</span>
                  <span className="list-link__meta">Recommended for the second phone. Replaces this phone’s trips, profiles and inventory with the shared ones. Map downloads stay.</span>
                </span>
              </button>
            </li>
            <li>
              <button className="list-link" onClick={() => void start('combine')} disabled={busy}>
                <span className="list-link__body">
                  <span className="list-link__title">Combine with this phone’s data</span>
                  <span className="list-link__meta">Keeps both. Profiles created separately on each phone will appear twice — delete the duplicates afterwards.</span>
                </span>
              </button>
            </li>
          </ul>
        </>
      ) : (
        <>
          <Notice>
            <p>Connected. The repository is private and empty, so this phone’s data will be the starting point.</p>
          </Notice>
          <button className="btn btn--primary btn--block" onClick={() => void start('combine')} disabled={busy}>
            {busy ? 'Uploading…' : 'Start family sync'}
          </button>
        </>
      )}
    </Sheet>
  );
}
