import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { countQueuedActions, syncQueuedActions } from "@/lib/offlineQueue";

/**
 * Śledzi stan połączenia i liczbę oczekujących akcji offline, oraz automatycznie
 * synchronizuje kolejkę: przy powrocie zasięgu (zdarzenie "online"), okresowo
 * co 20s dopóki coś czeka, i na żądanie (syncNow).
 */
export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const refreshCount = useCallback(async () => {
    try {
      setPendingCount(await countQueuedActions());
    } catch {
      // IndexedDB niedostępne (np. tryb prywatny) — nie blokuj aplikacji.
    }
  }, []);

  const syncNow = useCallback(async (silent = false) => {
    if (syncingRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await refreshCount();
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    try {
      const { synced, remaining } = await syncQueuedActions();
      setPendingCount(remaining);
      if (synced > 0 && !silent) {
        toast.success(
          `Zsynchronizowano ${synced} ${synced === 1 ? "zapis" : "zapisy(ów)"} z trybu offline` +
            (remaining > 0 ? ` — ${remaining} nadal czeka na zasięg.` : "."),
        );
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [refreshCount]);

  useEffect(() => {
    refreshCount();
    const handleOnline = () => {
      setIsOnline(true);
      syncNow();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Spróbuj też od razu przy starcie aplikacji (np. otwarcie po powrocie zasięgu).
    if (navigator.onLine) syncNow(true);

    const interval = setInterval(() => {
      if (navigator.onLine) syncNow(true);
    }, 20_000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isOnline, pendingCount, syncing, syncNow: () => syncNow(false), refreshCount };
}
