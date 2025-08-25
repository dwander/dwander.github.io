const CACHE_NAME = 'kpag-checklist-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ��ġ �̺�Ʈ - �ʿ��� ���ҽ� ĳ��
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching files');
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch((error) => {
        console.error('Service Worker: Cache failed', error);
      })
  );
});

// Ȱ��ȭ �̺�Ʈ - ���� ĳ�� ����
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('Service Worker: Activated');
      return self.clients.claim();
    })
  );
});

// ��Ʈ��ũ ��û ����ä��
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // ���� �������� ��û�� ó��
  if (url.origin === location.origin) {
    event.respondWith(
      // ��Ʈ��ũ �켱 ����
      fetch(event.request)
        .then((response) => {
          // �������� ������ ĳ�ÿ� ����
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseClone);
              });
          }
          return response;
        })
        .catch(() => {
          // ��Ʈ��ũ ���� �� ĳ�ÿ��� ��ȯ
          return caches.match(event.request);
        })
    );
  }
});