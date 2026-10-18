// SafeBite service worker
//
// 정책
//  - GET + 같은 오리진 요청만 다룬다. API(다른 오리진)와 POST/PUT 은 건드리지 않는다.
//    → 로그인한 사용자의 건강 정보가 캐시에 남지 않는다.
//  - 네트워크 우선(network-first), 오프라인일 때만 캐시를 사용한다.
//    → 이전 구현은 캐시 우선이라 새 배포 후에도 오래된 index.html 이 계속 제공됐다.
//  - CACHE_NAME 을 올리면 이전 캐시는 activate 단계에서 삭제된다.

const CACHE_NAME = 'safebite-v2';
const APP_SHELL = ['/', '/favicon.svg', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // 빌드 산출물과 앱 셸만 오프라인용으로 보관한다.
        const cacheable =
          response.ok &&
          (url.pathname.startsWith('/assets/') || APP_SHELL.includes(url.pathname));
        if (cacheable) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(
          (cached) =>
            cached ||
            // SPA 라우트(/analysis, /profile …)는 오프라인에서도 앱 셸로 연다
            (request.mode === 'navigate' ? caches.match('/') : undefined) ||
            Response.error()
        )
      )
  );
});
