import { useState } from 'react';
import { bump, showToast, useQuery } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Empty, Sheet, TopBar } from '../../components/ui';
import { ruleCatalog } from '../../rules/catalogNames';
import { clearStats, deleteAlwaysPack, listAlwaysPack, listReviews, listStats } from '../../storage/repo';

async function load() {
  const [reviews, stats, always] = await Promise.all([listReviews(), listStats(), listAlwaysPack()]);
  return { reviews, stats, always };
}

export function HistoryView() {
  const { data } = useQuery(load, []);
  const [confirm, setConfirm] = useState(false);
  if (!data) return <main className="page" aria-busy="true" />;
  const names = new Map(ruleCatalog().map((c) => [c.ruleId, c.name]));
  const learned = data.stats.filter((s) => s.ranOut || s.forgotten || s.notNeeded).sort((a, b) => b.forgotten + b.ranOut - (a.forgotten + a.ranOut));

  return (
    <main className="page">
      <TopBar title="Packing history" back="#/more" />
      {data.reviews.length === 0 && data.always.length === 0 ? (
        <Empty icon="history" title="No reviews yet">
          After a trip, open it and choose “Review this trip”. Recording what was used, forgotten or not needed tunes future lists.
        </Empty>
      ) : null}

      {data.reviews.length > 0 && (
        <section className="section mt0">
          <div className="section-head">
            <h2>Reviewed trips</h2>
          </div>
          <ul className="list card">
            {data.reviews.map((r) => {
              const o = Object.values(r.outcomes);
              const c = (k: string) => o.filter((x) => x.outcome === k).length;
              return (
                <li key={r.id}>
                  <a className="list-link" href={`#/trip/${r.tripId}`}>
                    <span className="list-link__icon">
                      <Icon name="flag" />
                    </span>
                    <span className="list-link__body">
                      <span className="list-link__title">{r.tripName}</span>
                      <span className="list-link__meta num">
                        {new Date(r.completedAt).toLocaleDateString()}: {c('forgotten')} forgotten, {c('ran-out')} ran out, {c('not-needed')} not needed
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {learned.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>What the app has learned</h2>
            <button className="btn btn--small btn--ghost" onClick={() => setConfirm(true)}>
              Reset
            </button>
          </div>
          <div className="card card--pad" style={{ overflowX: 'auto' }}>
            <table className="table num">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Forgot</th>
                  <th>Ran out</th>
                  <th>Unused</th>
                  <th>Qty ×</th>
                </tr>
              </thead>
              <tbody>
                {learned.map((s) => (
                  <tr key={s.ruleId}>
                    <td>{names.get(s.ruleId) ?? s.ruleId}</td>
                    <td>{s.forgotten}</td>
                    <td>{s.ranOut}</td>
                    <td>{s.notNeeded}</td>
                    <td>{s.qtyFactor.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Always pack</h2>
        </div>
        {data.always.length ? (
          <ul className="list card">
            {data.always.map((a) => (
              <li key={a.id} className="list-link">
                <span className="list-link__body">
                  <span className="list-link__title">{a.name}</span>
                  <span className="list-link__meta">
                    {a.qty} {a.unit}
                    {a.notes ? `, ${a.notes}` : ''}
                  </span>
                </span>
                <button
                  className="icon-btn"
                  aria-label={`Remove ${a.name} from always-pack`}
                  onClick={async () => {
                    await deleteAlwaysPack(a.id);
                    bump();
                    showToast(`${a.name} removed from always-pack`);
                  }}
                >
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small mt0">Items you add with “Pack on every trip” appear here and join every new list.</p>
        )}
      </section>
      {confirm && (
        <Sheet title="Reset what the app has learned?" onClose={() => setConfirm(false)}>
          <p>Quantity increases, forgotten flags and “not needed” counts are cleared. Trip reviews stay in your history. Existing checklists change only when you update them.</p>
          <div className="row-actions">
            <button className="btn" onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button
              className="btn btn--danger"
              onClick={async () => {
                await clearStats();
                bump();
                setConfirm(false);
                showToast('Learning reset.');
              }}
            >
              Reset learning
            </button>
          </div>
        </Sheet>
      )}
    </main>
  );
}
