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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
  } | null;
};

type Task = {
  id: string;
  task_name: string;
  completed: boolean;
  uwagi: string | null;
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

const GPS_RADIUS_M = 100;

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
    // Pobierz aktualne dane wizyty (godziny, notatki)
    const { data: visit } = await supabase
      .from("visits")
      .select("planned_start, hours_billed, notes")
      .eq("id", visitId)
      .single();

    // Pobierz parametry życiowe z tej wizyty
    const { data: vitals } = await supabase
      .from("senior_vitals")
      .select("*")
      .eq("visit_id", visitId)
      .order("measured_at", { ascending: false })
      .limit(1);

    // Przygotuj snapshot czynności
    const tasksSummary = tasks.map(t => ({
      task_name: t.task_name,
      completed: t.completed,
      uwagi: t.uwagi,
    }));

    // Zapisz raport
    await supabase.from("visit_reports").insert({
      visit_id: visitId,
      senior_id: seniorId,
      caregiver_id: caregiverId,
      report_date: (visit?.planned_start ?? new Date().toISOString()).split("T")[0],
      tasks_summary: tasksSummary,
      vitals_summary: vitals?.[0] ?? null,
      notes: visit?.notes ?? null,
      hours_billed: visit?.hours_billed ?? null,
    });
  } catch (e) {
    // Raport jest opcjonalny — nie blokuj zakończenia wizyty jeśli się nie uda
    console.error("Błąd zapisu raportu:", e);
  }
}

