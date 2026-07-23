import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  LogOut,
  MapPin,
  Phone,
  Rss,
  ShieldAlert,
  X,
  ArrowLeft,
  CheckSquare,
  Square,
  StickyNote,
  Heart,
  Thermometer,
  Activity,
  Wind,
  Scale,
  Droplets,
  MessageSquare,
  Bell,
  WifiOff,
  RefreshCw,
  CloudOff,
  MessageCircle,
  Send,
  KeyRound,
  ChevronLeft,
  Camera,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useIdleTimeout } from "@/hooks/use-idle-timeout";
import { runOrQueue, type DbOp } from "@/lib/offlineQueue";

export const Route = createFileRoute("/_authenticated/opiekun")({
  component: OpiekunApp,
});

// ─── typy ────────────────────────────────────────────────────────────────────

type VisitStatus =
  | "planned"
  | "active"
  | "completed"
  | "alert"
  | "requires_verification";

type Visit = {
  id: string;
  planned_start: string;
  planned_end: string;
  status: VisitStatus;
  senior_id: string;
  caregiver_id: string | null;
  actual_start: string | null;
  actual_end: string | null;
  hours_billed: number | null;
  nfc_verified_entry: boolean;
  nfc_verified_exit: boolean;
  gps_verified_entry: boolean;
  gps_verified_exit: boolean;
  notes: string | null;
  senior: {
    imie: string;
    nazwisko: string;
    adres: string;
    telefon: string | null;
    lat: number | null;
    lng: number | null;
    nfc_uid: string | null;
    plan_wsparcia: unknown;
    notatka_techniczna: string | null;
  } | null;
};

type Task = {
  id: string;
  task_name: string;
  completed: boolean;
  uwagi: string | null;
  requires_response: boolean;
  response: string | null;
};

type Vitals = {
  cisnienie_skurczowe: string;
  cisnienie_rozkurczowe: string;
  puls: string;
  temperatura: string;
  saturacja: string;
  waga: string;
  poziom_cukru: string;
  uwagi: string;
};

// ─── stałe ───────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<VisitStatus, string> = {
  planned: "Zaplanowana",
  active: "W trakcie",
  completed: "Zakończona",
  alert: "Alarm",
  requires_verification: "Wymaga weryfikacji",
};

const STATUS_TONE: Record<VisitStatus, string> = {
  planned: "bg-info/15 text-info",
  active: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  alert: "bg-destructive/15 text-destructive",
  requires_verification: "bg-warning/15 text-warning",
};

const GPS_RADIUS_M = 200; // zwiększony promień dla lepszej użyteczności

// ─── helper: odległość Haversine ─────────────────────────────────────────────

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── helper: pełne godziny wg reguły 50/10 ───────────────────────────────────

function calcHoursBilled(startIso: string, endIso: string): number {
  const diffMin =
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
  // każde 60 min = 50 min pracy + 10 min bufor; zaokrąglamy w dół
  return Math.max(0, Math.floor(diffMin / 60));
}

// ─── helper: czas serwera z Supabase ─────────────────────────────────────────

async function fetchServerTime(): Promise<string> {
  const { data, error } = await supabase.rpc("get_server_time" as never);
  if (error || !data) return new Date().toISOString(); // fallback
  return data as string;
}

// ─── główny komponent ─────────────────────────────────────────────────────────

// ─── Raport dzienny po zakończeniu wizyty ────────────────────────────────────

async function saveVisitReport(
  visitId: string,
  seniorId: string,
  caregiverId: string | null,
  tasks: Task[],
) {
  try {
    let visitData: { planned_start?: string; hours_billed?: number | null; notes?: string | null } = {};
    let latestVitals: Record<string, unknown> | null = null;

    // Dociągnij aktualne dane wizyty/parametrów tylko jeśli jest sieć —
    // offline korzystamy z tego, co mamy lokalnie (tasks), reszta zostaje null/domyślna.
    if (typeof navigator === "undefined" || navigator.onLine) {
      try {
        const { data: visit } = await supabase
          .from("visits")
          .select("planned_start, hours_billed, notes")
          .eq("id", visitId)
          .single();
        if (visit) visitData = visit;

        const { data: vitals } = await supabase
          .from("senior_vitals")
          .select("*")
          .eq("visit_id", visitId)
          .order("measured_at", { ascending: false })
          .limit(1);
        latestVitals = vitals?.[0] ?? null;
      } catch {
        // Sieć zniknęła w międzyczasie — kontynuuj z tym, co już mamy.
      }
    }

    // Przygotuj snapshot czynności
    const tasksSummary = tasks.map(t => ({
      task_name: t.task_name,
      completed: t.completed,
      uwagi: t.uwagi,
    }));

    // Zapisz raport (od razu albo do kolejki offline)
    await runOrQueue(`Raport dzienny — wizyta ${visitId}`, [{
      kind: "insert",
      table: "visit_reports",
      data: {
        visit_id: visitId,
        senior_id: seniorId,
        caregiver_id: caregiverId,
        report_date: (visitData.planned_start ?? new Date().toISOString()).split("T")[0],
        tasks_summary: tasksSummary,
        vitals_summary: latestVitals,
        notes: visitData.notes ?? null,
        hours_billed: visitData.hours_billed ?? null,
      },
    }]);
  } catch (e) {
    // Raport jest opcjonalny — nie blokuj zakończenia wizyty jeśli się nie uda
    console.error("Błąd zapisu raportu:", e);
  }
}

