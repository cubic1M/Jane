// Service worker: an offline page for when there's no connection, and phone notifications
// for urgent alerts and Jane's chat messages (spec step 85), whose buttons can be answered
// from the notification. Pages are never cached, so nobody's money is stored on the device.

const CACHE = "jane-offline-v1";
const OFFLINE_URL = "/offline";
// A chat button's id, like "finding.yes" (src/lib/jane-agent/types.ts).
const BUTTON_ID = /^[a-z_]+\.[a-z_]+$/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Page loads go to the network; only when that fails is the offline page shown.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL).then((r) => r ?? Response.error())),
  );
});

self.addEventListener("push", (event) => {
  let message = { title: "Jane", body: "You have a new alert.", url: "/alerts" };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    // Keep the default text.
  }
  // A chat message's first buttons ("Yes", "Not now").
  const actions = Array.isArray(message.actions)
    ? message.actions
        .filter((a) => a && BUTTON_ID.test(a.action) && typeof a.title === "string")
        .slice(0, 2)
    : [];
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: "/icons/192",
      ...(typeof message.tag === "string" ? { tag: message.tag } : {}),
      actions,
      data: { url: message.url, messageId: message.messageId },
    }),
  );
});

// Only ever opens a page on this site.
function openPage(path) {
  const url = new URL(path ?? "/alerts", self.location.origin);
  if (url.origin !== self.location.origin) return Promise.resolve();
  return self.clients.openWindow(url.href);
}

// A button on a chat message's notification answers it through /api/chat/act, with the
// session cookie and the same checks as the chat. Signed out, or when it can't be
// answered, the message opens in the chat instead.
async function answer(notification, actionId) {
  const { messageId, url } = notification.data ?? {};
  const chat = url ?? "/chat";
  try {
    const response = await fetch("/api/chat/act", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId, actionId }),
    });
    if (!response.ok) return openPage(chat);
    const result = await response.json();
    return self.registration.showNotification("Jane", {
      body: result.note || `Done: ${result.answeredWith ?? "answered"}.`,
      icon: "/icons/192",
      ...(notification.tag ? { tag: notification.tag } : {}),
      data: { url: chat },
    });
  } catch {
    return openPage(chat);
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { messageId, url } = event.notification.data ?? {};
  if (event.action && BUTTON_ID.test(event.action) && typeof messageId === "string") {
    event.waitUntil(answer(event.notification, event.action));
    return;
  }
  event.waitUntil(openPage(url));
});