function OpiekunApp() {
  const navigate = useNavigate();
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
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
          <SosButton />
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        {activeVisitId ? (
          <VisitScreen
            visitId={activeVisitId}
            onBack={() => setActiveVisitId(null)}
          />
        ) : (
          <DayScreen onOpenVisit={setActiveVisitId} />
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
          await supabase.from("alerts").insert({
            type: "sos",
            description: `SOS od opiekuna. GPS: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
          });
          toast.error("🆘 Alert SOS wysłany do koordynatora!");
        },
        async () => {
          await supabase.from("alerts").insert({
            type: "sos",
            description: "SOS od opiekuna. Brak GPS.",
          });
          toast.error("🆘 Alert SOS wysłany (bez lokalizacji)!");
        },
      );
    } catch {
      toast.error("Nie udało się wysłać alertu SOS.");
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

function DayScreen({ onOpenVisit }: { onOpenVisit: (id: string) => void }) {
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    },
  });

  // Sprawdź spóźnione wizyty przy każdym wejściu na ekran
  useEffect(() => {
    supabase.rpc("check_late_visits").catch(() => {
      // Ignoruj błąd jeśli funkcja niedostępna (plan Supabase)
    });
  }, []);

  const today = new Date();
  const startOfDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).toISOString();
  const endOfDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1,
  ).toISOString();

  const { data: visits, isLoading } = useQuery({
    queryKey: ["opiekun-visits", user?.id, startOfDay],
    enabled: !!user?.id,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(
          `id, planned_start, planned_end, status, actual_start, actual_end,
           hours_billed, nfc_verified_entry, nfc_verified_exit,
           gps_verified_entry, gps_verified_exit, notes, senior_id, caregiver_id,
           senior:seniors(imie, nazwisko, adres, telefon, lat, lng, nfc_uid, plan_wsparcia)`,
        )
        .eq("caregiver_id", user!.id)
        .gte("planned_start", startOfDay)
        .lt("planned_start", endOfDay)
        .order("planned_start");
      if (error) throw error;
      return (data ?? []) as unknown as Visit[];
    },
  });

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">Mój dzień</h1>
        <p className="text-sm text-muted-foreground">
          {today.toLocaleDateString("pl-PL", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Ładowanie wizyt...</span>
        </div>
      )}

      {!isLoading && (!visits || visits.length === 0) && (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          Brak zaplanowanych wizyt na dziś.
        </div>
      )}

      <div className="space-y-3">
        {(visits ?? []).map((v) => {
          const planTasks: string[] = Array.isArray(v.senior?.plan_wsparcia)
            ? (v.senior!.plan_wsparcia as unknown[]).map(String).filter(Boolean)
            : [];
          return (
            <button
              key={v.id}
              onClick={() => onOpenVisit(v.id)}
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
        })}
      </div>
    </div>
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
           senior:seniors(imie, nazwisko, adres, telefon, lat, lng, nfc_uid, plan_wsparcia)`,
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
        .select("id, task_name, completed")
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
  onSuccess,
}: {
  label: string;
  icon: "entry" | "exit";
  visit: Visit;
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

    const gpsResult = await new Promise<GeolocationPosition | null>(
      (resolve) => {
        navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
          enableHighAccuracy: true,
          timeout: 15000,
        });
      },
    );

    if (
      gpsResult &&
      visit.senior?.lat != null &&
      visit.senior?.lng != null
    ) {
      distanceM = haversineM(
        gpsResult.coords.latitude,
        gpsResult.coords.longitude,
        visit.senior.lat,
        visit.senior.lng,
      );
      gpsOk = distanceM <= GPS_RADIUS_M;
    }

    setStep("checking");

    // ── Zapisz do Supabase ──
    try {
      const serverTime = await fetchServerTime();

      if (isEntry) {
        const updateData: Record<string, unknown> = {
          actual_start: serverTime,
          status: gpsOk ? "active" : "requires_verification",
          nfc_verified_entry: true,
          gps_verified_entry: gpsOk,
          gps_distance_entry_m: Math.round(distanceM),
        };

        if (!gpsOk) {
          // Dodaj alert GPS
          await supabase.from("alerts").insert({
            visit_id: visit.id,
            senior_id: visit.senior_id,
            type: "gps_mismatch",
            description: `Wejście: GPS poza strefą ${Math.round(distanceM)}m od adresu (limit ${GPS_RADIUS_M}m). Wymaga weryfikacji koordynatora.`,
          });
        }

        const { error } = await supabase
          .from("visits")
          .update(updateData)
          .eq("id", visit.id);
        if (error) throw error;
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
          await supabase.from("alerts").insert({
            visit_id: visit.id,
            senior_id: visit.senior_id,
            type: "gps_mismatch",
            description: `Wyjście: GPS poza strefą ${Math.round(distanceM)}m. Rozliczono ${hoursBilled}h.`,
          });
        }

        const { error } = await supabase
          .from("visits")
          .update(updateData)
          .eq("id", visit.id);
        if (error) throw error;

        // Po wyjściu: sprawdź uwagi do niewykonanych zadań → Alarm
        if (!isEntry) {
          const { data: tasks } = await supabase
            .from("visit_tasks")
            .select("id, task_name, completed, uwagi")
            .eq("visit_id", visit.id);

          const tasksWithUwagi = (tasks ?? []).filter((t: any) => !t.completed && t.uwagi);

          if (tasksWithUwagi.length > 0) {
            await supabase.from("visits").update({ status: "alert" }).eq("id", visit.id);
            await supabase.from("alerts").insert({
              visit_id: visit.id,
              senior_id: visit.senior_id,
              type: "task_incomplete",
              description: `${tasksWithUwagi.length} czynności niewykonanych z uwagami: ${tasksWithUwagi.map((t: any) => t.task_name).join(", ")}`,
            });
          }
        }
      }

      setStep("done");
      toast.success(
        gpsOk
          ? isEntry
            ? "Wizyta rozpoczęta ✓"
            : "Wizyta zakończona ✓"
          : "Zapisano z flagą: wymaga weryfikacji koordynatora",
      );
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

      await supabase.from("visits").update(updateData).eq("id", visit.id);
      await supabase.from("alerts").insert({
        visit_id: visit.id,
        senior_id: visit.senior_id,
        type: "nfc_mismatch",
        description: `Tryb awaryjny (${isEntry ? "wejście" : "wyjście"}): ${note}`,
      });

      toast.warning("Zapisano w trybie awaryjnym — koordynator musi zatwierdzić.");
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

  const toggleTask = async (task: Task) => {
    await supabase
      .from("visit_tasks")
      .update({
        completed: !task.completed,
        completed_at: !task.completed ? new Date().toISOString() : null,
      } as never)
      .eq("id", task.id);
    onRefresh();
  };

  const saveUwagi = async (taskId: string) => {
    const val = uwagi[taskId] ?? "";
    await supabase.from("visit_tasks").update({ uwagi: val || null } as never).eq("id", taskId);
    onRefresh();
    setExpandedUwagi(null);
    toast.success("Uwaga zapisana");
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
        {tasks.map((t) => (
          <div key={t.id} className="divide-y">
            <div className="flex items-center gap-2 px-4 py-3">
              <button
                onClick={() => toggleTask(t)}
                className="flex items-center gap-3 flex-1 text-left hover:opacity-80"
              >
                {t.completed ? (
                  <CheckSquare className="h-5 w-5 flex-shrink-0 text-emerald-500" />
                ) : (
                  <Square className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                )}
                <span className={cn("text-sm", t.completed && "line-through text-muted-foreground")}>
                  {t.task_name}
                </span>
              </button>
              {!t.completed && (
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
            {t.uwagi && expandedUwagi !== t.id && !t.completed && (
              <div className="px-4 py-1.5 bg-amber-500/5 text-xs text-amber-700">
                ⚠️ {t.uwagi}
              </div>
            )}
          </div>
        ))}
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
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase.from("senior_vitals").insert({
        visit_id: visitId,
        senior_id: seniorId,
        created_by: user.user?.id,
        cisnienie_skurczowe: vitals.cisnienie_skurczowe ? Number(vitals.cisnienie_skurczowe) : null,
        cisnienie_rozkurczowe: vitals.cisnienie_rozkurczowe ? Number(vitals.cisnienie_rozkurczowe) : null,
        puls: vitals.puls ? Number(vitals.puls) : null,
        temperatura: vitals.temperatura ? Number(vitals.temperatura) : null,
        saturacja: vitals.saturacja ? Number(vitals.saturacja) : null,
        waga: vitals.waga ? Number(vitals.waga) : null,
        poziom_cukru: vitals.poziom_cukru ? Number(vitals.poziom_cukru) : null,
        uwagi: vitals.uwagi || null,
      });
      if (error) throw error;
      setSaved(true);
      toast.success("Parametry zapisane");
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
    await supabase.from("visits").update({ notes: val }).eq("id", visitId);
    setSaving(false);
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
