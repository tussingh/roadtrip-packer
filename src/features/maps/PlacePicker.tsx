import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Notice, Sheet, Stepper } from '../../components/ui';
import type { MapRegion, SavedPlace } from '../../types';
import { haversine, type LonLat } from './geo';
import { getPoiIndex, ready } from './mapData';
import { KIND_LABEL, type Poi } from './poiIndex';

export interface Place {
  name: string;
  lon: number;
  lat: number;
  sub?: string;
}

export function useOfflineSearch(regions: MapRegion[], q: string, near?: LonLat, kinds?: string[]) {
  const [results, setResults] = useState<(Poi & { regionName: string })[]>([]);
  const [searching, setSearching] = useState(false);
  const withPoi = regions.filter((r) => ready(r, 'poi'));
  const key = withPoi.map((r) => r.id).join(',');
  useEffect(() => {
    let alive = true;
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const all: (Poi & { regionName: string })[] = [];
      for (const r of withPoi) {
        try {
          const idx = await getPoiIndex(r.id);
          all.push(...idx.search(q, near, 25, kinds).map((p) => ({ ...p, regionName: r.name })));
        } catch {
          /* index unreadable: reported in regions pane */
        }
      }
      if (alive) {
        setResults(all.slice(0, 40));
        setSearching(false);
      }
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, key, near?.[0], near?.[1], kinds?.join()]);
  return { results, searching, hasIndex: withPoi.length > 0 };
}

export function locateMe(): Promise<LonLat> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Location is not available in this browser.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.longitude, p.coords.latitude]),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? 'Location permission was declined.' : 'Could not get your location. GPS works offline but may need a clear sky view.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
    );
  });
}

export function PlacePicker({
  title,
  regions,
  saved,
  center,
  onPick,
  onClose,
}: {
  title: string;
  regions: MapRegion[];
  saved: SavedPlace[];
  center?: LonLat;
  onPick: (p: Place) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [manual, setManual] = useState<{ lat: number; lon: number } | null>(null);
  const { results, searching, hasIndex } = useOfflineSearch(regions, q, center);
  const savedMatches = saved.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Sheet title={title} onClose={onClose}>
      <label className="search" style={{ margin: '0 0 12px' }}>
        <Icon name="search" size={20} />
        <span className="visually-hidden">Search places offline</span>
        <input type="search" autoFocus placeholder={hasIndex ? 'Search towns and places offline' : 'Search needs a places index'} value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {!hasIndex && (
        <Notice kind="warn">
          <p>No places index is downloaded, so offline search is unavailable. Use a saved place, your location, the map centre or coordinates.</p>
        </Notice>
      )}
      {err && (
        <Notice kind="safety">
          <p>{err}</p>
        </Notice>
      )}
      <div className="row-actions" style={{ marginBottom: 12 }}>
        <button
          className="btn btn--small"
          onClick={async () => {
            try {
              const p = await locateMe();
              onPick({ name: 'My location', lon: p[0], lat: p[1] });
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          <Icon name="locate" size={18} /> My location
        </button>
        {center && (
          <button className="btn btn--small" onClick={() => onPick({ name: 'Map centre', lon: center[0], lat: center[1] })}>
            <Icon name="pin" size={18} /> Map centre
          </button>
        )}
        <button className="btn btn--small" onClick={() => setManual(manual ? null : { lat: center?.[1] ?? 12.97, lon: center?.[0] ?? 77.59 })}>
          Coordinates
        </button>
      </div>
      {manual && (
        <div className="card card--pad" style={{ marginBottom: 12 }}>
          <div className="two-col">
            <Stepper label="Latitude" value={manual.lat} min={-90} max={90} step={0.0001} onChange={(v) => setManual({ ...manual, lat: v })} />
            <Stepper label="Longitude" value={manual.lon} min={-180} max={180} step={0.0001} onChange={(v) => setManual({ ...manual, lon: v })} />
          </div>
          <button className="btn btn--small btn--primary" onClick={() => onPick({ name: `${manual.lat.toFixed(4)}, ${manual.lon.toFixed(4)}`, lat: manual.lat, lon: manual.lon })}>
            Use these coordinates
          </button>
        </div>
      )}
      {searching && <p className="muted small">Searching…</p>}
      {results.length > 0 && (
        <ul className="list card" style={{ marginBottom: 12 }}>
          {results.map((p) => (
            <li key={`${p.regionName}-${p.i}`}>
              <button className="list-link" onClick={() => onPick({ name: p.name || KIND_LABEL[p.kind] || p.kind, lon: p.lon, lat: p.lat, sub: KIND_LABEL[p.kind] })}>
                <span className="list-link__body">
                  <span className="list-link__title">{p.name || KIND_LABEL[p.kind]}</span>
                  <span className="list-link__meta">
                    {KIND_LABEL[p.kind] ?? p.kind}
                    {p.extra ? `, ${p.extra}` : ''}
                    {center ? `, ${(haversine(center, [p.lon, p.lat]) / 1000).toFixed(0)} km straight-line` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && !searching && results.length === 0 && hasIndex && <p className="muted small">No match in the downloaded places index. It only contains mapped towns and points of interest, not street addresses.</p>}
      {savedMatches.length > 0 && (
        <>
          <h3 style={{ fontSize: 'var(--fs-m)', margin: '8px 0' }}>Saved places</h3>
          <ul className="list card">
            {savedMatches.map((s) => (
              <li key={s.id}>
                <button className="list-link" onClick={() => onPick({ name: s.name, lon: s.lon, lat: s.lat, sub: 'Saved place' })}>
                  <span className="list-link__body">
                    <span className="list-link__title">{s.name}</span>
                    <span className="list-link__meta">{s.kind}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}
