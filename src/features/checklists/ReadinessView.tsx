import { useEffect, useState } from 'react';
import { notifyChange, useQuery } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Milestone } from '../../components/Milestone';
import { Empty, Notice, TopBar } from '../../components/ui';
import { nowIso } from '../../data/defaults';
import { readiness } from '../../rules/progress';
import { getChecklist, getTrip, listProfiles, putChecklistItems } from '../../storage/repo';
import type { ChecklistItem } from '../../types';
import { destLabel, nameOf, tripTitle } from '../trips/tripUtils';
import { ItemRow } from './ItemRow';

async function load(id: string) {
  const [trip, items, profiles] = await Promise.all([getTrip(id), getChecklist(id), listProfiles()]);
  return { trip, items, profiles };
}

/** The last screen before leaving: only what still blocks departure. */
export function ReadinessView({ tripId }: { tripId: string }) {
  const { data } = useQuery(() => load(tripId), [tripId]);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  useEffect(() => {
    if (data) setItems(data.items);
  }, [data]);
  if (!data) return <main className="page" aria-busy="true" />;
  if (!data.trip) return <main className="page"><Empty icon="flag" title="Trip not found" /></main>;
  const trip = data.trip;
  const r = readiness(items);
  const who = (id: string) => nameOf(id, data.profiles);

  const toggle = async (i: ChecklistItem) => {
    const next = { ...i, packed: !i.packed, updatedAt: nowIso() };
    setItems((prev) => prev.map((p) => (p.id === i.id ? next : p)));
    await putChecklistItems([next]);
    notifyChange();
  };

  const verify = items.filter((i) => i.stage === 'verify' && !i.stale && !i.unavailable);
  const cabin = items.filter((i) => (i.stage === 'cabin' || i.accessibleEnRoute) && !i.packed && !i.unavailable && !i.stale && i.stage !== 'verify');
  const otherEssentials = r.essentialsLeft.filter((i) => i.stage !== 'verify' && !(i.stage === 'cabin' || i.accessibleEnRoute));

  const Section = ({ title, hint, list }: { title: string; hint?: string; list: ChecklistItem[] }) =>
    list.length ? (
      <section className="section">
        <div className="section-head pad-x">
          <h2>{title}</h2>
          <span className="num muted small">{list.filter((i) => !i.packed).length} left</span>
        </div>
        {hint && <p className="pad-x muted small mt0">{hint}</p>}
        <ul className="list">
          {list.map((i) => (
            <ItemRow key={i.id} item={i} who={who(i.assigneeId)} showWho onToggle={toggle} onOpen={() => (location.hash = `/trip/${trip.id}/pack`)} />
          ))}
        </ul>
      </section>
    ) : null;

  return (
    <main className="page page--flush">
      <div className="pad-x">
        <TopBar title="Ready to leave?" sub={tripTitle(trip)} back={`#/trip/${trip.id}/pack`} />
        <div className="card card--pad" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <Milestone pct={r.pct} label={destLabel(trip)} caption="essentials" size={80} />
          <div>
            {r.ready ? (
              <>
                <strong style={{ fontSize: 'var(--fs-l)' }}>All essentials and final checks done.</strong>
                <p className="muted small mb0">Drive safe. Take breaks every couple of hours with a little one aboard.</p>
              </>
            ) : (
              <>
                <strong style={{ fontSize: 'var(--fs-l)' }}>
                  {new Set([...r.essentialsLeft, ...r.safetyLeft, ...r.checksLeft].map((i) => i.id)).size} things still to do
                </strong>
                <p className="muted small mb0">Only essentials, safety items and the final checks are shown here.</p>
              </>
            )}
          </div>
        </div>
        {r.unavailableEssentials.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Notice kind="safety">
              <p>
                Marked “not taking” but essential: <strong>{r.unavailableEssentials.map((i) => i.name).join(', ')}</strong>. Make sure that is deliberate.
              </p>
            </Notice>
          </div>
        )}
        {r.toBuy.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Notice kind="warn" icon="bag">
              <p>
                Still to buy: {r.toBuy.slice(0, 6).map((i) => i.name).join(', ')}
                {r.toBuy.length > 6 ? ` and ${r.toBuy.length - 6} more` : ''}.
              </p>
            </Notice>
          </div>
        )}
      </div>
      <Section title="Verify before leaving" hint="Walk around the car and the house one last time." list={verify} />
      <Section title="Keep reachable in the cabin" hint="Diaper bag, water, snacks, medicines — not buried in the boot." list={cabin} />
      <Section title="Other essentials not packed" list={otherEssentials} />
      {r.ready && (
        <div className="pad-x" style={{ marginTop: 20 }}>
          <a className="btn btn--primary btn--block" href={`#/trip/${trip.id}`}>
            <Icon name="check" /> Back to trip
          </a>
        </div>
      )}
    </main>
  );
}
