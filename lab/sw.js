/* Offline support: the app shell, part artwork and the Python engine are cached after the first visit. */
const VER = "ll-v3";
const SHELL = ["./", "index.html", "lab.css", "lab.js", "net.js", "worker.js", "manifest.webmanifest", "res_values.json", "py/ecelab.zip", "icons/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const r = e.request; if (r.method !== "GET") return; const u = new URL(r.url);
  const cdn = u.hostname === "cdn.jsdelivr.net";
  if (!cdn && u.origin !== location.origin) return;
  if (cdn) {                                    // Pyodide files never change for a given version: cache first
    e.respondWith(caches.open(VER).then(async (c) => { const hit = await c.match(r); if (hit) return hit; const res = await fetch(r); if (res.ok) c.put(r, res.clone()); return res; }));
    return;
  }
  e.respondWith(fetch(r).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VER).then((c) => c.put(r, copy)); } return res; }).catch(() => caches.match(r)));   // same-origin: network first, offline fallback
});
