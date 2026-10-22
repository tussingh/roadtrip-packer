import { Map as MLMap, NavigationControl, Popup, ScaleControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef, useState } from 'react';
import type { LonLat } from '../maps/geo';
import { OFM_STYLE } from './offlineTiles';

setWorkerUrl(workerUrl);

export interface RoutePin {
  lon: number;
  lat: number;
  label: string;
  kind: 'start' | 'end' | 'food' | 'fuel' | 'stop' | 'sight' | 'hospital';
  href?: string;
}

const COLORS: Record<RoutePin['kind'], string> = {
  start: '#0E5E46',
  end: '#0E5E46',
  food: '#d9480f',
  fuel: '#1f6feb',
  stop: '#F2B705',
  sight: '#7a3fb0',
  hospital: '#b3261e',
};

/** Street map from OpenFreeMap with the route and pins. Works offline for routes saved with "Save map for offline". */
export default function OnlineMap({ route, pins, dark }: { route: LonLat[]; pins: RoutePin[]; dark: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const data = useRef({ route, pins });
  data.current = { route, pins };
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    let m: MLMap;
    try {
      m = new MLMap({ container: el.current, style: OFM_STYLE, center: route[0] ?? [77.59, 12.97], zoom: 6, attributionControl: { compact: true } });
    } catch {
      setFailed(true);
      return;
    }
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    m.on('error', (e) => {
      if (String((e as unknown as { error?: { message?: string } }).error?.message ?? '').includes('style')) setFailed(true);
    });
    m.on('load', () => {
      m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addSource('pins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#ffffff', 'line-width': 9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      m.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#0E5E46', 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      m.addLayer({
        id: 'pins',
        type: 'circle',
        source: 'pins',
        paint: { 'circle-radius': ['match', ['get', 'kind'], 'start', 9, 'end', 9, 'stop', 8, 6], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
      });
      sync(m);
      const [first] = data.current.route;
      if (first) {
        const b = data.current.route.reduce(([w, s, e, n], [x, y]) => [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(n, y)], [first[0], first[1], first[0], first[1]]);
        m.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 36, duration: 0 });
      }
    });
    m.on('click', 'pins', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as { label: string; href?: string };
      const div = document.createElement('div');
      const b = document.createElement('strong');
      b.textContent = p.label;
      div.appendChild(b);
      if (p.href) {
        const a = document.createElement('a');
        a.href = p.href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = ' Open in Google Maps';
        a.style.display = 'block';
        div.appendChild(a);
      }
      new Popup({ closeButton: true }).setLngLat(e.lngLat).setDOMContent(div).addTo(m);
    });
    m.on('mouseenter', 'pins', () => (m.getCanvas().style.cursor = 'pointer'));
    m.on('mouseleave', 'pins', () => (m.getCanvas().style.cursor = ''));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  useEffect(() => {
    const m = map.current;
    if (m && m.isStyleLoaded() && m.getSource('route')) sync(m);
  }, [route, pins]);

  function sync(m: MLMap) {
    const { route: r, pins: p } = data.current;
    (m.getSource('route') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: r.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r } }] : [] });
    (m.getSource('pins') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: p.map((x) => ({ type: 'Feature', properties: { label: x.label, kind: x.kind, color: COLORS[x.kind], href: x.href ?? '' }, geometry: { type: 'Point', coordinates: [x.lon, x.lat] } })),
    });
  }

  if (failed) return <div className="map map--fallback muted small">Map could not load. Check your connection, or save this route’s map for offline use next time you have signal.</div>;
  return <div ref={el} className="map" role="region" aria-label="Route map" />;
}
