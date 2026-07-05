import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

type Notification = {
  id: string;
  tytul: string;
  tresc: string | null;
  url: string | null;
};

// Rejestruje Service Worker i subskrybuje Realtime dla powiadomień
export function usePushNotifications(userId: string | null | undefined) {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Rejestracja Service Workera
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((e) => console.warn("SW registration failed:", e));
  }, []);

  // Supabase Realtime — nasłuchuj na nowe powiadomienia
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const notif = payload.new as Notification;
          showNotification(notif);
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [userId]);
}

async function showNotification(notif: Notification) {
  const title = notif.tytul;
  const body = notif.tresc ?? "";
  const url = notif.url ?? "/opiekun";

  // Spróbuj przez Service Worker (działa też gdy karta w tle)
  if ("serviceWorker" in navigator && "Notification" in window) {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(title, {
          body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: `ps-${notif.id}`,
          data: { url },
          vibrate: [200, 100, 200],
        });
        return;
      }
    }
  }

  // Fallback — natywne Notification API (tylko gdy karta otwarta)
  if ("Notification" in window && Notification.permission === "granted") {
    const n = new Notification(title, { body, icon: "/icon-192.png" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  }
}
