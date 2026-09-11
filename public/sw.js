/* Günce push service worker — no offline caching of authenticated content. */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "Günce",
    body: "Bir hatırlatman var.",
    tag: "gunce-reminder",
    data: { url: "/cocuk/ana" },
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = {
        title: typeof parsed.title === "string" ? parsed.title : payload.title,
        body: typeof parsed.body === "string" ? parsed.body : payload.body,
        tag: typeof parsed.tag === "string" ? parsed.tag : payload.tag,
        data: {
          url:
            parsed?.data?.url && typeof parsed.data.url === "string"
              ? parsed.data.url
              : "/cocuk/ana",
        },
      };
    }
  } catch {
    /* keep defaults — never throw on malformed payload */
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      renotify: true,
      data: payload.data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    event.notification?.data?.url && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/cocuk/ana";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {
              /* ignore */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
