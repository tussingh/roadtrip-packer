import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { showToast, useQuery } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Bar, Empty, Segmented, Sheet, TopBar } from '../../components/ui';
import { CATEGORY_LABEL, CATEGORY_ORDER, LOCATION_LABEL, STAGE_ORDER, nowIso } from '../../data/defaults';
import { STAGE_LABEL, progressOf } from '../../rules/progress';
import { deleteChecklistItem, getChecklist, getTrip, listProfiles, putChecklistItems, saveAlwaysPack } from '../../storage/repo';
import type { ChecklistItem, PackLocation } from '../../types';
import { nameOf, tripTitle } from '../trips/tripUtils';
import { ItemRow } from './ItemRow';
import { AddItemSheet, ItemSheet } from './ItemSheets';

type GroupBy = 'stage' | 'category' | 'person' | 'location';

interface Filters {
  q: string;
  unpackedOnly: boolean;
  toBuy: boolean;
  essentialsOnly: boolean;
  person: string | 'all';
  category: string | 'all';
  location: string | 'all';
  priority: 'all' | '1' | '2' | '3';
}

const DEFAULT_FILTERS: Filters = { q: '', unpackedOnly: false, toBuy: false, essentialsOnly: false, person: 'all', category: 'all', location: 'all', priority: 'all' };

/** Undo history: each entry restores the previous version of the touched items. */
type UndoEntry = { label: string; before: ChecklistItem[]; added: string[]; deleted: ChecklistItem[] };

async function load(tripId: string) {
  const [trip, items, profiles] = await Promise.all([getTrip(tripId), getChecklist(tripId), listProfiles()]);
  return { trip, items, profiles };
}

