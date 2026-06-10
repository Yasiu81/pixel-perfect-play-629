import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { CoordinatorSidebar } from "@/components/CoordinatorSidebar";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_coordinator")({
  component: CoordinatorLayout,
});

function CoordinatorLayout() {
  const { loading, role } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && role && role !== "coordinator") {
      navigate({ to: "/opiekun", replace: true });
    }
  }, [loading, role, navigate]);

  if (loading || role !== "coordinator") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Wczytywanie...</span>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <CoordinatorSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur">
            <SidebarTrigger />
            <div className="text-sm font-medium text-muted-foreground">Panel koordynatora</div>
          </header>
          <main className="flex-1 p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
