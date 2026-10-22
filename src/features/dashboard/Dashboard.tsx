import { useQuery } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Milestone } from '../../components/Milestone';
import { ListLink, Notice } from '../../components/ui';
import { localDateIso } from '../../data/defaults';
import { buildSchedule, progressOf } from '../../rules/progress';
import { getChecklist, getSettings, listProfiles, listTrips } from '../../storage/repo';
import type { Trip } from '../../types';
import { countdown, dateRange, destLabel, isUpcoming, pickNextTrip, tripTitle } from '../trips/tripUtils';

async function load() {
  const [trips, profiles, settings] = await Promise.all([listTrips(), listProfiles(), getSettings()]);
  const next = pickNextTrip(trips);
  const items = next ? await getChecklist(next.id) : [];
  return { trips, profiles, settings, next, items };
}

export function TripSign({ trip, pct, travellers }: { trip: Trip; pct: number; travellers: number }) {
  return (
    <a className="sign" href={`#/trip/${trip.id}`} aria-label={`Open ${tripTitle(trip)}`}>
      <div className="sign__inner">
        <div>
          <p className="sign__when">
            {countdown(trip)}
            {trip.startDate ? `, ${dateRange(trip)}` : ''}
          </p>
          <p className="sign__dest">{trip.destination.name || tripTitle(trip)}</p>
          <div className="sign__facts">
            {trip.totalKm > 0 && (
              <span className="num">
                <Icon name="route" size={16} /> {Math.round(trip.totalKm)} km
              </span>
            )}
            <span className="num">
              <Icon name="calendar" size={16} /> {trip.days} d / {trip.nights} n
            </span>
            <span className="num">
              <Icon name="users" size={16} /> {travellers}
            </span>
          </div>
        </div>
        <Milestone pct={pct} label={destLabel(trip)} size={84} onSign />
      </div>
    </a>
  );
}

export function Dashboard() {
  const { data } = useQuery(load, []);
  if (!data) return <main className="page" aria-busy="true" />;
  const { trips, next, items, settings } = data;
  const prog = progressOf(items.filter((i) => !i.stale));
  const others = trips.filter((t) => isUpcoming(t) && t.id !== next?.id);
  const today = localDateIso();
  const due = next ? buildSchedule(next, items, today).find((r) => r.at.slice(0, 10) <= today) : undefined;
  const backupDays = settings.lastBackupAt ? Math.floor((Date.now() - Date.parse(settings.lastBackupAt)) / 86400000) : null;

  return (
    <main className="page">
      <header className="topbar">
        <h1>
          Milestone
          <span className="sub">Family road trips, packed and ready</span>
        </h1>
        <a className="icon-btn" href="#/settings" aria-label="Settings and backup">
          <Icon name="settings" />
        </a>
      </header>

      {next ? (
        <>
          <TripSign trip={next} pct={prog.pct} travellers={next.travellerIds.length} />
          <div className="row-actions" style={{ marginTop: 12 }}>
            <a className="btn btn--primary" style={{ flex: 1 }} href={`#/trip/${next.id}/pack`}>
              <Icon name="pack" /> {prog.done === 0 ? 'Start packing' : 'Continue packing'}
            </a>
            <a className="btn" href={`#/trip/${next.id}/ready`}>
              <Icon name="flag" /> Ready?
            </a>
          </div>
          {due && (
            <a className="card card--pad" href={`#/trip/${next.id}/pack`} style={{ display: 'block', marginTop: 12, textDecoration: 'none', color: 'inherit' }}>
              <strong>Due now: {due.title}</strong>
              <span className="muted small" style={{ display: 'block' }}>
                {due.itemNames.length} item{due.itemNames.length === 1 ? '' : 's'} — {due.itemNames.slice(0, 3).join(', ')}
                {due.itemNames.length > 3 ? '…' : ''}
              </span>
            </a>
          )}
        </>
      ) : (
        <a className="sign" href="#/trips/new">
          <div className="sign__inner">
            <div>
              <p className="sign__when">No trip planned</p>
              <p className="sign__dest">Where to next?</p>
              <div className="sign__facts">
                <span>
                  <Icon name="plus" size={16} /> Plan a trip — your list is ready in seconds
                </span>
              </div>
            </div>
            <Milestone pct={0} label="Start" caption="km 0" size={72} onSign />
          </div>
        </a>
      )}

      {trips.length > 0 && (backupDays === null || backupDays > 30) && (
        <div style={{ marginTop: 16 }}>
          <Notice kind="warn">
            <p>
              {backupDays === null ? 'You have not backed up yet.' : `Last backup was ${backupDays} days ago.`} Your data lives only on this phone — browsers can clear it.{' '}
              <a href="#/settings">Back up now</a>
            </p>
          </Notice>
        </div>
      )}

      {others.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Also coming up</h2>
            <a href="#/trips">All trips</a>
          </div>
          <ul className="list card">
            {others.slice(0, 3).map((t) => (
              <li key={t.id}>
                <ListLink href={`#/trip/${t.id}`} icon="calendar" title={tripTitle(t)} meta={`${dateRange(t)}${t.totalKm ? `, ${Math.round(t.totalKm)} km` : ''}`} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Plan</h2>
        </div>
        <ul className="list card">
          <li>
            <ListLink href="#/trips/new" icon="plus" title="New trip" meta="Dates, distance, family, stay" />
          </li>
          <li>
            <ListLink href="#/trips" icon="calendar" title="Upcoming trips" meta={`${trips.filter((t) => isUpcoming(t)).length} planned`} />
          </li>
          <li>
            <ListLink href="#/pack" icon="pack" title="Packing checklist" meta={next ? `${prog.done} of ${prog.total} packed for ${tripTitle(next)}` : 'Create a trip first'} />
          </li>
          <li>
            <ListLink href="#/essentials" icon="car" title="Road trip essentials" meta="Vehicle kit and pre-departure checks" />
          </li>
          <li>
            <ListLink href="#/maps" icon="map" title="Offline maps" meta="Regions, places and routes on this device" />
          </li>
        </ul>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Family and kit</h2>
        </div>
        <ul className="list card">
          <li>
            <ListLink href="#/profiles" icon="users" title="Family profiles" meta="Ages, preferences, who drives" />
          </li>
          <li>
            <ListLink href="#/inventory" icon="box" title="My inventory" meta="What you own, where it is, what expires" />
          </li>
          <li>
            <ListLink href="#/history" icon="history" title="Packing history" meta="What was used, forgotten or not needed" />
          </li>
          <li>
            <ListLink href="#/settings" icon="settings" title="Settings and backup" meta="Assumptions, export, restore, privacy" />
          </li>
        </ul>
      </section>
    </main>
  );
}
