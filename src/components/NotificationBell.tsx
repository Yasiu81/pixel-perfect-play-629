import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ShieldAlert, Truck, MessageCircle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type NotifItem = {
  id: string;
  kind: "alert" | "family_request" | "message";
  title: string;
  subtitle: string;
  createdAt: string;
  onClick: () => void;
};

export function NotificationBell() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: alerts } = useQuery({
    queryKey: ["bell-alerts"],
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("alerts")
        .select("id, type, description, created_at, senior_id, caregiver_id, seniors:senior_id(imie, nazwisko)")
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(20);
      return (data ?? []) as unknown as {
        id: string; type: string; description: string | null; created_at: string;
        senior_id: string | null; caregiver_id: string | null;
        seniors: { imie: string; nazwisko: string } | null;
      }[];
    },
  });

  const { data: familyRequests } = useQuery({
    queryKey: ["bell-family-requests"],
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("additional_orders")
        .select("id, order_type, created_at, senior:seniors(imie, nazwisko)")
        .eq("status", "do_akceptacji")
        .order("created_at", { ascending: false })
        .limit(20);
      return (data ?? []) as unknown as {
        id: string; order_type: string; created_at: string;
        senior: { imie: string; nazwisko: string } | null;
      }[];
    },
  });

  const { data: unreadMessages } = useQuery({
    queryKey: ["bell-messages"],
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("messages")
        .select("id, caregiver_id, sender_id, body, created_at, profiles:caregiver_id(imie, nazwisko)")
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
      return (data ?? []) as unknown as {
        id: string; caregiver_id: string; sender_id: string; body: string; created_at: string;
        profiles: { imie: string; nazwisko: string } | null;
      }[];
    },
  });

  const items: NotifItem[] = [
    ...(alerts ?? []).map((a) => ({
      id: `alert-${a.id}`,
      kind: "alert" as const,
      title: a.seniors ? `Alarm — ${a.seniors.nazwisko} ${a.seniors.imie}` : "Alarm",
      subtitle: a.description ?? a.type,
      createdAt: a.created_at,
      onClick: () => navigate({ to: "/wizyty", search: { filter: "alert" } as never }),
    })),
    ...(familyRequests ?? []).map((r) => ({
      id: `request-${r.id}`,
      kind: "family_request" as const,
      title: r.senior ? `Zgłoszenie rodziny — ${r.senior.nazwisko} ${r.senior.imie}` : "Zgłoszenie rodziny",
      subtitle: r.order_type,
      createdAt: r.created_at,
      onClick: () => navigate({ to: "/wizyty" }),
    })),
    ...(unreadMessages ?? [])
      .filter((m) => m.sender_id === m.caregiver_id)
      .map((m) => ({
        id: `msg-${m.id}`,
        kind: "message" as const,
        title: m.profiles ? `Wiadomość — ${m.profiles.nazwisko} ${m.profiles.imie}` : "Nowa wiadomość",
        subtitle: m.body,
        createdAt: m.created_at,
        onClick: () => navigate({ to: "/czat", search: { opiekun: m.caregiver_id } as never }),
      })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const total = items.length;

  const KIND_ICON = {
    alert: <ShieldAlert className="h-4 w-4 text-red-600" />,
    family_request: <Truck className="h-4 w-4 text-violet-600" />,
    message: <MessageCircle className="h-4 w-4 text-sky-600" />,
  };

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["bell-alerts"] });
    qc.invalidateQueries({ queryKey: ["bell-family-requests"] });
    qc.invalidateQueries({ queryKey: ["bell-messages"] });
  };

  return (
    <div className="relative">
      <Button variant="ghost" size="sm" className="relative" onClick={() => { setOpen((v) => !v); if (!open) refreshAll(); }}>
        <Bell className="h-4 w-4" />
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {total > 9 ? "9+" : total}
          </span>
        )}
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-96 rounded-xl border bg-card shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <span className="text-sm font-semibold">Powiadomienia {total > 0 && `(${total})`}</span>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto divide-y">
              {items.length === 0 ? (
                <p className="px-4 py-6 text-sm text-center text-muted-foreground">Brak nowych powiadomień</p>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => { item.onClick(); setOpen(false); }}
                    className="flex w-full items-start gap-2.5 px-4 py-3 text-left hover:bg-muted/50"
                  >
                    <div className="mt-0.5 flex-shrink-0">{KIND_ICON[item.kind]}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{item.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{item.subtitle}</div>
                      <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                        {new Date(item.createdAt).toLocaleString("pl-PL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
