// Tiny --key value argument parser (no dependencies).
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[k] = v;
  }
  return out;
}

export function parseBBox(s) {
  if (!s) return undefined;
  const p = s.split(',').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isFinite(x)) || p[0] >= p[2] || p[1] >= p[3]) {
    throw new Error('--bbox must be west,south,east,north (e.g. 74.0,11.5,78.6,15.5)');
  }
  return p;
}

export function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}
