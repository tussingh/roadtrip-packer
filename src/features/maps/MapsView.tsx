import { useEffect, useMemo, useState } from 'react';
import { regenerateTrip } from '../../app/tripService';
import { bump, showToast, useOnline, useQuery } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Field, Notice, Segmented, Sheet, Toggle, TopBar } from '../../components/ui';
import { nowIso, uid } from '../../data/defaults';
import { resolveAssumptions } from '../../rules/assumptions';
import { deleteSavedPlace, deleteSavedRoute, getSettings, listSavedPlaces, listSavedRoutes, listTrips, saveSavedPlace, saveSavedRoute, saveTrip } from '../../storage/repo';
import type { MapRegion, SavedRoute, Trip } from '../../types';
import { isUpcoming, tripTitle } from '../trips/tripUtils';
import { bboxOf, formatHours, formatKm, haversine, locateOnLine, type LonLat } from './geo';
import { MapCanvas, type MapPoint } from './MapCanvas';
import { getPoiIndex, ready, regionFor, routeOffline } from './mapData';
import { locateMe, PlacePicker, useOfflineSearch, type Place } from './PlacePicker';
import { KIND_GROUPS, KIND_LABEL, type Poi } from './poiIndex';
import { listRegions, storageInfo, type StorageInfo } from './regionStore';
import { RegionsPane } from './RegionsPane';
import { suggestBreaks, townsAlong, type BreakSuggestion, type RouteFailure, type RouteResult } from './routing/route';

type Tab = 'route' | 'search' | 'regions';

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

async function load() {
  const [regions, saved, routes, trips, settings] = await Promise.all([listRegions(), listSavedPlaces(), listSavedRoutes(), listTrips(), getSettings()]);
  return { regions, saved, routes, trips, settings };
}

/** Keep one vertex every ~minM metres: plenty for along-route queries, far faster. */
function thin(line: LonLat[], minM: number): LonLat[] {
  if (line.length < 3) return line;
  const out = [line[0]];
  for (let i = 1; i < line.length - 1; i++) if (haversine(out[out.length - 1], line[i]) >= minM) out.push(line[i]);
  out.push(line[line.length - 1]);
  return out;
}

interface Analysis {
  towns: { name: string; alongM: number }[];
  breaks: BreakSuggestion[];
  medical: (Poi & { alongM: number; offM: number })[];
  fuel: number;
  toilets: number;
  food: number;
  savedNear: { name: string; offM: number }[];
  missing: string[];
}

