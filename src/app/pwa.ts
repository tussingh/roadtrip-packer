import { showToast } from './store';

/**
 * Registers the Workbox service worker (generated at build time) that
 * precaches the app shell. New versions wait until the user taps "Reload",
 * so a checklist is never swapped out mid-edit.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const update = registerSW({
        immediate: true,
        onNeedRefresh() {
          showToast('A new version is ready.', 'Reload', () => update(true));
        },
        onOfflineReady() {
          showToast('Installed for offline use.');
        },
        onRegisterError() {
          showToast('Offline mode could not be set up in this browser.');
        },
      });
    })
    .catch(() => undefined);
}
