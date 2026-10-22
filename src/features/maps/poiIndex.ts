import type { BBox } from '../../types';
import { cumulative, haversine, inBBox, locateOnLine, type LonLat } from './geo';

export interface PoiFile {
  format: 'milestone-poi';
  version: 1;
  bbox: BBox;
  generated?: string;
  source: string;
  kinds: string[];
  /** [lon, lat, kindIndex, name, extra?] */
  places: [number, number, number, string, string?][];
}

export interface Poi {
  i: number;
  lon: number;
  lat: number;
  kind: string;
  name: string;
  extra?: string;
}

export const KIND_GROUPS: Record<string, { label: string; kinds: string[] }> = {
  fuel: { label: 'Fuel', kinds: ['fuel'] },
  medical: { label: 'Hospitals & clinics', kinds: ['hospital', 'clinic'] },
  pharmacy: { label: 'Pharmacies', kinds: ['pharmacy'] },
  food: { label: 'Food', kinds: ['restaurant', 'cafe', 'fast_food'] },
  toilets: { label: 'Toilets', kinds: ['toilets'] },
  rest: { label: 'Rest areas', kinds: ['rest_area', 'services'] },
  atm: { label: 'ATMs', kinds: ['atm'] },
  stay: { label: 'Stays', kinds: ['hotel', 'motel', 'guest_house'] },
  sights: { label: 'Sights', kinds: ['attraction', 'viewpoint'] },
  places: { label: 'Towns', kinds: ['city', 'town', 'village', 'suburb'] },
};

export const KIND_LABEL: Record<string, string> = {
  fuel: 'Fuel station', hospital: 'Hospital', clinic: 'Clinic', pharmacy: 'Pharmacy', restaurant: 'Restaurant', cafe: 'Café',
  fast_food: 'Fast food', toilets: 'Toilets', rest_area: 'Rest area', services: 'Highway services', atm: 'ATM', police: 'Police',
  hotel: 'Hotel', motel: 'Motel', guest_house: 'Guest house', attraction: 'Attraction', viewpoint: 'Viewpoint',
  city: 'City', town: 'Town', village: 'Village', suburb: 'Neighbourhood',
};

const PLACE_RANK: Record<string, number> = { city: 0, town: 1, suburb: 2, village: 3 };
const CELL = 0.05; // degrees (~5.5 km)

export function normalise(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-෿]+/g, ' ')
    .trim();
}

export function validatePoiFile(json: unknown): PoiFile {
  const f = json as PoiFile;
  if (!f || f.format !== 'milestone-poi' || f.version !== 1 || !Array.isArray(f.places) || !Array.isArray(f.kinds)) {
    throw new Error('Not a Milestone places index (version 1).');
  }
  return f;
}

export class PoiIndex {
  readonly bbox: BBox;
  readonly source: string;
  readonly size: number;
  private lon: Float64Array;
  private lat: Float64Array;
  private kindIdx: Uint8Array;
  private names: string[];
  private extras: (string | undefined)[];
  private tokens: string[][];
  private kinds: string[];
  private grid = new Map<string, number[]>();

  constructor(file: PoiFile) {
    this.bbox = file.bbox;
    this.source = file.source;
    this.kinds = file.kinds;
    const n = file.places.length;
    this.size = n;
    this.lon = new Float64Array(n);
    this.lat = new Float64Array(n);
    this.kindIdx = new Uint8Array(n);
    this.names = new Array(n);
    this.extras = new Array(n);
    this.tokens = new Array(n);
    file.places.forEach(([lon, lat, k, name, extra], i) => {
      this.lon[i] = lon;
      this.lat[i] = lat;
      this.kindIdx[i] = k;
      this.names[i] = name ?? '';
      this.extras[i] = extra;
      this.tokens[i] = normalise(`${name ?? ''} ${extra ?? ''}`).split(' ').filter(Boolean);
      const key = this.cell(lon, lat);
      const arr = this.grid.get(key);
      if (arr) arr.push(i);
      else this.grid.set(key, [i]);
    });
  }

  static fromBytes(bytes: Uint8Array): PoiIndex {
    return new PoiIndex(validatePoiFile(JSON.parse(new TextDecoder().decode(bytes))));
  }

