const CACHE = "psru-wifi-shell-v1";

const SHELL = [
  "/m",
  "/m.html",
  "/css/tokens.css",
  "/css/app.css",
  "/css/mobile.css",
  "/js/mobile/app.js",
  "/js/mobile/sync.js",
  "/js/mobile/todayList.js",
  "/js/mobile/captureForm.js",
  "/js/core/api.js",
  "/js/core/dom.js",
  "/js/core/format.js",
  "/js/core/labels.js",
  "/js/offline/idb.js",
  "/js/offline/outbox.js",
  "/js/offline/imageResize.js",
  "/fonts/IBMPlexSansThai-Regular.ttf",
  "/fonts/IBMPlexSansThai-SemiBold.ttf",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // คำขอ API ต้องไม่ถูกแคช เพราะผลตรวจต้องไปถึงเซิร์ฟเวอร์จริงเท่านั้น
  if (url.pathname.startsWith("/api/") || event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((hit) =>
      hit ||
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match("/m.html"))
    )
  );
});
