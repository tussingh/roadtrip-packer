import { useMemo, useState } from 'react';
import { bump, showToast, useQuery } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Empty, Field, Notice, Sheet, Stepper, TextInput, Toggle, TopBar } from '../../components/ui';
import { localDateIso, nowIso, uid } from '../../data/defaults';
import { ruleCatalog } from '../../rules/catalogNames';
import { deleteInventoryItem, listInventory, listProfiles, saveInventoryItem } from '../../storage/repo';
import type { InventoryItem, TravellerProfile } from '../../types';
import { addDays, fmtDate, nameOf } from '../trips/tripUtils';

const blank = (): InventoryItem => ({ id: uid(), name: '', qty: 1, unit: 'item', location: '', needsReplenish: false, assignedTo: 'shared', forgottenCount: 0, notes: '', updatedAt: nowIso() });

export function InventoryView() {
  const { data } = useQuery(async () => ({ items: await listInventory(), profiles: await listProfiles() }), []);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<InventoryItem>();
  const today = localDateIso();
  const soon = addDays(today, 30);
  const list = useMemo(() => (data?.items ?? []).filter((i) => !q || `${i.name} ${i.location} ${i.notes}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  if (!data) return <main className="page" aria-busy="true" />;
  const attention = data.items.filter((i) => i.needsReplenish || (i.expiry && i.expiry <= soon));

  return (
    <main className="page page--flush">
      <div className="pad-x">
        <TopBar title="My inventory" sub="What you own, so trips only list what to buy" />
      </div>
      {data.items.length > 0 && (
        <label className="search">
          <Icon name="search" size={20} />
          <span className="visually-hidden">Search inventory</span>
          <input type="search" placeholder="Search inventory" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      )}
      {attention.length > 0 && !q && (
        <div className="pad-x">
          <Notice kind="warn">
            <p>
              Needs attention: {attention.map((i) => `${i.name}${i.expiry && i.expiry < today ? ' (expired)' : i.expiry && i.expiry <= soon ? ' (expires soon)' : ' (replenish)'}`).join(', ')}
            </p>
          </Notice>
        </div>
      )}
      {data.items.length === 0 ? (
        <div className="pad-x">
          <Empty icon="box" title="Nothing recorded yet" action={<button className="btn btn--primary" onClick={() => setEditing(blank())}><Icon name="plus" /> Add an item</button>}>
            Record things you already own — diapers in the cupboard, the first-aid kit, the tyre inflator. New trips then mark them as owned and only list the shortfall to buy.
          </Empty>
        </div>
      ) : (
        <ul className="list">
          {list.map((i) => {
            const expired = i.expiry && i.expiry < today;
            const expSoon = i.expiry && !expired && i.expiry <= soon;
            return (
              <li key={i.id}>
                <button className="list-link" onClick={() => setEditing(i)}>
                  <span className="item__qty num" style={{ minWidth: 48 }}>
                    {i.qty}
                    <small>{i.unit}</small>
                  </span>
                  <span className="list-link__body">
                    <span className="list-link__title">{i.name}</span>
                    <span className="item__meta">
                      {i.location && <span className="tag">{i.location}</span>}
                      <span className="tag tag--who">{nameOf(i.assignedTo, data.profiles)}</span>
                      {expired && <span className="tag tag--safety">Expired {fmtDate(i.expiry)}</span>}
                      {expSoon && <span className="tag tag--buy">Expires {fmtDate(i.expiry)}</span>}
                      {i.needsReplenish && <span className="tag tag--buy">Replenish</span>}
                      {i.forgottenCount > 0 && <span className="tag tag--cap">Forgotten {i.forgottenCount}×</span>}
                      {!i.ruleId && <span className="tag">Not linked</span>}
                    </span>
                  </span>
                  <Icon name="right" className="chev" size={18} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {data.items.length > 0 && (
        <button className="fab" onClick={() => setEditing(blank())}>
          <Icon name="plus" /> Add
        </button>
      )}
      {editing && <InventorySheet item={editing} profiles={data.profiles} isNew={!data.items.some((x) => x.id === editing.id)} onClose={() => setEditing(undefined)} />}
    </main>
  );
}

function InventorySheet({ item, profiles, isNew, onClose }: { item: InventoryItem; profiles: TravellerProfile[]; isNew: boolean; onClose: () => void }) {
  const [d, setD] = useState(item);
  const [err, setErr] = useState('');
  const catalog = ruleCatalog();
  const set = (p: Partial<InventoryItem>) => setD((x) => ({ ...x, ...p }));
  const save = async () => {
    if (!d.name.trim()) return setErr('Give the item a name.');
    await saveInventoryItem({ ...d, name: d.name.trim() });
    bump();
    showToast(isNew ? `Added ${d.name}` : `Saved ${d.name}`);
    onClose();
  };
  return (
    <Sheet title={isNew ? 'Add to inventory' : d.name || 'Inventory item'} onClose={onClose}>
      {err && (
        <Notice kind="safety">
          <p>{err}</p>
        </Notice>
      )}
      <Field label="Matches checklist item" htmlFor="inv-rule">
        <select
          id="inv-rule"
          className="select"
          value={d.ruleId ?? ''}
          onChange={(e) => {
            const c = catalog.find((x) => x.ruleId === e.target.value);
            set({ ruleId: e.target.value || undefined, ...(c && !d.name ? { name: c.name } : {}), ...(c ? { unit: c.unit } : {}) });
          }}
        >
          <option value="">Not linked — just keep a record</option>
          {catalog.map((c) => (
            <option key={c.ruleId} value={c.ruleId}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="field__hint">Linked items count towards trip quantities and the shopping list.</span>
      </Field>
      <TextInput label="Name" value={d.name} onChange={(v) => set({ name: v })} />
      <div className="two-col">
        <Stepper label="Quantity" value={d.qty} min={0} max={9999} onChange={(v) => set({ qty: v })} />
        <TextInput label="Unit" value={d.unit} onChange={(v) => set({ unit: v })} />
      </div>
      <TextInput label="Stored where" placeholder="e.g. Car boot, hall cupboard" value={d.location} onChange={(v) => set({ location: v })} />
      <TextInput label="Expiry date" type="date" hint="Expired stock is not counted on trips." value={d.expiry ?? ''} onChange={(v) => set({ expiry: v || undefined })} />
      <Field label="Belongs to" htmlFor="inv-who">
        <select id="inv-who" className="select" value={d.assignedTo} onChange={(e) => set({ assignedTo: e.target.value })}>
          <option value="shared">Family (shared)</option>
          <option value="car">Car</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Toggle label="Needs replenishing" checked={d.needsReplenish} onChange={(v) => set({ needsReplenish: v })} />
      <Stepper label="Times forgotten on trips" hint="Updated automatically from trip reviews." value={d.forgottenCount} min={0} max={99} onChange={(v) => set({ forgottenCount: v })} />
      <Field label="Notes" htmlFor="inv-notes">
        <textarea id="inv-notes" className="textarea" value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
      <div className="row-actions">
        {!isNew && (
          <button
            className="btn btn--danger"
            onClick={async () => {
              await deleteInventoryItem(d.id);
              bump();
              showToast(`Removed ${d.name}`, 'Undo', async () => {
                await saveInventoryItem(item);
                bump();
              });
              onClose();
            }}
          >
            <Icon name="trash" /> Remove
          </button>
        )}
        <button className="btn btn--primary" style={{ flex: 1 }} onClick={save}>
          {isNew ? 'Add item' : 'Save'}
        </button>
      </div>
    </Sheet>
  );
}
