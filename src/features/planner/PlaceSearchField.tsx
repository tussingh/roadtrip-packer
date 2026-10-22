import { useEffect, useId, useRef, useState } from 'react';
import { useOnline } from '../../app/store';
import { Icon } from '../../components/Icon';
import type { GeoPoint } from '../../types';
import { searchPlaces } from './services';

/** Live place suggestions (online). Picking one stores exact coordinates. */
export function PlaceSearchField({
  label,
  value,
  onPick,
  onText,
  near,
  placeholder,
  allowMyLocation,
}: {
  label: string;
  value: { name: string; lat?: number; lon?: number };
  onPick: (p: GeoPoint) => void;
  onText?: (name: string) => void;
  near?: [number, number];
  placeholder?: string;
  allowMyLocation?: boolean;
}) {
  const id = useId();
  const online = useOnline();
  const [q, setQ] = useState(value.name);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<GeoPoint[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current) setQ(value.name);
  }, [value.name]);

  useEffect(() => {
    if (!typed.current || q.trim().length < 3 || !online) {
      setResults([]);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setBusy(true);
      setErr('');
      try {
        const r = await searchPlaces(q, near);
        if (alive) {
          setResults(r);
          setOpen(true);
        }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setBusy(false);
      }
    }, 450);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, online, near?.[0], near?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const located = value.lat !== undefined && value.lon !== undefined && !typed.current;

  return (
    <div className="field" style={{ position: 'relative' }}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="search" style={{ margin: 0 }}>
        <Icon name={located ? 'pin' : 'search'} size={20} style={{ color: located ? 'var(--sign)' : undefined }} />
        <input
          id={id}
          value={q}
          placeholder={placeholder ?? (online ? 'Type a town, place or address' : 'Offline — type a name')}
          autoComplete="off"
          onChange={(e) => {
            typed.current = true;
            setQ(e.target.value);
            onText?.(e.target.value);
          }}
          onFocus={() => results.length && setOpen(true)}
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          aria-expanded={open}
        />
        {busy && <span className="muted small">…</span>}
      </div>
      {located && <span className="field__hint">Location found — the route will be calculated automatically.</span>}
      {!online && <span className="field__hint">Offline: place search and automatic routes need internet. You can still type the name and enter the distance yourself.</span>}
      {err && <span className="field__hint" style={{ color: 'var(--safety)' }}>{err}</span>}
      {allowMyLocation && online && (
        <button
          type="button"
          className="btn btn--small btn--ghost"
          style={{ paddingLeft: 0 }}
          onClick={() =>
            navigator.geolocation?.getCurrentPosition(
              (pos) => {
                typed.current = false;
                onPick({ name: 'My location', lat: pos.coords.latitude, lon: pos.coords.longitude });
              },
              () => setErr('Location permission was declined.'),
              { enableHighAccuracy: false, timeout: 15000 },
            )
          }
        >
          <Icon name="locate" size={16} /> Use my current location
        </button>
      )}
      {open && results.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="list card" style={{ position: 'absolute', zIndex: 30, left: 0, right: 0, top: '100%', marginTop: 4, boxShadow: 'var(--shadow)', maxHeight: 320, overflowY: 'auto' }}>
          {results.map((r) => (
            <li key={`${r.name}-${r.lat}-${r.lon}`} role="option" aria-selected={false}>
              <button
                type="button"
                className="list-link"
                onClick={() => {
                  typed.current = false;
                  setQ(r.name);
                  setOpen(false);
                  onPick(r);
                }}
              >
                <span className="list-link__body">
                  <span className="list-link__title">{r.name}</span>
                  {r.detail && <span className="list-link__meta">{r.detail}</span>}
                </span>
              </button>
            </li>
          ))}
          <li className="muted small" style={{ padding: '6px 16px' }}>
            Search © OpenStreetMap contributors
          </li>
        </ul>
      )}
    </div>
  );
}
