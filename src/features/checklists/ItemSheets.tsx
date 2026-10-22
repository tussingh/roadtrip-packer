import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Field, Notice, Segmented, Sheet, Stepper, TextInput, Toggle } from '../../components/ui';
import { CATEGORY_LABEL, CATEGORY_ORDER, LOCATION_LABEL, NECESSITY_LABEL, STAGE_ORDER, STAGE_SHORT, nowIso, uid } from '../../data/defaults';
import { effectiveQty } from '../../rules/merge';
import type { AlwaysPackItem, Category, ChecklistItem, PackLocation, Stage, TravellerProfile } from '../../types';

export function ItemSheet({
  item,
  who,
  people,
  onClose,
  onChange,
  onDelete,
}: {
  item: ChecklistItem;
  who: string;
  people: { id: string; name: string }[];
  onClose: () => void;
  onChange: (next: ChecklistItem) => void;
  onDelete: (i: ChecklistItem) => void;
}) {
  const [draft, setDraft] = useState(item);
  const set = (p: Partial<ChecklistItem>) => setDraft((d) => ({ ...d, ...p }));
  const custom = item.source === 'custom';
  const qty = effectiveQty(draft);
  const commit = (p: Partial<ChecklistItem>) => {
    const next = { ...draft, ...p, updatedAt: nowIso() };
    setDraft(next);
    onChange(next);
  };
  const [why, ...steps] = item.reasons;
  const notes = steps.filter((s) => s.startsWith('Note: '));
  const calc = steps.filter((s) => !s.startsWith('Note: '));

  return (
    <Sheet title={item.name} onClose={onClose}>
      <p className="muted small mt0">
        {who}
        {!item.isCheck && `, ${LOCATION_LABEL[item.location]}`}, {STAGE_SHORT[item.stage].toLowerCase()}, {NECESSITY_LABEL[item.necessity].toLowerCase()}
        {item.accessibleEnRoute ? ', keep reachable on the drive' : ''}
      </p>
      {notes.map((n) => (
        <Notice key={n} kind={item.safetyCritical ? 'safety' : 'warn'} icon="shield">
          <p>{n.slice(6)}</p>
        </Notice>
      ))}

      {!item.isCheck && (
        <>
          <Stepper
            label={item.unit === '₹' ? 'Amount (₹)' : `Quantity (${item.unit})`}
            hint={draft.userQty !== undefined ? `Recommended: ${item.recommendedQty}. Your number is kept when the list updates.` : undefined}
            value={qty}
            min={0}
            max={item.unit === '₹' ? 200000 : 999}
            step={item.unit === '₹' ? 500 : 1}
            onChange={(v) => commit({ userQty: v === item.recommendedQty ? undefined : v })}
          />
          {draft.userQty !== undefined && (
            <button className="btn btn--small" onClick={() => commit({ userQty: undefined })} style={{ marginTop: -6, marginBottom: 14 }}>
              Use recommended ({item.recommendedQty})
            </button>
          )}
        </>
      )}

      {why && item.source !== 'custom' && (
        <section style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '4px 0 6px', fontSize: 'var(--fs-m)' }}>Why {item.isCheck ? 'this check' : 'this quantity'}</h3>
          <ol className="why">
            <li>{why}</li>
            {calc.map((s, k) => (
              <li key={k} className="num">
                {s}
              </li>
            ))}
          </ol>
          {item.conditions.length > 0 && <p className="muted small">Conditions: {item.conditions.join('; ')}</p>}
          {item.purchaseReason && <p className="small">Shopping: {item.purchaseReason}</p>}
        </section>
      )}

      <Segmented<'packed' | 'owned' | 'buy' | 'unavailable' | 'open'>
        label="Status"
        value={draft.unavailable ? 'unavailable' : draft.packed ? 'packed' : draft.needsPurchase ? 'buy' : draft.owned === 'owned' ? 'owned' : 'open'}
        onChange={(v) =>
          commit({
            packed: v === 'packed',
            unavailable: v === 'unavailable',
            needsPurchase: v === 'buy',
            owned: v === 'owned' || v === 'packed' ? 'owned' : v === 'buy' ? 'not-owned' : draft.owned,
          })
        }
        options={[
          { value: 'open', label: 'To pack' },
          { value: 'packed', label: item.isCheck ? 'Done' : 'Packed' },
          ...(item.isCheck
            ? []
            : [
                { value: 'owned' as const, label: 'Have it' },
                { value: 'buy' as const, label: 'Need to buy' },
              ]),
          { value: 'unavailable', label: item.isCheck ? 'Skip' : 'Not taking' },
        ]}
      />
      {draft.unavailable && (item.safetyCritical || item.necessity === 'essential') && (
        <Notice kind="safety">
          <p>This is marked {item.safetyCritical ? 'safety-critical' : 'essential'}. It stays visible on the readiness check until you take it or decide deliberately.</p>
        </Notice>
      )}

      {custom && (
        <>
          <TextInput label="Name" value={draft.name} onChange={(v) => set({ name: v })} onBlur={() => commit({ name: draft.name.trim() || item.name })} />
          <EditMeta draft={draft} people={people} onChange={commit} />
        </>
      )}

      <Field label="Notes" htmlFor="item-notes">
        <textarea id="item-notes" className="textarea" value={draft.notes} placeholder="Brand, size, where it is…" onChange={(e) => set({ notes: e.target.value })} onBlur={() => commit({ notes: draft.notes })} />
      </Field>

      <div className="row-actions">
        {custom && (
          <button className="btn btn--danger" onClick={() => onDelete(item)}>
            <Icon name="trash" /> Delete item
          </button>
        )}
        <button className="btn btn--primary" style={{ flex: 1 }} onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

