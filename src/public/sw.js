// Service Worker — Plan Seniora PWA
const CACHE = "planseniora-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(clients.claim());
});

// Obsługa powiadomień push
self.addEventListener("push", (e) => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch { data = { title: "Plan Seniora", body: e.data.text() }; }

  e.waitUntil(
    self.registration.showNotification(data.title ?? "Plan Seniora", {
      body: data.body ?? "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag ?? "planseniora",
      data: { url: data.url ?? "/opiekun" },
      requireInteraction: data.requireInteraction ?? false,
      vibrate: [200, 100, 200],
    })
  );
});

// Kliknięcie w powiadomienie → otwórz aplikację
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url ?? "/opiekun";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
