/**
 * Minimal service worker (Story 8.2) — installability only, NO caching.
 *
 * Next 16 ships no SW framework; recent Chromium no longer strictly requires a
 * fetch handler for installability, but a trivial pass-through one is shipped to
 * maximize cross-browser installability. It deliberately does NO caching,
 * precaching, offline, background sync, or push: a stale cache would be a real
 * hazard and all of that is explicitly out of scope for this story.
 *
 * Root-served (`/sw.js`) so its scope is the whole origin (`/`). `skipWaiting` +
 * `clients.claim` let an updated SW take control immediately rather than waiting
 * for every tab to close.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Pure pass-through: hand every request straight to the network, cache nothing.
self.addEventListener("fetch", () => {
  // Intentionally empty — no `respondWith`, so the browser performs the default
  // network fetch. Present only so the SW has a fetch handler for installability.
});
