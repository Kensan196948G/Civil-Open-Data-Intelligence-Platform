/* CODIP Service Worker (docs/design/pwa-mobile-design.md §3.1/§5)
 * - 静的アセット: cache-first (プリキャッシュ)
 * - ナビゲーション: network-first + オフライン時キャッシュフォールバック
 * - 観測・閾値・地形API: stale-while-revalidate (TTL 15分/24h)
 * 更新時は CACHE_VERSION を上げ、古いキャッシュを削除する。
 */
const CACHE_VERSION = "codip-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;
const PRECACHE_URLS = ["/", "/manifest.webmanifest", "/icon.svg"];
const NAVIGATION_URLS = ["/", "/sources", "/map", "/terrain", "/weather", "/decisions", "/sites", "/reports", "/logs", "/audit", "/tags", "/settings"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("codip-v") && key !== STATIC_CACHE && key !== API_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// オンライン復帰時のバックグラウンド再検証（PwaRegister が sync を登録）。
// オフライン中に古くなった API キャッシュを、接続回復後にまとめて更新する。
self.addEventListener("sync", (event) => {
  if (event.tag === "codip-revalidate-apis") {
    event.waitUntil(revalidateApiCache());
  }
});

async function revalidateApiCache() {
  const cache = await caches.open(API_CACHE);
  const keys = await cache.keys();
  await Promise.all(
    keys.map(async (request) => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          await cache.put(request, response);
        }
      } catch {
        // まだオフライン → キャッシュを保持したまま次回に委ねる
      }
    }),
  );
}

function shouldCacheApi(url) {
  return (
    url.pathname.startsWith("/api/v1/observations/") ||
    url.pathname.startsWith("/api/v1/thresholds") ||
    url.pathname.startsWith("/api/v1/terrain/")
  );
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        const clone = response.clone();
        caches.open(API_CACHE).then((cache) => cache.put(request, clone));
      }
      return response;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (shouldCacheApi(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (request.mode === "navigate" || NAVIGATION_URLS.includes(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/"))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
