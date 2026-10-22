import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { regenerateTrip } from '../../app/tripService';
import { bump, showToast, useOnline, useQuery } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Empty, Notice, TopBar } from '../../components/ui';
import { resolveAssumptions } from '../../rules/assumptions';
import { summariseForecast } from '../../rules/weather';
import { getSettings, getTrip, listProfiles, saveTrip } from '../../storage/repo';
import type { PlannedPlace, Trip, TripPlan } from '../../types';
import { tripTitle } from '../trips/tripUtils';
import { departureAdvice, fmtClock, fuelCost, fuelGaps, googleDirectionsUrl, googlePlaceUrl, hospitalsAlong, planStops, rankDestinationSights, restaurantsEvery, sightsAlong } from './analyze';
import type { RoutePin } from './OnlineMap';
import { applyPlanToTrip, onPlacesJob, placesJob } from './planner';
import { fetchPlacesInBackground, fmtHours } from './RouteStep';
import { OFM_ATTRIBUTION, saveRouteMap, type SaveProgress } from './offlineTiles';

const OnlineMap = lazy(() => import('./OnlineMap'));

async function load(id: string) {
  const [trip, settings, profiles] = await Promise.all([getTrip(id), getSettings(), listProfiles()]);
  return { trip, settings, profiles };
}

const KIND_LABEL: Record<string, string> = {
  restaurant: 'Restaurant', fast_food: 'Quick food', cafe: 'Café', fuel: 'Fuel', toilets: 'Toilets', rest_area: 'Rest area', services: 'Highway services', hospital: 'Hospital', clinic: 'Clinic',
  attraction: 'Attraction', viewpoint: 'Viewpoint', museum: 'Museum', zoo: 'Zoo', theme_park: 'Theme park', waterfall: 'Waterfall', fort: 'Fort', monument: 'Monument', castle: 'Palace / castle', ruins: 'Ruins', archaeological_site: 'Heritage site', temple: 'Temple', lake: 'Lake', dam: 'Dam', park: 'Park',
};

const WEATHER_CODE = (c: number) => (c >= 95 ? 'Thunderstorm' : c >= 80 ? 'Showers' : c >= 61 ? 'Rain' : c >= 51 ? 'Drizzle' : c >= 45 ? 'Fog' : c >= 2 ? 'Cloudy' : 'Clear');

function GLink({ p, label = 'Reviews & photos' }: { p: { name: string; lat: number; lon: number }; label?: string }) {
  return (
    <a className="btn btn--small" href={googlePlaceUrl(p)} target="_blank" rel="noopener noreferrer">
      <Icon name="pin" size={16} /> {label}
    </a>
  );
}

function PlaceLine({ p, extra }: { p: PlannedPlace; extra?: string }) {
  return (
    <span className="muted small" style={{ display: 'block' }}>
      {KIND_LABEL[p.kind] ?? p.kind} · km {Math.round(p.alongKm)}
      {p.offKm >= 0.3 ? ` · ${p.offKm} km off the road` : ' · on the road'}
      {p.tags.cuisine ? ` · ${p.tags.cuisine.replace(/_/g, ' ').replace(/;/g, ', ')}` : ''}
      {p.tags.opening_hours ? ` · ${p.tags.opening_hours}` : ''}
      {extra ? ` · ${extra}` : ''}
    </span>
  );
}