function OpiekunApp() {
  const navigate = useNavigate();
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const { isOnline, pendingCount, syncing, syncNow } = useOfflineSync();

  // Opiekunka pracuje w terenie z telefonem w kieszeni/torbie i długo nie
  // dotyka ekranu podczas realnej opieki nad seniorem — 3-minutowy limit
  // (właściwy dla biurka koordynatora) powodował tu częste, uciążliwe
  // wylogowania w trakcie pracy. Tu zostaje dłuższy, 20-minutowy limit.
  useIdleTimeout(true, 20 * 60 * 1000);

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    },
  });

  // Aktywuj powiadomienia push
  usePushNotifications(user?.id);

  // Nieprzeczytane powiadomienia
  const { data: notifs, refetch: refetchNotifs } = useQuery({
    queryKey: ["my-notifications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("notifications")
        .select("id, tytul, tresc, url, przeczytane, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  const unread = (notifs ?? []).filter((n: any) => !n.przeczytane).length;

  const { data: unreadChatCount } = useQuery({
    queryKey: ["chat-unread", user?.id],
    enabled: !!user,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("messages")
        .select("id")
        .eq("caregiver_id", user!.id)
        .neq("sender_id", user!.id)
        .is("read_at", null);
      return (data ?? []).length;
    },
  });

  const markAllRead = async () => {
    if (!user) return;
    await supabase
      .from("notifications")
      .update({ przeczytane: true })
      .eq("user_id", user.id)
      .eq("przeczytane", false);
    refetchNotifs();
  };

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="opiekun-app flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
            PS
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Plan Seniora</div>
            <div className="text-xs text-muted-foreground">Panel opiekuna</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Dzwonek powiadomień */}
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowNotifs(v => !v); if (!showNotifs) markAllRead(); }}
              className="relative"
            >
              <Bell className="h-4 w-4" />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Button>

            {/* Panel powiadomień */}
            {showNotifs && (
              <div className="absolute right-0 top-10 z-50 w-80 rounded-xl border bg-card shadow-xl overflow-hidden">
                <div className="flex items-center justify-between border-b px-4 py-2.5">
                  <span className="text-sm font-semibold">Powiadomienia</span>
                  <button onClick={() => setShowNotifs(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y">
                  {(notifs ?? []).length === 0 ? (
                    <p className="px-4 py-6 text-sm text-center text-muted-foreground">
                      Brak powiadomień
                    </p>
                  ) : (notifs ?? []).map((n: any) => (
                    <div
                      key={n.id}
                      className={`px-4 py-3 ${!n.przeczytane ? "bg-primary/5" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{n.tytul}</div>
                          {n.tresc && (
                            <div className="text-xs text-muted-foreground mt-0.5">{n.tresc}</div>
                          )}
                          <div className="text-xs text-muted-foreground/60 mt-1">
                            {new Date(n.created_at).toLocaleString("pl-PL", {
                              day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
                            })}
                          </div>
                        </div>
                        {!n.przeczytane && (
                          <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <SosButton />
          <Button variant="ghost" size="sm" onClick={() => setShowChat(true)} className="relative">
            <MessageCircle className="h-4 w-4" />
            {!!unreadChatCount && unreadChatCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                {unreadChatCount > 9 ? "9+" : unreadChatCount}
              </span>
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Baner offline / oczekująca synchronizacja */}
      {(!isOnline || pendingCount > 0) && (
        <div
          className={cn(
            "flex items-center justify-between gap-2 px-4 py-2 text-xs font-medium",
            !isOnline ? "bg-amber-500/15 text-amber-800" : "bg-sky-500/15 text-sky-800",
          )}
        >
          <div className="flex items-center gap-1.5">
            {!isOnline ? <WifiOff className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
            {!isOnline
              ? pendingCount > 0
                ? `Brak zasięgu — ${pendingCount} ${pendingCount === 1 ? "zapis czeka" : "zapisy(ów) czeka"} na wysłanie`
                : "Brak zasięgu — zapisy będą zachowane lokalnie"
              : `${pendingCount} ${pendingCount === 1 ? "zapis oczekuje" : "zapisy(ów) oczekuje"} na wysłanie...`}
          </div>
          {isOnline && pendingCount > 0 && (
            <button
              onClick={() => syncNow()}
              disabled={syncing}
              className="flex items-center gap-1 rounded-md bg-white/60 px-2 py-1 hover:bg-white/90"
            >
              <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
              Synchronizuj teraz
            </button>
          )}
        </div>
      )}

      {/* Content */}
      <main className="flex-1 overflow-auto">
        {showChat && user ? (
          <CaregiverChatScreen meId={user.id} onBack={() => setShowChat(false)} />
        ) : activeVisitId ? (
          <VisitScreen
            visitId={activeVisitId}
            onBack={() => setActiveVisitId(null)}
          />
        ) : (
          <ScheduleScreen onOpenVisit={setActiveVisitId} />
        )}
      </main>
    </div>
  );
}

// ─── Przycisk SOS ────────────────────────────────────────────────────────────

function SosButton() {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const holdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const HOLD_MS = 2000;

  const startHold = () => {
    setHolding(true);
    const start = Date.now();
    holdRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, (elapsed / HOLD_MS) * 100);
      setProgress(pct);
      if (elapsed >= HOLD_MS) {
        clearInterval(holdRef.current!);
        sendSos();
      }
    }, 50);
  };

  const cancelHold = () => {
    setHolding(false);
    setProgress(0);
    if (holdRef.current) clearInterval(holdRef.current);
  };

  const sendSos = async () => {
    setHolding(false);
    setProgress(0);
    try {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { queued } = await runOrQueue("SOS opiekuna", [{
            kind: "insert",
            table: "alerts",
            data: {
              type: "sos",
              description: `SOS od opiekuna. GPS: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
            },
          }]);
          if (queued) {
            toast.error("🆘 Brak zasięgu — SOS zapisany lokalnie, ale NIE dotarł jeszcze do koordynatora. W nagłym wypadku zadzwoń też telefonicznie!", { duration: 10000 });
          } else {
            toast.error("🆘 Alert SOS wysłany do koordynatora!");
          }
        },
        async () => {
          const { queued } = await runOrQueue("SOS opiekuna (bez GPS)", [{
            kind: "insert",
            table: "alerts",
            data: { type: "sos", description: "SOS od opiekuna. Brak GPS." },
          }]);
          if (queued) {
            toast.error("🆘 Brak zasięgu — SOS zapisany lokalnie, ale NIE dotarł jeszcze do koordynatora. W nagłym wypadku zadzwoń też telefonicznie!", { duration: 10000 });
          } else {
            toast.error("🆘 Alert SOS wysłany (bez lokalizacji)!");
          }
        },
      );
    } catch {
      toast.error("Nie udało się wysłać alertu SOS. W nagłym wypadku zadzwoń telefonicznie!", { duration: 10000 });
    }
  };

  return (
    <button
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      className={cn(
        "relative flex h-9 w-9 select-none items-center justify-center rounded-full transition-all",
        holding
          ? "bg-destructive text-destructive-foreground scale-110"
          : "bg-destructive/15 text-destructive hover:bg-destructive/25",
      )}
      title="Przytrzymaj 2s aby wysłać SOS"
    >
      <ShieldAlert className="h-5 w-5" />
      {holding && (
        <svg className="absolute inset-0 h-9 w-9 -rotate-90" viewBox="0 0 36 36">
          <circle
            cx="18" cy="18" r="16"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeDasharray={`${(progress / 100) * 100.5} 100.5`}
          />
        </svg>
      )}
    </button>
  );
}

// ─── Ekran: Mój dzień ────────────────────────────────────────────────────────

