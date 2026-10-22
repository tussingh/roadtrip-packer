import { useRef, useState } from 'react';
import { bump, showToast, useOnline } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Notice, Sheet, TextInput } from '../../components/ui';
import type { MapAssetKind, MapRegion } from '../../types';
import { importAssetFile } from './downloader';
import { pauseDownload, startDownload, useDownloads } from './downloadQueue';
import { fetchCatalog, parseCatalog, regionFromManifest, type RegionManifest } from './manifest';
import { forgetRegion } from './mapData';
import { deleteRegion, getRegion, saveRegion, type StorageInfo } from './regionStore';

const ASSET_LABEL: Record<MapAssetKind, { title: string; gives: string }> = {
  tiles: { title: 'Map tiles', gives: 'map display, pan and zoom' },
  poi: { title: 'Places index', gives: 'offline search, fuel, hospitals, food, toilets' },
  graph: { title: 'Road network', gives: 'offline road routes and distances' },
};

export const fmtBytes = (b: number) => (b <= 0 ? '0 MB' : b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

const DEFAULT_CATALOG = 'regions/catalog.json';

export function RegionsPane({ regions, storage, swReady }: { regions: MapRegion[]; storage: StorageInfo; swReady: boolean }) {
  const online = useOnline();
  const downloads = useDownloads();
  const [catalogUrl, setCatalogUrl] = useState(DEFAULT_CATALOG);
  const [available, setAvailable] = useState<RegionManifest[]>();
  const [catalogError, setCatalogError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<RegionManifest>();
  const [remove, setRemove] = useState<MapRegion>();
  const manifestFile = useRef<HTMLInputElement>(null);
  const assetFile = useRef<HTMLInputElement>(null);
  const [importTarget, setImportTarget] = useState<{ regionId: string; kind: MapAssetKind }>();

  const loadCatalog = async () => {
    setLoading(true);
    setCatalogError(undefined);
    const url = new URL(catalogUrl.trim() || DEFAULT_CATALOG, document.baseURI).href;
    const res = await fetchCatalog(url);
    setLoading(false);
    setAvailable(res.regions);
    if (res.error) setCatalogError(res.error);
    else if (res.regions.length === 0) setCatalogError('This catalog lists no regions yet. See the map-data guide in the project documentation to build and publish one.');
  };

  const addAndDownload = async (m: RegionManifest) => {
    const existing = await getRegion(m.id);
    await saveRegion(regionFromManifest(m, existing));
    bump();
    setConfirm(undefined);
    void startDownload(m.id);
  };

  const onManifestFile = async (f?: File) => {
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      const res = parseCatalog(json, location.href);
      if (res.error || !res.regions.length) throw new Error(res.error ?? 'No regions in file.');
      for (const m of res.regions) await saveRegion(regionFromManifest(m, await getRegion(m.id)));
      bump();
      showToast(`Added ${res.regions.length} region${res.regions.length === 1 ? '' : 's'}. Import or download each file below.`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  const onAssetFile = async (f?: File) => {
    if (!f || !importTarget) return;
    showToast(`Copying ${f.name} into app storage…`);
    const r = await importAssetFile(importTarget.regionId, importTarget.kind, f, () => undefined).catch((e: unknown) => {
      showToast(e instanceof Error ? e.message : String(e));
      return undefined;
    });
    forgetRegion(importTarget.regionId);
    bump();
    const a = r?.assets[importTarget.kind];
    if (a) showToast(a.status === 'ready' ? `${ASSET_LABEL[importTarget.kind].title} ready${a.verified ? ' and verified' : ''}.` : `Import failed: ${a.error}`);
    setImportTarget(undefined);
  };

  const totalStored = regions.reduce((s, r) => s + Object.values(r.assets).reduce((x, a) => x + (a ? Math.min(a.bytes, a.chunksDone * a.chunkSize) : 0), 0), 0);

  return (
    <div className="pad-x">
      <div className="card card--pad" style={{ marginTop: 12 }}>
        <dl className="kv">
          <dt>App offline</dt>
          <dd>{swReady ? 'Yes — the app opens without internet' : 'Not yet — open the installed app once while online'}</dd>
          <dt>Map data</dt>
          <dd>{regions.filter((r) => r.installedAt).length} complete region(s), {fmtBytes(totalStored)} stored</dd>
          <dt>Device storage</dt>
          <dd className="num">{storage.quota ? `${fmtBytes(storage.usage ?? 0)} used of ${fmtBytes(storage.quota)} allowed` : 'Unknown'}</dd>
        </dl>
        <p className="muted small mb0" style={{ marginTop: 8 }}>
          Installing the app does not download maps. Each region below must be downloaded (or imported from a file) before it works offline.
        </p>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>On this device</h2>
        </div>
        {regions.length === 0 && <p className="muted small mt0">No map regions yet.</p>}
        {regions.map((r) => {
          const job = downloads.find((d) => d.regionId === r.id);
          const missing = (['tiles', 'poi', 'graph'] as MapAssetKind[]).filter((k) => r.assets[k]?.status !== 'ready');
          return (
            <div key={r.id} className="card region" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <h3>{r.name}</h3>
                  <p className="muted small" style={{ margin: '2px 0 6px' }}>
                    {r.dataDate ? `Data from ${r.dataDate}. ` : ''}
                    Zoom up to {r.maxZoom}. {r.attribution}
                  </p>
                </div>
                <button className="icon-btn" aria-label={`Delete ${r.name}`} onClick={() => setRemove(r)}>
                  <Icon name="trash" />
                </button>
              </div>
              {(['tiles', 'poi', 'graph'] as MapAssetKind[]).map((k) => {
                const a = r.assets[k];
                const active = job?.current === k ? job.progress : undefined;
                const pct = a ? (active ? active.done / active.total : Math.min(1, (a.chunksDone * a.chunkSize) / Math.max(1, a.bytes))) : 0;
                const state = active ? (active.phase === 'verifying' ? 'verifying' : 'downloading') : a?.status ?? 'absent';
                return (
                  <div key={k} className="asset-row">
                    <span>
                      <span className="status-dot" data-s={state} aria-hidden="true" />
                      <strong>{ASSET_LABEL[k].title}</strong>
                      <span className="muted" style={{ display: 'block' }}>
                        {!a
                          ? 'Not published for this region'
                          : state === 'ready'
                            ? `${fmtBytes(a.bytes)}${a.verified ? ', checksum verified' : ', size checked (no checksum published)'}`
                            : state === 'error'
                              ? a.error
                              : state === 'absent'
                                ? `${fmtBytes(a.bytes)} — gives ${ASSET_LABEL[k].gives}`
                                : `${state === 'verifying' ? 'Verifying' : state === 'paused' ? 'Paused at' : 'Downloading'} ${Math.round(pct * 100)}% of ${fmtBytes(a.bytes)}`}
                      </span>
                    </span>
                    {a && state !== 'ready' && !job && (
                      <button
                        className="btn btn--small"
                        onClick={() => {
                          setImportTarget({ regionId: r.id, kind: k });
                          assetFile.current?.click();
                        }}
                      >
                        From file
                      </button>
                    )}
                  </div>
                );
              })}
              <div className="row-actions" style={{ marginTop: 8 }}>
                {job ? (
                  <button className="btn btn--small" onClick={() => pauseDownload(r.id)}>
                    Pause
                  </button>
                ) : (
                  missing.some((k) => r.assets[k]?.url) && (
                    <button className="btn btn--small btn--primary" disabled={!online} onClick={() => void startDownload(r.id)}>
                      <Icon name="download" size={18} /> {missing.some((k) => (r.assets[k]?.chunksDone ?? 0) > 0) ? 'Resume download' : 'Download'}
                    </button>
                  )
                )}
                {!online && missing.length > 0 && !job && <span className="muted small">Connect to the internet to download.</span>}
              </div>
            </div>
          );
        })}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Get a region</h2>
        </div>
        <TextInput label="Region catalog address" hint="The site this app was installed from can publish regions/catalog.json. You can also use any catalog you trust." value={catalogUrl} onChange={setCatalogUrl} inputMode="url" />
        <div className="row-actions">
          <button className="btn" onClick={loadCatalog} disabled={!online || loading}>
            {loading ? 'Loading…' : 'Show available regions'}
          </button>
          <button className="btn" onClick={() => manifestFile.current?.click()}>
            <Icon name="upload" size={18} /> Region file from device
          </button>
        </div>
        {!online && <p className="muted small">You are offline. You can still add a region from files already on this phone.</p>}
        {catalogError && (
          <div style={{ marginTop: 12 }}>
            <Notice kind="warn">
              <p>{catalogError}</p>
            </Notice>
          </div>
        )}
        {available && available.length > 0 && (
          <ul className="list card" style={{ marginTop: 12 }}>
            {available.map((m) => {
              const size = Object.values(m.assets).reduce((s, a) => s + (a?.bytes ?? 0), 0);
              return (
                <li key={m.id}>
                  <button className="list-link" onClick={() => setConfirm(m)}>
                    <span className="list-link__body">
                      <span className="list-link__title">{m.name}</span>
                      <span className="list-link__meta">
                        {fmtBytes(size)} total{m.dataDate ? `, data from ${m.dataDate}` : ''}. {m.description}
                      </span>
                    </span>
                    <Icon name="download" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <input ref={manifestFile} type="file" accept="application/json,.json" hidden onChange={(e) => void onManifestFile(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
        <input ref={assetFile} type="file" hidden onChange={(e) => void onAssetFile(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
      </section>

      {confirm && (
        <Sheet title={`Download ${confirm.name}?`} onClose={() => setConfirm(undefined)}>
          <ul className="list card">
            {(['tiles', 'poi', 'graph'] as MapAssetKind[]).map((k) => (
              <li key={k} className="list-link">
                <span className="list-link__body">
                  <span className="list-link__title">{ASSET_LABEL[k].title}</span>
                  <span className="list-link__meta">{confirm.assets[k] ? `${fmtBytes(confirm.assets[k]!.bytes)} — ${ASSET_LABEL[k].gives}` : 'Not available for this region'}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="small">
            Total {fmtBytes(Object.values(confirm.assets).reduce((s, a) => s + (a?.bytes ?? 0), 0))}. Use Wi-Fi if you can. Keep the app open: phones pause web downloads in the background, but progress is saved and you can resume.
          </p>
          {storage.quota !== undefined && storage.usage !== undefined && Object.values(confirm.assets).reduce((s, a) => s + (a?.bytes ?? 0), 0) > storage.quota - storage.usage && (
            <Notice kind="safety">
              <p>This is more than the storage the browser currently allows this app. The download may fail.</p>
            </Notice>
          )}
          <div className="row-actions">
            <button className="btn" onClick={() => setConfirm(undefined)}>
              Cancel
            </button>
            <button className="btn btn--primary" style={{ flex: 1 }} onClick={() => void addAndDownload(confirm)}>
              Download
            </button>
          </div>
        </Sheet>
      )}
      {remove && (
        <Sheet title={`Delete ${remove.name}?`} onClose={() => setRemove(undefined)}>
          <p>Frees about {fmtBytes(Object.values(remove.assets).reduce((s, a) => s + (a ? Math.min(a.bytes, a.chunksDone * a.chunkSize) : 0), 0))}. Saved places and routes stay. You will need the internet (or the files) to get this region back.</p>
          <div className="row-actions">
            <button className="btn" onClick={() => setRemove(undefined)}>
              Keep
            </button>
            <button
              className="btn btn--danger"
              onClick={async () => {
                pauseDownload(remove.id);
                await deleteRegion(remove.id);
                forgetRegion(remove.id);
                bump();
                setRemove(undefined);
                showToast('Region deleted.');
              }}
            >
              Delete region
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
