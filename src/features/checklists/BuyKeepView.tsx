import { useMemo } from 'react';
import { bump, showToast, useQuery } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Empty, TopBar } from '../../components/ui';
import { nowIso } from '../../data/defaults';
import { BUY_KEEP_LABEL, BUY_KEEP_ORDER, buyKeepAdvice } from '../../rules/buyKeep';
import { getChecklist, getTrip, listProfiles, putChecklistItems } from '../../storage/repo';
import type { ChecklistItem } from '../../types';
import { nameOf, tripTitle } from '../trips/tripUtils';

async function load(id: string) {
  const [trip, items, profiles] = await Promise.all([getTrip(id), getChecklist(id), listProfiles()]);
  return { trip, items, profiles };
}

const qtyText = (i: ChecklistItem) => {
  const q = i.userQty ?? i.recommendedQty;
  return q > 1 || i.unit ? `${q}${i.unit ? ` ${i.unit}` : ''}` : '';
};

export function BuyKeepView({ tripId }: { tripId: string }) {
  const { data } = useQuery(() => load(tripId), [tripId]);
  const advice = useMemo(() => (data?.trip ? buyKeepAdvice(data.items, data.trip) : []), [data]);
  if (!data) return <main className="page" aria-busy="true" />;
  if (!data.trip) return <main className="page"><TopBar title="Buy or bring" back="#/" /><Empty icon="bag" title="Trip not found" /></main>;
  const trip = data.trip;
  const who = (id: string) => nameOf(id, data.profiles);

  const markOwned = async (i: ChecklistItem) => {
    await putChecklistItems([{ ...i, owned: 'owned', needsPurchase: false, updatedAt: nowIso() }]);
    bump();
    showToast(`${i.name}: marked as bought`);
  };

  const shoppingText = () => {
    const lines = [`Shopping for ${tripTitle(trip)}`];
    for (const g of ['buy-before', 'bring-hard-to-find'] as const) {
      const list = advice.filter((a) => a.group === g && !a.item.packed && a.item.owned !== 'owned');
      if (!list.length) continue;
      lines.push('', BUY_KEEP_LABEL[g].title + ':');
      for (const a of list) lines.push(`☐ ${a.item.name}${qtyText(a.item) ? ` — ${qtyText(a.item)}` : ''}`);
    }
    return lines.join('\n');
  };

  const share = async () => {
    const text = shoppingText();
    try {
      if (navigator.share) await navigator.share({ title: 'Shopping list', text });
      else {
        await navigator.clipboard.writeText(text);
        showToast('Shopping list copied — paste it into WhatsApp.');
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <main className="page">
      <TopBar title="Buy or bring" sub={tripTitle(trip)} back={`#/trip/${trip.id}`} actions={<button className="icon-btn" aria-label="Share shopping list" onClick={() => void share()}><Icon name="upload" /></button>} />
      <p className="muted small">
        Based on {trip.resupply === 'good' && !trip.remote ? 'good shops along the way' : 'limited shops on this route'} and staying at a {trip.accommodation}. Mark items in Inventory as owned to make this sharper.
      </p>
      {BUY_KEEP_ORDER.map((g) => {
        const list = advice.filter((a) => a.group === g);
        if (!list.length) return null;
        return (
          <section key={g} className="section" aria-label={BUY_KEEP_LABEL[g].title}>
            <div className="section-head">
              <h2>{BUY_KEEP_LABEL[g].title}</h2>
              <span className="num muted">{list.length}</span>
            </div>
            <p className="muted small mt0">{BUY_KEEP_LABEL[g].blurb}</p>
            <ul className="list card">
              {list.map(({ item, why }) => (
                <li key={item.id} style={{ padding: '10px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div>
                      <strong>{item.name}</strong> {qtyText(item) && <span className="num muted">· {qtyText(item)}</span>} {item.packed && <span className="muted small">(packed)</span>}
                    </div>
                    <div className="muted small">
                      {who(item.assigneeId)} — {why}
                    </div>
                  </div>
                  {(g === 'buy-before' || g === 'bring-hard-to-find') && item.owned !== 'owned' && !item.packed && (
                    <button type="button" className="btn btn--small" onClick={() => void markOwned(item)}>
                      Have it
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {advice.length === 0 && <Empty icon="bag" title="No items yet">Edit the trip to build its list.</Empty>}
    </main>
  );
}
