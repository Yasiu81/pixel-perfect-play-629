import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const IDLE_MS = 3 * 60 * 1000; // 3 minuty
const EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;

/**
 * Wylogowuje użytkownika po 3 minutach bezczynności.
 * RODO: ogranicza ryzyko dostępu osób trzecich do otwartej sesji koordynatora/opiekuna.
 */
export function useIdleTimeout(enabled: boolean) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const logout = async () => {
      try {
        await supabase.auth.signOut();
        toast.info("Wylogowano automatycznie po 3 minutach bezczynności.");
      } catch {
        // ignore
      }
    };

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(logout, IDLE_MS);
    };

    EVENTS.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      EVENTS.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [enabled]);
}
