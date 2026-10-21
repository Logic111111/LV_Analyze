// Service worker registration (P7.8), production builds only (the dev server serves modules that
// a cache would only get in the way of). When a new version has installed and is waiting, the
// listeners hear about it and can offer a reload; reloading asks it to take over, then the page
// reloads once it controls the page.
const listeners = new Set();
let pending = null; // () => void that activates the waiting version

/** @param {(activate: (() => void) | null) => void} fn @returns {() => void} unsubscribe */
export function onUpdateReady(fn) { listeners.add(fn); fn(pending); return () => listeners.delete(fn); }

export function registerServiceWorker() {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // The very first install also takes control (clients.claim) — that's not an update.
      if (hadController && !reloading) { reloading = true; window.location.reload(); }
    });
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const ready = (w) => {
        if (!w || !navigator.serviceWorker.controller) return;
        pending = () => w.postMessage('SKIP_WAITING');
        listeners.forEach(fn => fn(pending));
      };
      if (reg.waiting) ready(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') ready(w); });
      });
    } catch (e) { console.warn('Service worker not registered:', e && e.message); }
  });
}