const DAYS_PL_SHORT = ["Pn", "Wt", "Śr", "Cz", "Pt", "Sb", "Nd"];
const MONTHS_PL = [
  "Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec",
  "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień",
];

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function startOfWeekMon(d: Date) {
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const r = new Date(d);
  r.setDate(d.getDate() - diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function ScheduleScreen({ onOpenVisit }: { onOpenVisit: (id: string) => void }) {
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    },
  });

  useEffect(() => {
    (async () => {
      try {
        await supabase.rpc("check_late_visits");
      } catch {
        // Ignoruj błąd jeśli funkcja niedostępna
      }
    })();
  }, []);

  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("day");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const today = new Date();

  // Zawsze pobieramy zakres całego widocznego miesiąca — pokrywa to też
  // widok dnia/tygodnia bez dodatkowych zapytań przy przełączaniu.
  const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const monthEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1);
  const rangeStartISO = monthStart.toISOString();
  const rangeEndISO = monthEnd.toISOString();

  const { data: visits, isLoading } = useQuery({
    queryKey: ["opiekun-visits", user?.id, monthStart.toISOString()],
    enabled: !!user?.id,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(
          `id, planned_start, planned_end, status, actual_start, actual_end,
           hours_billed, nfc_verified_entry, nfc_verified_exit,
           gps_verified_entry, gps_verified_exit, notes, senior_id, caregiver_id,
           senior:seniors(imie, nazwisko, adres, telefon, lat, lng, nfc_uid, plan_wsparcia, notatka_techniczna)`,
        )
        .eq("caregiver_id", user!.id)
        .gte("planned_start", rangeStartISO)
        .lt("planned_start", rangeEndISO)
        .order("planned_start");
      if (error) throw error;
      return (data ?? []) as unknown as Visit[];
    },
  });

  const visitsByDay = new Map<string, Visit[]>();
  for (const v of visits ?? []) {
    const key = new Date(v.planned_start).toDateString();
    if (!visitsByDay.has(key)) visitsByDay.set(key, []);
    visitsByDay.get(key)!.push(v);
  }
  const visitsForSelectedDay = visitsByDay.get(selectedDate.toDateString()) ?? [];

  const goPrev = () => {
    const d = new Date(selectedDate);
    if (viewMode === "day") d.setDate(d.getDate() - 1);
    else if (viewMode === "week") d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    setSelectedDate(d);
  };
  const goNext = () => {
    const d = new Date(selectedDate);
    if (viewMode === "day") d.setDate(d.getDate() + 1);
    else if (viewMode === "week") d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    setSelectedDate(d);
  };
  const goToday = () => setSelectedDate(new Date());

  const headerLabel =
    viewMode === "month"
      ? `${MONTHS_PL[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`
      : selectedDate.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });

  // ── Potwierdzenie odczytu grafiku (tylko widoki tydzień/miesiąc) ──
  const qc = useQueryClient();
  const periodType: "week" | "month" | null =
    viewMode === "week" ? "week" : viewMode === "month" ? "month" : null;
  const periodStartDate =
    periodType === "week" ? startOfWeekMon(selectedDate)
    : periodType === "month" ? new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
    : null;
  const periodStartKey = periodStartDate
    ? `${periodStartDate.getFullYear()}-${String(periodStartDate.getMonth() + 1).padStart(2, "0")}-${String(periodStartDate.getDate()).padStart(2, "0")}`
    : null;

  const { data: ack } = useQuery({
    queryKey: ["schedule-ack", user?.id, periodType, periodStartKey],
    enabled: !!user?.id && !!periodType,
    queryFn: async () => {
      const { data } = await supabase
        .from("schedule_acknowledgements")
        .select("id")
        .eq("caregiver_id", user!.id)
        .eq("period_type", periodType!)
        .eq("period_start", periodStartKey!)
        .maybeSingle();
      return data;
    },
  });

  const ackMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("schedule_acknowledgements").insert({
        caregiver_id: user!.id,
        period_type: periodType,
        period_start: periodStartKey,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Potwierdzono zapoznanie z grafikiem");
      qc.invalidateQueries({ queryKey: ["schedule-ack"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">Mój grafik</h1>
      </div>

      {/* Przełącznik widoku */}
      <div className="flex rounded-lg border bg-muted/30 p-1">
        {([
          { key: "day", label: "Dzień" },
          { key: "week", label: "Tydzień" },
          { key: "month", label: "Miesiąc" },
        ] as const).map((opt) => (
          <button
            key={opt.key}
            onClick={() => setViewMode(opt.key)}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
              viewMode === opt.key ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Nawigacja okresu */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={goPrev}><ChevronLeft className="h-4 w-4" /></Button>
        <div className="text-center">
          <div className="text-sm font-medium capitalize">{headerLabel}</div>
          {!sameDay(selectedDate, today) && (
            <button onClick={goToday} className="text-xs text-primary hover:underline">Dziś</button>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={goNext}><ChevronRight className="h-4 w-4" /></Button>
      </div>

      {/* Potwierdzenie zapoznania z grafikiem — tylko widok tydzień/miesiąc */}
      {periodType && (
        ack ? (
          <div className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 py-2 text-xs font-medium text-emerald-700">
            <CheckSquare className="h-3.5 w-3.5" />
            Potwierdzono zapoznanie z tym grafikiem
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => ackMut.mutate()}
            disabled={ackMut.isPending}
          >
            {ackMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Potwierdzam zapoznanie z grafikiem
          </Button>
        )
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Ładowanie wizyt...</span>
        </div>
      )}

      {/* Widok miesiąca — siatka z kropkami */}
      {viewMode === "month" && !isLoading && (
        <div className="rounded-xl border bg-card p-2">
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DAYS_PL_SHORT.map((d) => (
              <div key={d} className="py-1 text-center text-[11px] font-medium text-muted-foreground">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {(() => {
              const firstOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
              const firstWeekday = firstOfMonth.getDay() === 0 ? 6 : firstOfMonth.getDay() - 1;
              const daysInMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate();
              const cells = [];
              for (let i = 0; i < firstWeekday; i++) cells.push(<div key={`e${i}`} />);
              for (let day = 1; day <= daysInMonth; day++) {
                const d = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day);
                const count = visitsByDay.get(d.toDateString())?.length ?? 0;
                const isToday = sameDay(d, today);
                const isSelected = sameDay(d, selectedDate);
                cells.push(
                  <button
                    key={day}
                    onClick={() => { setSelectedDate(d); setViewMode("day"); }}
                    className={`flex aspect-square flex-col items-center justify-center rounded-lg text-xs ${
                      isSelected ? "bg-primary text-primary-foreground" : isToday ? "bg-muted font-semibold" : "hover:bg-muted/60"
                    }`}
                  >
                    {day}
                    {count > 0 && (
                      <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${isSelected ? "bg-primary-foreground" : "bg-primary"}`} />
                    )}
                  </button>,
                );
              }
              return cells;
            })()}
          </div>
        </div>
      )}

      {/* Pasek dni tygodnia */}
      {viewMode === "week" && !isLoading && (
        <div className="grid grid-cols-7 gap-1">
          {(() => {
            const start = startOfWeekMon(selectedDate);
            return Array.from({ length: 7 }).map((_, i) => {
              const d = new Date(start);
              d.setDate(start.getDate() + i);
              const count = visitsByDay.get(d.toDateString())?.length ?? 0;
              const isToday = sameDay(d, today);
              const isSelected = sameDay(d, selectedDate);
              return (
                <button
                  key={i}
                  onClick={() => setSelectedDate(d)}
                  className={`flex flex-col items-center rounded-lg py-2 text-xs ${
                    isSelected ? "bg-primary text-primary-foreground" : isToday ? "bg-muted font-semibold" : "hover:bg-muted/60"
                  }`}
                >
                  <span>{DAYS_PL_SHORT[i]}</span>
                  <span className="text-sm font-medium">{d.getDate()}</span>
                  {count > 0 && (
                    <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${isSelected ? "bg-primary-foreground" : "bg-primary"}`} />
                  )}
                </button>
              );
            });
          })()}
        </div>
      )}

      {/* Lista wizyt wybranego dnia (widoki: dzień / tydzień) */}
      {(viewMode === "day" || viewMode === "week") && !isLoading && (
        <>
          {visitsForSelectedDay.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
              Brak zaplanowanych wizyt na ten dzień.
            </div>
          ) : (
            <div className="space-y-3">
              {visitsForSelectedDay.map((v) => (
                <VisitCard key={v.id} visit={v} onClick={() => onOpenVisit(v.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VisitCard({ visit: v, onClick }: { visit: Visit; onClick: () => void }) {
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  const planTasks: string[] = Array.isArray(v.senior?.plan_wsparcia)
    ? (v.senior!.plan_wsparcia as unknown[]).map(String).filter(Boolean)
    : [];
  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:shadow-md active:scale-[0.98]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {v.senior?.imie} {v.senior?.nazwisko}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{v.senior?.adres}</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {fmtTime(v.planned_start)} – {fmtTime(v.planned_end)}
          </div>
          {v.senior?.notatka_techniczna && (
            <div className="mt-1.5 flex items-start gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-900">
              <KeyRound className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <span className="line-clamp-2">{v.senior.notatka_techniczna}</span>
            </div>
          )}
          {planTasks.length > 0 && (
            <div className="mt-2 border-t pt-2 space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Zaplanowane czynności:</div>
              {planTasks.map((t, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-foreground">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary/50 flex-shrink-0" />
                  {t}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant="secondary" className={STATUS_TONE[v.status]}>
            {STATUS_LABEL[v.status]}
          </Badge>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </button>
  );
}

// ─── Ekran: Wizyta (NFC + GPS + czynności) ───────────────────────────────────

function VisitScreen({
  visitId,
  onBack,
}: {
  visitId: string;
  onBack: () => void;
}) {
  const qc = useQueryClient();

  const { data: visit, isLoading } = useQuery({
    queryKey: ["visit", visitId],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(
          `id, planned_start, planned_end, status, actual_start, actual_end,
           hours_billed, nfc_verified_entry, nfc_verified_exit,
           gps_verified_entry, gps_verified_exit, notes, senior_id, caregiver_id,
           senior:seniors(imie, nazwisko, adres, telefon, lat, lng, nfc_uid, plan_wsparcia, notatka_techniczna)`,
        )
        .eq("id", visitId)
        .single();
      if (error) throw error;
      return data as unknown as Visit;
    },
  });

  const { data: tasks, refetch: refetchTasks } = useQuery({
    queryKey: ["visit-tasks", visitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visit_tasks")
        .select("id, task_name, completed, uwagi, requires_response, response")
        .eq("visit_id", visitId)
        .order("task_name");
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["visit", visitId] });
    qc.invalidateQueries({ queryKey: ["opiekun-visits"] });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!visit) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Nie znaleziono wizyty.
      </div>
    );
  }

  const s = visit.senior;
  const isActive = visit.status === "active";
  const isCompleted =
    visit.status === "completed" || visit.status === "requires_verification";
  const canStart = visit.status === "planned" || visit.status === "alert";

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-10">
      {/* Nagłówek */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold truncate">
            {s?.imie} {s?.nazwisko}
          </h1>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {fmtTime(visit.planned_start)} – {fmtTime(visit.planned_end)}
          </div>
        </div>
        <Badge variant="secondary" className={STATUS_TONE[visit.status]}>
          {STATUS_LABEL[visit.status]}
        </Badge>
      </div>

      {/* Adres + telefon */}
      {s && (
        <div className="rounded-xl border bg-card p-4 space-y-2">
          <div className="flex items-start gap-2 text-sm">
            <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
            <a
              href={`https://www.google.com/maps?q=${s.lat},${s.lng}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              {s.adres}
            </a>
          </div>
          {s.telefon && (
            <div className="flex items-center gap-2 text-sm">
              <Phone className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <a href={`tel:${s.telefon}`} className="text-primary hover:underline">
                {s.telefon}
              </a>
            </div>
          )}
        </div>
      )}

      {/* Informacje o dostępie od koordynatora — widoczne PRZED wejściem do mieszkania */}
      {s?.notatka_techniczna && (
        <div className="rounded-xl border border-amber-300 bg-amber-500/10 p-4">
          <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-amber-900">
            <KeyRound className="h-4 w-4 flex-shrink-0" />
            Informacje o dostępie
          </div>
          <p className="whitespace-pre-wrap text-sm text-amber-900">
            {s.notatka_techniczna}
          </p>
        </div>
      )}

      {/* KROK 1: Wejście */}
      {canStart && (
        <NfcGpsStep
          label="Rozpocznij wizytę"
          icon="entry"
          visit={visit}
          onSuccess={invalidate}
        />
      )}

      {/* KROK 2: Czynności */}
      {isActive && (
        <TasksStep
          visitId={visitId}
          tasks={tasks ?? []}
          onRefresh={refetchTasks}
        />
      )}

      {/* Parametry życiowe */}
      {isActive && visit.senior && (
        <VitalsStep visitId={visitId} seniorId={visit.senior_id} />
      )}

      {/* Dokumentacja foto — bez zapisu w galerii telefonu */}
      {isActive && (
        <PhotosStep visitId={visitId} />
      )}

      {/* Notatka */}
      {isActive && (
        <NotesStep visitId={visitId} initialNotes={visit.notes ?? ""} />
      )}

      {/* KROK 3: Wyjście */}
      {isActive && (
        <NfcGpsStep
          label="Zakończ wizytę"
          icon="exit"
          visit={visit}
          tasks={tasks ?? []}
          onSuccess={async () => {
            // Zapisz raport dzienny po zakończeniu
            await saveVisitReport(visitId, visit.senior_id, visit.caregiver_id ?? null, tasks ?? []);
            invalidate();
          }}
        />
      )}

      {/* Podsumowanie po zakończeniu */}
      {isCompleted && (
        <CompletedSummary visit={visit} tasks={tasks ?? []} />
      )}
    </div>
  );
}

// ─── Krok NFC + GPS ──────────────────────────────────────────────────────────

function NfcGpsStep({
  label,
  icon,
  visit,
  tasks,
  onSuccess,
}: {
  label: string;
  icon: "entry" | "exit";
  visit: Visit;
  tasks?: Task[];
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<
    "idle" | "nfc" | "gps" | "checking" | "done" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [justificationMode, setJustificationMode] = useState(false);
  const [justification, setJustification] = useState("");
  const nfcRef = useRef<AbortController | null>(null);

  const isEntry = icon === "entry";

  const start = async () => {
    setStep("nfc");
    setErrorMsg("");

    // ── Sprawdź WebNFC ──
    if (!("NDEFReader" in window)) {
      // Fallback: GPS only z flagą requires_verification
      setErrorMsg(
        "Ten telefon / przeglądarka nie obsługuje NFC. Użyj Chrome na Androidzie z NFC.",
      );
      setStep("error");
      return;
    }

    let nfcUid: string | null = null;

    try {
      const ndef = new (window as unknown as { NDEFReader: new () => NDEFReader }).NDEFReader();
      nfcRef.current = new AbortController();
      await ndef.scan({ signal: nfcRef.current.signal });

      nfcUid = await new Promise<string>((resolve, reject) => {
        ndef.onreading = (event: NDEFReadingEvent) => {
          resolve(event.serialNumber.toLowerCase().replace(/:/g, ""));
        };
        ndef.onreadingerror = () => reject(new Error("Błąd odczytu tagu NFC"));
        setTimeout(
          () => reject(new Error("Czas oczekiwania na tag NFC upłynął (30s)")),
          30000,
        );
      });

      nfcRef.current.abort();
    } catch (e) {
      setErrorMsg((e as Error).message);
      setStep("error");
      return;
    }

    // ── Sprawdź UID tagu ──
    const expectedUid = visit.senior?.nfc_uid?.toLowerCase().replace(/:/g, "");
    if (expectedUid && nfcUid !== expectedUid) {
      setErrorMsg(
        `Nieprawidłowy tag NFC! Oczekiwano tagu seniora ${visit.senior?.imie} ${visit.senior?.nazwisko}.`,
      );
      setStep("error");
      return;
    }

    // ── Pobierz GPS ──
    setStep("gps");
    let gpsOk = false;
    let distanceM = 0;

    // Jeśli senior nie ma wpisanych współrzędnych GPS — weryfikacja tylko przez NFC
    const seniorHasGps = visit.senior?.lat != null && visit.senior?.lng != null;

    if (!seniorHasGps) {
      // Brak GPS seniora → uznaj za OK, NFC wystarczy
      gpsOk = true;
    } else {
      const gpsResult = await new Promise<GeolocationPosition | null>(
        (resolve) => {
          navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
            enableHighAccuracy: true,
            timeout: 15000,
          });
        },
      );

      if (gpsResult) {
        distanceM = haversineM(
          gpsResult.coords.latitude,
          gpsResult.coords.longitude,
          visit.senior!.lat!,
          visit.senior!.lng!,
        );
        gpsOk = distanceM <= GPS_RADIUS_M;
      } else {
        // Brak sygnału GPS → nie blokuj, ale zanotuj
        gpsOk = true;
      }
    }

    setStep("checking");

    // ── Zbuduj operacje do zapisu (od razu albo do kolejki offline) ──
    try {
      const serverTime = await fetchServerTime();
      const ops: DbOp[] = [];
      let queuedLabel = "";

      if (isEntry) {
        const updateData: Record<string, unknown> = {
          actual_start: serverTime,
          status: gpsOk ? "active" : "requires_verification",
          nfc_verified_entry: true,
          gps_verified_entry: gpsOk,
          gps_distance_entry_m: Math.round(distanceM),
        };

        if (!gpsOk) {
          ops.push({
            kind: "insert",
            table: "alerts",
            data: {
              visit_id: visit.id,
              senior_id: visit.senior_id,
              type: "gps_mismatch",
              description: `Wejście: GPS poza strefą ${Math.round(distanceM)}m od adresu (limit ${GPS_RADIUS_M}m). Wymaga weryfikacji koordynatora.`,
            },
          });
        }
        ops.push({ kind: "update", table: "visits", data: updateData, match: { id: visit.id } });
        queuedLabel = `Zameldowanie — ${visit.senior?.imie ?? ""} ${visit.senior?.nazwisko ?? ""}`;
      } else {
        // Wyjście
        const hoursBilled = visit.actual_start
          ? calcHoursBilled(visit.actual_start, serverTime)
          : 0;

        const updateData: Record<string, unknown> = {
          actual_end: serverTime,
          status: gpsOk ? "completed" : "requires_verification",
          nfc_verified_exit: true,
          gps_verified_exit: gpsOk,
          gps_distance_exit_m: Math.round(distanceM),
          hours_billed: hoursBilled,
        };

        if (!gpsOk) {
          ops.push({
            kind: "insert",
            table: "alerts",
            data: {
              visit_id: visit.id,
              senior_id: visit.senior_id,
              type: "gps_mismatch",
              description: `Wyjście: GPS poza strefą ${Math.round(distanceM)}m. Rozliczono ${hoursBilled}h.`,
            },
          });
        }
        ops.push({ kind: "update", table: "visits", data: updateData, match: { id: visit.id } });

        // Po wyjściu: sprawdź uwagi do niewykonanych zadań → Alarm.
        // Lista zadań jest już wczytana w aplikacji (visit.tasks), więc możemy
        // to wyliczyć teraz, nawet offline — bez dodatkowego zapytania do bazy.
        const tasksWithUwagi = (tasks ?? []).filter((t) => !t.completed && t.uwagi);
        if (tasksWithUwagi.length > 0) {
          ops.push({ kind: "update", table: "visits", data: { status: "alert" }, match: { id: visit.id } });
          ops.push({
            kind: "insert",
            table: "alerts",
            data: {
              visit_id: visit.id,
              senior_id: visit.senior_id,
              type: "task_incomplete",
              description: `${tasksWithUwagi.length} czynności niewykonanych z uwagami: ${tasksWithUwagi.map((t) => t.task_name).join(", ")}`,
            },
          });
        }
        queuedLabel = `Wymeldowanie — ${visit.senior?.imie ?? ""} ${visit.senior?.nazwisko ?? ""}`;
      }

      const { queued } = await runOrQueue(queuedLabel, ops);

      setStep("done");
      if (queued) {
        toast.success(
          "Brak zasięgu — zapisano lokalnie na telefonie. Wyśle się automatycznie, gdy tylko wróci internet.",
        );
      } else {
        toast.success(
          gpsOk
            ? isEntry
              ? "Wizyta rozpoczęta ✓"
              : "Wizyta zakończona ✓"
            : "Zapisano z flagą: wymaga weryfikacji koordynatora",
        );
      }
      onSuccess();
    } catch (e) {
      setErrorMsg((e as Error).message);
      setStep("error");
    }
  };

  if (step === "done") return null;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30">
        <h3 className="text-sm font-semibold">
          {isEntry ? "Krok 1 — Wejście" : "Krok 3 — Wyjście"}
        </h3>
      </div>

      <div className="p-4 space-y-4">
        {step === "idle" && (
          <button
            onClick={start}
            className="w-full rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-8 text-center transition-all hover:border-primary/70 hover:bg-primary/10 active:scale-[0.98]"
          >
            <Rss className="mx-auto h-10 w-10 text-primary mb-3" />
            <div className="font-semibold text-primary">{label}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Dotknij, a następnie przyłóż telefon do tagu NFC seniora
            </div>
          </button>
        )}

        {step === "nfc" && (
          <div className="text-center py-6 space-y-3">
            <Rss className="mx-auto h-10 w-10 text-primary animate-pulse" />
            <div className="font-medium">Przyłóż telefon do tagu NFC...</div>
            <div className="text-xs text-muted-foreground">
              Naklejka NFC powinna być przy drzwiach lub w ustalonym miejscu
            </div>
          </div>
        )}

        {step === "gps" && (
          <div className="text-center py-6 space-y-3">
            <MapPin className="mx-auto h-10 w-10 text-warning animate-pulse" />
            <div className="font-medium">Pobieranie lokalizacji GPS...</div>
            <div className="text-xs text-muted-foreground">Chwilę...</div>
          </div>
        )}

        {step === "checking" && (
          <div className="text-center py-6 space-y-3">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
            <div className="font-medium">Weryfikacja i zapis...</div>
          </div>
        )}

        {step === "error" && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>

            {!justificationMode ? (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => setStep("idle")}
                >
                  Spróbuj ponownie
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  onClick={() => setJustificationMode(true)}
                >
                  Zgłoś problem
                </Button>
              </div>
            ) : (
              <EmergencyRegistration
                visit={visit}
                isEntry={isEntry}
                onSuccess={() => {
                  setStep("done");
                  onSuccess();
                }}
                onCancel={() => setJustificationMode(false)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tryb awaryjny ───────────────────────────────────────────────────────────

function EmergencyRegistration({
  visit,
  isEntry,
  onSuccess,
  onCancel,
}: {
  visit: Visit;
  isEntry: boolean;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!note.trim()) {
      toast.error("Podaj uzasadnienie trybu awaryjnego.");
      return;
    }
    setSaving(true);
    try {
      const serverTime = await fetchServerTime();
      const updateData: Record<string, unknown> = isEntry
        ? { actual_start: serverTime, status: "requires_verification" }
        : {
            actual_end: serverTime,
            status: "requires_verification",
            hours_billed: visit.actual_start
              ? calcHoursBilled(visit.actual_start, serverTime)
              : 0,
          };

      const ops: DbOp[] = [
        { kind: "update", table: "visits", data: updateData, match: { id: visit.id } },
        {
          kind: "insert",
          table: "alerts",
          data: {
            visit_id: visit.id,
            senior_id: visit.senior_id,
            type: "nfc_mismatch",
            description: `Tryb awaryjny (${isEntry ? "wejście" : "wyjście"}): ${note}`,
          },
        },
      ];
      const { queued } = await runOrQueue(
        `Tryb awaryjny — ${visit.senior?.imie ?? ""} ${visit.senior?.nazwisko ?? ""}`,
        ops,
      );

      toast.warning(
        queued
          ? "Brak zasięgu — zapisano lokalnie. Wyśle się automatycznie po powrocie internetu (koordynator i tak musi zatwierdzić)."
          : "Zapisano w trybie awaryjnym — koordynator musi zatwierdzić.",
      );
      onSuccess();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <Textarea
        placeholder="Opisz powód braku odczytu NFC / problemu z GPS..."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
      />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          <X className="h-4 w-4" />
          Anuluj
        </Button>
        <Button size="sm" onClick={save} disabled={saving} className="flex-1">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Zapisz (tryb awaryjny)
        </Button>
      </div>
    </div>
  );
}

// ─── Czynności ───────────────────────────────────────────────────────────────

function TasksStep({
  visitId,
  tasks,
  onRefresh,
}: {
  visitId: string;
  tasks: Task[];
  onRefresh: () => void;
}) {
  const [expandedUwagi, setExpandedUwagi] = useState<string | null>(null);
  const [uwagi, setUwagi] = useState<Record<string, string>>({});
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [savingResponse, setSavingResponse] = useState<string | null>(null);
  // Optymistyczne nadpisanie stanu "wykonane" — widoczne natychmiast, nawet
  // offline, niezależnie od tego czy odświeżenie z serwera się powiodło.
  const [localCompleted, setLocalCompleted] = useState<Record<string, boolean>>({});

  const saveResponse = async (taskId: string) => {
    setSavingResponse(taskId);
    try {
      const { queued } = await runOrQueue(`Odpowiedź na czynność ${taskId}`, [
        { kind: "update", table: "visit_tasks", data: { response: responses[taskId] || null }, match: { id: taskId } },
      ]);
      onRefresh();
      toast.success(queued ? "Odpowiedź zapisana lokalnie (offline)" : "Odpowiedź zapisana");
    } finally {
      setSavingResponse(null);
    }
  };

  const toggleTask = async (task: Task) => {
    const nextCompleted = !(localCompleted[task.id] ?? task.completed);
    setLocalCompleted((m) => ({ ...m, [task.id]: nextCompleted }));
    const { queued } = await runOrQueue(`Czynność: ${task.task_name}`, [
      {
        kind: "update",
        table: "visit_tasks",
        data: { completed: nextCompleted, completed_at: nextCompleted ? new Date().toISOString() : null },
        match: { id: task.id },
      },
    ]);
    if (queued) toast.message("Zapisano lokalnie — wyśle się po powrocie zasięgu.");
    onRefresh();
  };

  const saveUwagi = async (taskId: string) => {
    const val = uwagi[taskId] ?? "";
    const { queued } = await runOrQueue(`Uwaga do czynności ${taskId}`, [
      { kind: "update", table: "visit_tasks", data: { uwagi: val || null }, match: { id: taskId } },
    ]);
    onRefresh();
    setExpandedUwagi(null);
    toast.success(queued ? "Uwaga zapisana lokalnie (offline)" : "Uwaga zapisana");
  };

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30">
        <h3 className="text-sm font-semibold">Krok 2 — Wykonane czynności</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Zaznacz wykonane · Kliknij <MessageSquare className="inline h-3 w-3" /> aby dodać uwagę jeśli niewykonane
        </p>
      </div>
      <div className="divide-y">
        {tasks.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Brak zaplanowanych czynności dla tej wizyty.
          </p>
        )}
        {tasks.map((t) => {
          const isCompleted = localCompleted[t.id] ?? t.completed;
          return (
          <div key={t.id} className="divide-y">
            <div className="flex items-center gap-2 px-4 py-3">
              <button
                onClick={() => toggleTask(t)}
                className="flex items-center gap-3 flex-1 text-left hover:opacity-80"
              >
                {isCompleted ? (
                  <CheckSquare className="h-5 w-5 flex-shrink-0 text-emerald-500" />
                ) : (
                  <Square className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                )}
                <span className={cn("text-sm", isCompleted && "line-through text-muted-foreground")}>
                  {t.task_name}
                </span>
              </button>
              {!isCompleted && (
                <button
                  onClick={() => {
                    setExpandedUwagi(expandedUwagi === t.id ? null : t.id);
                    if (!uwagi[t.id] && t.uwagi) setUwagi(u => ({ ...u, [t.id]: t.uwagi ?? "" }));
                  }}
                  className={cn(
                    "flex-shrink-0 p-1 rounded hover:bg-muted",
                    (t.uwagi || expandedUwagi === t.id) ? "text-amber-500" : "text-muted-foreground"
                  )}
                  title="Dodaj uwagę"
                >
                  <MessageSquare className="h-4 w-4" />
                </button>
              )}
            </div>
            {/* Pole uwag */}
            {expandedUwagi === t.id && (
              <div className="px-4 py-2 bg-amber-500/5 border-amber-300/30 space-y-2">
                <p className="text-xs text-amber-700 font-medium">Powód niewykonania / uwaga:</p>
                <Textarea
                  rows={2}
                  value={uwagi[t.id] ?? t.uwagi ?? ""}
                  onChange={(e) => setUwagi(u => ({ ...u, [t.id]: e.target.value }))}
                  placeholder="np. Podopieczny odmówił, brak czasu, inne..."
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => saveUwagi(t.id)}>Zapisz uwagę</Button>
                  <Button size="sm" variant="ghost" onClick={() => setExpandedUwagi(null)}>Anuluj</Button>
                </div>
              </div>
            )}
            {/* Pokaż zapisaną uwagę */}
            {t.uwagi && expandedUwagi !== t.id && !isCompleted && (
              <div className="px-4 py-1.5 bg-amber-500/5 text-xs text-amber-700">
                ⚠️ {t.uwagi}
              </div>
            )}

            {/* Pole odpowiedzi — gdy koordynator zaznaczył "wymaga odpowiedzi" */}
            {t.requires_response && (
              <div className="px-4 py-3 bg-blue-500/5 border-t border-blue-200/50 space-y-2">
                <p className="text-sm font-medium text-blue-800 flex items-center gap-1.5">
                  <MessageSquare className="h-4 w-4" />
                  Wymagana odpowiedź / wynik pomiaru:
                </p>
                {t.response && savingResponse !== t.id ? (
                  <div className="space-y-1.5">
                    <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-900">
                      {t.response}
                    </div>
                    <button
                      onClick={() => setResponses(r => ({ ...r, [t.id]: t.response ?? "" }))}
                      className="text-xs text-blue-600 hover:text-blue-800 underline"
                    >
                      Edytuj odpowiedź
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Textarea
                      rows={2}
                      placeholder="Wpisz wynik, obserwację lub odpowiedź..."
                      value={responses[t.id] ?? t.response ?? ""}
                      onChange={e => setResponses(r => ({ ...r, [t.id]: e.target.value }))}
                      className="text-sm resize-none border-blue-200 focus:border-blue-400"
                    />
                    <Button
                      size="sm"
                      onClick={() => saveResponse(t.id)}
                      disabled={savingResponse === t.id || !responses[t.id]?.trim()}
                      className="w-full"
                    >
                      {savingResponse === t.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : "Zapisz odpowiedź"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Parametry życiowe ────────────────────────────────────────────────────────

function VitalsStep({
  visitId,
  seniorId,
}: {
  visitId: string;
  seniorId: string;
}) {
  const [vitals, setVitals] = useState<Vitals>({
    cisnienie_skurczowe: "", cisnienie_rozkurczowe: "", puls: "",
    temperatura: "", saturacja: "", waga: "", poziom_cukru: "", uwagi: "",
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (field: keyof Vitals) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setVitals(v => ({ ...v, [field]: e.target.value }));

  const handleSave = async () => {
    const hasAny = Object.values(vitals).some(v => v.trim() !== "");
    if (!hasAny) { toast.error("Wypełnij przynajmniej jeden parametr"); return; }
    setSaving(true);
    try {
      // getSession() czyta z lokalnej pamięci (działa offline), w przeciwieństwie
      // do getUser(), które domyślnie odpytuje serwer.
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id ?? null;

      const { queued } = await runOrQueue(`Parametry życiowe — wizyta ${visitId}`, [{
        kind: "insert",
        table: "senior_vitals",
        data: {
          visit_id: visitId,
          senior_id: seniorId,
          created_by: userId,
          cisnienie_skurczowe: vitals.cisnienie_skurczowe ? Number(vitals.cisnienie_skurczowe) : null,
          cisnienie_rozkurczowe: vitals.cisnienie_rozkurczowe ? Number(vitals.cisnienie_rozkurczowe) : null,
          puls: vitals.puls ? Number(vitals.puls) : null,
          temperatura: vitals.temperatura ? Number(vitals.temperatura) : null,
          saturacja: vitals.saturacja ? Number(vitals.saturacja) : null,
          waga: vitals.waga ? Number(vitals.waga) : null,
          poziom_cukru: vitals.poziom_cukru ? Number(vitals.poziom_cukru) : null,
          uwagi: vitals.uwagi || null,
        },
      }]);
      setSaved(true);
      toast.success(queued ? "Parametry zapisane lokalnie (offline)" : "Parametry zapisane");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const fields: { key: keyof Vitals; label: string; unit: string; icon: React.ReactNode; placeholder: string }[] = [
    { key: "cisnienie_skurczowe", label: "Ciśnienie skurczowe", unit: "mmHg", icon: <Heart className="h-4 w-4 text-red-500" />, placeholder: "120" },
    { key: "cisnienie_rozkurczowe", label: "Ciśnienie rozkurczowe", unit: "mmHg", icon: <Heart className="h-4 w-4 text-red-400" />, placeholder: "80" },
    { key: "puls", label: "Tętno", unit: "ud/min", icon: <Activity className="h-4 w-4 text-pink-500" />, placeholder: "72" },
    { key: "temperatura", label: "Temperatura", unit: "°C", icon: <Thermometer className="h-4 w-4 text-orange-500" />, placeholder: "36.6" },
    { key: "saturacja", label: "Saturacja (SpO₂)", unit: "%", icon: <Wind className="h-4 w-4 text-blue-500" />, placeholder: "98" },
    { key: "waga", label: "Waga", unit: "kg", icon: <Scale className="h-4 w-4 text-violet-500" />, placeholder: "65.0" },
    { key: "poziom_cukru", label: "Poziom cukru", unit: "mg/dL", icon: <Droplets className="h-4 w-4 text-amber-500" />, placeholder: "100" },
  ];

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Heart className="h-4 w-4 text-red-500" />
            Krok 3 — Parametry życiowe
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">Wypełnij mierzone parametry (opcjonalne)</p>
        </div>
        {saved && <span className="text-xs text-emerald-600 font-medium">✓ Zapisano</span>}
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {fields.map(f => (
            <div key={f.key}>
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
                {f.icon} {f.label}
              </label>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  step="0.1"
                  placeholder={f.placeholder}
                  value={vitals[f.key]}
                  onChange={set(f.key)}
                  className="h-8 text-sm"
                  disabled={saved}
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">{f.unit}</span>
              </div>
            </div>
          ))}
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Dodatkowe obserwacje</label>
          <Textarea
            placeholder="np. Senior skarżył się na ból głowy, widoczne obrzęki nóg..."
            value={vitals.uwagi}
            onChange={set("uwagi")}
            rows={2}
            className="text-sm resize-none"
            disabled={saved}
          />
        </div>
        {!saved && (
          <Button size="sm" onClick={handleSave} disabled={saving} className="w-full">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Zapisz parametry
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Dokumentacja foto (bez zapisu w galerii telefonu) ──────────────────────

type VisitPhoto = { id: string; storage_path: string; created_at: string };

function PhotosStep({ visitId }: { visitId: string }) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const { data: photos, isLoading } = useQuery({
    queryKey: ["visit-photos", visitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visit_photos")
        .select("id, storage_path, created_at")
        .eq("visit_id", visitId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as VisitPhoto[];
    },
  });

  // Podpisane URL-e do podglądu miniaturek (bucket jest prywatny)
  useEffect(() => {
    (async () => {
      const missing = (photos ?? []).filter((p) => !urls[p.id]);
      if (missing.length === 0) return;
      const next: Record<string, string> = {};
      for (const p of missing) {
        const { data } = await supabase.storage.from("visit-photos").createSignedUrl(p.storage_path, 300);
        if (data?.signedUrl) next[p.id] = data.signedUrl;
      }
      if (Object.keys(next).length > 0) setUrls((prev) => ({ ...prev, ...next }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = `${visitId}/${Date.now()}-${file.name}`;
      const { error: uploadErr } = await supabase.storage.from("visit-photos").upload(path, file);
      if (uploadErr) throw uploadErr;
      const { error: dbErr } = await supabase.from("visit_photos").insert({
        visit_id: visitId,
        storage_path: path,
      } as never);
      if (dbErr) throw dbErr;
      qc.invalidateQueries({ queryKey: ["visit-photos", visitId] });
      toast.success("Zdjęcie dodane");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Camera className="h-4 w-4" /> Dokumentacja foto
        </h3>
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground ${uploading ? "opacity-50" : ""}`}>
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
          Zrób zdjęcie
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleCapture}
            disabled={uploading}
          />
        </label>
      </div>

      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (photos ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Brak zdjęć. Zdjęcia trafiają bezpośrednio do systemu, nie zapisują się w galerii telefonu.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {(photos ?? []).map((p) => (
            <div key={p.id} className="aspect-square overflow-hidden rounded-lg border bg-muted">
              {urls[p.id] ? (
                <img src={urls[p.id]} alt="Dokumentacja z wizyty" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NotesStep({
  visitId,
  initialNotes,
}: {
  visitId: string;
  initialNotes: string;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = async (val: string) => {
    setSaving(true);
    try {
      await runOrQueue(`Notatka z wizyty ${visitId}`, [
        { kind: "update", table: "visits", data: { notes: val }, match: { id: visitId } },
      ]);
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (val: string) => {
    setNotes(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(val), 1500);
  };

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <StickyNote className="h-4 w-4" />
          Notatka z wizyty
        </h3>
        {saving && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> zapisuję...
          </span>
        )}
      </div>
      <div className="p-4">
        <Textarea
          placeholder="Obserwacje, uwagi, stan podopiecznego..."
          value={notes}
          onChange={(e) => handleChange(e.target.value)}
          rows={3}
          className="resize-none border-0 p-0 shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  );
}

// ─── Podsumowanie ────────────────────────────────────────────────────────────

function CompletedSummary({ visit, tasks }: { visit: Visit; tasks: Task[] }) {
  const completed = tasks.filter((t) => t.completed).length;
  return (
    <div className="rounded-xl border bg-success/10 border-success/30 p-4 space-y-3">
      <div className="flex items-center gap-2 text-success font-semibold">
        <CheckCircle2 className="h-5 w-5" />
        Wizyta zakończona
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Godziny rozliczeniowe
          </div>
          <div className="font-semibold text-lg">
            {visit.hours_billed ?? 0} h
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Czynności
          </div>
          <div className="font-semibold text-lg">
            {completed}/{tasks.length}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            NFC wejście
          </div>
          <div>{visit.nfc_verified_entry ? "✓ OK" : "⚠ Brak"}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            NFC wyjście
          </div>
          <div>{visit.nfc_verified_exit ? "✓ OK" : "⚠ Brak"}</div>
        </div>
      </div>
      {visit.status === "requires_verification" && (
        <div className="flex items-start gap-2 rounded-lg bg-warning/15 p-2 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          Wizyta wymaga weryfikacji przez koordynatora
        </div>
      )}
    </div>
  );
}

// ─── Czat z koordynatorem ────────────────────────────────────────────────────

type ChatMessage = {
  id: string;
  caregiver_id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

function fmtChatDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Dziś";
  return d.toLocaleDateString("pl-PL", { day: "numeric", month: "long" });
}

function CaregiverChatScreen({ meId, onBack }: { meId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["my-chat-thread", meId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, caregiver_id, sender_id, body, read_at, created_at")
        .eq("caregiver_id", meId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as ChatMessage[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`my-messages-${meId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `caregiver_id=eq.${meId}` },
        () => qc.invalidateQueries({ queryKey: ["my-chat-thread", meId] }),
      )
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [meId, qc]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const unreadIds = (messages ?? [])
      .filter((m) => m.sender_id !== meId && !m.read_at)
      .map((m) => m.id);
    if (unreadIds.length === 0) return;
    supabase.from("messages").update({ read_at: new Date().toISOString() } as never)
      .in("id", unreadIds)
      .then(({ error }) => {
        if (!error) qc.invalidateQueries({ queryKey: ["chat-unread", meId] });
      });
  }, [messages, meId, qc]);

  const sendMut = useMutation({
    mutationFn: async (body: string) => {
      const { queued } = await runOrQueue(`Wiadomość do koordynatora`, [{
        kind: "insert",
        table: "messages",
        data: { caregiver_id: meId, sender_id: meId, body },
      }]);
      return queued;
    },
    onSuccess: (queued) => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["my-chat-thread", meId] });
      if (queued) toast.message("Brak zasięgu — wiadomość wyśle się automatycznie po powrocie internetu.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSend = () => {
    const body = draft.trim();
    if (!body) return;
    sendMut.mutate(body);
  };

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col">
      <div className="flex items-center gap-3 border-b bg-card px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="font-semibold">Czat z koordynatorem</h1>
          <p className="text-xs text-muted-foreground">Plan Seniora — biuro</p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {isLoading ? (
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
        ) : (messages ?? []).length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Brak wiadomości. Napisz do koordynatora, jeśli masz pytanie lub problem.
          </p>
        ) : (
          (messages ?? []).map((m, i) => {
            const isMe = m.sender_id === meId;
            const prev = messages![i - 1];
            const showDay = !prev || fmtChatDay(prev.created_at) !== fmtChatDay(m.created_at);
            return (
              <div key={m.id}>
                {showDay && (
                  <div className="my-2 text-center text-xs text-muted-foreground">{fmtChatDay(m.created_at)}</div>
                )}
                <div className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                      isMe ? "bg-primary text-primary-foreground" : "bg-muted"
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    <div className={`mt-1 text-[10px] ${isMe ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {fmtTime(m.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-2 border-t bg-card p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Napisz wiadomość..."
          rows={1}
          className="max-h-32 min-h-[40px] resize-none"
        />
        <Button size="icon" onClick={handleSend} disabled={sendMut.isPending || !draft.trim()}>
          {sendMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

// ─── helper ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── typy WebNFC (nie ma w lib.dom) ──────────────────────────────────────────

interface NDEFReader extends EventTarget {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  onreading: ((event: NDEFReadingEvent) => void) | null;
  onreadingerror: (() => void) | null;
}

interface NDEFReadingEvent extends Event {
  serialNumber: string;
}
