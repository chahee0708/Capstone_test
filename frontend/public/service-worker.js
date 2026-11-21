/*
 * service-worker.js — 스스로 지워지는 서비스 워커
 *
 * 예전 버전은 첫 화면('/')을 한 번 저장해 두고 계속 그 저장본을 보여 줬다 (cache-first).
 * 개발 서버 시절의 첫 화면이 저장된 브라우저에서는, 배포용 빌드로 바꾼 뒤
 * 없는 파일(/src/main.tsx)을 찾느라 흰 화면만 나왔다. 새 버전을 올려도 계속 옛 화면이 나오는 문제도 있었다.
 *
 * 이 파일은 예전 서비스 워커가 깔린 브라우저를 고치기 위한 것이다.
 * 브라우저는 페이지를 열 때 이 파일이 바뀌었는지 서버에서 확인하므로, 바뀐 이 파일이 설치되면서
 *   1. 저장해 둔 캐시를 모두 지우고
 *   2. 자기 자신(서비스 워커)을 해제하고
 *   3. 열려 있는 SafeBite 탭을 새로 불러온다 → 최신 화면
 * 이후로는 서비스 워커 없이 일반 웹페이지로 동작한다 (index.html 에서도 더는 등록하지 않는다)
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: 'window' });
      windows.forEach((client) => client.navigate(client.url));
    })(),
  );
});
