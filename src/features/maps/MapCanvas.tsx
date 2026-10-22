import { layers, namedFlavor } from '@protomaps/basemaps';
import { addProtocol, Map as MLMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { PMTiles, Protocol } from 'pmtiles';
import { useEffect, useRef } from 'react';
import type { MapRegion } from '../../types';
import type { LonLat } from './geo';
import { IdbChunkSource } from './idbSource';

setWorkerUrl(workerUrl);
const protocol = new Protocol();
addProtocol('pmtiles', protocol.tile);
const registered = new Set<string>();

function ensureArchive(r: MapRegion): string {
  const a = r.assets.tiles!;
  const src = new IdbChunkSource(r.id, a.bytes, a.chunkSize);
  const key = src.getKey();
  if (!registered.has(`${key}:${a.bytes}`)) {
    protocol.add(new PMTiles(src));
    registered.add(`${key}:${a.bytes}`);
  }
  return `pmtiles://${key}`;
}

/** Glyphs and sprites ship inside the app and are precached by the service worker. */
function assetBase(): string {
  return new URL('.', document.baseURI).href + 'map-assets/';
}

export function buildStyle(r: MapRegion, dark: boolean): StyleSpecification {
  const url = ensureArchive(r);
  return {
    version: 8,
    glyphs: assetBase() + 'fonts/{fontstack}/{range}.pbf',
    sprite: assetBase() + `sprites/${dark ? 'dark' : 'light'}`,
    sources: {
      protomaps: { type: 'vector', url, attribution: r.attribution },
    },
    layers: layers('protomaps', namedFlavor(dark ? 'dark' : 'light'), { lang: 'en' }),
  };
}

export interface MapPoint {
  lon: number;
  lat: number;
  label: string;
  kind: 'poi' | 'break' | 'waypoint' | 'me' | 'saved';
}

export function MapCanvas({
  region,
  dark,
  route,
  points,
  focus,
  onMove,
}: {
  region?: MapRegion;
  dark: boolean;
  route?: LonLat[];
  points: MapPoint[];
  focus?: { center?: LonLat; bounds?: [LonLat, LonLat]; zoom?: number; seq: number };
  onMove?: (center: LonLat, zoom: number) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const overlay = useRef({ route, points });
  overlay.current = { route, points };

  useEffect(() => {
    if (!el.current || !region?.assets.tiles || region.assets.tiles.status !== 'ready') return;
    const [w, s, e, n] = region.bbox;
    const m = new MLMap({
      container: el.current,
      style: buildStyle(region, dark),
      bounds: [
        [w, s],
        [e, n],
      ],
      maxBounds: [
        [w - 1, s - 1],
        [e + 1, n + 1],
      ],
      maxZoom: Math.min(19, region.maxZoom + 3),
      attributionControl: { compact: true },
      cooperativeGestures: false,
    });
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    m.on('load', () => {
      m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addSource('points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      m.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#0E5E46', 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      m.addLayer({
        id: 'points',
        type: 'circle',
        source: 'points',
        paint: {
          'circle-radius': ['match', ['get', 'kind'], 'waypoint', 9, 'me', 8, 'break', 8, 6],
          'circle-color': ['match', ['get', 'kind'], 'waypoint', '#0E5E46', 'me', '#1f6feb', 'break', '#F2B705', 'saved', '#7a3fb0', '#b3261e'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
      m.addLayer({
        id: 'point-labels',
        type: 'symbol',
        source: 'points',
        layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true },
        paint: { 'text-color': dark ? '#e7ece8' : '#23292e', 'text-halo-color': dark ? '#13181b' : '#ffffff', 'text-halo-width': 1.5 },
      });
      sync(m, overlay.current.route, overlay.current.points);
    });
    m.on('moveend', () => {
      const c = m.getCenter();
      onMove?.([c.lng, c.lat], m.getZoom());
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region?.id, region?.assets.tiles?.status, dark]);

  useEffect(() => {
    const m = map.current;
    if (m && m.isStyleLoaded() && m.getSource('route')) sync(m, route, points);
  }, [route, points]);

  useEffect(() => {
    const m = map.current;
    if (!m || !focus) return;
    if (focus.bounds) m.fitBounds([focus.bounds[0], focus.bounds[1]], { padding: 40, duration: 0, maxZoom: 13 });
    else if (focus.center) m.jumpTo({ center: focus.center, zoom: focus.zoom ?? Math.max(m.getZoom(), 12) });
  }, [focus?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="map" role="region" aria-label="Offline map" />;
}

function sync(m: MLMap, route: LonLat[] | undefined, points: MapPoint[]) {
  (m.getSource('route') as GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection',
    features: route && route.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route } }] : [],
  });
  (m.getSource('points') as GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection',
    features: points.map((p) => ({ type: 'Feature', properties: { label: p.label, kind: p.kind }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })),
  });
}
