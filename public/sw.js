/* Service worker — ao servir /sw.js o servidor injeta VERSION (hash do conteúdo de public/) e a lista ASSETS. */
const VERSION = '__VERSION__';
const ASSETS = __ASSETS__;
const CACHE = 'financas-' + VERSION;
const SHELL = '/index.html';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('financas-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // dados e sessão: sempre rede (o app guarda a própria cópia local)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname === '/healthz') return;

  if (req.mode === 'navigate') {
    // app shell do cache: abre na hora, com ou sem conexão; versão nova chega pelo ciclo do SW
    e.respondWith(caches.match(SHELL, { cacheName: CACHE }).then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then(r => r || fetch(req)));
});
