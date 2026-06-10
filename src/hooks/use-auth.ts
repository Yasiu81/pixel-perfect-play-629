import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

type AuthState = {
  loading: boolean;
  user: User | null;
  role: AppRole | null;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    loading: true,
    user: null,
    role: null,
  });

  useEffect(() => {
    let mounted = true;

    const loadRole = async (user: User | null) => {
      if (!user) {
        if (mounted) setState({ loading: false, user: null, role: null });
        return;
      }
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (!mounted) return;
      // Koordynator > opiekun (jeśli ktoś ma obie role, traktujemy jako koordynator)
      const roles = (data ?? []).map((r) => r.role as AppRole);
      const role: AppRole | null = roles.includes("coordinator")
        ? "coordinator"
        : roles.includes("caregiver")
        ? "caregiver"
        : null;
      setState({ loading: false, user, role });
    };

    supabase.auth.getUser().then(({ data }) => loadRole(data.user));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      loadRole(session?.user ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
