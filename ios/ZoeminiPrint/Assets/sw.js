/**
 * Zoemini 2 / Ivy 2 Web Print Studio — Service Worker
 * Handles Android PWA Web Share Target API (Level 2 - Files) POST requests.
 */

const SHARED_MEDIA_CACHE = "shared-media";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Intercept incoming Android Web Share Target POST request
  if (
    event.request.method === "POST" &&
    (url.pathname === "/share-target" || url.pathname.endsWith("/share-target"))
  ) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const files = formData.getAll("shared_images");

          const cache = await caches.open(SHARED_MEDIA_CACHE);
          // Clear any stale shared media entries before writing new ones
          await cache.delete("/shared-image-temp");
          await cache.delete("/shared-image-temp-2");

          if (files.length > 0 && files[0] instanceof Blob) {
            const firstFile = files[0];
            await cache.put(
              "/shared-image-temp",
              new Response(firstFile, {
                headers: {
                  "content-type": firstFile.type || "image/jpeg",
                  "x-file-name": encodeURIComponent(firstFile.name || "Shared-Image-1.jpg"),
                },
              })
            );
          }

          // If the user shared 2 images at once from Android Gallery (e.g. for Dual Round Stickers)
          if (files.length > 1 && files[1] instanceof Blob) {
            const secondFile = files[1];
            await cache.put(
              "/shared-image-temp-2",
              new Response(secondFile, {
                headers: {
                  "content-type": secondFile.type || "image/jpeg",
                  "x-file-name": encodeURIComponent(secondFile.name || "Shared-Image-2.jpg"),
                },
              })
            );
          }
        } catch (err) {
          console.error("[SW] Failed to process shared media:", err);
        }

        // Redirect POST to GET with HTTP 303 See Other (relative to SW registration scope)
        const redirectUrl = new URL("./?received_share=true", self.registration.scope).href;
        return Response.redirect(redirectUrl, 303);
      })()
    );
  }
});