function readPrefs(): { groupBy: GroupBy; filters: Filters } {
  try {
    const raw = sessionStorage.getItem('milestone.checklist.view');
    if (raw) return { groupBy: 'stage', filters: DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { groupBy: 'stage', filters: DEFAULT_FILTERS };
}

export function ChecklistView({ tripId }: { tripId: string }) {
  const { data } = useQuery(() => load(tripId), [tripId]);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>(() => readPrefs().groupBy);
  const [filters, setFilters] = useState<Filters>(() => ({ ...readPrefs().filters, q: '' }));
  const [open, setOpen] = useState<ChecklistItem>();
  const [adding, setAdding] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const undo = useRef<UndoEntry[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const loadedFor = useRef<string>('');
  const itemsRef = useRef<ChecklistItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (data?.items && loadedFor.current !== tripId) {
      loadedFor.current = tripId;
      setItems(data.items);
    }
  }, [data, tripId]);

  useEffect(() => {
    try {
      sessionStorage.setItem('milestone.checklist.view', JSON.stringify({ groupBy, filters: { ...filters, q: '' } }));
    } catch {
      /* ignore */
    }
  }, [groupBy, filters]);

  const profiles = useMemo(() => data?.profiles ?? [], [data]);
  const who = useCallback((id: string) => nameOf(id, profiles), [profiles]);

  const pushUndo = (e: UndoEntry) => {
    undo.current.push(e);
    if (undo.current.length > 30) undo.current.shift();
    setUndoCount(undo.current.length);
  };

  const apply = useCallback(
    async (changed: ChecklistItem[], label: string, opts: { silent?: boolean } = {}) => {
      const byId = new Map(changed.map((c) => [c.id, c]));
      const before = itemsRef.current.filter((p) => byId.has(p.id));
      itemsRef.current = itemsRef.current.map((p) => byId.get(p.id) ?? p);
      setItems((prev) => prev.map((p) => byId.get(p.id) ?? p));
      await putChecklistItems(changed);
      pushUndo({ label, before, added: [], deleted: [] });
      if (!opts.silent) showToast(label, 'Undo', () => void runUndo());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const runUndo = async () => {
    const e = undo.current.pop();
    setUndoCount(undo.current.length);
    if (!e) return;
    if (e.before.length) await putChecklistItems(e.before);
    for (const id of e.added) await deleteChecklistItem(id);
    if (e.deleted.length) await putChecklistItems(e.deleted);
    setItems((prev) => {
      const byId = new Map(e.before.map((b) => [b.id, b]));
      const next = prev.filter((p) => !e.added.includes(p.id)).map((p) => byId.get(p.id) ?? p);
      return [...next, ...e.deleted];
    });
    showToast(`Undone: ${e.label.toLowerCase()}`);
  };

  const toggle = useCallback(
    (i: ChecklistItem) => {
      const next = { ...i, packed: !i.packed, unavailable: i.packed ? i.unavailable : false, owned: !i.packed ? 'owned' as const : i.owned, updatedAt: nowIso() };
      void apply([next], `${next.packed ? (i.isCheck ? 'Done' : 'Packed') : 'Unpacked'}: ${i.name}`, { silent: true });
    },
    [apply],
  );

  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return items.filter((i) => {
      if (q && !`${i.name} ${i.notes}`.toLowerCase().includes(q)) return false;
      if (filters.unpackedOnly && (i.packed || i.unavailable)) return false;
      if (filters.toBuy && !(i.needsPurchase && !i.packed)) return false;
      if (filters.essentialsOnly && !(i.necessity === 'essential' || i.safetyCritical)) return false;
      if (filters.person !== 'all' && i.assigneeId !== filters.person) return false;
      if (filters.category !== 'all' && i.category !== filters.category) return false;
      if (filters.location !== 'all' && i.location !== filters.location) return false;
      if (filters.priority !== 'all' && String(i.priority) !== filters.priority) return false;
      return true;
    });
  }, [items, filters]);

  const groups = useMemo(() => {
    const keyOf = (i: ChecklistItem): string => {
      if (groupBy === 'stage') return i.stage;
      if (groupBy === 'category') return i.category;
      if (groupBy === 'person') return i.assigneeId;
      return i.location;
    };
    const order =
      groupBy === 'stage' ? STAGE_ORDER : groupBy === 'category' ? CATEGORY_ORDER : groupBy === 'location' ? (Object.keys(LOCATION_LABEL) as PackLocation[]) : ['car', 'shared', ...profiles.map((p) => p.id)];
    const map = new Map<string, ChecklistItem[]>();
    for (const i of visible) {
      const k = keyOf(i);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(i);
    }
    const label = (k: string) =>
      groupBy === 'stage' ? STAGE_LABEL[k as keyof typeof STAGE_LABEL] : groupBy === 'category' ? CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL] : groupBy === 'location' ? LOCATION_LABEL[k as PackLocation] : who(k);
    return [...map.entries()]
      .sort((a, b) => (order.indexOf(a[0] as never) + 1 || 999) - (order.indexOf(b[0] as never) + 1 || 999))
      .map(([k, list]) => ({ key: k, label: label(k), // Stable order: rows never jump under your thumb when ticked.
        items: list.sort((x, y) => x.priority - y.priority || x.order - y.order) }));
  }, [visible, groupBy, profiles, who]);

  if (!data) return <main className="page" aria-busy="true" />;
  if (!data.trip) {
    return (
      <main className="page">
        <TopBar title="Checklist" back="#/" />
        <Empty icon="pack" title="Trip not found" />
      </main>
    );
  }
  const trip = data.trip;
  const prog = progressOf(items.filter((i) => !i.stale));
  const people = profiles.filter((p) => trip.travellerIds.includes(p.id));
  const activeFilters = [filters.person !== 'all', filters.category !== 'all', filters.location !== 'all', filters.priority !== 'all'].filter(Boolean).length;
  const showWho = groupBy !== 'person';

  const markPacked = (list: ChecklistItem[], label: string) => {
    const changed = list.filter((i) => !i.packed && !i.unavailable).map((i) => ({ ...i, packed: true, owned: 'owned' as const, updatedAt: nowIso() }));
    if (changed.length) void apply(changed, `${label}: ${changed.length} item${changed.length === 1 ? '' : 's'} marked packed`);
  };

  return (
    <main className="page page--flush">
      <div className="pad-x">
        <TopBar
          title={tripTitle(trip)}
          sub={
            <span className="num">
              {prog.done} of {prog.total} packed, {prog.pct}%
            </span>
          }
          back={`#/trip/${trip.id}`}
          actions={
            <>
              <button className="icon-btn" onClick={() => void runUndo()} disabled={undoCount === 0} aria-label="Undo last change" title="Undo">
                <Icon name="undo" style={{ opacity: undoCount ? 1 : 0.35 }} />
              </button>
              <button className="icon-btn" onClick={() => setBulkOpen(true)} aria-label="More actions">
                <Icon name="more" />
              </button>
            </>
          }
        />
        <Bar pct={prog.pct} cap />
        <div style={{ height: 12 }} />
      </div>

      <label className="search">
        <Icon name="search" size={20} />
        <span className="visually-hidden">Search items</span>
        <input type="search" placeholder="Search items" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
      </label>
      <div className="chips" role="group" aria-label="Quick filters">
        <button className="chip" aria-pressed={filters.unpackedOnly} onClick={() => setFilters({ ...filters, unpackedOnly: !filters.unpackedOnly })}>
          Not packed
        </button>
        <button className="chip" aria-pressed={filters.toBuy} onClick={() => setFilters({ ...filters, toBuy: !filters.toBuy })}>
          To buy
        </button>
        <button className="chip" aria-pressed={filters.essentialsOnly} onClick={() => setFilters({ ...filters, essentialsOnly: !filters.essentialsOnly })}>
          Essentials
        </button>
        {people.map((p) => (
          <button key={p.id} className="chip" aria-pressed={filters.person === p.id} onClick={() => setFilters({ ...filters, person: filters.person === p.id ? 'all' : p.id })}>
            {p.name}
          </button>
        ))}
        <button className="chip" aria-pressed={filters.person === 'car'} onClick={() => setFilters({ ...filters, person: filters.person === 'car' ? 'all' : 'car' })}>
          Car
        </button>
        <button className="chip" aria-pressed={activeFilters > 0} onClick={() => setFiltersOpen(true)}>
          <Icon name="filter" size={16} /> More{activeFilters ? ` (${activeFilters})` : ''}
        </button>
      </div>

      {groups.length === 0 ? (
        <Empty icon={items.length ? 'search' : 'pack'} title={items.length ? 'Nothing matches' : 'No items yet'} action={items.length ? <button className="btn" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</button> : undefined}>
          {items.length ? (prog.done === prog.total && filters.unpackedOnly ? 'Everything is packed.' : 'Try a different filter or search.') : 'Edit the trip to build its list.'}
        </Empty>
      ) : (
        groups.map((g) => {
          const left = g.items.filter((i) => !i.packed && !i.unavailable).length;
          return (
            <section key={g.key} aria-label={g.label}>
              <h2 className="stage-head">
                <span>{g.label}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="num">{left ? `${left} left` : 'all done'}</span>
                  {left > 0 && (
                    <button className="btn btn--small btn--ghost" onClick={() => markPacked(g.items, g.label)} aria-label={`Mark all ${left} in ${g.label} as packed`}>
                      Pack all
                    </button>
                  )}
                </span>
              </h2>
              <ul className="list">
                {g.items.map((i) => (
                  <ItemRow key={i.id} item={i} who={who(i.assigneeId)} showWho={showWho} onToggle={toggle} onOpen={setOpen} />
                ))}
              </ul>
            </section>
          );
        })
      )}
      <p className="pad-x muted small" style={{ marginTop: 16 }}>
        Red marks essentials. Tap an item to see why it is on the list and how the quantity was worked out.
      </p>

      <button className="fab" onClick={() => setAdding(true)}>
        <Icon name="plus" /> Add item
      </button>

      {open && (
        <ItemSheet
          key={open.id}
          item={items.find((i) => i.id === open.id) ?? open}
          who={who(open.assigneeId)}
          people={people}
          onClose={() => setOpen(undefined)}
          onChange={(next) => void apply([next], `Updated ${next.name}`, { silent: true })}
          onDelete={async (i) => {
            await deleteChecklistItem(i.id);
            setItems((prev) => prev.filter((p) => p.id !== i.id));
            pushUndo({ label: `Deleted ${i.name}`, before: [], added: [], deleted: [i] });
            setOpen(undefined);
            showToast(`Deleted ${i.name}`, 'Undo', () => void runUndo());
          }}
        />
      )}
      {adding && (
        <AddItemSheet
          tripId={trip.id}
          people={people}
          onClose={() => setAdding(false)}
          onAdd={async (item, always) => {
            await putChecklistItems([item]);
            if (always) await saveAlwaysPack(always);
            setItems((prev) => [...prev, item]);
            pushUndo({ label: `Added ${item.name}`, before: [], added: [item.id], deleted: [] });
            setAdding(false);
            showToast(`Added ${item.name}${always ? ' (and to always-pack)' : ''}`, 'Undo', () => void runUndo());
          }}
        />
      )}
      {filtersOpen && (
        <Sheet title="Filter and group" onClose={() => setFiltersOpen(false)}>
          <Segmented<GroupBy>
            label="Group by"
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: 'stage', label: 'When to pack' },
              { value: 'category', label: 'Category' },
              { value: 'person', label: 'Person' },
              { value: 'location', label: 'Bag / place' },
            ]}
          />
          <Segmented
            label="Category"
            value={filters.category}
            onChange={(v) => setFilters({ ...filters, category: v })}
            options={[{ value: 'all', label: 'All' }, ...CATEGORY_ORDER.filter((c) => items.some((i) => i.category === c)).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))]}
          />
          <Segmented
            label="Packing location"
            value={filters.location}
            onChange={(v) => setFilters({ ...filters, location: v })}
            options={[{ value: 'all', label: 'All' }, ...(Object.keys(LOCATION_LABEL) as PackLocation[]).filter((l) => items.some((i) => i.location === l)).map((l) => ({ value: l, label: LOCATION_LABEL[l] }))]}
          />
          <Segmented
            label="Priority"
            value={filters.priority}
            onChange={(v) => setFilters({ ...filters, priority: v })}
            options={[
              { value: 'all', label: 'All' },
              { value: '1', label: 'High' },
              { value: '2', label: 'Medium' },
              { value: '3', label: 'Low' },
            ]}
          />
          <div className="row-actions">
            <button className="btn" onClick={() => setFilters(DEFAULT_FILTERS)}>
              Clear all
            </button>
            <button className="btn btn--primary" style={{ flex: 1 }} onClick={() => setFiltersOpen(false)}>
              Show {visible.length} items
            </button>
          </div>
        </Sheet>
      )}
      {bulkOpen && (
        <Sheet title="Checklist actions" onClose={() => setBulkOpen(false)}>
          <ul className="list card">
            <li>
              <button
                className="list-link"
                onClick={() => {
                  markPacked(visible, 'Shown items');
                  setBulkOpen(false);
                }}
              >
                <span className="list-link__body">
                  <span className="list-link__title">Mark all shown items packed</span>
                  <span className="list-link__meta">{visible.filter((i) => !i.packed && !i.unavailable).length} items match the current filters</span>
                </span>
              </button>
            </li>
            <li>
              <button
                className="list-link"
                onClick={() => {
                  const changed = items.filter((i) => i.packed).map((i) => ({ ...i, packed: false, updatedAt: nowIso() }));
                  if (changed.length) void apply(changed, `Unpacked ${changed.length} items`);
                  setBulkOpen(false);
                }}
              >
                <span className="list-link__body">
                  <span className="list-link__title">Start over: unpack everything</span>
                  <span className="list-link__meta">For the return journey or a second trip. Undo is available.</span>
                </span>
              </button>
            </li>
            <li>
              <a className="list-link" href={`#/trip/${trip.id}/ready`}>
                <span className="list-link__body">
                  <span className="list-link__title">Departure readiness check</span>
                  <span className="list-link__meta">Essentials, safety items and final checks</span>
                </span>
              </a>
            </li>
            <li>
              <a className="list-link" href={`#/trip/${trip.id}/edit`}>
                <span className="list-link__body">
                  <span className="list-link__title">Edit trip and rebuild the list</span>
                  <span className="list-link__meta">Ticks, quantity edits and your own items are kept</span>
                </span>
              </a>
            </li>
          </ul>
        </Sheet>
      )}
    </main>
  );
}
