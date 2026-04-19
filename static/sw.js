/* ============================================================
   sw.js - Service Worker di "Il Mio Giardino"
   ============================================================
   Obiettivi:

     1. Rendere l'app installabile e usabile offline.
     2. Mostrare sempre dati freschi quando la rete c'è, senza
        sacrificare la resilienza quando non c'è.
     3. Non bloccare mai il deploy: bumpare VERSIONE_CACHE
        invalida tutto ciò che serve in modo controllato.

   Strategia per tipo di risorsa:

     - navigate (l'HTML delle pagine)  → network-first
     - /api/*                           → network-first, salva in
                                          cache anche le letture
                                          per avere sempre un
                                          "ultimo valore noto"
     - /static, /icons, /css, /js, font → stale-while-revalidate
                                          (cache-first con refresh
                                          in background)

   Le POST/PUT/DELETE verso l'API NON vengono mai cachate: sono
   effetti collaterali, non ha senso servirli dalla cache e se la
   rete manca vogliamo che il client riceva l'errore e decida
   (oggi mostra un toast; in futuro potrebbe accodarli).
   ============================================================ */

"use strict";

// Bump questo numero quando vuoi che tutti i client ricarichino
// integralmente le risorse statiche al prossimo avvio.
const VERSIONE_CACHE = "giardino-v2.0.0";

const CACHE_GUSCIO = `guscio-${VERSIONE_CACHE}`;   // HTML di navigazione
const CACHE_API    = `api-${VERSIONE_CACHE}`;      // Letture API
const CACHE_STATIC = `static-${VERSIONE_CACHE}`;   // CSS/JS/icone

// Elenco delle risorse critiche per il primo avvio offline.
// Non serve precachare ogni file: il service worker si popolerà
// da solo man mano che l'utente naviga. Qui metto solo il minimo
// indispensabile per rendere la shell usabile al first-load offline.
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/css/style.css",
  "/js/app.js",
  "/js/piante.js",
  "/js/vasi.js",
  "/js/tabelle.js",
  "/manifest.json",
  "/icons/icon.svg",
];

// ----------------------------------------------------------------
// Install: pre-carica il guscio dell'app
// ----------------------------------------------------------------
// Uso { cache: "reload" } per forzare il bypass della cache HTTP:
// al momento dell'installazione voglio SEMPRE la versione fresca
// dal server, non quella che il browser potrebbe avere in pancia.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_GUSCIO);
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const resp = await fetch(url, { cache: "reload" });
            if (resp.ok) await cache.put(url, resp);
          } catch (_) {
            // In dev può capitare che qualche path non esista
            // ancora; non voglio che questo fermi l'install.
          }
        })
      );
      // skipWaiting fa sì che il nuovo SW attivi subito, senza
      // attendere che tutte le vecchie pagine vengano chiuse.
      self.skipWaiting();
    })()
  );
});

// ----------------------------------------------------------------
// Activate: pulizia delle cache vecchie
// ----------------------------------------------------------------
// Ogni cache ha il nome con dentro VERSIONE_CACHE: cancello
// qualunque cache che non matchi la versione corrente. Così
// quando bumpo il numero, al prossimo avvio l'utente riceve
// tutto da capo senza doverlo fare a mano.
self.addEventListener("activate", (event) => {
  const cacheBuone = new Set([CACHE_GUSCIO, CACHE_API, CACHE_STATIC]);
  event.waitUntil(
    (async () => {
      const nomi = await caches.keys();
      await Promise.all(
        nomi.map((n) => (cacheBuone.has(n) ? null : caches.delete(n)))
      );
      // clients.claim() assume il controllo immediato delle pagine
      // aperte; senza di esso, i tab già aperti continuerebbero a
      // parlare con il vecchio SW fino al prossimo reload.
      await self.clients.claim();
    })()
  );
});

