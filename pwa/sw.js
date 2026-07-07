const CACHE_NAME = "hamako-maps-360";
const FILES = [
  "../",
  "../html/index.html",
  "../css/style.css",
  "../js/main.js",
  "../js/mapData.js",
  "../js/minimap.js",
  "/manifest.json"
];

// インストール時にキャッシュする
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(urlsToCache);
        })
    );
});

// キャッシュを使ってオフライン対応
self.addEventListener("fetch", (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});


// インストールを促す
self.addEventListener("fetch", function( e ) {
    // empty
});

// 古いキャッシュを削除
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
});
