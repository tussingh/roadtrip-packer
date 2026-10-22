// Minimal PMTiles v3 writer and Mapbox Vector Tile encoder — TEST FIXTURES ONLY.
import { zxyToTileId } from 'pmtiles';

function varint(n, out) {
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
}

/** Minimal valid PMTiles v3 (no compression, single root directory). */
export function writePmtiles(tiles, bounds, minZ, maxZ) {
  const entries = tiles.map((t) => ({ id: zxyToTileId(t.z, t.x, t.y), data: t.data })).sort((a, b) => a.id - b.id);
  const dir = [];
  varint(entries.length, dir);
  let last = 0;
  for (const e of entries) {
    varint(e.id - last, dir);
    last = e.id;
  }
  for (let i = 0; i < entries.length; i++) varint(1, dir);
  for (const e of entries) varint(e.data.length, dir);
  for (let i = 0; i < entries.length; i++) varint(i === 0 ? 1 : 0, dir);
  const meta = new TextEncoder().encode('{"name":"synthetic test tiles"}');
  const tileBytes = entries.reduce((s, e) => s + e.data.length, 0);
  const H = 127;
  const out = new Uint8Array(H + dir.length + meta.length + tileBytes);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode('PMTiles'), 0);
  out[7] = 3;
  const u64 = (o, v) => {
    dv.setUint32(o, v >>> 0, true);
    dv.setUint32(o + 4, Math.floor(v / 2 ** 32), true);
  };
  const rootOff = H;
  const metaOff = rootOff + dir.length;
  const dataOff = metaOff + meta.length;
  u64(8, rootOff); u64(16, dir.length); u64(24, metaOff); u64(32, meta.length);
  u64(40, 0); u64(48, 0); u64(56, dataOff); u64(64, tileBytes);
  u64(72, entries.length); u64(80, entries.length); u64(88, entries.length);
  out[96] = 1; out[97] = 1; out[98] = 1; out[99] = 1; out[100] = minZ; out[101] = maxZ;
  dv.setInt32(102, Math.round(bounds[0] * 1e7), true);
  dv.setInt32(106, Math.round(bounds[1] * 1e7), true);
  dv.setInt32(110, Math.round(bounds[2] * 1e7), true);
  dv.setInt32(114, Math.round(bounds[3] * 1e7), true);
  out[118] = minZ;
  dv.setInt32(119, Math.round(((bounds[0] + bounds[2]) / 2) * 1e7), true);
  dv.setInt32(123, Math.round(((bounds[1] + bounds[3]) / 2) * 1e7), true);
  out.set(new Uint8Array(dir), rootOff);
  out.set(meta, metaOff);
  let o = dataOff;
  for (const e of entries) {
    out.set(e.data, o);
    o += e.data.length;
  }
  return out;
}

/* ---- tiny protobuf writer for MVT ---- */
const zz = (n) => (n << 1) ^ (n >> 31);
function field(num, wire, out) { varint((num << 3) | wire, out); }
function bytesField(num, bytes, out) { field(num, 2, out); varint(bytes.length, out); out.push(...bytes); }
function packed(nums) { const o = []; for (const n of nums) varint(n, o); return o; }

/** One-layer MVT ("earth") with a polygon covering the whole tile, so a basemap style draws land. */
export function landTile() {
  const cmd = (id, count) => (id & 7) | (count << 3);
  const geom = [cmd(1, 1), zz(0), zz(0), cmd(2, 3), zz(4096), zz(0), zz(0), zz(4096), zz(-4096), zz(0), cmd(7, 1)];
  const feature = [];
  field(3, 0, feature); varint(3, feature); // POLYGON
  bytesField(4, packed(geom), feature);
  const layer = [];
  field(15, 0, layer); varint(2, layer);
  bytesField(1, [...new TextEncoder().encode('earth')], layer);
  bytesField(2, feature, layer);
  field(5, 0, layer); varint(4096, layer);
  const tile = [];
  bytesField(3, layer, tile);
  return new Uint8Array(tile);
}
