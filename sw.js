const CACHE_NAME = 'hardin-trips-v2';

const SHELL = [
  '/Trips/',
  '/Trips/index.html',
  '/Trips/manifest.json',
  '/Trips/icon-180.png',
  '/Trips/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

const BYPASS_PATTERNS = [
  'firebaseio.com',
  'firebasestorage.googleapis.com',
  'identitytoolkit.googleapis.com',
  'open-meteo.com',
  'archive-api.open-meteo',
  'mapbox.com',
  'nominatim.openstreetmap',
  'photon.komoot.io',
  'overpass-api.de',
  'project-osrm.org',
  'workers.dev',
  'aerodatabox',
  'rapidapi.com',
];

const CDN_PATTERNS = [
  'gstatic.com/firebasejs',
  'unpkg.com/leaflet',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

self.addEventListener('fetch', e => {
  const url = e.request.url;

  if (BYPASS_PATTERNS.some(p => url.includes(p))) return;

  if (CDN_PATTERNS.some(p => url.includes(p))) {
    // CDN resources are versioned — cache-first is safe
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

  // App shell: network-first so updates deploy immediately; fall back to cache offline
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
