const CACHE_PREFIX = "climate-spiral-";
const CACHE_NAME = `${CACHE_PREFIX}v46`;
const REMOTE_CACHE_ORIGINS = new Set(["https://cdn.jsdelivr.net"]);
const DATA_ASSETS = [
  "./data/GLB.Ts+dSST.txt",
  "./data/co2_mm_mlo.txt",
  "./data/ch4_mm_gl.txt",
  "./data/global-sea-level.json",
  "./data/ocean-temperature.json",
  "./data/land-temperature.json",
  "./data/sea-ice-north.json",
  "./data/sea-ice-south.json",
  "./data/piomas-monthly.txt",
];

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./co2-data.mjs",
  "./dataset-display.mjs",
  "./datasets.mjs",
  "./dataset-loader.mjs",
  "./gistemp-data.mjs",
  "./camera-controller.mjs",
  "./video-controller.mjs",
  "./manifest.json",
  "./temperature-data.mjs",
  "./local-temperature-data.mjs",
  "./local-temperature-ui.mjs",
  "./station-temperature-data.mjs",
  "./country-temperature-data.mjs",
  "./data/country-temperature/catalog.json",
  "./spiral-layout.mjs",
  "./spiral-geometry.mjs",
  "./video-export.mjs",
  "./video-mux.mjs",
  "./vendor/mediabunny/mediabunny.min.mjs",
  "./methane-data.mjs",
  "./sea-level-data.mjs",
  "./sea-ice-data.mjs",
  "./sea-ice-volume-data.mjs",
  "./vendor/d3-dsv/dsv.mjs",
  ...DATA_ASSETS,
  "./icons/icon_32.png",
  "./icons/icon_192.png",
  "./icons/icon_512.png",
  "./icons/settings.png",
  "./icons/info.png",
  "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js",
  "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/exporters/GLTFExporter.js",
];

const toAbsoluteUrl = (path) => new URL(path, self.location).toString();
const DATA_ASSET_URLS = new Set(DATA_ASSETS.map(toAbsoluteUrl));
const STATION_ASSET_PATH = new URL('./data/weather-stations/', self.location).pathname;
const COUNTRY_ASSET_PATH = new URL('./data/country-temperature/', self.location).pathname;

async function cacheCoreAssets(cache) {
  await Promise.allSettled(
    CORE_ASSETS.map(async (assetUrl) => {
      const request = new Request(toAbsoluteUrl(assetUrl), { cache: "no-store" });
      const response = await fetch(request);
      if (response && response.ok) {
        await cache.put(request, response);
      }
    })
  );
}

function shouldCache(url, response) {
  if (!response || !response.ok) return false;
  if (url.origin === self.location.origin) return true;
  return REMOTE_CACHE_ORIGINS.has(url.origin);
}

async function networkFirst(request, cache) {
  try {
    const response = await fetch(new Request(request, { cache: "no-store" }));
    if (shouldCache(new URL(request.url), response)) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (request.mode === "navigate") {
      const appShell = await cache.match(toAbsoluteUrl("./index.html"));
      if (appShell) return appShell;
    }

    throw error;
  }
}

async function cacheFirst(request, cache) {
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (shouldCache(new URL(request.url), response)) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cacheCoreAssets(cache);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      if (request.mode === "navigate" || DATA_ASSET_URLS.has(requestUrl.toString())
          || (requestUrl.origin === self.location.origin && (requestUrl.pathname.startsWith(STATION_ASSET_PATH)
              || requestUrl.pathname.startsWith(COUNTRY_ASSET_PATH)))) {
        return networkFirst(request, cache);
      }

      return cacheFirst(request, cache);
    })()
  );
});
