import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, Smartphone } from "lucide-react";

export const Route = createFileRoute("/_authenticated/opiekun")({
  component: OpiekunPlaceholder,
});

function OpiekunPlaceholder() {
  const navigate = useNavigate();

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground font-semibold">
            PS
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Plan Seniora</div>
            <div className="text-xs text-muted-foreground">Aplikacja opiekuna</div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          <LogOut className="h-4 w-4" />
          <span className="ml-1">Wyloguj</span>
        </Button>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md shadow-card">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-primary-soft text-primary">
              <Smartphone className="h-6 w-6" />
            </div>
            <CardTitle>Aplikacja opiekuna</CardTitle>
            <CardDescription>Mój dzień, wizyty i rejestracja NFC+GPS.</CardDescription>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            Ten moduł zostanie zbudowany w kolejnym etapie. Po zalogowaniu opiekun zobaczy tutaj
            listę swoich wizyt na dziś.
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
