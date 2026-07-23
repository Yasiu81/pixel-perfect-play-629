import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;

/**
 * Wylogowuje użytkownika po określonym czasie bezczynności.
 * RODO: ogranicza ryzyko dostępu osób trzecich do otwartej sesji.
 *
 * Czas domyślny to 3 minuty (odpowiedni dla panelu koordynatora — komputer
 * biurowy, dane wrażliwe seniorów). Aplikacja opiekuna w terenie powinna
 * dostawać dłuższy czas — opiekunka fizycznie zajmuje się seniorem i nie
 * dotyka telefonu przez kilka-kilkanaście minut, co przy 3-minutowym limicie
 * powodowało częste, uciążliwe wylogowania w trakcie pracy.
 */
export function useIdleTimeout(enabled: boolean, idleMs: number = 3 * 60 * 1000) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const logout = async () => {
      try {
        await supabase.auth.signOut();
        const minutes = Math.round(idleMs / 60_000);
        toast.info(`Wylogowano automatycznie po ${minutes} min bezczynności.`);
      } catch {
        // ignore
      }
    };

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(logout, idleMs);
    };

    EVENTS.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      EVENTS.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [enabled, idleMs]);
}
