import { useEffect, useRef, useState } from 'react';
import { bump, showToast, useQuery } from '../../app/store';
import { Icon } from '../../components/Icon';
import { downloadText, Notice, Segmented, Sheet, Stepper, TextInput, TopBar } from '../../components/ui';
import { localDateIso } from '../../data/defaults';
import { ASSUMPTION_DEFS, DEFAULT_ASSUMPTIONS, resolveAssumptions } from '../../rules/assumptions';
import { ENGINE_VERSION } from '../../rules/engine';
import { APP_VERSION, exportBackup, importBackup, markBackedUp, validateBackup, type ImportMode } from '../../storage/backup';
import { deleteDatabase, SCHEMA_VERSION } from '../../storage/db';
import { getSettings, saveSettings } from '../../storage/repo';
import type { Assumptions, Settings } from '../../types';
import { requestPersistence, storageInfo, type StorageInfo } from '../maps/regionStore';
import { FamilySync } from './FamilySync';

const mb = (b?: number) => (b === undefined ? '?' : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);

export function SettingsView() {
  const { data: settings } = useQuery(getSettings, []);
  const [s, setS] = useState<Settings>();
  const [storage, setStorage] = useState<StorageInfo>({});
  const [pending, setPending] = useState<{ text: string; summary: string }>();
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [wipe, setWipe] = useState(false);
  const [wipeText, setWipeText] = useState('');
  const [showAssumptions, setShowAssumptions] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

  useEffect(() => {
    if (settings) setS(settings);
  }, [settings]);
  useEffect(() => {
    void storageInfo().then(setStorage);
  }, []);
  if (!s) return <main className="page" aria-busy="true" />;

  const save = async (next: Settings) => {
    setS(next);
    await saveSettings(next);
    bump();
  };
  const a = resolveAssumptions(s.assumptions, {});

  const doExport = async () => {
    const backup = await exportBackup();
    downloadText(`milestone-backup-${localDateIso()}.json`, JSON.stringify(backup, null, 1));
    await markBackedUp();
    bump();
    showToast('Backup file saved. Keep a copy off this phone (email, cloud drive or computer).');
  };

  const onFile = async (f?: File) => {
    setImportErrors([]);
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) return setImportErrors(['That file is too large to be a Milestone backup.']);
    const text = await f.text();
    const v = validateBackup(text);
    if (!v.file) return setImportErrors(v.errors);
    const d = v.file.data;
    setPending({
      text,
      summary: `${d.trips.length} trips, ${d.checklist.length} checklist items, ${d.profiles.length} profiles, ${d.inventory.length} inventory items, ${d.reviews.length} reviews — exported ${new Date(v.file.exportedAt).toLocaleString()}.`,
    });
  };

  const doImport = async (mode: ImportMode) => {
    if (!pending) return;
    const r = await importBackup(pending.text, mode);
    setPending(undefined);
    if (!r.ok) return setImportErrors(r.errors);
    bump();
    showToast(`Restored ${r.counts.trips ?? 0} trips${r.skippedMapRegions ? '. Map regions must be downloaded again' : ''}.`);
  };

  return (
    <main className="page">
      <TopBar title="Settings and backup" back="#/more" />

      <section className="section mt0">
        <Segmented
          label="Appearance"
          value={s.theme}
          onChange={(v) => save({ ...s, theme: v })}
          options={[
            { value: 'system', label: 'Match phone' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
        <TextInput label="Home city" hint="Default starting point for new trips." value={s.homeCity} onChange={(v) => setS({ ...s, homeCity: v })} onBlur={() => save(s)} />
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Family-wide assumptions</h2>
          <button className="btn btn--small btn--ghost" onClick={() => setShowAssumptions(true)}>
            Edit
          </button>
        </div>
        <p className="muted small mt0">
          {Object.keys(s.assumptions).length ? `${Object.keys(s.assumptions).length} changed from the defaults.` : 'Using the defaults.'} For example: {a.diapersPerDay12to24m} diapers a day at 12–24 months, a break every {a.restBreakEveryHoursWithChild} h with a child, {a.avgSpeedKmh} km/h average speed.
        </p>
      </section>

      <FamilySync />

      <section className="section">
        <div className="section-head">
          <h2>Backup and restore</h2>
        </div>
        <Notice kind="warn">
          <p>Everything lives only on this phone. {isIOS ? 'iOS can delete website data that has not been used for a while unless the app is added to the Home Screen.' : 'Clearing browser data deletes it.'} Export a backup before big changes and keep it somewhere else.</p>
        </Notice>
        <p className="small">{s.lastBackupAt ? `Last backup: ${new Date(s.lastBackupAt).toLocaleString()}` : 'No backup yet.'}</p>
        <div className="row-actions">
          <button className="btn btn--primary" onClick={doExport}>
            <Icon name="download" /> Export backup
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" /> Restore from file
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
        </div>
        <p className="muted small">Backups contain trips, checklists, profiles, inventory, history and settings as JSON. Downloaded map data is not included because of its size.</p>
        {importErrors.length > 0 && (
          <Notice kind="safety">
            {importErrors.map((e) => (
              <p key={e}>{e}</p>
            ))}
            <p>Nothing was changed.</p>
          </Notice>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Storage on this device</h2>
        </div>
        <dl className="kv">
          <dt>Used</dt>
          <dd className="num">
            {mb(storage.usage)} of {mb(storage.quota)} available to this app
          </dd>
          <dt>Protected from clean-up</dt>
          <dd>{storage.persisted === undefined ? 'Not supported by this browser' : storage.persisted ? 'Yes' : 'No — the browser may clear data when space is low'}</dd>
          <dt>Installed</dt>
          <dd>{standalone ? 'Yes, running as an app' : 'No — running in a browser tab'}</dd>
        </dl>
        {!storage.persisted && (
          <button
            className="btn btn--small"
            style={{ marginTop: 12 }}
            onClick={async () => {
              const ok = await requestPersistence();
              setStorage(await storageInfo());
              showToast(ok ? 'The browser agreed to keep this app’s data.' : 'The browser declined. Installing to the Home Screen and regular backups are the safeguards.');
            }}
          >
            Ask the browser to keep data
          </button>
        )}
        {!standalone && (
          <p className="muted small">
            {isIOS ? 'To install on iPhone: open in Safari, tap Share, then “Add to Home Screen”.' : 'To install: use your browser menu and choose “Install app” or “Add to Home screen”.'}
          </p>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Privacy and network use</h2>
        </div>
        <div className="card card--pad prose small">
          <p>No account, no analytics, no ads, no AI services. Profiles, your child’s details, trips, inventory and history never leave this device unless you export a backup yourself.</p>
          <p>The app makes network requests only to:</p>
          <p>1. The site you installed it from, to check for app updates.</p>
          <p>2. Map catalog and region file addresses you choose in Offline Maps, only when you start a download. Nothing about your trips is sent.</p>
          <p>3. Only if you turn on Family sync: api.github.com, to read and write one encrypted file in your private repository. The family passphrase never leaves your phones.</p>
          <p>Live traffic, weather, business hours and road closures are not available in this app.</p>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>About</h2>
        </div>
        <dl className="kv small">
          <dt>App</dt>
          <dd>Milestone {APP_VERSION}</dd>
          <dt>Rules</dt>
          <dd>{ENGINE_VERSION}</dd>
          <dt>Data version</dt>
          <dd>{SCHEMA_VERSION}</dd>
        </dl>
        <div className="card card--pad prose small" style={{ marginTop: 12 }}>
          <p>Open-source components: React (MIT), idb (ISC), Zod (MIT), MapLibre GL JS (BSD-3-Clause), PMTiles (BSD-3-Clause), Protomaps basemap styles (BSD-3-Clause), Workbox (MIT), Overpass and Noto Sans fonts (SIL OFL 1.1), map icons derived from Tangrams icons (MIT).</p>
          <p>Map data © OpenStreetMap contributors, available under the Open Database Licence (ODbL).</p>
          <p>Health and safety notes are general guidance, not medical advice. Ask your paediatrician about medicines and doses.</p>
        </div>
      </section>

      <section className="section">
        <button className="btn btn--danger" onClick={() => setWipe(true)}>
          <Icon name="trash" /> Delete all data on this device
        </button>
      </section>

      {showAssumptions && <GlobalAssumptions settings={s} onSave={save} onClose={() => setShowAssumptions(false)} />}

      {pending && (
        <Sheet title="Restore this backup?" onClose={() => setPending(undefined)}>
          <p>{pending.summary}</p>
          <ul className="list card">
            <li>
              <button className="list-link" onClick={() => doImport('merge')}>
                <span className="list-link__body">
                  <span className="list-link__title">Merge</span>
                  <span className="list-link__meta">Add what is missing; where both have a record, keep the newer one.</span>
                </span>
              </button>
            </li>
            <li>
              <button className="list-link" onClick={() => doImport('replace')}>
                <span className="list-link__body">
                  <span className="list-link__title">Replace everything</span>
                  <span className="list-link__meta">Delete current trips, profiles and inventory, then restore the file. Map data stays.</span>
                </span>
              </button>
            </li>
          </ul>
        </Sheet>
      )}

      {wipe && (
        <Sheet title="Delete all data?" onClose={() => setWipe(false)}>
          <p>This permanently removes every trip, checklist, profile, inventory item, review, setting and downloaded map region from this device. It cannot be undone without a backup file.</p>
          <TextInput label="Type DELETE to confirm" value={wipeText} onChange={setWipeText} autoCapitalize="characters" />
          <div className="row-actions">
            <button className="btn btn--primary" onClick={doExport}>
              Export backup first
            </button>
            <button
              className="btn btn--danger"
              disabled={wipeText.trim() !== 'DELETE'}
              onClick={async () => {
                await deleteDatabase();
                try {
                  sessionStorage.clear();
                  localStorage.clear();
                } catch {
                  /* ignore */
                }
                location.hash = '/';
                location.reload();
              }}
            >
              Delete everything
            </button>
          </div>
        </Sheet>
      )}
    </main>
  );
}

function GlobalAssumptions({ settings, onSave, onClose }: { settings: Settings; onSave: (s: Settings) => Promise<void>; onClose: () => void }) {
  const [over, setOver] = useState<Partial<Assumptions>>(settings.assumptions);
  const eff = resolveAssumptions(over, {});
  const groups = [...new Set(Object.values(ASSUMPTION_DEFS).map((d) => d.group))];
  return (
    <Sheet title="Family-wide assumptions" onClose={onClose}>
      <p className="muted small mt0">Defaults for new and updated trips. A trip can still override any value. Existing lists change when you choose “Save and update list” on a trip.</p>
      {groups.map((g) => (
        <section key={g}>
          <h3 style={{ margin: '18px 0 8px' }}>{g}</h3>
          {(Object.keys(ASSUMPTION_DEFS) as (keyof Assumptions)[])
            .filter((k) => ASSUMPTION_DEFS[k].group === g)
            .map((k) => {
              const d = ASSUMPTION_DEFS[k];
              return <Stepper key={k} label={d.label} hint={`${d.help} Default ${DEFAULT_ASSUMPTIONS[k]}.`} value={eff[k]} min={d.min} max={d.max} step={d.step} suffix={d.unit} onChange={(v) => setOver((o) => ({ ...o, [k]: v }))} />;
            })}
        </section>
      ))}
      <div className="row-actions" style={{ position: 'sticky', bottom: 0, background: 'var(--paper)', padding: '10px 0' }}>
        <button className="btn" onClick={() => setOver({})}>
          Reset all
        </button>
        <button
          className="btn btn--primary"
          style={{ flex: 1 }}
          onClick={async () => {
            const clean = Object.fromEntries(Object.entries(over).filter(([k, v]) => v !== DEFAULT_ASSUMPTIONS[k as keyof Assumptions]));
            await onSave({ ...settings, assumptions: clean });
            showToast('Assumptions saved.');
            onClose();
          }}
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}
