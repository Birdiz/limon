/* Service worker : garde tout le site en cache pour que Limon s'ouvre sans réseau.

   Écrit en JavaScript : il n'est pas mis en paquet avec la page. Au build, le greffon `pwa` de
   vite.config.ts remplace VERSION et FICHIERS par l'empreinte du build et la liste de ses fichiers.
   Une nouvelle version s'installe en arrière-plan puis attend ; la page lui dit de prendre la main
   (message « activer ») au moment où l'artisan ne la regarde pas (src/ui/pwa.ts). */
const VERSION = "__VERSION__";
const FICHIERS = ["__FICHIERS__"];
const CACHE = `limon-${VERSION}`;

self.addEventListener("install", (e) => {
  // « reload » : ne pas reprendre une ancienne copie du cache HTTP.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: "reload" })))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("limon-") && k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "activer") void self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // La page est la même quelle que soit l'adresse : le projet partagé est après le « # ».
  // ignoreVary : les scripts de module partent avec un en-tête Origin que la copie en cache n'a pas.
  const opts = { cacheName: CACHE, ignoreSearch: true, ignoreVary: true };
  const cached = caches.match(req.mode === "navigate" ? "index.html" : req, opts);
  e.respondWith(cached.then((r) => r || fetch(req)));
});
