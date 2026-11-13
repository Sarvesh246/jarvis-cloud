/* Vaelo's service worker makes the home-screen app open instantly and still
   open with no signal. It only ever stores the public app shell (the page,
   its hashed scripts, styles, fonts and icons). Anything under /api, which
   is where signed-in data lives, always goes to the network and is never
   cached. */
const SHELL = "vaelo-shell-v7";
const PRECACHE = ["/", "/prefs.js"];
const CURRENT_ASSETS = null;

// Storage is optional at runtime (private browsing, eviction and quota errors).
// Keep writes alive after delivering the network response, but never turn a
// successful download into a failed request just because it cannot be saved.
function saveResponse(event, key, response) {
  if (!response.ok) return;
  // A build file that is gone can come back as a page; never keep that.
  if (typeof key !== "string" && /text\/html/i.test(response.headers.get("Content-Type") || "")) return;
  const copy = response.clone();
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.put(key, copy)).catch(() => {}),
  );
}

function savedResponse(key) {
  return caches.open(SHELL).then((cache) => cache.match(key)).catch(() => undefined);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("vaelo-shell-") && key !== SHELL).map((key) => caches.delete(key))))
      .catch(() => { /* Cache cleanup is optional; online loading must still work. */ })
      .then(async () => {
        if (CURRENT_ASSETS) {
          const keep = new Set([...PRECACHE, ...CURRENT_ASSETS]);
          const cache = await caches.open(SHELL);
          const keys = await cache.keys();
          await Promise.all(keys.filter(key => !keep.has(new URL(key.url).pathname)).map(key => cache.delete(key)));
        }
        return self.clients.claim();
      }),
  );
});

// "Vaelo replied" opens the app where the reply is waiting.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === location.origin);
      return open ? open.focus() : self.clients.openWindow("/");
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Pages: the newest version when online, the saved shell when not.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // A direct visit to a script, another page or a redirected sign-in
          // response must not replace the app's offline home page.
          if (url.pathname === "/" && !response.redirected &&
              response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() === "text/html") {
            saveResponse(event, "/", response);
          }
          return response;
        })
        .catch(async () => (await savedResponse("/")) || new Response("Vaelo is offline. Reconnect and try again.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })),
    );
    return;
  }

  // Saved appearance choices are applied by this small script before the
  // page paints; newest when online, the saved copy when not.
  if (url.pathname === "/prefs.js") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          saveResponse(event, "/prefs.js", response);
          return response;
        })
        .catch(async () => (await savedResponse("/prefs.js")) || new Response("", { status: 503, headers: { "Content-Type": "text/javascript; charset=utf-8" } })),
    );
    return;
  }

  // Hashed build files never change, so the saved copy is always right.
  // Icons and the manifest are left to the network: iOS reads them when the
  // app is added to the home screen and falls back to a letter if that fails.
  if (url.pathname.startsWith("/assets/") && (!CURRENT_ASSETS || CURRENT_ASSETS.includes(url.pathname))) {
    event.respondWith(
      savedResponse(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            saveResponse(event, request, response);
            return response;
          }),
      ),
    );
  }
});
