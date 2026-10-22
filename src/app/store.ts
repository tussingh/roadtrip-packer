import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/* ---------------- data invalidation ---------------- */

let version = 0;
const listeners = new Set<() => void>();

/** Call after any write so every live query re-reads IndexedDB. */
export function bump() {
  version++;
  for (const l of listeners) l();
  for (const l of changeListeners) l();
}

const changeListeners = new Set<() => void>();
/** Signal a change that does not need every screen to re-read (e.g. a tick). */
export function notifyChange() {
  for (const l of changeListeners) l();
}

/** Notified after local data changes (used to schedule family sync). */
export function onDataChange(l: () => void) {
  changeListeners.add(l);
  return () => changeListeners.delete(l);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDataVersion() {
  return useSyncExternalStore(subscribe, () => version);
}

export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | undefined; error: Error | undefined; loading: boolean } {
  const v = useDataVersion();
  const [state, setState] = useState<{ data: T | undefined; error: Error | undefined; loading: boolean }>({ data: undefined, error: undefined, loading: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    run().then(
      (data) => alive && setState({ data, error: undefined, loading: false }),
      (error: unknown) => alive && setState({ data: undefined, error: error instanceof Error ? error : new Error(String(error)), loading: false }),
    );
    return () => {
      alive = false;
    };
  }, [run, v]);
  return state;
}

/* ---------------- hash router ---------------- */

function currentPath() {
  const h = typeof location !== 'undefined' ? location.hash.replace(/^#/, '') : '';
  return h || '/';
}

export function useRoute(): string[] {
  const path = useSyncExternalStore(
    (l) => {
      window.addEventListener('hashchange', l);
      return () => window.removeEventListener('hashchange', l);
    },
    currentPath,
    () => '/',
  );
  return path.split('?')[0].split('/').filter(Boolean);
}

export function navigate(path: string, replace = false) {
  const url = `#${path}`;
  if (replace) history.replaceState(null, '', url);
  else location.hash = path;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/* ---------------- online status ---------------- */

export function useOnline(): boolean {
  return useSyncExternalStore(
    (l) => {
      window.addEventListener('online', l);
      window.addEventListener('offline', l);
      return () => {
        window.removeEventListener('online', l);
        window.removeEventListener('offline', l);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/* ---------------- toast bus ---------------- */

export interface ToastMsg {
  id: number;
  message: string;
  action?: string;
  onAction?: () => void;
}
let toastId = 0;
let toast: ToastMsg | null = null;
const toastListeners = new Set<() => void>();

export function showToast(message: string, action?: string, onAction?: () => void) {
  toast = { id: ++toastId, message, action, onAction };
  toastListeners.forEach((l) => l());
}
export function clearToast(id?: number) {
  if (id !== undefined && toast?.id !== id) return;
  toast = null;
  toastListeners.forEach((l) => l());
}
export function useToast() {
  return useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toast,
  );
}
