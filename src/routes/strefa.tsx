import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/strefa")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user && location.pathname !== "/strefa/logowanie") {
      throw redirect({ to: "/strefa/logowanie" });
    }
    if (data.user) {
      // Sprawdź czy ma rolę family
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id);
      const hasFamily = (roles ?? []).some((r) => r.role === "family");
      if (!hasFamily && location.pathname !== "/strefa/logowanie") {
        throw redirect({ to: "/strefa/logowanie" });
      }
    }
  },
  component: () => <Outlet />,
});