// ----------------------------------------------------------------
// Fetch: routing per tipo di richiesta
// ----------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Non intercetto le richieste non-GET: sono effetti collaterali
  // (POST/PUT/DELETE sull'API) e la loro semantica è "vanno sulla
  // rete, se fallisce è un errore legittimo".
  if (req.method !== "GET") return;

  // Ignoro gli schemi diversi da http/https (chrome-extension://, ecc.)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Routing in base al tipo di richiesta
  if (req.mode === "navigate") {
    // Caricamento di una pagina HTML (l'utente clicca un link,
    // apre l'app dalla Home, preme reload...)
    event.respondWith(strategiaNavigate(req));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(strategiaApi(req));
    return;
  }

  // Tutto il resto (CSS, JS, immagini, font, manifest) viene
  // gestito come asset statico.
  event.respondWith(strategiaStatica(req));
});

// ----------------------------------------------------------------
// Strategie
// ----------------------------------------------------------------

// network-first per l'HTML di navigazione, con fallback
// all'index cached per l'offline-first.
async function strategiaNavigate(req) {
  const cache = await caches.open(CACHE_GUSCIO);
  try {
    const rete = await fetch(req);
    // Salvo la pagina (o comunque l'index) come ultimo stato noto.
    // Uso clone() perché Response è uno stream monouso: una volta
    // letto, non puoi ri-leggerlo. clone() ti dà un duplicato.
    cache.put(req, rete.clone());
    return rete;
  } catch (_) {
    // Offline: provo a servire la pagina esatta; se non c'è,
    // fallback a index.html. Il routing SPA lato client farà
    // il resto.
    const cached = await cache.match(req);
    if (cached) return cached;
    const indice = await cache.match("/index.html");
    if (indice) return indice;
    // Ultima spiaggia: una risposta minima con messaggio leggibile
    return new Response(
      "<h1>Offline</h1><p>Riprova quando c'è connessione.</p>",
      { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 }
    );
  }
}

// network-first per le API, con fallback alla cache. Salvo in
// cache anche le risposte delle letture, così se la rete cade
// l'utente vede almeno l'ultimo dato conosciuto (meglio di un
// errore).
async function strategiaApi(req) {
  const cache = await caches.open(CACHE_API);
  try {
    const rete = await fetch(req);
    // Cacho solo se la risposta è ok (200-299). Non voglio
    // congelare un 404 o un 500 come "risposta definitiva".
    if (rete.ok) cache.put(req, rete.clone());
    return rete;
  } catch (_) {
    const cached = await cache.match(req);
    if (cached) {
      // Aggiungo un header custom così il client può eventualmente
      // accorgersi che sta guardando un dato stantio.
      const clone = cached.clone();
      const body = await clone.text();
      return new Response(body, {
        status: cached.status,
        statusText: cached.statusText,
        headers: (() => {
          const h = new Headers(cached.headers);
          h.set("X-Giardino-Origine", "cache-offline");
          return h;
        })(),
      });
    }
    // Nessuna cache disponibile: 503 in JSON così il client
    // può parsarlo come errore strutturato.
    return new Response(
      JSON.stringify({ errore: "Offline e nessun dato in cache" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

// stale-while-revalidate per gli asset statici: se c'è in cache
// lo servo subito (partenza istantanea), e in parallelo lancio
// un fetch che aggiorna la cache per il prossimo giro. Se la
// cache è vuota, fallback alla rete.
async function strategiaStatica(req) {
  const cache = await caches.open(CACHE_STATIC);
  const cached = await cache.match(req);

  // Fetch asincrono che aggiorna la cache in background. Non
  // attendiamo il completamento se abbiamo già una risposta in
  // cache da restituire.
  const refresh = fetch(req)
    .then((resp) => {
      if (resp.ok) cache.put(req, resp.clone());
      return resp;
    })
    .catch(() => null);

  // Se ho già una risposta in cache, la rendo subito; il refresh
  // continua in background senza bloccare la pagina.
  if (cached) return cached;

  // Prima visita: aspetto la rete.
  const fresca = await refresh;
  if (fresca) return fresca;

  return new Response("Risorsa non disponibile offline", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// ----------------------------------------------------------------
// Messaggi dal client (utile per forzare aggiornamenti in dev)
// ----------------------------------------------------------------
// Da una pagina si può fare:
//   navigator.serviceWorker.controller.postMessage({ tipo: "skipWaiting" })
// per attivare subito un nuovo SW in attesa, senza dover chiudere tutti
// i tab. Utile durante lo sviluppo.
self.addEventListener("message", (event) => {
  if (event.data && event.data.tipo === "skipWaiting") {
    self.skipWaiting();
  }
});
