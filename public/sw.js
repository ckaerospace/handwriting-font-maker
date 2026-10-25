// Network first, cache fallback: the app keeps working offline after one visit.
const CACHE = "hfm-v1";
const CORE = ["./", "index.html", "css/style.css", "js/app.js", "js/worker.js", "js/session.js", "js/pipeline.js", "js/page.js", "js/geom.js", "js/segment.js", "js/align.js", "js/glyphs.js", "js/trace.js", "js/font.js", "js/classifier.js", "js/recognize.js", "vendor/opentype.min.mjs", "model/cls.json", "model/cls.f16", "model/fallback.json", "template/template.json", "samples/samples.json", "manifest.webmanifest"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(r, c)); } return res; }).catch(() => caches.match(r)));
});
