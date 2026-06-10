import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app")({
  component: AppRouter,
});

function AppRouter() {
  const { loading, role } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (role === "coordinator") navigate({ to: "/pulpit", replace: true });
    else if (role === "caregiver") navigate({ to: "/opiekun", replace: true });
    // brak roli → pokaż komunikat (poniżej)
  }, [loading, role, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      {loading || role ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Wczytywanie konta...</span>
        </div>
      ) : (
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold">Konto bez przypisanej roli</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Twoje konto czeka na nadanie uprawnień przez koordynatora. Skontaktuj się z administratorem firmy.
          </p>
        </div>
      )}
    </div>
  );
}
