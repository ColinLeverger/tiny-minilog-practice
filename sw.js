/* Offline-first service worker: the app shell is cached on install, so after
 * one online visit the page opens with no network. Song files are cached by
 * the page itself (js/source.js), keyed by content hash.
 * The deploy workflow stamps VERSION with the commit SHA; old caches are
 * swept on activate. */
var VERSION = "tpr-dev";
var SHELL = [
  "./",
  "index.html",
  "css/styles.css",
  "js/i18n.js",
  "js/midi.js",
  "js/layout.js",
  "js/fretboard.js",
  "js/theory.js",
  "js/source.js",
  "js/stretch.js",
  "js/engine.js",
  "js/app.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      return Promise.all(SHELL.map(function (url) {
        return fetch(url, { cache: "no-store" }).then(function (res) {
          if (!res.ok) throw new Error("Could not cache " + url);
          return c.put(url, res);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        // tpr-blobs-* holds the songs and belongs to the page, not to a release
        if (k !== VERSION && k.indexOf("tpr-blobs-") !== 0) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  // Authenticated GitHub calls never go through this cache.
  if (e.request.method !== "GET" || url.origin !== self.location.origin || e.request.headers.has("Authorization")) return;
  e.respondWith(
    caches.open(VERSION).then(function (c) {
      return c.match(e.request, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(e.request).then(function (res) {
          if (res && res.ok) c.put(e.request, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    })
  );
});
