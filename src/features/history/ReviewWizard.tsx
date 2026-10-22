import { useEffect, useMemo, useState } from 'react';
import { completeReview } from '../../app/tripService';
import { bump, navigate, showToast, useQuery } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Empty, Field, Notice, TextInput, TopBar } from '../../components/ui';
import { CATEGORY_LABEL } from '../../data/defaults';
import { getChecklist, getTrip, listProfiles } from '../../storage/repo';
import type { AlwaysPackItem, ChecklistItem, Outcome } from '../../types';
import { nameOf, tripTitle } from '../trips/tripUtils';

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: 'used', label: 'Used' },
  { value: 'not-needed', label: 'Not needed' },
  { value: 'ran-out', label: 'Ran out' },
  { value: 'forgotten', label: 'Forgot it' },
];

async function load(id: string) {
  const [trip, items, profiles] = await Promise.all([getTrip(id), getChecklist(id), listProfiles()]);
  return { trip, items, profiles };
}

export function ReviewWizard({ tripId }: { tripId: string }) {
  const { data } = useQuery(() => load(tripId), [tripId]);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome | undefined>>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const reviewable = useMemo(() => (data?.items ?? []).filter((i) => !i.isCheck && !i.stale), [data]);

  useEffect(() => {
    if (!data) return;
    const init: Record<string, Outcome | undefined> = {};
    for (const i of reviewable) init[i.id] = i.packed ? 'used' : undefined;
    setOutcomes(init);
  }, [data, reviewable]);

  if (!data) return <main className="page" aria-busy="true" />;
  if (!data.trip) return <main className="page"><Empty icon="history" title="Trip not found" /></main>;
  const trip = data.trip;
  const groups = new Map<string, ChecklistItem[]>();
  for (const i of reviewable) {
    if (!groups.has(i.category)) groups.set(i.category, []);
    groups.get(i.category)!.push(i);
  }

  const save = async () => {
    setBusy(true);
    const out: Record<string, { ruleId?: string; name: string; outcome: Outcome }> = {};
    for (const i of reviewable) {
      const o = outcomes[i.id];
      if (o) out[i.key] = { ruleId: i.ruleId, name: i.name, outcome: o };
    }
    const add: Omit<AlwaysPackItem, 'id' | 'updatedAt'>[] = extra.map((name) => ({ name, category: 'comfort', assignee: 'shared', qty: 1, unit: 'item', location: 'suitcase', stage: 'advance', notes: `Added after ${tripTitle(trip)}` }));
    await completeReview({ trip, outcomes: out, addNextTime: add, notes });
    bump();
    showToast('Review saved. Future lists will use it.');
    navigate('/history');
  };

  const counts = OUTCOMES.map((o) => ({ ...o, n: Object.values(outcomes).filter((x) => x === o.value).length }));

  return (
    <main className="page page--flush" style={{ paddingBottom: 'calc(var(--nav-h) + 120px)' }}>
      <div className="pad-x">
        <TopBar title="How did packing go?" sub={tripTitle(trip)} back={`#/trip/${trip.id}`} />
        <Notice>
          <p>
            Ran out → that consumable gets a bigger quantity next time. Forgot it → it moves to top priority. Not needed twice → shown as optional. Safety items are never demoted.
          </p>
        </Notice>
        <p className="num small muted">{counts.map((c) => `${c.label}: ${c.n}`).join('   ')}</p>
      </div>
      {[...groups.entries()].map(([cat, list]) => (
        <section key={cat}>
          <h2 className="stage-head">{CATEGORY_LABEL[cat as keyof typeof CATEGORY_LABEL]}</h2>
          <ul className="list">
            {list.map((i) => (
              <li key={i.id} style={{ padding: '10px 16px' }}>
                <div style={{ fontWeight: 700 }}>
                  {i.name} <span className="muted small">{nameOf(i.assigneeId, data.profiles)}</span>
                </div>
                <div className="segmented" role="group" aria-label={`Outcome for ${i.name}`} style={{ marginTop: 6 }}>
                  {OUTCOMES.map((o) => (
                    <button key={o.value} type="button" className="btn--small" aria-pressed={outcomes[i.id] === o.value} onClick={() => setOutcomes((s) => ({ ...s, [i.id]: s[i.id] === o.value ? undefined : o.value }))}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="pad-x section">
        <h2 style={{ fontSize: 'var(--fs-l)' }}>Add next time</h2>
        <p className="muted small mt0">Things that were not on the list at all. They join your always-pack list.</p>
        {extra.map((x) => (
          <div key={x} className="tag" style={{ marginRight: 6, marginBottom: 6, fontSize: 'var(--fs-s)' }}>
            {x}
            <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label={`Remove ${x}`} onClick={() => setExtra(extra.filter((e) => e !== x))}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <TextInput label="Item" value={draft} onChange={setDraft} placeholder="e.g. Clothes pegs" />
          </div>
          <button
            className="btn"
            style={{ marginBottom: 16 }}
            onClick={() => {
              if (draft.trim() && !extra.includes(draft.trim())) setExtra([...extra, draft.trim()]);
              setDraft('');
            }}
          >
            Add
          </button>
        </div>
        <Field label="Notes for next time" htmlFor="rv-notes">
          <textarea id="rv-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="wizard-foot">
        <div>
          <button className="btn btn--primary" onClick={save} disabled={busy}>
            Save review
          </button>
        </div>
      </div>
    </main>
  );
}
