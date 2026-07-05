// Minimal service worker: exists for PWA installability only.
// No caching — Fleex is a live control surface and every payload must be
// fresh; a stale cached index.html would break dev (Vite) and prod alike.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