export function TripPlanView({ tripId }: { tripId: string }) {
  const { data } = useQuery(() => load(tripId), [tripId]);
  const online = useOnline();
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState<SaveProgress>();
  const [, setJobTick] = useState(0);
  useEffect(() => onPlacesJob(() => setJobTick((n) => n + 1)), []);
  const job = placesJob(tripId);
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.dataset.theme === 'dark'));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  const trip = data?.trip;
  const plan = trip?.plan;
  const opt = plan ? plan.options[plan.chosen] ?? plan.options[0] : undefined;
  const a = data ? resolveAssumptions(data.settings.assumptions, trip?.assumptionOverrides) : undefined;
  const hasChild = Boolean(data && trip && data.profiles.some((p) => trip.travellerIds.includes(p.id) && p.kind === 'child'));

  const derived = useMemo(() => {
    if (!trip || !plan || !opt || !a) return undefined;
    const places = plan.places ?? [];
    const advice = departureAdvice({ durationH: trip.legs[0]?.hours ?? opt.durationH, breakEveryH: hasChild ? a.restBreakEveryHoursWithChild : a.restBreakEveryHoursAdults, originName: plan.origin.name, date: trip.startDate, dest: plan.destination, mountains: trip.mountains, hasChild });
    return {
      advice,
      stops: planStops(opt, places, hasChild ? a.restBreakEveryHoursWithChild : a.restBreakEveryHoursAdults, advice.departH),
      food: restaurantsEvery(opt, places, 100, 3),
      sights: sightsAlong(places, 8),
      destSights: rankDestinationSights(plan.destinationSights ?? [], plan.destination, 10),
      hospitals: hospitalsAlong(places, opt, 50),
      gaps: places.length ? fuelGaps(places, opt, 80) : [],
      fc: plan.forecast ? summariseForecast(plan.forecast, trip.startDate, trip.endDate) : undefined,
    };
  }, [trip, plan, opt, a, hasChild]);

  useEffect(() => {
    if (trip && plan && !plan.places && !plan.placesError && online && !placesJob(trip.id)) void fetchPlacesInBackground(trip.id);
  }, [trip?.id, plan?.places, plan?.placesError, online]); // eslint-disable-line react-hooks/exhaustive-deps

  const pins = useMemo<RoutePin[]>(() => {
    if (!plan || !derived) return [];
    const out: RoutePin[] = [
      { ...plan.origin, label: plan.origin.name.split(',')[0], kind: 'start' },
      { ...plan.destination, label: plan.destination.name.split(',')[0], kind: 'end' },
    ];
    for (const w of derived.food) if (w.picks[0]) out.push({ lat: w.picks[0].place.lat, lon: w.picks[0].place.lon, label: w.picks[0].place.name, kind: 'food', href: googlePlaceUrl(w.picks[0].place) });
    for (const s of derived.stops) if (s.main) out.push({ lat: s.main.lat, lon: s.main.lon, label: `${s.clock ?? ''} ${s.meal ?? 'Break'}: ${s.main.name || KIND_LABEL[s.main.kind]}`, kind: 'stop', href: googlePlaceUrl(s.main) });
    for (const s of derived.sights) out.push({ lat: s.lat, lon: s.lon, label: s.name, kind: 'sight', href: googlePlaceUrl(s) });
    for (const h of derived.hospitals) out.push({ lat: h.lat, lon: h.lon, label: h.name, kind: 'hospital', href: googlePlaceUrl(h) });
    return out;
  }, [plan, derived]);

  if (!data) return <main className="page" aria-busy="true" />;
  if (!trip) return <main className="page"><TopBar title="Route & stops" back="#/" /><Empty icon="route" title="Trip not found" /></main>;
  if (!plan || !opt || !derived || !a) {
    return (
      <main className="page">
        <TopBar title="Route & stops" sub={tripTitle(trip)} back={`#/trip/${trip.id}`} />
        <Empty icon="route" title="No route yet" action={<a className="btn btn--primary" href={`#/trip/${trip.id}/edit`}>Pick start and destination</a>}>
          Edit the trip and choose the start and destination from the suggestions. The app then finds the route, distance, driving time, stops, restaurants and sights automatically.
        </Empty>
      </main>
    );
  }

  const persist = async (next: Trip, msg?: string) => {
    await saveTrip(next);
    await regenerateTrip(next);
    bump();
    if (msg) showToast(msg);
  };

  const loadPlaces = async (fresh = false) => {
    if (fresh) await saveTrip({ ...trip, plan: { ...plan, places: undefined, placesFetchedAt: undefined, placesError: undefined } });
    await fetchPlacesInBackground(trip.id);
  };

  const chooseRoute = async (i: number) => {
    const p: TripPlan = { ...plan, chosen: i, places: undefined, placesFetchedAt: undefined, placesError: undefined, offlineMap: undefined };
    await persist(applyPlanToTrip(trip, p));
    if (online) void loadPlaces();
  };

  const saveOffline = async () => {
    setBusy('map');
    setProgress({ done: 0, total: 1, bytes: 0 });
    try {
      const r = await saveRouteMap(opt.geometry, [plan.destination.lon, plan.destination.lat], setProgress);
      await persist({ ...trip, plan: { ...plan, offlineMap: { tiles: r.tiles, bytes: r.bytes, savedAt: new Date().toISOString() } } }, `Map saved for offline: ${r.tiles} pieces, ${(r.bytes / 1048576).toFixed(1)} MB.`);
    } catch (e) {
      showToast(`Map not saved: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy('');
      setProgress(undefined);
    }
  };

  const fuel = data.settings.car ? fuelCost(trip.totalKm, data.settings.car.mileageKmpl, data.settings.car.fuelPricePerLitre) : fuelCost(trip.totalKm, 15, 103);

  const planText = () => {
    const L = [`🚗 ${tripTitle(trip)}: ${plan.origin.name.split(',')[0]} → ${plan.destination.name.split(',')[0]}`, `${Math.round(opt.distanceKm)} km, about ${fmtHours(opt.durationH)} (${opt.label})`, `Leave by ${fmtClock(derived.advice.departH)}, arrive about ${fmtClock(derived.advice.arriveH)}`, ''];
    for (const s of derived.stops) L.push(`${s.clock ?? `after ${fmtHours(s.atH)}`} · km ${s.atKm} · ${s.meal ?? 'Break'}${s.main ? `: ${s.main.name || KIND_LABEL[s.main.kind]} ${googlePlaceUrl(s.main)}` : ''}`);
    L.push('', `Directions: ${googleDirectionsUrl(plan.origin, plan.destination, plan.via)}`);
    return L.join('\n');
  };
  const share = async () => {
    const text = planText();
    try {
      if (navigator.share) await navigator.share({ title: tripTitle(trip), text });
      else {
        await navigator.clipboard.writeText(text);
        showToast('Plan copied — paste it into WhatsApp.');
      }
    } catch {
      /* cancelled */
    }
  };

  const places = plan.places;

  return (
    <main className="page">
      <TopBar title="Route & stops" sub={tripTitle(trip)} back={`#/trip/${trip.id}`} actions={<button className="icon-btn" aria-label="Share plan" onClick={() => void share()}><Icon name="upload" /></button>} />

      <div className="card card--pad" style={{ marginBottom: 12 }}>
        <p className="mt0 muted small">{opt.label}</p>
        <p className="num" style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, margin: '0 0 4px' }}>
          {Math.round(opt.distanceKm)} km · {fmtHours(opt.durationH)}
        </p>
        <p className="small" style={{ margin: 0 }}>
          {plan.origin.name.split(',')[0]} → {plan.via.map((v) => v.name.split(',')[0] + ' → ').join('')}
          {plan.destination.name.split(',')[0]}
          {opt.roads.length ? ` via ${opt.roads.slice(0, 3).map((r) => r.name).join(', ')}` : ''}
        </p>
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Leave by</dt>
          <dd className="num">{fmtClock(derived.advice.departH)}</dd>
          <dt>Arrive about</dt>
          <dd className="num">
            {fmtClock(derived.advice.arriveH)} with {derived.advice.breaks} break{derived.advice.breaks === 1 ? '' : 's'}
            {derived.advice.sunsetH ? ` (sunset ${fmtClock(derived.advice.sunsetH)})` : ''}
          </dd>
          <dt>Fuel</dt>
          <dd className="num">
            ≈ {fuel.litres} L, ₹{fuel.rupees.toLocaleString('en-IN')} for {trip.totalKm} km{data.settings.car ? '' : ' (15 km/L, ₹103/L — set your car in Settings)'}
          </dd>
          {plan.elevation && (
            <>
              <dt>Altitude</dt>
              <dd className="num">
                {plan.elevation.min}–{plan.elevation.max} m{trip.mountains ? ' · ghat roads' : ''}
              </dd>
            </>
          )}
        </dl>
        <div className="row-actions" style={{ marginTop: 12 }}>
          <a className="btn btn--primary" style={{ flex: 1 }} href={googleDirectionsUrl(plan.origin, plan.destination, plan.via)} target="_blank" rel="noopener noreferrer">
            <Icon name="route" /> Navigate in Google Maps
          </a>
        </div>
      </div>

      {derived.advice.overnightSuggested && (
        <Notice kind="warn">
          <p>{derived.advice.notes.find((n) => n.includes('overnight')) ?? 'Long drive — consider an overnight stop.'}</p>
        </Notice>
      )}

      <section className="section" aria-label="Map">
        {online || plan.offlineMap ? (
          <Suspense fallback={<div className="map map--fallback muted small">Loading map…</div>}>
            <OnlineMap route={opt.geometry} pins={pins} dark={dark} />
          </Suspense>
        ) : (
          <div className="map map--fallback muted small">Offline — this route’s map was not saved. Use “Save map for offline” next time you have signal.</div>
        )}
        <p className="muted small" style={{ margin: '6px 0' }}>
          <span style={{ color: '#d9480f' }}>●</span> best food every 100 km <span style={{ color: '#F2B705' }}>●</span> planned breaks <span style={{ color: '#7a3fb0' }}>●</span> sights <span style={{ color: '#b3261e' }}>●</span> hospitals · Map {OFM_ATTRIBUTION}
        </p>
        <div className="card card--pad">
          {plan.offlineMap ? (
            <p className="mt0 small">
              <Icon name="check" size={16} style={{ color: 'var(--ok)' }} /> Map saved on this phone for offline use ({(plan.offlineMap.bytes / 1048576).toFixed(1)} MB, {new Date(plan.offlineMap.savedAt).toLocaleDateString('en-IN')}). Works in no-signal ghat sections.
            </p>
          ) : (
            <p className="mt0 small">Save this route’s map so it still shows in ghats and no-signal stretches. About 5–40 MB.</p>
          )}
          {progress && (
            <p className="num small">
              Saving… {Math.round((progress.done / Math.max(1, progress.total)) * 100)}% ({(progress.bytes / 1048576).toFixed(1)} MB)
            </p>
          )}
          <button type="button" className="btn" disabled={!online || busy === 'map'} onClick={() => void saveOffline()}>
            <Icon name="download" /> {plan.offlineMap ? 'Update offline map' : 'Save map for offline'}
          </button>
          <p className="muted small" style={{ marginBottom: 0 }}>
            For turn-by-turn voice navigation use Google Maps; also download the area in Google Maps (Offline maps) as a backup.
          </p>
        </div>
      </section>

      {plan.options.length > 1 && (
        <section className="section">
          <div className="section-head">
            <h2>Other routes</h2>
          </div>
          <ul className="list card">
            {plan.options.map((o, i) => (
              <li key={o.id}>
                <button type="button" className="list-link" onClick={() => void chooseRoute(i)} aria-current={i === plan.chosen}>
                  <span className="list-link__body">
                    <span className="list-link__title">
                      {o.label} {i === plan.chosen && '✓'}
                    </span>
                    <span className="list-link__meta num">
                      {Math.round(o.distanceKm)} km · {fmtHours(o.durationH)} · {o.highwayPct}% national highway
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!places && (
        <Notice kind={plan.placesError ? 'warn' : 'info'}>
          <p>{job ? job.message : plan.placesError ? `Places could not be loaded: ${plan.placesError}` : 'Restaurants, stops and sights have not been loaded yet.'}</p>
          {!job && (
            <button type="button" className="btn btn--small" disabled={!online} onClick={() => void loadPlaces()}>
              <Icon name="refresh" size={16} /> {online ? 'Find stops and restaurants' : 'Needs internet'}
            </button>
          )}
        </Notice>
      )}

      {places && (
        <>
          <section className="section">
            <div className="section-head">
              <h2>Your drive, with breaks</h2>
            </div>
            <p className="muted small mt0">A break about every {hasChild ? a.restBreakEveryHoursWithChild : a.restBreakEveryHoursAdults} h{hasChild ? ' for changes and feeds' : ''}. Times assume you leave at {fmtClock(derived.advice.departH)}.</p>
            <ol className="drive-tl">
              <li>
                <b className="num">{fmtClock(derived.advice.departH)}</b> Leave {plan.origin.name.split(',')[0]} with a full tank
              </li>
              {derived.stops.map((s, i) => (
                <li key={i} data-meal={s.meal ? 'yes' : undefined}>
                  <b className="num">{s.clock}</b> {s.meal ?? 'Break'} · km {s.atKm}
                  {s.main ? (
                    <div>
                      <strong>{s.main.name || KIND_LABEL[s.main.kind]}</strong>
                      <PlaceLine p={s.main} />
                    </div>
                  ) : (
                    <div className="muted small">{s.why}</div>
                  )}
                  <div className="muted small">
                    {s.fuel ? `Fuel: ${s.fuel.name || 'pump'} (km ${Math.round(s.fuel.alongKm)})` : 'No pump mapped right here'}
                    {s.toilets ? ' · toilets nearby' : ''}
                  </div>
                  {s.main && <GLink p={s.main} />}
                </li>
              ))}
              <li>
                <b className="num">{fmtClock(derived.advice.arriveH)}</b> Arrive {plan.destination.name.split(',')[0]}
              </li>
            </ol>
          </section>

          <section className="section">
            <div className="section-head">
              <h2>Best food every 100 km</h2>
            </div>
            <p className="muted small mt0">OpenStreetMap has no star ratings, so picks favour family-friendly signals: Indian/vegetarian food, known chains, toilets, high chairs, and being right on the highway. Tap for Google reviews before you stop.</p>
            {derived.food.map((w) => (
              <div key={w.fromKm} className="card card--pad" style={{ marginBottom: 8 }}>
                <p className="mt0 muted small num">
                  km {w.fromKm}–{w.toKm} · around {fmtClock(derived.advice.departH + w.atHour)}
                </p>
                {w.picks.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>No mapped restaurants right on the route here — eat at the previous stop or carry snacks.</p>
                ) : (
                  w.picks.map((pk, j) => (
                    <div key={pk.place.id} style={{ marginTop: j ? 10 : 0, paddingTop: j ? 10 : 0, borderTop: j ? '1px solid var(--kerb)' : undefined }}>
                      <strong>
                        {j === 0 ? '★ ' : ''}
                        {pk.place.name}
                      </strong>
                      <PlaceLine p={pk.place} />
                      {pk.why.length > 0 && <span className="small" style={{ display: 'block' }}>{pk.why.join(' · ')}</span>}
                      <div style={{ marginTop: 6 }}>
                        <GLink p={pk.place} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            ))}
          </section>

          {derived.sights.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>Worth a stop on the way</h2>
              </div>
              <ul className="list card">
                {derived.sights.map((s) => (
                  <li key={s.id} style={{ padding: '10px 16px' }}>
                    <strong>{s.name}</strong>
                    <PlaceLine p={s} />
                    <GLink p={s} label="See in Google Maps" />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {derived.gaps.length > 0 && (
            <Notice kind="warn" icon="warn">
              <p>
                <strong>Long stretch without a mapped fuel station:</strong> {derived.gaps.map((g) => `km ${g.fromKm}–${g.toKm}`).join(', ')}. Fill up before it. Carry extra water and snacks.
              </p>
            </Notice>
          )}

          {derived.hospitals.length > 0 && (
            <details className="card card--pad section">
              <summary>
                <strong>Hospitals along the route ({derived.hospitals.length})</strong>
              </summary>
              <ul className="list" style={{ marginTop: 8 }}>
                {derived.hospitals.map((h) => (
                  <li key={h.id} style={{ padding: '8px 0' }}>
                    <strong>{h.name}</strong>
                    <PlaceLine p={h} extra={h.tags.emergency === 'yes' ? 'emergency' : undefined} />
                    {(h.tags.phone || h.tags['contact:phone']) && (
                      <a href={`tel:${(h.tags.phone || h.tags['contact:phone']).split(/[;,]/)[0].replace(/\s/g, '')}`} className="btn btn--small" style={{ marginRight: 8 }}>
                        Call
                      </a>
                    )}
                    <GLink p={h} label="Directions" />
                  </li>
                ))}
              </ul>
              <p className="muted small">Emergency: dial 112 (all services) or 108 (ambulance).</p>
            </details>
          )}
        </>
      )}

      {derived.destSights.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Things to see around {plan.destination.name.split(',')[0]}</h2>
          </div>
          <ul className="list card">
            {derived.destSights.map((s) => (
              <li key={s.id} style={{ padding: '10px 16px' }}>
                <strong>{s.name}</strong>
                <span className="muted small" style={{ display: 'block' }}>
                  {KIND_LABEL[s.kind] ?? s.kind} · {s.distKm} km from {plan.destination.name.split(',')[0]}
                </span>
                <GLink p={s} label="See in Google Maps" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan.forecast && plan.forecast.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Weather at {plan.forecastFor?.split(',')[0]}</h2>
          </div>
          {derived.fc?.inRange ? (
            <p className="small mt0">
              For your dates: <strong>{derived.fc.temperature}</strong>, {derived.fc.rain === 'dry' ? 'mostly dry' : derived.fc.rain === 'showers' ? 'some showers' : 'heavy rain likely'}. The packing list uses this.
            </p>
          ) : (
            <p className="muted small mt0">Your dates are beyond the 16-day forecast; the list uses the usual weather for the season. Open this screen closer to the trip to refresh.</p>
          )}
          <div className="forecast" role="table" aria-label="Forecast">
            {plan.forecast
              .filter((d) => !trip.startDate || (d.date >= trip.startDate && d.date <= (trip.endDate ?? trip.startDate)))
              .concat(trip.startDate && plan.forecast.some((d) => d.date >= trip.startDate!) ? [] : plan.forecast.slice(0, 7))
              .slice(0, 10)
              .map((d) => (
                <div key={d.date} role="row" className="forecast__day">
                  <span>{new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}</span>
                  <b className="num">
                    {Math.round(d.tMax)}° / {Math.round(d.tMin)}°
                  </b>
                  <span className="small">{WEATHER_CODE(d.code)}</span>
                  <span className="small muted num">{d.rainProb}% rain</span>
                </div>
              ))}
          </div>
          <p className="muted small">Forecast: Open-Meteo.com</p>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Good to know</h2>
        </div>
        <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.6 }}>
          {derived.advice.notes
            .filter((n) => !n.includes('overnight'))
            .map((n) => (
              <li key={n}>{n}</li>
            ))}
          {opt.highwayPct >= 40 && <li>Mostly national highway: keep FASTag recharged (tolls add roughly ₹1.5–3 per km for cars) and some cash for state-border permits or parking.</li>}
          {trip.returnSameRoute && <li>The return drive uses the same route; the same stops work in reverse.</li>}
          <li>Do not drive more than 2–2.5 h at a stretch with a toddler; a 20-minute break also keeps the driver alert.</li>
          <li>Child seat rear-facing as long as possible; never hold the baby on a lap in a moving car.</li>
        </ul>
        <p className="muted small">
          Route: OSRM / OpenStreetMap · Places © OpenStreetMap contributors · {plan.placesFetchedAt ? `places updated ${new Date(plan.placesFetchedAt).toLocaleDateString('en-IN')}` : `route updated ${new Date(plan.fetchedAt).toLocaleDateString('en-IN')}`}. Only the start, stops and destination are sent to these free services — never your family details.
        </p>
        {places && job && <p className="small">{job.message}</p>}
        {places && (
          <button type="button" className="btn btn--small" disabled={!online || Boolean(job)} onClick={() => void loadPlaces(true)}>
            <Icon name="refresh" size={16} /> Refresh places
          </button>
        )}
      </section>
    </main>
  );
}
