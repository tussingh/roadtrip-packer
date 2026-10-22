import { useMemo, useState } from 'react';
import { regenerateTrip } from '../../app/tripService';
import { bump, navigate, showToast, useQuery } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Bar, downloadText, Empty, Sheet, Stepper, TopBar } from '../../components/ui';
import { CATEGORY_LABEL, localDateIso, nowIso, uid } from '../../data/defaults';
import { ASSUMPTION_DEFS, DEFAULT_ASSUMPTIONS, resolveAssumptions } from '../../rules/assumptions';
import { deriveFacts, describeAge } from '../../rules/context';
import { buildSchedule, groupProgress, progressOf, readiness, remindersToIcs } from '../../rules/progress';
import { deleteTrip, getChecklist, getSettings, getTrip, listProfiles, saveTrip } from '../../storage/repo';
import type { Assumptions, Trip } from '../../types';
import { TripSign } from '../dashboard/Dashboard';
import { daysUntil, fmtDate, nameOf, tripTitle } from './tripUtils';

async function load(id: string) {
  const [trip, items, profiles, settings] = await Promise.all([getTrip(id), getChecklist(id), listProfiles(), getSettings()]);
  return { trip, items, profiles, settings };
}

const LAUNDRY_TEXT = { none: 'No laundry', midway: 'Laundry once, midway', anytime: 'Laundry available' };

