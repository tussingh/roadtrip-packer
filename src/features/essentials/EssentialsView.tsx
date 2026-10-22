import { useMemo } from 'react';
import { useQuery } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Notice, TopBar } from '../../components/ui';
import { blankTrip, NECESSITY_LABEL } from '../../data/defaults';
import { generate, type GeneratedItem } from '../../rules/engine';
import { getSettings, listInventory, listProfiles, listTrips } from '../../storage/repo';
import type { Category } from '../../types';
import { pickNextTrip, tripTitle } from '../trips/tripUtils';

async function load() {
  const [trips, profiles, settings, inventory] = await Promise.all([listTrips(), listProfiles(), getSettings(), listInventory()]);
  return { next: pickNextTrip(trips), profiles, settings, inventory };
}

const SECTIONS: { title: string; cats: Category[]; filter?: (i: GeneratedItem) => boolean }[] = [
  { title: 'Documents', cats: ['documents'], filter: (i) => i.assigneeId === 'car' },
  { title: 'Safety equipment — always carried', cats: ['vehicle-safety', 'health'], filter: (i) => i.assigneeId === 'car' },
  { title: 'Tools and recovery', cats: ['vehicle-tools'] },
  { title: 'Water, food and cash reserves', cats: ['food-water'], filter: (i) => i.assigneeId === 'car' },
  { title: 'Pre-departure inspection', cats: ['vehicle-checks'] },
  { title: 'Navigation and power', cats: ['electronics'], filter: (i) => i.assigneeId === 'car' },
  { title: 'Cabin comfort', cats: ['comfort'] },
];

export function EssentialsView() {
  const { data } = useQuery(load, []);
  const result = useMemo(() => {
    if (!data) return undefined;
    const baseline = { ...blankTrip(data.profiles.map((p) => p.id)), name: 'Typical 400 km weekend', days: 3, nights: 2, totalKm: 400, drivingDays: 2 };
    const trip = data.next && data.next.totalKm > 0 ? data.next : baseline;
    return { trip, isBaseline: trip === baseline, ...generate({ trip, profiles: data.profiles, globalAssumptions: data.settings.assumptions, inventory: data.inventory, today: new Date() }) };
  }, [data]);
  if (!data || !result) return <main className="page" aria-busy="true" />;

  return (
    <main className="page">
      <TopBar title="Road trip essentials" sub={result.isBaseline ? 'For a typical 400 km family weekend' : `For ${tripTitle(result.trip)}`} back="#/more" />
      {!result.isBaseline && (
        <a className="btn btn--primary btn--block" href={`#/trip/${result.trip.id}/pack`} style={{ marginBottom: 16 }}>
          <Icon name="pack" /> Tick these off in the checklist
        </a>
      )}
      <Notice kind="safety" icon="shield">
        <p>Safety equipment is never removed for short trips. Tools must suit your specific car — check the owner’s manual for jack points, tyre pressures, fuse ratings and towing points.</p>
      </Notice>
      {SECTIONS.map((s) => {
        const list = result.items.filter((i) => s.cats.includes(i.category) && (!s.filter || s.filter(i)));
        if (!list.length) return null;
        return (
          <section key={s.title} className="section">
            <div className="section-head">
              <h2>{s.title}</h2>
            </div>
            <ul className="list card">
              {list.map((i) => {
                const note = i.reasons.find((r) => r.startsWith('Note: '));
                return (
                  <li key={i.key} className={`item${i.necessity === 'essential' || i.safetyCritical ? ' item--essential' : ''}`} style={{ padding: '10px 16px', display: 'block' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <strong style={{ flex: 1 }}>{i.name}</strong>
                      {!i.isCheck && i.unit !== '₹' && (
                        <span className="num" style={{ fontWeight: 800 }}>
                          {i.recommendedQty} <span className="muted small">{i.unit}</span>
                        </span>
                      )}
                      {i.unit === '₹' && <span className="num" style={{ fontWeight: 800 }}>₹{i.recommendedQty.toLocaleString('en-IN')}</span>}
                    </div>
                    <div className="item__meta">
                      <span className={`tag${i.necessity === 'essential' ? ' tag--safety' : ''}`}>{NECESSITY_LABEL[i.necessity]}</span>
                      {i.owned === 'owned' && <span className="tag">In inventory</span>}
                    </div>
                    <p className="small muted mb0" style={{ marginTop: 4 }}>
                      {i.reasons[0]}
                      {note ? `. ${note.slice(6)}` : ''}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <section className="section">
        <div className="section-head">
          <h2>Driving with a little one</h2>
        </div>
        <div className="card card--pad prose small">
          <p>Set the route before moving. A passenger handles the phone; the driver does not use a handheld device while driving.</p>
          <p>Plan a stop roughly every two hours for changes, feeds and stretching. Only offer food when the car is stopped or an adult can supervise closely.</p>
          <p>Thin layers only under the car-seat harness; put blankets over the buckled harness. No aftermarket head supports or inserts the seat maker has not approved.</p>
          <p>Never leave a child in a parked car, even briefly — cabins heat up fast.</p>
          <p>Stop when the driver feels drowsy. Swap drivers before you need to.</p>
        </div>
      </section>
    </main>
  );
}
