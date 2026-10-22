import { useQuery } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Empty, ListLink, TopBar } from '../../components/ui';
import { listTrips } from '../../storage/repo';
import { dateRange, isUpcoming, tripTitle } from './tripUtils';

export function TripsList() {
  const { data: trips } = useQuery(listTrips, []);
  if (!trips) return <main className="page" aria-busy="true" />;
  const upcoming = trips.filter((t) => isUpcoming(t));
  const past = trips.filter((t) => !isUpcoming(t)).reverse();
  return (
    <main className="page">
      <TopBar title="Trips" back="#/" />
      {trips.length === 0 ? (
        <Empty icon="calendar" title="No trips yet" action={<a className="btn btn--primary" href="#/trips/new"><Icon name="plus" /> Plan a trip</a>}>
          Add where you are going and for how long. The packing list is built immediately on this phone.
        </Empty>
      ) : (
        <>
          <section className="section mt0">
            <div className="section-head">
              <h2>Upcoming</h2>
            </div>
            {upcoming.length ? (
              <ul className="list card">
                {upcoming.map((t) => (
                  <li key={t.id}>
                    <ListLink href={`#/trip/${t.id}`} icon="calendar" title={tripTitle(t)} meta={`${dateRange(t)}${t.totalKm ? `, ${Math.round(t.totalKm)} km` : ''}`} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Nothing planned.</p>
            )}
          </section>
          {past.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>Past and completed</h2>
              </div>
              <ul className="list card">
                {past.map((t) => (
                  <li key={t.id}>
                    <ListLink href={`#/trip/${t.id}`} icon="history" title={tripTitle(t)} meta={`${dateRange(t)}${t.status === 'completed' ? ', reviewed' : ', not reviewed yet'}`} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <button className="fab" onClick={() => (location.hash = '/trips/new')}>
        <Icon name="plus" /> New trip
      </button>
    </main>
  );
}
