import { useEffect } from 'react';
import { navigate, useQuery } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Empty, TopBar } from '../../components/ui';
import { listTrips } from '../../storage/repo';
import { pickNextTrip } from './tripUtils';

/** The Pack tab opens the next trip's checklist directly. */
export function PackRedirect() {
  const { data: trips } = useQuery(listTrips, []);
  const next = trips ? pickNextTrip(trips) : undefined;
  useEffect(() => {
    if (next) navigate(`/trip/${next.id}/pack`, true);
  }, [next]);
  if (!trips || next) return <main className="page" aria-busy="true" />;
  return (
    <main className="page">
      <TopBar title="Packing checklist" />
      <Empty icon="pack" title="No upcoming trip" action={<a className="btn btn--primary" href="#/trips/new"><Icon name="plus" /> Plan a trip</a>}>
        Create a trip and its packing list appears here.
      </Empty>
    </main>
  );
}
