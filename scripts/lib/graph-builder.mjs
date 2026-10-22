// Builds the compact "MRG1" road graph from OpenStreetMap ways.
// Pure functions: used by scripts/build-road-graph.mjs and by the test suite.

/** Planning speeds by road class (km/h). Heuristics, not legal limits. */
export const DEFAULT_SPEEDS = {
  motorway: 80,
  motorway_link: 40,
  trunk: 65,
  trunk_link: 35,
  primary: 50,
  primary_link: 30,
  secondary: 40,
  secondary_link: 28,
  tertiary: 32,
  tertiary_link: 25,
  unclassified: 25,
};

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
export function haversine(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Overpass `out geom;` JSON → [{coords:[[lon,lat],…], tags}] */
export function waysFromOverpass(json) {
  const out = [];
  for (const el of json.elements ?? []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    out.push({ coords: el.geometry.map((g) => [g.lon, g.lat]), tags: el.tags ?? {} });
  }
  return out;
}

/** GeoJSON FeatureCollection of (Multi)LineStrings with OSM tags as properties. */
export function waysFromGeoJSON(fc) {
  const out = [];
  for (const f of fc.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const coords of lines) if (coords.length >= 2) out.push({ coords, tags: f.properties ?? {} });
  }
  return out;
}

const key = (c) => `${Math.round(c[0] * 1e6)}:${Math.round(c[1] * 1e6)}`;