  private cell(lon: number, lat: number) {
    return `${Math.floor(lon / CELL)}:${Math.floor(lat / CELL)}`;
  }

  get(i: number): Poi {
    return { i, lon: this.lon[i], lat: this.lat[i], kind: this.kinds[this.kindIdx[i]] ?? 'unknown', name: this.names[i], extra: this.extras[i] };
  }

  covers(p: LonLat): boolean {
    return inBBox(p, this.bbox);
  }

  /** Offline name search. Every query word must prefix-match a word in the name. */
  search(query: string, near?: LonLat, limit = 20, kinds?: string[]): Poi[] {
    const q = normalise(query).split(' ').filter(Boolean);
    if (q.length === 0) return [];
    const kindSet = kinds ? new Set(kinds) : undefined;
    const scored: { i: number; score: number }[] = [];
    const full = q.join(' ');
    for (let i = 0; i < this.size; i++) {
      const toks = this.tokens[i];
      if (toks.length === 0) continue;
      if (kindSet && !kindSet.has(this.kinds[this.kindIdx[i]])) continue;
      if (!q.every((w) => toks.some((t) => t.startsWith(w)))) continue;
      const nm = normalise(this.names[i]);
      let score = nm === full ? 0 : nm.startsWith(full) ? 1 : 2;
      score += (PLACE_RANK[this.kinds[this.kindIdx[i]]] ?? 4) * 0.1;
      if (near) score += Math.min(1, haversine(near, [this.lon[i], this.lat[i]]) / 500_000);
      scored.push({ i, score });
    }
    scored.sort((a, b) => a.score - b.score || this.names[a.i].localeCompare(this.names[b.i]));
    return scored.slice(0, limit).map((s) => this.get(s.i));
  }

  nearby(p: LonLat, radiusM: number, kinds?: string[], limit = 50): (Poi & { distM: number })[] {
    const kindSet = kinds ? new Set(kinds) : undefined;
    const r = Math.ceil(radiusM / 5000) + 1;
    const cx = Math.floor(p[0] / CELL);
    const cy = Math.floor(p[1] / CELL);
    const out: (Poi & { distM: number })[] = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (const i of this.grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (kindSet && !kindSet.has(this.kinds[this.kindIdx[i]])) continue;
          const d = haversine(p, [this.lon[i], this.lat[i]]);
          if (d <= radiusM) out.push({ ...this.get(i), distM: d });
        }
      }
    }
    return out.sort((a, b) => a.distM - b.distM).slice(0, limit);
  }

  /** POIs within `maxOffM` of a route, ordered by distance along it. */
  alongRoute(line: LonLat[], maxOffM: number, kinds?: string[]): (Poi & { alongM: number; offM: number })[] {
    if (line.length < 2) return [];
    const kindSet = kinds ? new Set(kinds) : undefined;
    const cum = cumulative(line);
    const cells = new Set<string>();
    const pad = Math.ceil(maxOffM / 5000);
    for (const [lon, lat] of line) {
      const cx = Math.floor(lon / CELL);
      const cy = Math.floor(lat / CELL);
      for (let dx = -pad; dx <= pad; dx++) for (let dy = -pad; dy <= pad; dy++) cells.add(`${cx + dx}:${cy + dy}`);
    }
    // densify long segments so the cell sweep does not skip cells between vertices
    for (let k = 1; k < line.length; k++) {
      const steps = Math.ceil(haversine(line[k - 1], line[k]) / 3000);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const lon = line[k - 1][0] + t * (line[k][0] - line[k - 1][0]);
        const lat = line[k - 1][1] + t * (line[k][1] - line[k - 1][1]);
        cells.add(this.cell(lon, lat));
      }
    }
    const out: (Poi & { alongM: number; offM: number })[] = [];
    const seen = new Set<number>();
    for (const c of cells) {
      for (const i of this.grid.get(c) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        if (kindSet && !kindSet.has(this.kinds[this.kindIdx[i]])) continue;
        const loc = locateOnLine([this.lon[i], this.lat[i]], line, cum);
        if (loc.offRoute <= maxOffM) out.push({ ...this.get(i), alongM: loc.along, offM: loc.offRoute });
      }
    }
    return out.sort((a, b) => a.alongM - b.alongM);
  }
}
