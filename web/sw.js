/* Jarvis Web: einfacher Offline-Cache für die Oberflächen (API-Aufrufe laufen im Browser, nicht hier) */
const C = "jarvis-v1";
const FILES = ["/", "/index.html", "/jarvis.html", "/core/core.css", "/core/core.js", "/core/backend.js", "/manifest.webmanifest", "/icon.svg",
  "/oberflaechen/nova.html", "/oberflaechen/sphaeren.html", "/oberflaechen/aura.html", "/oberflaechen/gitter.html",
  "/oberflaechen/begleiter.html", "/oberflaechen/band.html"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