function perpDist(p, a, b) {
  const lat0 = rad(p[1]);
  const proj = (q) => [rad(q[0]) * Math.cos(lat0) * R, rad(q[1]) * R];
  const [px, py] = proj(p);
  const [ax, ay] = proj(a);
  const [bx, by] = proj(b);
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas–Peucker over indices; returns sorted kept indices including both ends. */
function simplify(coords, tol) {
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(coords[i], coords[s], coords[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tol) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = [];
  for (let i = 0; i < coords.length; i++) if (keep[i]) out.push(i);
  return out;
}

function onewayOf(tags) {
  const v = String(tags.oneway ?? '').toLowerCase();
  if (v === '-1' || v === 'reverse') return -1;
  if (v === 'yes' || v === 'true' || v === '1') return 1;
  if (v === 'no' || v === 'false' || v === '0') return 0;
  if (tags.junction === 'roundabout' || tags.highway === 'motorway' || tags.highway === 'motorway_link') return 1;
  return 0;
}

function speedOf(tags, speeds) {
  const ms = parseInt(String(tags.maxspeed ?? ''), 10);
  const cls = speeds[tags.highway];
  if (Number.isFinite(ms) && ms >= 10 && ms <= 120) return Math.min(ms, cls ? Math.max(cls, 30) + 20 : ms);
  return cls ?? 25;
}

function nameOf(tags) {
  const ref = tags.ref ? String(tags.ref).split(';')[0].trim() : '';
  const name = tags['name:en'] || tags.name || '';
  if (ref && name) return `${ref} (${name})`.slice(0, 120);
  return (ref || name).slice(0, 120);
}

/**
 * @param ways  [{coords, tags}]
 * @param opts  {speeds?, classes?, simplifyM?, source?, generated?}
 * @returns Uint8Array (MRG1)
 */
export function buildGraph(ways, opts = {}) {
  const speeds = { ...DEFAULT_SPEEDS, ...(opts.speeds ?? {}) };
  const classes = new Set(opts.classes ?? Object.keys(speeds));
  const tol = opts.simplifyM ?? 25;
  const usable = ways.filter((w) => classes.has(w.tags.highway) && w.coords.length >= 2);

  // 1. junctions: coordinates used more than once, or way endpoints
  const uses = new Map();
  for (const w of usable) {
    w.coords.forEach((c, i) => {
      const k = key(c);
      uses.set(k, (uses.get(k) ?? 0) + (i === 0 || i === w.coords.length - 1 ? 2 : 1));
    });
  }

  // 2. nodes + raw edges
  const nodeIndex = new Map();
  const lon = [];
  const lat = [];
  const node = (c) => {
    const k = key(c);
    let i = nodeIndex.get(k);
    if (i === undefined) {
      i = lon.length;
      nodeIndex.set(k, i);
      lon.push(Math.round(c[0] * 1e6));
      lat.push(Math.round(c[1] * 1e6));
    }
    return i;
  };
  const names = [''];
  const nameIdx = new Map([['', 0]]);
  const nameId = (n) => {
    if (!nameIdx.has(n)) {
      if (names.length >= 65535) return 0;
      nameIdx.set(n, names.length);
      names.push(n);
    }
    return nameIdx.get(n);
  };
  const edgeMap = new Map(); // "from>to" → {len, speed, name}
  const addEdge = (a, b, len, speed, name) => {
    if (a === b) return;
    const k = `${a}>${b}`;
    const prev = edgeMap.get(k);
    if (!prev || len / speed < prev.len / prev.speed) edgeMap.set(k, { a, b, len, speed, name });
  };

  for (const w of usable) {
    const dir = onewayOf(w.tags);
    const speed = speedOf(w.tags, speeds);
    const name = nameId(nameOf(w.tags));
    // split at junctions
    let start = 0;
    for (let i = 1; i < w.coords.length; i++) {
      const isJunction = (uses.get(key(w.coords[i])) ?? 0) > 1 || i === w.coords.length - 1;
      if (!isJunction) continue;
      const seg = w.coords.slice(start, i + 1);
      const kept = simplify(seg, tol);
      for (let k = 1; k < kept.length; k++) {
        let len = 0;
        for (let m = kept[k - 1] + 1; m <= kept[k]; m++) len += haversine(seg[m - 1], seg[m]);
        const a = node(seg[kept[k - 1]]);
        const b = node(seg[kept[k]]);
        if (dir >= 0) addEdge(a, b, len, speed, name);
        if (dir <= 0) addEdge(b, a, len, speed, name);
      }
      start = i;
    }
  }

  // 3. CSR
  const n = lon.length;
  const edges = [...edgeMap.values()].sort((x, y) => x.a - y.a || x.b - y.b);
  const e = edges.length;
  const first = new Uint32Array(n + 1);
  for (const ed of edges) first[ed.a + 1]++;
  for (let i = 0; i < n; i++) first[i + 1] += first[i];

  let w = 180, s = 90, ea = -180, no = -90;
  for (let i = 0; i < n; i++) {
    const x = lon[i] / 1e6;
    const y = lat[i] / 1e6;
    if (x < w) w = x;
    if (x > ea) ea = x;
    if (y < s) s = y;
    if (y > no) no = y;
  }
  if (opts.bbox) [w, s, ea, no] = opts.bbox;

  const meta = new TextEncoder().encode(
    JSON.stringify({ names, source: opts.source ?? '© OpenStreetMap contributors (ODbL)', generated: opts.generated, speeds, classes: [...classes] }),
  );
  const HEADER = 56;
  let size = HEADER + n * 4 * 2 + (n + 1) * 4 + e * 4 * 2 + e * 2 + e;
  const pad = (4 - (size % 4)) % 4;
  size += pad + meta.length;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  u8.set([77, 82, 71, 49], 0); // "MRG1"
  dv.setUint32(4, 1, true);
  dv.setUint32(8, n, true);
  dv.setUint32(12, e, true);
  dv.setUint32(16, meta.length, true);
  dv.setFloat64(20, w, true);
  dv.setFloat64(28, s, true);
  dv.setFloat64(36, ea, true);
  dv.setFloat64(44, no, true);
  let o = HEADER;
  for (let i = 0; i < n; i++, o += 4) dv.setInt32(o, lon[i], true);
  for (let i = 0; i < n; i++, o += 4) dv.setInt32(o, lat[i], true);
  for (let i = 0; i <= n; i++, o += 4) dv.setUint32(o, first[i], true);
  for (let j = 0; j < e; j++, o += 4) dv.setUint32(o, edges[j].b, true);
  for (let j = 0; j < e; j++, o += 4) dv.setUint32(o, Math.max(1, Math.round(edges[j].len * 10)), true);
  for (let j = 0; j < e; j++, o += 2) dv.setUint16(o, edges[j].name, true);
  for (let j = 0; j < e; j++, o += 1) dv.setUint8(o, Math.max(5, Math.min(255, Math.round(edges[j].speed))));
  o += pad;
  u8.set(meta, o);
  return u8;
}

/** Overpass QL for the roads a family car journey needs. */
export function roadsQuery([w, s, e, n]) {
  return `[out:json][timeout:900][maxsize:2000000000];
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary)$"](${s},${w},${n},${e});
out geom tags;`;
}
