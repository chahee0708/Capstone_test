// [변경] 캐시 이름을 바꿔 예전 캐시(safebite-v1: 이전 앱 이름이 든 화면)를 지운다
//        화면(HTML)은 서버에서 먼저 받고, 서버에 못 닿을 때만 캐시를 쓴다 → 앱을 고쳐도 옛 화면이 남지 않는다
const CACHE_NAME = 'beforeyoubite-v2';
const urlsToCache = [
  '/',
  '/analysis',
  '/profile',
];

self.addEventListener('install', (event) => {
  // [추가] 새 버전을 기다리지 않고 바로 쓴다
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', (event) => {
  // [추가] 페이지 이동(HTML)은 서버 먼저, 실패하면 캐시
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request).then((r) => r || caches.match('/')))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request)
      .then((response) => response || fetch(event.request))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // [추가] 열려 있는 탭도 새 버전이 맡는다
  );
});
