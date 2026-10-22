import { z } from 'zod';
import type { BBox, MapAssetKind, MapRegion } from '../../types';

const asset = z.object({
  url: z.string().min(1),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
});

export const regionManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'id must be lowercase letters, digits and dashes'),
  name: z.string().min(1),
  description: z.string().default(''),
  bbox: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  maxZoom: z.number().int().min(0).max(16),
  dataDate: z.string().optional(),
  attribution: z.string().min(1),
  assets: z.object({ tiles: asset.optional(), poi: asset.optional(), graph: asset.optional() }),
});

export const catalogSchema = z.object({
  format: z.literal('milestone-region-catalog'),
  version: z.literal(1),
  regions: z.array(regionManifestSchema),
});

export type RegionManifest = z.infer<typeof regionManifestSchema>;
export type AssetManifest = z.infer<typeof asset>;

/** Resolve relative asset URLs against the catalog/manifest location. */
export function resolveManifest(m: RegionManifest, baseUrl: string): RegionManifest {
  const resolved = { ...m, assets: { ...m.assets } };
  for (const k of ['tiles', 'poi', 'graph'] as MapAssetKind[]) {
    const a = m.assets[k];
    if (a) resolved.assets[k] = { ...a, url: new URL(a.url, baseUrl).toString() };
  }
  return resolved;
}

export function parseCatalog(json: unknown, baseUrl: string): { regions: RegionManifest[]; error?: string } {
  const single = regionManifestSchema.safeParse(json);
  if (single.success) return { regions: [resolveManifest(single.data, baseUrl)] };
  const cat = catalogSchema.safeParse(json);
  if (!cat.success) {
    const issue = cat.error.issues[0];
    return { regions: [], error: `Not a valid region catalog or manifest (${issue.path.join('.') || 'file'}: ${issue.message})` };
  }
  return { regions: cat.data.regions.map((r) => resolveManifest(r, baseUrl)) };
}

export function regionFromManifest(m: RegionManifest, existing?: MapRegion): MapRegion {
  const now = new Date().toISOString();
  const r: MapRegion = existing
    ? { ...existing, assets: { ...existing.assets } }
    : { id: m.id, name: m.name, description: m.description, bbox: m.bbox as BBox, maxZoom: m.maxZoom, attribution: m.attribution, assets: {}, updatedAt: now };
  r.name = m.name;
  r.description = m.description;
  r.bbox = m.bbox as BBox;
  r.maxZoom = m.maxZoom;
  r.dataDate = m.dataDate;
  r.attribution = m.attribution;
  for (const k of ['tiles', 'poi', 'graph'] as MapAssetKind[]) {
    const a = m.assets[k];
    if (!a) continue;
    const prev = r.assets[k];
    const changed = !prev || prev.url !== a.url || prev.bytes !== a.bytes || (a.sha256 && prev.sha256 !== a.sha256);
    if (changed) {
      r.assets[k] = { kind: k, url: a.url, bytes: a.bytes, sha256: a.sha256?.toLowerCase(), chunkSize: prev?.chunkSize ?? 1024 * 1024, chunksDone: 0, status: 'absent', verified: false, source: 'download', updatedAt: now };
    }
  }
  return r;
}

export async function fetchCatalog(url: string, fetchImpl: typeof fetch = fetch): Promise<{ regions: RegionManifest[]; error?: string }> {
  let res: Response;
  try {
    res = await fetchImpl(url, { cache: 'no-store' });
  } catch {
    return { regions: [], error: 'Could not reach the catalog. Connect to the internet to browse downloadable regions.' };
  }
  if (!res.ok) return { regions: [], error: `Catalog request failed (HTTP ${res.status}).` };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { regions: [], error: 'The catalog is not valid JSON.' };
  }
  return parseCatalog(json, res.url || url);
}
