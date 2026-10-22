import { blankTrip, starterFamily } from '../data/defaults';
import { DEFAULT_ASSUMPTIONS } from './assumptions';
import { deriveFacts } from './context';
import { ALL_RULES } from './engine';
import { resolveDyn } from './ruleTypes';

export interface CatalogEntry {
  ruleId: string;
  name: string;
  unit: string;
  category: string;
}

let cache: CatalogEntry[] | undefined;

/** Human names for every physical item rule, for linking inventory to recommendations. */
export function ruleCatalog(): CatalogEntry[] {
  if (cache) return cache;
  const fam = starterFamily(new Date('2026-01-01'));
  const trip = { ...blankTrip(fam.map((p) => p.id)), days: 3, nights: 2, totalKm: 400 };
  const f = deriveFacts(trip, fam, DEFAULT_ASSUMPTIONS, new Date('2026-01-01'));
  const t = f.adults[0];
  const c = f.children[0];
  cache = ALL_RULES.filter((r) => !r.isCheck).map((r) => {
    const who = r.scope === 'each-child' ? c : r.scope === 'each-adult' ? t : undefined;
    let name = r.id;
    let unit = 'item';
    try {
      name = resolveDyn(r.name, f, who);
      unit = r.qty ? r.qty(f, who).unit : 'item';
    } catch {
      /* keep id */
    }
    return { ruleId: r.id, name, unit, category: r.category };
  });
  cache.sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}
