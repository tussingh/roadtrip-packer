import { useEffect, useState } from 'react';
import { regenerateTrip } from '../../app/tripService';
import { bump, navigate, showToast, useQuery } from '../../app/store';
import { Icon } from '../../components/Icon';
import { MultiSelect, Notice, Segmented, Stepper, TextInput, Toggle, TopBar } from '../../components/ui';
import { ACTIVITY_LABEL, blankTrip, localDateIso, uid } from '../../data/defaults';
import { resolveAssumptions } from '../../rules/assumptions';
import { autoWeather } from '../../rules/context';
import { getSettings, getTrip, listProfiles, saveTrip } from '../../storage/repo';
import type { Activity, Trip } from '../../types';
import { addDays } from './tripUtils';
import { PlaceSearchField } from '../planner/PlaceSearchField';
import { RouteStep, fetchPlacesInBackground } from '../planner/RouteStep';
import { applyPlanToTrip } from '../planner/planner';

const STEPS = ['Where and when', 'Your route', 'Family and stay', 'Conditions and plans'];

async function load(tripId?: string) {
  const [profiles, settings, trip] = await Promise.all([listProfiles(), getSettings(), tripId ? getTrip(tripId) : Promise.resolve(undefined)]);
  return { profiles, settings, trip };
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function TripWizard({ tripId }: { tripId?: string }) {
  const { data } = useQuery(() => load(tripId), [tripId]);
  const [trip, setTrip] = useState<Trip>();
  const [step, setStep] = useState(0);
  const [useDates, setUseDates] = useState(true);
  const [knowHours, setKnowHours] = useState(false);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!data || trip) return;
    if (data.trip) {
      setTrip(data.trip);
      setUseDates(Boolean(data.trip.startDate));
      setKnowHours(Boolean(data.trip.totalDriveHours));
    } else {
      const t = blankTrip(data.profiles.map((p) => p.id), data.settings.homeCity);
      const start = addDays(localDateIso(), 7);
      setTrip({ ...t, startDate: start, endDate: addDays(start, 1) });
    }
  }, [data, trip]);

  if (!data || !trip) return <main className="page" aria-busy="true" />;
  const editing = Boolean(tripId);
  const a = resolveAssumptions(data.settings.assumptions, trip.assumptionOverrides);
  const set = (patch: Partial<Trip>) => setTrip((t) => ({ ...t!, ...patch }));

  const setDates = (start?: string, end?: string) => {
    if (!start) return set({ startDate: undefined, endDate: undefined });
    const e = end && end >= start ? end : start;
    const nights = daysBetween(start, e);
    set({ startDate: start, endDate: e, days: nights + 1, nights, drivingDays: Math.min(trip.drivingDays || 2, nights + 1) });
  };

  const validate = (s: number): string | undefined => {
    if (s === 0) {
      if (!trip.destination.name.trim() && !trip.name.trim()) return 'Add where you are going.';
      if (useDates && !trip.startDate) return 'Pick a departure date, or switch to a number of days.';
      if (trip.nights > trip.days) return 'Nights cannot be more than days.';
    }
    if (s === 1 && trip.drivingDays > trip.days) return 'Driving days cannot be more than trip days.';
    if (s === 2 && trip.travellerIds.length === 0) return 'Choose at least one traveller.';
    return undefined;
  };

  const goNext = () => {
    const err = validate(step);
    setError(err);
    if (!err) setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const finish = async () => {
    for (let s = 0; s < STEPS.length; s++) {
      const err = validate(s);
      if (err) {
        setStep(s);
        setError(err);
        return;
      }
    }
    setBusy(true);
    try {
      const final: Trip = {
        ...trip,
        name: trip.name.trim() || trip.destination.name.split(',')[0].trim(),
        startDate: useDates ? trip.startDate : undefined,
        endDate: useDates ? trip.endDate : undefined,
        totalDriveHours: trip.kmSource === 'online-route' || knowHours ? trip.totalDriveHours : undefined,
        kmSource: trip.kmSource === 'online-route' || trip.kmSource === 'offline-route' ? trip.kmSource : trip.totalKm > 0 ? 'manual' : 'none',
      };
      await saveTrip(final);
      const res = await regenerateTrip(final);
      bump();
      if (final.plan && !final.plan.places && navigator.onLine) void fetchPlacesInBackground(final.id);
      if (editing) {
        const parts = [`${res.added} added`, `${res.removed} removed`, `${res.qtyChanged} quantities changed`];
        showToast(`List updated: ${parts.join(', ')}. Your ticks and edits were kept.`);
        navigate(`/trip/${final.id}`);
      } else {
        showToast(`Packing list ready: ${res.items.length} items.`);
        navigate(`/trip/${final.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const perDayHours = trip.drivingDays > 0 ? ((knowHours || trip.kmSource === 'online-route') && trip.totalDriveHours ? trip.totalDriveHours : trip.totalKm / a.avgSpeedKmh) / trip.drivingDays : 0;
  const auto = autoWeather(trip.startDate && useDates ? Number(trip.startDate.slice(5, 7)) : null, trip.mountains, new Set(trip.activities));

  return (
    <main className="page" style={{ paddingBottom: 'calc(var(--nav-h) + 120px)' }}>
      <TopBar title={editing ? 'Edit trip' : 'New trip'} sub={`${step + 1} of ${STEPS.length}: ${STEPS[step]}`} back={step === 0 ? (editing ? `#/trip/${tripId}` : '#/') : () => setStep(step - 1)} />
      <div className="steps" aria-hidden="true">
        {STEPS.map((s, i) => (
          <span key={s} data-on={i <= step} />
        ))}
      </div>
      {error && (
        <Notice kind="safety">
          <p>{error}</p>
        </Notice>
      )}

      {step === 0 && (
        <>
          <PlaceSearchField
            label="Starting from"
            value={trip.origin}
            allowMyLocation
            onText={(name) => set({ origin: { name } })}
            onPick={(p) => set({ origin: { name: p.name, lat: p.lat, lon: p.lon } })}
          />
          <PlaceSearchField
            label="Going to"
            value={trip.destination}
            placeholder="e.g. Madikeri, Coorg"
            near={trip.origin.lon !== undefined ? [trip.origin.lon, trip.origin.lat!] : undefined}
            onText={(name) => set({ destination: { name } })}
            onPick={(p) => set({ destination: { name: p.name, lat: p.lat, lon: p.lon } })}
          />
          {trip.stops.map((s, i) => (
            <div key={s.id} className="card card--pad" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <PlaceSearchField
                    label={`Stop ${i + 1} on the way`}
                    value={s}
                    onText={(name) => set({ stops: trip.stops.map((x) => (x.id === s.id ? { ...x, name, lat: undefined, lon: undefined } : x)) })}
                    onPick={(p) => set({ stops: trip.stops.map((x) => (x.id === s.id ? { ...x, name: p.name, lat: p.lat, lon: p.lon } : x)) })}
                  />
                </div>
                <button type="button" className="icon-btn" aria-label={`Remove stop ${i + 1}`} onClick={() => set({ stops: trip.stops.filter((x) => x.id !== s.id) })} style={{ marginTop: 28 }}>
                  <Icon name="trash" />
                </button>
              </div>
              <Toggle label="Staying overnight here" checked={s.overnight} onChange={(v) => set({ stops: trip.stops.map((x) => (x.id === s.id ? { ...x, overnight: v } : x)) })} />
            </div>
          ))}
          <button type="button" className="btn btn--small" style={{ marginBottom: 16 }} onClick={() => set({ stops: [...trip.stops, { id: uid(), name: '', overnight: false }] })}>
            <Icon name="plus" size={18} /> Add a stop on the way
          </button>
          <Toggle label="I know the dates" hint="Dates give a real weather forecast, your child’s exact age and packing reminders." checked={useDates} onChange={setUseDates} />
          {useDates ? (
            <div className="two-col">
              <TextInput label="Leave on" type="date" value={trip.startDate ?? ''} onChange={(v) => setDates(v || undefined, trip.endDate)} />
              <TextInput label="Return on" type="date" min={trip.startDate} value={trip.endDate ?? ''} onChange={(v) => setDates(trip.startDate, v)} />
            </div>
          ) : (
            <div className="two-col">
              <Stepper label="Days" value={trip.days} min={1} max={60} onChange={(v) => set({ days: v, nights: Math.min(trip.nights, v), drivingDays: Math.min(trip.drivingDays, v) })} />
              <Stepper label="Nights" value={trip.nights} min={0} max={trip.days} onChange={(v) => set({ nights: v })} />
            </div>
          )}
          {useDates && trip.startDate && (
            <p className="muted small mt0">
              {trip.days} day{trip.days === 1 ? '' : 's'}, {trip.nights} night{trip.nights === 1 ? '' : 's'}
            </p>
          )}
          <TextInput label="Trip name" hint="Optional — the destination is used if you leave this empty." placeholder={trip.destination.name || 'Weekend in the hills'} value={trip.name} onChange={(v) => set({ name: v })} />
        </>
      )}

      {step === 1 && (
        <>
          <RouteStep trip={trip} assumptions={a} useDates={useDates} onTrip={(t) => setTrip(t)} />
          <Toggle label="Return by the same route" checked={trip.returnSameRoute} onChange={(v) => setTrip(trip.plan ? applyPlanToTrip({ ...trip, returnSameRoute: v }, trip.plan) : { ...trip, returnSameRoute: v })} />
          <Toggle label="Adjust distance and driving time myself" hint={trip.kmSource === 'online-route' ? 'Only needed if the calculated route is not how you will drive.' : 'Needed when offline or when the places were typed without picking a suggestion.'} checked={manual || trip.kmSource !== 'online-route'} onChange={setManual} />
          {(manual || trip.kmSource !== 'online-route') && (
            <>
              <Stepper label="Total driving distance" hint="Whole trip, there and back, in kilometres." value={trip.totalKm} min={0} max={10000} step={10} suffix="km" onChange={(v) => set({ totalKm: v, kmSource: v > 0 ? 'manual' : 'none', legs: [] })} />
              <Stepper label="Driving days" hint="Days with a significant drive — usually the outward and return days." value={trip.drivingDays} min={0} max={trip.days} onChange={(v) => set({ drivingDays: v, legs: [] })} />
              <Toggle label="I know how long the driving takes" hint={`Otherwise estimated at ${a.avgSpeedKmh} km/h, including towns and stops.`} checked={knowHours} onChange={setKnowHours} />
              {knowHours && <Stepper label="Total hours in the car" value={trip.totalDriveHours ?? Math.round((trip.totalKm / a.avgSpeedKmh) * 2) / 2} min={0} max={200} step={0.5} suffix="h" onChange={(v) => set({ totalDriveHours: v, legs: [] })} />}
              {trip.drivingDays > 0 && trip.totalKm > 0 && (
                <Notice>
                  <p className="num">
                    About {Math.round(trip.totalKm / trip.drivingDays)} km and {Math.round(perDayHours * 10) / 10} h per driving day.
                  </p>
                </Notice>
              )}
            </>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <MultiSelect
            label="Who is travelling"
            hint={<a href="#/profiles">Edit family profiles</a>}
            values={trip.travellerIds}
            options={data.profiles.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(v) => set({ travellerIds: v })}
          />
          <Segmented
            label="Where you are staying"
            value={trip.accommodation}
            onChange={(v) => set({ accommodation: v })}
            options={[
              { value: 'hotel', label: 'Hotel' },
              { value: 'resort', label: 'Resort' },
              { value: 'homestay', label: 'Homestay' },
              { value: 'family', label: 'Family / friends' },
              { value: 'camping', label: 'Camping' },
            ]}
          />
          <Segmented
            label="Laundry"
            hint="Laundry reduces clothing — not diapers, food or medicines."
            value={trip.laundry}
            onChange={(v) => set({ laundry: v })}
            options={[
              { value: 'none', label: 'None' },
              { value: 'midway', label: 'Once, midway' },
              { value: 'anytime', label: `Every ${a.laundryEveryDays} days` },
            ]}
          />
        </>
      )}

      {step === 3 && (
        <>
          <MultiSelect<Activity> label="Planned activities" values={trip.activities} onChange={(v) => set({ activities: v })} options={(Object.keys(ACTIVITY_LABEL) as Activity[]).map((k) => ({ value: k, label: ACTIVITY_LABEL[k] }))} />
          <Segmented
            label="Temperature"
            hint={trip.temperature === 'auto' ? `Auto uses a South-India seasonal guess: ${auto.temperature}. This app has no live weather.` : undefined}
            value={trip.temperature}
            onChange={(v) => set({ temperature: v })}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'hot', label: 'Hot' },
              { value: 'warm', label: 'Warm' },
              { value: 'mild', label: 'Mild' },
              { value: 'cool', label: 'Cool' },
              { value: 'cold', label: 'Cold' },
            ]}
          />
          <Segmented
            label="Rain"
            hint={trip.rain === 'auto' ? `Auto: ${auto.rain} for the travel month.` : undefined}
            value={trip.rain}
            onChange={(v) => set({ rain: v })}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'dry', label: 'Dry' },
              { value: 'showers', label: 'Showers' },
              { value: 'monsoon', label: 'Monsoon' },
            ]}
          />
          <Toggle label="Hills or ghat roads" hint="Adds motion-sickness, brake and layering items." checked={trip.mountains} onChange={(v) => set({ mountains: v })} />
          <Toggle label="Remote stretches" hint="Long gaps between fuel, food, pharmacies or hospitals." checked={trip.remote} onChange={(v) => set({ remote: v, resupply: v && trip.resupply === 'good' ? 'limited' : !v ? 'good' : trip.resupply })} />
          {trip.remote && (
            <Segmented
              label="How easy is it to restock on the way?"
              value={trip.resupply}
              onChange={(v) => set({ resupply: v })}
              options={[
                { value: 'limited', label: 'Limited' },
                { value: 'poor', label: 'Very poor' },
              ]}
            />
          )}
          <Toggle label="Driving at night" checked={trip.overnightDriving} onChange={(v) => set({ overnightDriving: v })} />
        </>
      )}

      <div className="wizard-foot">
        <div>
          {step < STEPS.length - 1 ? (
            <>
              {step >= 1 && (
                <button className="btn" onClick={finish} disabled={busy}>
                  {editing ? 'Save now' : 'Create now'}
                </button>
              )}
              <button className="btn btn--primary" onClick={goNext}>
                Next
              </button>
            </>
          ) : (
            <button className="btn btn--primary" onClick={finish} disabled={busy}>
              {busy ? 'Building list…' : editing ? 'Save and update list' : 'Create trip and list'}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
