// Builds the compact places index (milestone-poi v1) from OpenStreetMap data.

const AMENITY = ['fuel', 'hospital', 'clinic', 'pharmacy', 'restaurant', 'cafe', 'fast_food', 'toilets', 'atm', 'police'];
const HIGHWAY = ['rest_area', 'services'];
const TOURISM = ['hotel', 'motel', 'guest_house', 'attraction', 'viewpoint'];
const PLACE = ['city', 'town', 'village', 'suburb'];

export const POI_KINDS = [...AMENITY, ...HIGHWAY, ...TOURISM, ...PLACE];

export function kindOf(tags) {
  if (AMENITY.includes(tags.amenity)) return tags.amenity;
  if (HIGHWAY.includes(tags.highway)) return tags.highway;
  if (TOURISM.includes(tags.tourism)) return tags.tourism;
  if (PLACE.includes(tags.place)) return tags.place;
  if (tags.healthcare === 'hospital') return 'hospital';
  if (tags.healthcare === 'pharmacy') return 'pharmacy';
  return undefined;
}

/** Overpass `out center tags;` JSON → [{lon, lat, tags}] */
export function poisFromOverpass(json) {
  const out = [];
  for (const el of json.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    out.push({ lon, lat, tags: el.tags ?? {} });
  }
  return out;
}

/** GeoJSON points (or anything with a representative coordinate) with OSM tags as properties. */
export function poisFromGeoJSON(fc) {
  const out = [];
  for (const f of fc.features ?? []) {
    const g = f.geometry;
    if (g?.type === 'Point') out.push({ lon: g.coordinates[0], lat: g.coordinates[1], tags: f.properties ?? {} });
  }
  return out;
}

const r6 = (x) => Math.round(x * 1e6) / 1e6;

export function buildPoiFile(pois, opts = {}) {
  const kinds = [];
  const kindIdx = new Map();
  const places = [];
  const seen = new Set();
  for (const p of pois) {
    const kind = kindOf(p.tags);
    if (!kind) continue;
    if (opts.bbox) {
      const [w, s, e, n] = opts.bbox;
      if (p.lon < w || p.lon > e || p.lat < s || p.lat > n) continue;
    }
    if (!kindIdx.has(kind)) {
      kindIdx.set(kind, kinds.length);
      kinds.push(kind);
    }
    const en = p.tags['name:en'] || '';
    const local = p.tags.name || '';
    const name = (en || local || p.tags.brand || p.tags.operator || '').slice(0, 100);
    const extra = [en && local && en !== local ? local : '', p.tags.brand && p.tags.brand !== name ? p.tags.brand : ''].filter(Boolean).join(' · ').slice(0, 100);
    const dedupe = `${kind}|${name}|${r6(p.lon).toFixed(4)}|${r6(p.lat).toFixed(4)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const row = [r6(p.lon), r6(p.lat), kindIdx.get(kind), name];
    if (extra) row.push(extra);
    places.push(row);
  }
  let bbox = opts.bbox;
  if (!bbox) {
    bbox = [180, 90, -180, -90];
    for (const [x, y] of places) {
      bbox = [Math.min(bbox[0], x), Math.min(bbox[1], y), Math.max(bbox[2], x), Math.max(bbox[3], y)];
    }
  }
  return {
    format: 'milestone-poi',
    version: 1,
    bbox,
    generated: opts.generated,
    source: opts.source ?? '© OpenStreetMap contributors (ODbL)',
    kinds,
    places,
  };
}

export function poisQuery([w, s, e, n]) {
  const b = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:900][maxsize:1000000000];
(
  nwr["amenity"~"^(${AMENITY.join('|')})$"]${b};
  nwr["highway"~"^(${HIGHWAY.join('|')})$"]${b};
  nwr["tourism"~"^(${TOURISM.join('|')})$"]${b};
  node["place"~"^(${PLACE.join('|')})$"]${b};
);
out center tags;`;
}