export default function MapsView() {
  const { data } = useQuery(load, []);
  const online = useOnline();
  const [tab, setTab] = useState<Tab>();
  const [activeId, setActiveId] = useState<string>();
  const [center, setCenter] = useState<LonLat>();
  const [focus, setFocus] = useState<{ center?: LonLat; bounds?: [LonLat, LonLat]; zoom?: number; seq: number }>();
  const [storage, setStorage] = useState<StorageInfo>({});
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  const swReady = typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller);

  // search state
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string>();
  const [nearby, setNearby] = useState<(Poi & { distM: number })[]>();
  const [me, setMe] = useState<LonLat>();
  // route state
  const [waypoints, setWaypoints] = useState<(Place | undefined)[]>([undefined, undefined]);
  const [picking, setPicking] = useState<number>();
  const [route, setRoute] = useState<RouteResult>();
  const [failure, setFailure] = useState<RouteFailure>();
  const [analysis, setAnalysis] = useState<Analysis>();
  const [routing, setRouting] = useState(false);
  const [useForTrip, setUseForTrip] = useState(false);
  const [shownRoute, setShownRoute] = useState<LonLat[]>();

  useEffect(() => {
    void storageInfo().then(setStorage);
    const obs = new MutationObserver(() => setDark(document.documentElement.dataset.theme === 'dark'));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  const regions = useMemo(() => data?.regions ?? [], [data]);
  const tileRegions = regions.filter((r) => ready(r, 'tiles'));
  const active: MapRegion | undefined = tileRegions.find((r) => r.id === activeId) ?? tileRegions[0];
  const currentTab: Tab = tab ?? (regions.some((r) => r.installedAt || ready(r, 'tiles') || ready(r, 'poi')) ? 'search' : 'regions');
  const searchCenter = me ?? center;
  const { results, searching, hasIndex } = useOfflineSearch(regions, currentTab === 'search' ? q : '', searchCenter);
  const a = data ? resolveAssumptions(data.settings.assumptions, {}) : undefined;

  if (!data || !a) return <main className="page" aria-busy="true" />;

  const show = (p: { lon: number; lat: number }) => setFocus({ center: [p.lon, p.lat], zoom: 13, seq: Date.now() });

  const runNearby = async (g: string) => {
    setGroup(g);
    const origin = me ?? center;
    if (!origin) return setNearby([]);
    const out: (Poi & { distM: number })[] = [];
    for (const r of regions.filter((x) => ready(x, 'poi'))) {
      try {
        out.push(...(await getPoiIndex(r.id)).nearby(origin, 30000, KIND_GROUPS[g].kinds, 30));
      } catch {
        /* skip */
      }
    }
    setNearby(out.sort((x, y) => x.distM - y.distM).slice(0, 30));
  };

  const savePlace = async (p: { name: string; lon: number; lat: number; kind?: string }) => {
    await saveSavedPlace({ id: uid(), name: p.name, lat: p.lat, lon: p.lon, kind: p.kind ? KIND_LABEL[p.kind] ?? p.kind : 'Place', notes: '', updatedAt: nowIso() });
    bump();
    showToast(`Saved ${p.name}.`);
  };

  const compute = async () => {
    const wps = waypoints.filter((w): w is Place => Boolean(w));
    setRoute(undefined);
    setFailure(undefined);
    setAnalysis(undefined);
    if (wps.length < 2) return setFailure({ ok: false, reason: 'too-few-points', message: 'Choose a start and a destination.' });
    const pts = wps.map((w) => [w.lon, w.lat] as LonLat);
    const region = regionFor(regions, pts, 'graph');
    const straight = pts.slice(1).reduce((s, p, i) => s + haversine(pts[i], p), 0);
    if (!region) {
      const anyGraph = regions.some((r) => ready(r, 'graph'));
      return setFailure({
        ok: false,
        reason: 'outside-coverage',
        message: anyGraph ? 'No single downloaded road network covers every point on this route. Download a region that contains the whole route.' : 'No road network is downloaded, so road routing is unavailable offline.',
        straightLineM: straight,
      });
    }
    setRouting(true);
    try {
      const res = await routeOffline(region.id, wps.map((w) => ({ name: w.name, lon: w.lon, lat: w.lat })));
      if (!res.ok) return setFailure(res);
      setRoute(res);
      setShownRoute(res.geometry);
      const b = bboxOf(res.geometry);
      setFocus({ bounds: [[b[0], b[1]], [b[2], b[3]]], seq: Date.now() });
      // along-route analysis from the places index, if present
      const missing: string[] = [];
      const poiRegion = regionFor(regions, pts, 'poi');
      const line = thin(res.geometry, 250);
      const savedNear = data.saved
        .map((s) => ({ name: s.name, offM: locateOnLine([s.lon, s.lat], line).offRoute }))
        .filter((s) => s.offM <= 5000)
        .sort((x, y) => x.offM - y.offM);
      if (!poiRegion) {
        missing.push('No places index covers this route: towns, fuel, hospitals and break suggestions are not available offline.');
        setAnalysis({ towns: [], breaks: [], medical: [], fuel: 0, toilets: 0, food: 0, savedNear, missing });
      } else {
        const idx = await getPoiIndex(poiRegion.id);
        const thinRes = { ...res, geometry: line };
        const along = idx.alongRoute(line, 2000);
        const count = (kinds: string[]) => along.filter((p) => kinds.includes(p.kind)).length;
        setAnalysis({
          towns: townsAlong(thinRes, idx),
          breaks: suggestBreaks(thinRes, idx, a.restBreakEveryHoursWithChild),
          medical: idx.alongRoute(line, 5000, ['hospital', 'clinic', 'pharmacy']),
          fuel: count(['fuel']),
          toilets: count(['toilets', 'rest_area', 'services']),
          food: count(['restaurant', 'cafe', 'fast_food']),
          savedNear,
          missing,
        });
      }
    } catch (e) {
      setFailure({ ok: false, reason: 'not-connected', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setRouting(false);
    }
  };

  const points: MapPoint[] = [
    ...(currentTab === 'route' ? waypoints.filter((w): w is Place => Boolean(w)).map((w) => ({ lon: w.lon, lat: w.lat, label: w.name, kind: 'waypoint' as const })) : []),
    ...(currentTab === 'route' && analysis ? analysis.breaks.flatMap((b) => b.options.slice(0, 1).map((o) => ({ lon: o.lon, lat: o.lat, label: `Break ${formatHours(b.atHours)}`, kind: 'break' as const }))) : []),
    ...(currentTab === 'search' ? (nearby ?? results).slice(0, 30).map((p) => ({ lon: p.lon, lat: p.lat, label: p.name || KIND_LABEL[p.kind] || '', kind: 'poi' as const })) : []),
    ...data.saved.map((s) => ({ lon: s.lon, lat: s.lat, label: s.name, kind: 'saved' as const })),
    ...(me ? [{ lon: me[0], lat: me[1], label: 'You', kind: 'me' as const }] : []),
  ];

  return (
    <main className="page page--flush">
      <div className="pad-x">
        <TopBar
          title="Maps"
          sub={active ? `Showing ${active.name}` : 'Trip route maps and offline regions'}
          actions={
            tileRegions.length > 1 ? (
              <select className="select" style={{ width: 'auto', minHeight: 40 }} aria-label="Region shown on map" value={active?.id} onChange={(e) => setActiveId(e.target.value)}>
                {tileRegions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            ) : undefined
          }
        />
        <section aria-label="Trip maps" style={{ marginBottom: 12 }}>
          {data.trips.filter((t) => t.plan).length > 0 ? (
            <ul className="list card">
              {data.trips
                .filter((t) => t.plan)
                .map((t) => (
                  <li key={t.id}>
                    <a className="list-link" href={`#/trip/${t.id}/route`}>
                      <Icon name="route" style={{ color: 'var(--sign)' }} />
                      <span className="list-link__body">
                        <span className="list-link__title">{tripTitle(t)}</span>
                        <span className="list-link__meta">
                          {Math.round(t.plan!.options[t.plan!.chosen]?.distanceKm ?? 0)} km · route, stops, restaurants{t.plan!.offlineMap ? ' · saved offline' : ' · tap to save map offline'}
                        </span>
                      </span>
                      <Icon name="right" size={18} />
                    </a>
                  </li>
                ))}
            </ul>
          ) : (
            <Notice>
              <p>
                <strong>Trip maps:</strong> create a trip and pick the start and destination from the suggestions. Its route map, stops and restaurants appear here, and you can save the map along the route for offline use.
              </p>
              <a className="btn btn--small btn--primary" href="#/trips/new">
                <Icon name="plus" size={16} /> New trip
              </a>
            </Notice>
          )}
          <p className="muted small" style={{ margin: '8px 0 0' }}>Below: advanced whole-region offline maps with offline search and routing (needs a published region pack).</p>
        </section>
      </div>
      <div className="map-wrap">
        {active ? (
          <MapCanvas region={active} dark={dark} route={currentTab === 'route' ? shownRoute : undefined} points={points} focus={focus} onMove={(c) => setCenter(c)} />
        ) : (
          <div className="map-overlay">
            <div>
              <Icon name="map" size={36} />
              <p>
                The app works offline, but map tiles are a separate download.
                <br />
                {regions.length ? 'Finish downloading a region’s map tiles to see the map here.' : 'Add a region below to see maps without signal.'}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="pad-x" style={{ marginTop: 12 }}>
        <Segmented<Tab>
          label={<span className="visually-hidden">Map tools</span>}
          value={currentTab}
          onChange={setTab}
          options={[
            { value: 'search', label: 'Find places' },
            { value: 'route', label: 'Route' },
            { value: 'regions', label: 'Regions' },
          ]}
        />
      </div>

      {currentTab === 'regions' && <RegionsPane regions={regions} storage={storage} swReady={swReady} />}

      {currentTab === 'search' && (
        <div className="pad-x">
          {!hasIndex && (
            <Notice kind="warn">
              <p>Offline search needs a region’s places index. {regions.length ? 'Download it in Regions.' : 'Add a region in Regions.'}</p>
            </Notice>
          )}
          <label className="search" style={{ margin: '0 0 10px' }}>
            <Icon name="search" size={20} />
            <span className="visually-hidden">Search places</span>
            <input type="search" placeholder="Town, hospital, restaurant…" value={q} onChange={(e) => { setQ(e.target.value); setNearby(undefined); setGroup(undefined); }} disabled={!hasIndex} />
          </label>
          <div className="segmented" style={{ marginBottom: 12 }}>
            {['fuel', 'medical', 'pharmacy', 'food', 'toilets', 'rest', 'atm'].map((g) => (
              <button key={g} type="button" aria-pressed={group === g} disabled={!hasIndex} onClick={() => void runNearby(g)}>
                {KIND_GROUPS[g].label}
              </button>
            ))}
            <button
              type="button"
              onClick={async () => {
                try {
                  const p = await locateMe();
                  setMe(p);
                  setFocus({ center: p, zoom: 13, seq: Date.now() });
                } catch (e) {
                  showToast(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              <Icon name="locate" size={16} /> Locate me
            </button>
          </div>
          {group && (
            <p className="muted small mt0">
              Nearest to {me ? 'your location' : 'the map centre'}, within 30 km straight-line. Only places mapped in OpenStreetMap appear — confirm hours and services by phone.
            </p>
          )}
          {searching && <p className="muted small">Searching…</p>}
          <ul className="list card">
            {(nearby ?? results).map((p) => {
              const d = 'distM' in p ? (p as { distM: number }).distM : searchCenter ? haversine(searchCenter, [p.lon, p.lat]) : undefined;
              return (
                <li key={`${p.i}-${p.lon}`} className="list-link">
                  <button className="list-link__body" style={{ background: 'none', border: 0, textAlign: 'left', padding: 0, cursor: 'pointer' }} onClick={() => show(p)}>
                    <span className="list-link__title">{p.name || KIND_LABEL[p.kind]}</span>
                    <span className="list-link__meta">
                      {KIND_LABEL[p.kind] ?? p.kind}
                      {p.extra ? `, ${p.extra}` : ''}
                      {d !== undefined ? `, ${formatKm(d)} straight-line` : ''}
                    </span>
                  </button>
                  <button className="icon-btn" aria-label={`Route to ${p.name || KIND_LABEL[p.kind]}`} onClick={() => { setWaypoints([me ? { name: 'My location', lon: me[0], lat: me[1] } : waypoints[0], { name: p.name || KIND_LABEL[p.kind], lon: p.lon, lat: p.lat }]); setTab('route'); }}>
                    <Icon name="route" />
                  </button>
                  <button className="icon-btn" aria-label={`Save ${p.name || KIND_LABEL[p.kind]}`} onClick={() => void savePlace({ name: p.name || KIND_LABEL[p.kind], lon: p.lon, lat: p.lat, kind: p.kind })}>
                    <Icon name="pin" />
                  </button>
                </li>
              );
            })}
          </ul>
          {nearby && nearby.length === 0 && <p className="muted small">Nothing of that kind is mapped within 30 km{!searchCenter ? ' — pan the map or tap “Locate me” first' : ''}.</p>}

          <section className="section">
            <div className="section-head">
              <h2>Saved places</h2>
            </div>
            {data.saved.length === 0 ? (
              <p className="muted small mt0">Tap the pin on a search result to save it. Saved places show on the map and are checked against your routes.</p>
            ) : (
              <ul className="list card">
                {data.saved.map((s) => (
                  <li key={s.id} className="list-link">
                    <button className="list-link__body" style={{ background: 'none', border: 0, textAlign: 'left', padding: 0, cursor: 'pointer' }} onClick={() => show(s)}>
                      <span className="list-link__title">{s.name}</span>
                      <span className="list-link__meta">{s.kind}</span>
                    </button>
                    <button className="icon-btn" aria-label={`Delete ${s.name}`} onClick={async () => { await deleteSavedPlace(s.id); bump(); }}>
                      <Icon name="trash" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {currentTab === 'route' && (
        <div className="pad-x">
          {!regions.some((r) => ready(r, 'graph')) && (
            <Notice kind="warn">
              <p>Road routing needs a region’s road network. Without it you can still see straight-line distances, which are not driving distances.</p>
            </Notice>
          )}
          <ol className="list card" style={{ listStyle: 'none' }}>
            {waypoints.map((w, i) => (
              <li key={i} className="list-link">
                <span className="list-link__icon" aria-hidden="true">
                  <Icon name={i === 0 ? 'locate' : i === waypoints.length - 1 ? 'flag' : 'pin'} />
                </span>
                <button className="list-link__body" style={{ background: 'none', border: 0, textAlign: 'left', padding: 0, cursor: 'pointer' }} onClick={() => setPicking(i)}>
                  <span className="list-link__meta">{i === 0 ? 'Start' : i === waypoints.length - 1 ? 'Destination' : `Stop ${i}`}</span>
                  <span className="list-link__title">{w?.name ?? 'Choose…'}</span>
                </button>
                {i > 0 && i < waypoints.length - 1 && (
                  <button className="icon-btn" aria-label={`Remove stop ${i}`} onClick={() => setWaypoints(waypoints.filter((_, k) => k !== i))}>
                    <Icon name="close" />
                  </button>
                )}
              </li>
            ))}
          </ol>
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button className="btn btn--small" onClick={() => setWaypoints([...waypoints.slice(0, -1), undefined, waypoints[waypoints.length - 1]])}>
              <Icon name="plus" size={18} /> Add stop
            </button>
            <button className="btn btn--small" onClick={() => setWaypoints([...waypoints].reverse())}>
              <Icon name="refresh" size={18} /> Reverse
            </button>
            <button className="btn btn--primary" style={{ flex: 1 }} onClick={() => void compute()} disabled={routing || waypoints.some((w) => !w)}>
              {routing ? 'Working it out…' : 'Find road route'}
            </button>
          </div>

          {failure && (
            <div style={{ marginTop: 14 }}>
              <Notice kind="warn">
                <p>{failure.message}</p>
                {failure.straightLineM !== undefined && <p className="num">Straight-line distance: {formatKm(failure.straightLineM)}. This is not a driving distance — roads are usually 20–50% longer.</p>}
              </Notice>
            </div>
          )}

          {route && (
            <RouteDetails
              route={route}
              analysis={analysis}
              trips={data.trips.filter((t) => isUpcoming(t))}
              onShowPoint={show}
              useForTrip={useForTrip}
              setUseForTrip={setUseForTrip}
              onSave={async () => {
                const wps = waypoints.filter((w): w is Place => Boolean(w));
                const region = regionFor(regions, wps.map((w) => [w.lon, w.lat] as LonLat), 'graph')!;
                const saved: SavedRoute = {
                  id: uid(),
                  name: `${wps[0].name} to ${wps[wps.length - 1].name}`,
                  regionId: region.id,
                  waypoints: wps.map((w) => ({ name: w.name, lat: w.lat, lon: w.lon })),
                  geometry: thin(route.geometry, 60),
                  roadKm: Math.round(route.distanceM / 100) / 10,
                  straightLineKm: Math.round(route.straightLineM / 100) / 10,
                  estHours: Math.round((route.durationS / 3600) * 10) / 10,
                  legsKm: route.legs.map((l) => Math.round(l.distanceM / 100) / 10),
                  majorRoads: route.roads.slice(0, 8).map((r) => r.name),
                  method: 'offline-road-graph',
                  createdAt: nowIso(),
                };
                await saveSavedRoute(saved);
                bump();
                showToast('Route saved on this device.');
              }}
            />
          )}

          <section className="section">
            <div className="section-head">
              <h2>Saved routes</h2>
            </div>
            {data.routes.length === 0 ? (
              <p className="muted small mt0">Routes you save can be viewed on the map later with no signal.</p>
            ) : (
              <ul className="list card">
                {data.routes.map((r) => (
                  <li key={r.id} className="list-link">
                    <button
                      className="list-link__body"
                      style={{ background: 'none', border: 0, textAlign: 'left', padding: 0, cursor: 'pointer' }}
                      onClick={() => {
                        setShownRoute(r.geometry);
                        setWaypoints(r.waypoints);
                        const b = bboxOf(r.geometry);
                        setFocus({ bounds: [[b[0], b[1]], [b[2], b[3]]], seq: Date.now() });
                      }}
                    >
                      <span className="list-link__title">{r.name}</span>
                      <span className="list-link__meta num">
                        {r.roadKm} km by road, about {formatHours(r.estHours)}
                      </span>
                    </button>
                    <button className="icon-btn" aria-label={`Delete route ${r.name}`} onClick={async () => { await deleteSavedRoute(r.id); bump(); }}>
                      <Icon name="trash" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Notice>
            <p>Offline routes use major roads only and estimated speeds. They ignore traffic, closures, tolls and turn restrictions, and there is no turn-by-turn guidance. Check live conditions online before you leave.</p>
          </Notice>
        </div>
      )}

      {picking !== undefined && (
        <PlacePicker
          title={picking === 0 ? 'Start' : picking === waypoints.length - 1 ? 'Destination' : `Stop ${picking}`}
          regions={regions}
          saved={data.saved}
          center={me ?? center}
          onClose={() => setPicking(undefined)}
          onPick={(p) => {
            setWaypoints(waypoints.map((w, i) => (i === picking ? p : w)));
            setPicking(undefined);
            setRoute(undefined);
            setFailure(undefined);
          }}
        />
      )}
      {!online && currentTab === 'regions' && <p className="pad-x muted small">You are offline. Downloads resume when you reconnect.</p>}
    </main>
  );
}

function RouteDetails({
  route,
  analysis,
  trips,
  onShowPoint,
  onSave,
  useForTrip,
  setUseForTrip,
}: {
  route: RouteResult;
  analysis?: Analysis;
  trips: Trip[];
  onShowPoint: (p: { lon: number; lat: number }) => void;
  onSave: () => Promise<void>;
  useForTrip: boolean;
  setUseForTrip: (v: boolean) => void;
}) {
  return (
    <section className="section">
      <div className="card card--pad">
        <p className="mt0 mb0" style={{ fontSize: 'var(--fs-xl)', fontWeight: 800 }}>
          <span className="num">{formatKm(route.distanceM)}</span> by road
        </p>
        <p className="muted small mt0">
          About {formatHours(route.durationS / 3600)} at estimated road-class speeds, without stops. Straight-line: {formatKm(route.straightLineM)}.
        </p>
        {route.legs.length > 1 && (
          <table className="table num" style={{ marginTop: 8 }}>
            <tbody>
              {route.legs.map((l, i) => (
                <tr key={i}>
                  <td>
                    {l.from} to {l.to}
                  </td>
                  <td>{formatKm(l.distanceM)}</td>
                  <td>{formatHours(l.durationS / 3600)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {route.warnings.map((w) => (
          <p key={w} className="small" style={{ color: 'var(--warn)' }}>
            {w}
          </p>
        ))}
        <div className="row-actions" style={{ marginTop: 10 }}>
          <button className="btn btn--small" onClick={() => void onSave()}>
            <Icon name="download" size={18} /> Save route
          </button>
          {trips.length > 0 && (
            <button className="btn btn--small" onClick={() => setUseForTrip(true)}>
              <Icon name="pack" size={18} /> Use distance for a trip
            </button>
          )}
        </div>
      </div>

      {route.roads.length > 0 && (
        <>
          <h3 style={{ margin: '18px 0 6px' }}>Main roads</h3>
          <p className="small mt0">{route.roads.slice(0, 8).map((r) => `${r.name} (${formatKm(r.distanceM)})`).join(', ')}</p>
        </>
      )}
      {analysis && (
        <>
          {analysis.missing.map((m) => (
            <Notice key={m} kind="warn">
              <p>{m}</p>
            </Notice>
          ))}
          {analysis.towns.length > 0 && (
            <>
              <h3 style={{ margin: '18px 0 6px' }}>Towns on the way</h3>
              <p className="small mt0">{analysis.towns.map((t) => `${t.name} (${formatKm(t.alongM)})`).join(', ')}</p>
            </>
          )}
          {analysis.breaks.length > 0 && (
            <>
              <h3 style={{ margin: '18px 0 6px' }}>Suggested breaks with a toddler</h3>
              <ol className="timeline">
                {analysis.breaks.map((b, i) => (
                  <li key={i}>
                    <strong className="num">
                      Around {formatHours(b.atHours)} ({formatKm(b.targetAlongM)})
                    </strong>
                    {b.options.length ? (
                      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }} className="small">
                        {b.options.map((o, k) => (
                          <li key={k}>
                            <button className="btn--ghost" style={{ border: 0, background: 'none', padding: 0, color: 'var(--sign)', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }} onClick={() => onShowPoint(o)}>
                              {o.name || KIND_LABEL[o.kind] || o.kind}
                            </button>{' '}
                            <span className="muted">
                              {o.name ? `${KIND_LABEL[o.kind] ?? o.kind}, ` : ''}{o.offM < 200 ? 'on the route' : `${formatKm(o.offM)} off route`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="muted small" style={{ display: 'block' }}>
                        No mapped fuel, food, toilets or rest area near this point — plan the stop a little earlier.
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
          <h3 style={{ margin: '18px 0 6px' }}>Along the route (mapped within 2 km)</h3>
          <p className="small mt0 num">
            {plural(analysis.fuel, 'fuel station')}, {plural(analysis.food, 'place to eat', 'places to eat')}, {plural(analysis.toilets, 'toilet or rest area', 'toilets or rest areas')}.
          </p>
          {analysis.medical.length > 0 && (
            <>
              <h3 style={{ margin: '18px 0 6px' }}>Hospitals, clinics and pharmacies within 5 km</h3>
              <ul className="list card">
                {analysis.medical.slice(0, 15).map((m) => (
                  <li key={`${m.i}`}>
                    <button className="list-link" onClick={() => onShowPoint(m)}>
                      <span className="list-link__body">
                        <span className="list-link__title">{m.name || KIND_LABEL[m.kind]}</span>
                        <span className="list-link__meta num">
                          {KIND_LABEL[m.kind]}, at {formatKm(m.alongM)}, {formatKm(m.offM)} off route
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="muted small">Mapped facilities only. Opening hours, emergency and paediatric services must be confirmed by phone.</p>
            </>
          )}
          {analysis.savedNear.length > 0 && (
            <>
              <h3 style={{ margin: '18px 0 6px' }}>Your saved places near this route</h3>
              <p className="small mt0">{analysis.savedNear.map((s) => `${s.name} (${formatKm(s.offM)} off route)`).join(', ')}</p>
            </>
          )}
        </>
      )}
      {useForTrip && <UseForTripSheet route={route} trips={trips} onClose={() => setUseForTrip(false)} />}
    </section>
  );
}

function UseForTripSheet({ route, trips, onClose }: { route: RouteResult; trips: Trip[]; onClose: () => void }) {
  const [tripId, setTripId] = useState(trips[0]?.id ?? '');
  const [roundTrip, setRoundTrip] = useState(true);
  const km = Math.round((route.distanceM / 1000) * (roundTrip ? 2 : 1));
  const hours = Math.round((route.durationS / 3600) * (roundTrip ? 2 : 1) * 10) / 10;
  return (
    <Sheet title="Use this distance for a trip" onClose={onClose}>
      <Field label="Trip" htmlFor="uft">
        <select id="uft" className="select" value={tripId} onChange={(e) => setTripId(e.target.value)}>
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {tripTitle(t)}
            </option>
          ))}
        </select>
      </Field>
      <Toggle label="Round trip (there and back)" checked={roundTrip} onChange={setRoundTrip} />
      <p className="num">
        Sets the trip to {km} km and about {hours} h of driving, then updates its packing list. Ticks and edits are kept.
      </p>
      <button
        className="btn btn--primary btn--block"
        onClick={async () => {
          const t = trips.find((x) => x.id === tripId);
          if (!t) return;
          const next: Trip = { ...t, totalKm: km, kmSource: 'offline-route', totalDriveHours: hours, legs: [] };
          await saveTrip(next);
          await regenerateTrip(next);
          bump();
          showToast(`${tripTitle(t)} now uses ${km} km.`);
          onClose();
        }}
      >
        Update trip
      </button>
    </Sheet>
  );
}

