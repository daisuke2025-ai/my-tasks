const CACHE = "my-tasks-shell-v8-members-2";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./auth.js",
  "./sharing.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.allSettled(SHELL.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("my-tasks-shell-") && key !== CACHE)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const local =
    url.origin === self.location.origin &&
    (url.pathname.endsWith("/") ||
      /\/(index\.html|style\.css|script\.js|auth\.js|sharing\.js)$/.test(
        url.pathname,
      ));
  const library =
    url.hostname === "cdn.jsdelivr.net" &&
    url.pathname.includes("/@supabase/supabase-js@2/dist/umd/supabase.min.js");
  if (!local && !library) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(event.request);
        if (response.ok || response.type === "opaque")
          cache.put(event.request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        if (local && event.request.mode === "navigate") {
          const fallback = await cache.match("./index.html");
          if (fallback) return fallback;
        }
        throw error;
      }
    })(),
  );
});
