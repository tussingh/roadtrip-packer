import { useEffect, useState } from 'react';
import { regenerateTrip } from '../../app/tripService';
import { bump, showToast, useOnline } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Notice } from '../../components/ui';
import { summariseForecast } from '../../rules/weather';
import { getTrip, saveTrip } from '../../storage/repo';
import type { Assumptions, GeoPoint, Trip } from '../../types';
import { addPlaces, applyPlanToTrip, buildRoutePlan, looksHilly } from './planner';
import { searchPlaces } from './services';

const hasCoords = (p: { lat?: number; lon?: number }) => typeof p.lat === 'number' && typeof p.lon === 'number';
const geo = (p: { name: string; lat?: number; lon?: number }): GeoPoint => ({ name: p.name, lat: p.lat!, lon: p.lon! });

export function routeKey(trip: Trip): string {
  const pts = [trip.origin, ...trip.stops.filter(hasCoords), trip.destination];
  return pts.map((p) => `${p.lat?.toFixed(4)},${p.lon?.toFixed(4)}`).join('|');
}

export function fmtHours(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}

/** Wizard step: calculates route options automatically and fills km, hours, driving days. */
export function RouteStep({ trip, assumptions, useDates, onTrip }: { trip: Trip; assumptions: Assumptions; useDates: boolean; onTrip: (t: Trip) => void }) {
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ready = hasCoords(trip.origin) && hasCoords(trip.destination);
  const key = routeKey(trip);
  const planKey = trip.plan ? [trip.plan.origin, ...trip.plan.via, trip.plan.destination].map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join('|') : '';
  const stale = ready && planKey !== key;

  const calc = async () => {
    setBusy(true);
    setErr('');
    try {
      const plan = await buildRoutePlan({ origin: geo(trip.origin), destination: geo(trip.destination), via: trip.stops.filter(hasCoords).map(geo) }, assumptions);
      onTrip(applyPlanToTrip(trip, plan));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (stale && online && !busy) void calc();
  }, [key, online]); // eslint-disable-line react-hooks/exhaustive-deps

  // Typed a name but did not pick a suggestion: look it up automatically.
  const [resolving, setResolving] = useState(false);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  useEffect(() => {
    if (ready || !online || resolving) return;
    const missing = [trip.origin, trip.destination].filter((p) => p.name.trim() && !hasCoords(p));
    if (!missing.length) return;
    setResolving(true);
    (async () => {
      const found = new Map<string, GeoPoint>();
      const bad: string[] = [];
      for (const p of missing) {
        try {
          const near = hasCoords(trip.origin) ? ([trip.origin.lon!, trip.origin.lat!] as [number, number]) : undefined;
          const r = (await searchPlaces(p.name, near))[0];
          if (r) found.set(p.name, r);
          else bad.push(p.name);
        } catch {
          bad.push(p.name);
        }
      }
      setUnresolved(bad);
      const fix = (p: Trip['origin']) => {
        const r = found.get(p.name);
        return r && !hasCoords(p) ? { name: r.detail ? `${r.name}, ${r.detail}` : r.name, lat: r.lat, lon: r.lon } : p;
      };
      if (found.size) onTrip({ ...trip, origin: fix(trip.origin), destination: fix(trip.destination) });
      setResolving(false);
    })();
  }, [ready, online, trip.origin.name, trip.destination.name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready && resolving) {
    return (
      <div className="card card--pad" aria-busy="true" style={{ marginBottom: 16 }}>
        <p className="mt0" style={{ marginBottom: 0 }}>
          <Icon name="search" size={18} /> Looking up {[trip.origin, trip.destination].filter((p) => !hasCoords(p)).map((p) => p.name.split(',')[0]).join(' and ')}…
        </p>
      </div>
    );
  }
  if (!ready) {
    return (
      <Notice kind="warn">
        <p>
          <strong>Route not calculated.</strong> {unresolved.length ? `Could not find “${unresolved.join('”, “')}”. ` : ''}Go back and pick the start and destination from the suggestions (they appear as you type) to get the route, kilometres and driving time automatically. Or enter the distance yourself below.
        </p>
      </Notice>
    );
  }
  if (!online && stale) {
    return (
      <Notice kind="warn" icon="offline">
        <p>You are offline. The route will be calculated when you are back online — or enter the distance yourself below.</p>
      </Notice>
    );
  }
  if (busy || (stale && !err)) {
    return (
      <div className="card card--pad" aria-busy="true" style={{ marginBottom: 16 }}>
        <p className="mt0">
          <Icon name="route" size={18} /> Finding the best routes from {trip.origin.name.split(',')[0]} to {trip.destination.name.split(',')[0]}…
        </p>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Also checking the weather forecast and whether the road climbs into hills.
        </p>
      </div>
    );
  }
  if (err || !trip.plan) {
    return (
      <Notice kind="warn">
        <p>Could not calculate the route: {err || 'unknown error'}</p>
        <button type="button" className="btn btn--small" onClick={() => void calc()}>
          <Icon name="refresh" size={16} /> Try again
        </button>
      </Notice>
    );
  }

  const plan = trip.plan;
  const opt = plan.options[plan.chosen] ?? plan.options[0];
  const fc = plan.forecast && useDates ? summariseForecast(plan.forecast, trip.startDate, trip.endDate) : undefined;
  const daysEachWay = trip.legs.filter((l) => l.id.startsWith('out')).length || 1;

  return (
    <>
      <h3 className="section-title">Choose your route</h3>
      <div role="radiogroup" aria-label="Route options" style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
        {plan.options.map((o, i) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={i === plan.chosen}
            className="card card--pad route-opt"
            data-on={i === plan.chosen}
            onClick={() => onTrip(applyPlanToTrip(trip, { ...plan, chosen: i, places: undefined, placesFetchedAt: undefined }))}
          >
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>{o.label}</strong>
              {i === plan.chosen && <Icon name="check" size={20} style={{ color: 'var(--sign)' }} />}
            </span>
            <span className="num" style={{ display: 'block', fontSize: '1.15rem', margin: '4px 0' }}>
              {Math.round(o.distanceKm)} km · {fmtHours(o.durationH)}
            </span>
            <span className="muted small" style={{ display: 'block' }}>
              {o.highwayPct}% national highway{o.roads.length ? ` · ${o.roads.slice(0, 3).map((r) => r.name).join(', ')}` : ''}
            </span>
          </button>
        ))}
      </div>
      <div className="card card--pad" style={{ marginBottom: 16 }}>
        <p className="mt0">
          <strong>Filled in for you</strong>
        </p>
        <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
          <li className="num">
            {Math.round(opt.distanceKm)} km one way, about {fmtHours(opt.durationH)} of driving (routed time ×{assumptions.routeTimeFactor} for Indian roads)
          </li>
          <li>
            {daysEachWay > 1 ? `Long drive — split into ${daysEachWay} days each way with an overnight stop.` : 'One driving day each way.'} Total {trip.totalKm} km over {trip.drivingDays} driving day{trip.drivingDays === 1 ? '' : 's'}.
          </li>
          {plan.elevation && (
            <li>
              Road goes from {plan.elevation.min} m to {plan.elevation.max} m{looksHilly(plan) ? ' — hills/ghats detected, warm layers and motion-sickness items added.' : '.'}
            </li>
          )}
          {fc?.inRange ? (
            <li>
              Forecast at {plan.forecastFor?.split(',')[0]}: {fc.temperature}, {fc.rain === 'dry' ? 'mostly dry' : fc.rain === 'showers' ? 'some showers' : 'heavy rain likely'}.
            </li>
          ) : (
            <li className="muted">Weather forecast covers the next 16 days; for later trips the season is used.</li>
          )}
        </ul>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Restaurants, fuel, toilets, hospitals and sights along the route load after you save.
        </p>
      </div>
    </>
  );
}

/** After saving, fetch places along the route without blocking the user. */
export async function fetchPlacesInBackground(tripId: string): Promise<void> {
  try {
    const trip = await getTrip(tripId);
    if (!trip?.plan) return;
    const plan = await addPlaces(trip.plan);
    const latest = (await getTrip(tripId)) ?? trip;
    const next = applyPlanToTrip({ ...latest }, plan);
    await saveTrip(next);
    await regenerateTrip(next);
    bump();
    if (plan.placesError) showToast('Route saved, but stops could not be loaded. Open “Route & stops” to retry.');
    else showToast(`Found ${plan.places?.length ?? 0} places along the route — see “Route & stops”.`);
  } catch {
    /* the Route & stops screen offers a retry */
  }
}