export function TripSummary({ tripId }: { tripId: string }) {
  const { data } = useQuery(() => load(tripId), [tripId]);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const derived = useMemo(() => {
    if (!data?.trip) return undefined;
    const a = resolveAssumptions(data.settings.assumptions, data.trip.assumptionOverrides);
    return { a, facts: deriveFacts(data.trip, data.profiles, a, new Date()) };
  }, [data]);

  if (!data) return <main className="page" aria-busy="true" />;
  const { trip, items, profiles } = data;
  if (!trip || !derived) {
    return (
      <main className="page">
        <TopBar title="Trip" back="#/trips" />
        <Empty icon="calendar" title="Trip not found">
          It may have been deleted on this device.
        </Empty>
      </main>
    );
  }
  const { facts } = derived;
  const active = items.filter((i) => !i.stale);
  const prog = progressOf(active);
  const ready = readiness(active);
  const byPerson = groupProgress(active, (i) => i.assigneeId);
  const byCat = groupProgress(active, (i) => i.category);
  const schedule = buildSchedule(trip, items, localDateIso());
  const overrides = Object.keys(trip.assumptionOverrides).length;
  const ended = (daysUntil(trip.endDate ?? trip.startDate) ?? 1) < 0;

  const exportIcs = () => {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    downloadText(`${tripTitle(trip).replace(/[^\w-]+/g, '-')}-packing.ics`, remindersToIcs(tripTitle(trip), schedule, stamp), 'text/calendar');
  };

  const planAgain = async () => {
    const copy: Trip = { ...trip, id: uid(), name: `${tripTitle(trip)} (again)`, startDate: undefined, endDate: undefined, status: 'planning', createdAt: nowIso(), updatedAt: nowIso(), generatedAt: undefined };
    await saveTrip(copy);
    await regenerateTrip(copy);
    bump();
    navigate(`/trip/${copy.id}/edit`);
  };

  return (
    <main className="page">
      <TopBar
        title={tripTitle(trip)}
        back="#/trips"
        actions={
          <a className="icon-btn" href={`#/trip/${trip.id}/edit`} aria-label="Edit trip">
            <Icon name="edit" />
          </a>
        }
      />
      <TripSign trip={trip} pct={prog.pct} travellers={trip.travellerIds.length} />

      <div className="stat-row" style={{ marginTop: 12 }}>
        <div>
          <b className="num">{prog.total}</b>
          <span>items and checks</span>
        </div>
        <div>
          <b className="num">{ready.essentialsLeft.length}</b>
          <span>essentials left</span>
        </div>
        <div>
          <b className="num">{ready.toBuy.length}</b>
          <span>to buy</span>
        </div>
      </div>

      <div className="row-actions" style={{ marginTop: 12 }}>
        <a className="btn btn--primary" style={{ flex: 1 }} href={`#/trip/${trip.id}/pack`}>
          <Icon name="pack" /> Open checklist
        </a>
        <a className="btn" href={`#/trip/${trip.id}/ready`}>
          <Icon name="flag" /> Readiness
        </a>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>What the list is based on</h2>
          <a href={`#/trip/${trip.id}/edit`}>Change</a>
        </div>
        <div className="card card--pad">
          <dl className="kv">
            <dt>Route</dt>
            <dd>
              {trip.origin.name || 'Start'} to {trip.destination.name || 'destination'}
              {trip.stops.length ? `, via ${trip.stops.map((s) => s.name || 'stop').join(', ')}` : ''}
            </dd>
            <dt>Distance</dt>
            <dd className="num">
              {facts.totalKm > 0 ? `${Math.round(facts.totalKm)} km ${trip.kmSource === 'offline-route' ? '(offline road route)' : '(entered)'}` : 'Not entered — vehicle items assume local driving'}
            </dd>
            <dt>Driving</dt>
            <dd className="num">
              {facts.drivingDays ? `${facts.drivingDays} day${facts.drivingDays === 1 ? '' : 's'}, longest ${facts.maxDriveHours} h${trip.totalDriveHours ? '' : ' (estimated)'}` : 'No driving days'}
            </dd>
            <dt>Weather</dt>
            <dd>
              {facts.temperature}
              {facts.temperatureAuto ? ' (seasonal guess)' : ''}, {facts.rain}
              {facts.rainAuto ? ' (seasonal guess)' : ''}
            </dd>
            <dt>Stay</dt>
            <dd>
              {trip.accommodation}, {LAUNDRY_TEXT[trip.laundry].toLowerCase()}
            </dd>
            <dt>Restocking</dt>
            <dd>{facts.resupply === 'good' ? 'Easy along the way' : facts.resupply === 'limited' ? 'Limited — reserves added' : 'Very poor — reserves added'}</dd>
            <dt>Family</dt>
            <dd>{facts.everyone.map((t) => (t.kind === 'child' ? `${t.name} (${describeAge(t.ageMonths)})` : t.name)).join(', ')}</dd>
          </dl>
          <button className="btn btn--small" style={{ marginTop: 14 }} onClick={() => setAssumptionsOpen(true)}>
            <Icon name="bulb" size={18} /> Assumptions{overrides ? ` (${overrides} changed for this trip)` : ''}
          </button>
        </div>
        {trip.generatedAt && <p className="muted small">List built {new Date(trip.generatedAt).toLocaleString()} with rules {trip.engineVersion}.</p>}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Progress by person</h2>
        </div>
        <div className="card card--pad progress-list">
          {[...byPerson.entries()].map(([who, p]) => (
            <div key={who}>
              <span>{nameOf(who, profiles)}</span>
              <span className="num muted">
                {p.done}/{p.total}
              </span>
              <Bar pct={p.pct} />
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Progress by category</h2>
        </div>
        <div className="card card--pad progress-list">
          {[...byCat.entries()]
            .sort((x, y) => x[1].pct - y[1].pct)
            .map(([cat, p]) => (
              <div key={cat}>
                <span>{CATEGORY_LABEL[cat]}</span>
                <span className="num muted">
                  {p.done}/{p.total}
                </span>
                <Bar pct={p.pct} />
              </div>
            ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Packing schedule</h2>
          {schedule.length > 0 && (
            <button className="btn btn--small btn--ghost" onClick={exportIcs}>
              <Icon name="calendar" size={18} /> Add to calendar
            </button>
          )}
        </div>
        {schedule.length ? (
          <>
            <ol className="timeline">
              {schedule.map((r) => (
                <li key={r.id}>
                  <strong>{r.title}</strong>
                  <span className="muted small" style={{ display: 'block' }}>
                    {fmtDate(r.at.slice(0, 10))}, {r.at.slice(11)} — {r.itemNames.length} open item{r.itemNames.length === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ol>
            <p className="muted small">
              Phone browsers cannot reliably show reminders while the app is closed, so “Add to calendar” saves these as calendar events with alerts — your calendar app delivers them, even offline.
            </p>
          </>
        ) : (
          <p className="muted small">{trip.startDate ? 'Everything is packed — nothing left to schedule.' : 'Add travel dates to get a packing schedule.'}</p>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>After the trip</h2>
        </div>
        <p className="muted small mt0">Record what was used, not needed, ran out or was forgotten. Future lists adjust using clear rules — nothing safety-related is ever dropped.</p>
        <div className="row-actions">
          <a className={`btn ${ended && trip.status !== 'completed' ? 'btn--primary' : ''}`} href={`#/trip/${trip.id}/review`}>
            <Icon name="history" /> {trip.status === 'completed' ? 'Review again' : 'Review this trip'}
          </a>
          <button className="btn" onClick={planAgain}>
            <Icon name="refresh" /> Plan again
          </button>
        </div>
      </section>

      <section className="section">
        <button className="btn btn--danger" onClick={() => setConfirmDelete(true)}>
          <Icon name="trash" /> Delete trip
        </button>
      </section>

      {assumptionsOpen && <AssumptionsSheet trip={trip} globals={data.settings.assumptions} onClose={() => setAssumptionsOpen(false)} />}
      {confirmDelete && (
        <Sheet title="Delete this trip?" onClose={() => setConfirmDelete(false)}>
          <p>The trip and its checklist will be removed from this device. Packing history from completed reviews is kept. This cannot be undone unless you have a backup.</p>
          <div className="row-actions">
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              Keep trip
            </button>
            <button
              className="btn btn--danger"
              onClick={async () => {
                await deleteTrip(trip.id);
                bump();
                showToast('Trip deleted.');
                navigate('/trips');
              }}
            >
              Delete trip
            </button>
          </div>
        </Sheet>
      )}
    </main>
  );
}

function AssumptionsSheet({ trip, globals, onClose }: { trip: Trip; globals: Partial<Assumptions>; onClose: () => void }) {
  const base = resolveAssumptions(globals, {});
  const [over, setOver] = useState<Partial<Assumptions>>(trip.assumptionOverrides);
  const [busy, setBusy] = useState(false);
  const effective = resolveAssumptions(globals, over);
  const groups = [...new Set(Object.values(ASSUMPTION_DEFS).map((d) => d.group))];
  const save = async () => {
    setBusy(true);
    const t = { ...trip, assumptionOverrides: over };
    await saveTrip(t);
    const res = await regenerateTrip(t);
    bump();
    showToast(`Updated ${res.qtyChanged} quantities. Your ticks and edits were kept.`);
    onClose();
  };
  return (
    <Sheet title="Assumptions for this trip" onClose={onClose}>
      <p className="muted small mt0">These numbers drive every quantity. Changes here apply only to this trip; set family-wide defaults in Settings.</p>
      {groups.map((g) => (
        <section key={g}>
          <h3 style={{ margin: '18px 0 8px' }}>{g}</h3>
          {(Object.keys(ASSUMPTION_DEFS) as (keyof Assumptions)[])
            .filter((k) => ASSUMPTION_DEFS[k].group === g)
            .map((k) => {
              const d = ASSUMPTION_DEFS[k];
              const changed = over[k] !== undefined && over[k] !== base[k];
              return (
                <Stepper
                  key={k}
                  label={
                    <>
                      {d.label}
                      {changed && <span className="tag tag--cap" style={{ marginLeft: 6 }}>changed</span>}
                    </>
                  }
                  hint={`${d.help} Default ${base[k]}${base[k] !== DEFAULT_ASSUMPTIONS[k] ? ' (your family setting)' : ''}.`}
                  value={effective[k]}
                  min={d.min}
                  max={d.max}
                  step={d.step}
                  suffix={d.unit}
                  onChange={(v) => setOver((o) => ({ ...o, [k]: v }))}
                />
              );
            })}
        </section>
      ))}
      <div className="row-actions" style={{ position: 'sticky', bottom: 0, background: 'var(--paper)', padding: '10px 0' }}>
        <button className="btn" onClick={() => setOver({})}>
          Reset
        </button>
        <button className="btn btn--primary" style={{ flex: 1 }} onClick={save} disabled={busy}>
          Save and update list
        </button>
      </div>
    </Sheet>
  );
}
