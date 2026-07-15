import { supabase } from "@/integrations/supabase/client";

// ─── Tryb offline aplikacji opiekuna ────────────────────────────────────────
// Gdy telefon opiekunki traci zasięg (częste w Pruszczu Gdańskim i okolicznych
// wsiach), zapis NFC/GPS/czynności/parametrów życiowych trafia do lokalnej
// kolejki w IndexedDB zamiast się nie udać. Po odzyskaniu zasięgu (zdarzenie
// "online" + okresowe próby co 20s, gdy aplikacja jest otwarta) kolejka jest
// automatycznie wysyłana do Supabase, w tej samej kolejności co powstała.

const DB_NAME = "plan-seniora-offline";
const DB_VERSION = 1;
const STORE = "queue";

export type DbOp =
  | { kind: "insert"; table: string; data: Record<string, unknown> }
  | { kind: "update"; table: string; data: Record<string, unknown>; match: Record<string, unknown> };

export type QueuedAction = {
  id?: number;
  createdAt: number;
  label: string; // czytelny opis dla UI, np. "Zameldowanie — Jan Kowalski"
  ops: DbOp[];
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueAction(action: Omit<QueuedAction, "id">): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(action);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getQueuedActions(): Promise<QueuedAction[]> {
  const db = await openDb();
  const actions = await new Promise<QueuedAction[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedAction[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return actions.sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeQueuedAction(id: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function countQueuedActions(): Promise<number> {
  const db = await openDb();
  const count = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return count;
}

/** Wykonuje pojedynczą listę operacji DB w kolejności (przerywa na pierwszym błędzie). */
export async function executeOps(ops: DbOp[]): Promise<void> {
  for (const op of ops) {
    if (op.kind === "insert") {
      const { error } = await supabase.from(op.table as never).insert(op.data as never);
      if (error) throw error;
    } else {
      let q = supabase.from(op.table as never).update(op.data as never);
      for (const [k, v] of Object.entries(op.match)) {
        q = q.eq(k, v as never);
      }
      const { error } = await q;
      if (error) throw error;
    }
  }
}

/** Rozpoznaje błąd sieci (brak połączenia) odróżniając go od realnego błędu zapisu (RLS, walidacja itp). */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const msg = String((e as Error)?.message ?? e ?? "");
  return /Failed to fetch|NetworkError|Load failed|network request failed|ERR_INTERNET_DISCONNECTED/i.test(msg);
}

/**
 * Próbuje wykonać operacje od razu. Jeśli urządzenie jest offline albo zapis
 * nie powiódł się z powodu sieci — zapisuje operacje do lokalnej kolejki
 * zamiast rzucać błąd dalej. Realne błędy (np. RLS, walidacja) są przekazywane wyżej.
 */
export async function runOrQueue(label: string, ops: DbOp[]): Promise<{ queued: boolean }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    await queueAction({ label, ops, createdAt: Date.now() });
    return { queued: true };
  }
  try {
    await executeOps(ops);
    return { queued: false };
  } catch (e) {
    if (isNetworkError(e)) {
      await queueAction({ label, ops, createdAt: Date.now() });
      return { queued: true };
    }
    throw e;
  }
}

/** Próbuje wysłać całą kolejkę. Zwraca liczbę zsynchronizowanych i wciąż oczekujących akcji. */
export async function syncQueuedActions(): Promise<{ synced: number; remaining: number }> {
  const actions = await getQueuedActions();
  let synced = 0;
  for (const action of actions) {
    if (action.id == null) continue;
    try {
      await executeOps(action.ops);
      await removeQueuedAction(action.id);
      synced++;
    } catch (e) {
      if (isNetworkError(e)) {
        // Nadal offline — przerwij, spróbujemy ponownie przy następnej okazji.
        break;
      }
      // Realny błąd (np. miesiąc zamknięty w międzyczasie) — zostaw w kolejce,
      // ale nie blokuj wysyłki pozostałych akcji.
      console.error("Nie udało się zsynchronizować akcji offline:", action.label, e);
    }
  }
  const remaining = await countQueuedActions();
  return { synced, remaining };
}
