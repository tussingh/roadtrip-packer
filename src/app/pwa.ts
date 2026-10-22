import { showToast } from './store';

/**
 * Registers the Workbox service worker (generated at build time) that
 * precaches the app shell. New versions wait until the user taps "Reload",
 * so a checklist is never swapped out mid-edit.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const startedAt = Date.now();
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const update = registerSW({
        immediate: true,
        onRegisteredSW(_url, reg) {
          // Phones keep installed apps open for days: look for updates when brought back.
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && navigator.onLine) void reg?.update();
          });
        },
        onNeedRefresh() {
          // Every tick is saved instantly, so reloading is safe — except inside a half-filled form.
          const inForm = /\/(new|edit|review)\b/.test(location.hash);
          if (Date.now() - startedAt < 15000 && !inForm) return void update(true);
          showToast('A new version of Milestone is ready.', 'Update now', () => update(true));
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
