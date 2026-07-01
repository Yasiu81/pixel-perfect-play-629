import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/strefa/logowanie")({
  ssr: false,
  component: StrefaLogowanie,
});

function StrefaLogowanie() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id);

      const roleList = (roles ?? []).map((r) => r.role);

      if (roleList.includes("family")) {
        navigate({ to: "/strefa/pulpit" });
      } else if (roleList.includes("coordinator")) {
        navigate({ to: "/pulpit" });
      } else if (roleList.includes("caregiver")) {
        navigate({ to: "/opiekun" });
      } else {
        toast.error("Brak dostępu do Strefy Klienta. Skontaktuj się z koordynatorem.");
        await supabase.auth.signOut();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0F6E56]/5 via-white to-[#0F6E56]/10 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0F6E56] text-white text-2xl font-bold shadow-lg">
            PS
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Plan Seniora</h1>
          <p className="text-sm text-gray-500">Strefa Klienta — panel dla rodziny</p>
        </div>

        <div className="rounded-2xl border bg-white p-8 shadow-sm">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Adres e-mail</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="twoj@email.pl" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hasło</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
            <Button type="submit" className="w-full bg-[#0F6E56] hover:bg-[#0a5a45]" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Zaloguj się
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-gray-400">
            Dostęp tylko dla uprawnionych członków rodziny.<br />
            Dane logowania otrzymasz od koordynatora.
          </p>
        </div>

        <p className="text-center text-xs text-gray-400">
          Jesteś opiekunem lub koordynatorem?{" "}
          <a href="/auth" className="text-[#0F6E56] hover:underline">Panel główny →</a>
        </p>
      </div>
    </div>
  );
}
