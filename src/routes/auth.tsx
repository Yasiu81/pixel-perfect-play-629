import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/app" });
  },
  head: () => ({
    meta: [
      { title: "Logowanie — Plan Seniora" },
      { name: "description", content: "Zaloguj się do systemu Plan Seniora." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);

  // login
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // signup
  const [imie, setImie] = useState("");
  const [nazwisko, setNazwisko] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });
    setLoading(false);
    if (error) {
      toast.error("Nie udało się zalogować", { description: error.message });
      return;
    }
    toast.success("Zalogowano");
    navigate({ to: "/app" });
  }

  function validatePassword(pw: string): string | null {
    if (pw.length < 12) return "Hasło musi mieć co najmniej 12 znaków.";
    if (!/[a-z]/.test(pw)) return "Hasło musi zawierać małą literę.";
    if (!/[A-Z]/.test(pw)) return "Hasło musi zawierać dużą literę.";
    if (!/[0-9]/.test(pw)) return "Hasło musi zawierać cyfrę.";
    return null;
  }

  async function handleSignup(e: FormEvent) {
    e.preventDefault();
    const pwError = validatePassword(signupPassword);
    if (pwError) {
      toast.error("Słabe hasło", { description: pwError });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: signupEmail,
      password: signupPassword,
      options: {
        emailRedirectTo: window.location.origin,
        data: { imie, nazwisko },
      },
    });
    setLoading(false);
    if (error) {
      toast.error("Nie udało się utworzyć konta", { description: error.message });
      return;
    }
    toast.success("Konto utworzone — możesz się zalogować");
    setTab("login");
    setLoginEmail(signupEmail);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-2">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Plan Seniora</h1>
            <p className="text-xs text-muted-foreground">System opieki domowej</p>
          </div>
        </div>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>Witaj ponownie</CardTitle>
            <CardDescription>Zaloguj się, aby zarządzać opieką.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "signup")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Logowanie</TabsTrigger>
                <TabsTrigger value="signup">Rejestracja</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-4">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Hasło</Label>
                    <Input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Logowanie..." : "Zaloguj się"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="mt-4">
                <form onSubmit={handleSignup} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="imie">Imię</Label>
                      <Input id="imie" required value={imie} onChange={(e) => setImie(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="nazwisko">Nazwisko</Label>
                      <Input id="nazwisko" required value={nazwisko} onChange={(e) => setNazwisko(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Hasło</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Min. 12 znaków, w tym mała i duża litera oraz cyfra.
                    </p>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Tworzenie..." : "Utwórz konto"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Nowe konta czekają na nadanie roli przez koordynatora. Rola koordynatora dla pierwszego konta nadawana jest ręcznie w bazie danych.
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
