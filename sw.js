const CACHE = "trasporti-pwa-v4"; // bump version when assets change

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",

  // Data
  "./data/articles.json",
  "./data/pallet_rates_by_region.json",
  "./data/groupage_rates.json",
  "./data/geo_provinces.json",
  "./data/geo_provinces.csv",
  "./data/template_articles.csv",

  // Icons
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// Helper: network-first (for files you want always fresh)
async function networkFirst(request) {
  try {
    const fresh = await fetch(request, { cache: "no-store" });
    const cache = await caches.open(CACHE);
    cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await caches.match(request);
    return cached || Response.error();
  }
}

// Helper: cache-first (fast + offline)
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const fresh = await fetch(request);
  const cache = await caches.open(CACHE);
  cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : null)));

    await self.clients.claim();

    // Notify clients that a new SW is active (useful if you want to reload UI)
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: "SW_UPDATED", cache: CACHE });
    }
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Only handle same-origin
  if (url.origin !== self.location.origin) return;

  // Always try to get latest for "app shell"
  const isAppShell =
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname === "/" ||
    url.pathname.endsWith("/");

  if (isAppShell) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // Everything else: cache-first
  e.respondWith(cacheFirst(e.request));
});