function EditMeta({ draft, people, onChange }: { draft: Pick<ChecklistItem, 'category' | 'assigneeId' | 'location' | 'stage'>; people: { id: string; name: string }[]; onChange: (p: Partial<ChecklistItem>) => void }) {
  return (
    <>
      <Field label="Category" htmlFor="m-cat">
        <select id="m-cat" className="select" value={draft.category} onChange={(e) => onChange({ category: e.target.value as Category })}>
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="For" htmlFor="m-who">
        <select id="m-who" className="select" value={draft.assigneeId} onChange={(e) => onChange({ assigneeId: e.target.value })}>
          <option value="shared">Family (shared)</option>
          <option value="car">Car</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="two-col">
        <Field label="Pack in" htmlFor="m-loc">
          <select id="m-loc" className="select" value={draft.location} onChange={(e) => onChange({ location: e.target.value as PackLocation })}>
            {(Object.keys(LOCATION_LABEL) as PackLocation[]).map((l) => (
              <option key={l} value={l}>
                {LOCATION_LABEL[l]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="When" htmlFor="m-stage">
          <select id="m-stage" className="select" value={draft.stage} onChange={(e) => onChange({ stage: e.target.value as Stage })}>
            {STAGE_ORDER.map((s) => (
              <option key={s} value={s}>
                {STAGE_SHORT[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </>
  );
}

export function AddItemSheet({
  tripId,
  people,
  onClose,
  onAdd,
}: {
  tripId: string;
  people: TravellerProfile[];
  onClose: () => void;
  onAdd: (item: ChecklistItem, always?: AlwaysPackItem) => void;
}) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState(1);
  const [unit, setUnit] = useState('item');
  const [always, setAlways] = useState(false);
  const [meta, setMeta] = useState<Pick<ChecklistItem, 'category' | 'assigneeId' | 'location' | 'stage'>>({ category: 'comfort', assigneeId: 'shared', location: 'suitcase', stage: 'advance' });
  const [err, setErr] = useState('');
  const add = () => {
    if (!name.trim()) return setErr('Give the item a name.');
    const id = uid();
    const now = nowIso();
    const item: ChecklistItem = {
      id,
      tripId,
      key: `custom:${id}`,
      source: 'custom',
      name: name.trim(),
      ...meta,
      recommendedQty: qty,
      unit: unit.trim() || 'item',
      reasons: ['Added by you'],
      conditions: [],
      necessity: 'recommended',
      priority: 2,
      reusable: true,
      consumable: false,
      accessibleEnRoute: meta.location === 'cabin' || meta.location === 'diaper-bag',
      safetyCritical: false,
      isCheck: false,
      packed: false,
      owned: 'unknown',
      unavailable: false,
      needsPurchase: false,
      notes: '',
      order: 100000,
      updatedAt: now,
    };
    const ap: AlwaysPackItem | undefined = always
      ? { id: uid(), name: item.name, category: meta.category, assignee: meta.assigneeId, qty, unit: item.unit, location: meta.location, stage: meta.stage, notes: '', updatedAt: now }
      : undefined;
    onAdd(item, ap);
  };
  return (
    <Sheet title="Add an item" onClose={onClose}>
      {err && (
        <Notice kind="safety">
          <p>{err}</p>
        </Notice>
      )}
      <TextInput label="Name" value={name} onChange={setName} autoFocus placeholder="e.g. Coffee filter" />
      <div className="two-col">
        <Stepper label="Quantity" value={qty} min={1} max={999} onChange={setQty} />
        <TextInput label="Unit" value={unit} onChange={setUnit} />
      </div>
      <EditMeta draft={meta} people={people} onChange={(p) => setMeta((m) => ({ ...m, ...p }))} />
      <Toggle label="Pack on every trip" hint="Adds it to your always-pack list for future trips." checked={always} onChange={setAlways} />
      <button className="btn btn--primary btn--block" onClick={add}>
        Add item
      </button>
    </Sheet>
  );
}
