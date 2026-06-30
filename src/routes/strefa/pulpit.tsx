import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LogOut, Phone, MapPin, Clock, CheckCircle2,
  AlertTriangle, FileText, Calendar, ChevronLeft, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/strefa/pulpit")({
  ssr: false,
  component: StrefaPulpit,
});

// ─── Typy ────────────────────────────────────────────────────────────────────

type Senior = {
  id: string;
  imie: string;
  nazwisko: string;
  adres: string;
  telefon: string | null;
  status: string;
  godziny_min: number | null;
  godziny_max: number | null;
  typ_finansowania: string | null;
  decyzja_od: string | null;
  decyzja_do: string | null;
};

type Visit = {
  id: string;
  planned_start: string;
  planned_end: string;
  actual_start: string | null;
  actual_end: string | null;
  status: string;
  hours_billed: number | null;
  notes: string | null;
  caregiver_id: string | null;
  tasks: { task_name: string; completed: boolean }[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, string> = {
  planned: "bg-sky-500/15 text-sky-700",
  active: "bg-amber-500/15 text-amber-700",
  completed: "bg-emerald-500/15 text-emerald-700",
  alert: "bg-red-500/15 text-red-700",
  requires_verification: "bg-amber-500/15 text-amber-700",
};
const STATUS_LABEL: Record<string, string> = {
  planned: "Zaplanowana", active: "W trakcie", completed: "Zakończona",
  alert: "Alarm", requires_verification: "Do weryfikacji",
};
const FIN_LABEL: Record<string, string> = {
  bon_senioralny: "Bon Senioralny", prywatny: "Prywatny", mieszany: "Mieszany",
};
const MONTHS_PL = ["Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec",
  "Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień"];

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pl-PL");
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

// ─── Główny komponent ─────────────────────────────────────────────────────────

function StrefaPulpit() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/strefa/logowanie" });
  };

  // Pobierz seniora powiązanego z zalogowanym użytkownikiem
  const { data: user } = useQuery({
    queryKey: ["family-user"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    },
  });

  const { data: access } = useQuery({
    queryKey: ["family-access", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("family_access")
        .select("senior_id, relacja")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const seniorIds = (access ?? []).map((a) => a.senior_id);

  const { data: seniors, isLoading: seniorsLoading } = useQuery({
    queryKey: ["family-seniors", seniorIds],
    enabled: seniorIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seniors")
        .select("id, imie, nazwisko, adres, telefon, status, godziny_min, godziny_max, typ_finansowania, decyzja_od, decyzja_do")
        .in("id", seniorIds);
      if (error) throw error;
      return (data ?? []) as Senior[];
    },
  });

  const [selectedSeniorId, setSelectedSeniorId] = useState<string | null>(null);
  const senior = seniors?.find((s) => s.id === selectedSeniorId) ?? seniors?.[0] ?? null;

  const relacja = access?.find((a) => a.senior_id === senior?.id)?.relacja;

  // Wizyty seniora
  const { data: visits } = useQuery({
    queryKey: ["family-visits", senior?.id],
    enabled: !!senior,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(`id, planned_start, planned_end, actual_start, actual_end,
                 status, hours_billed, notes, caregiver_id,
                 tasks:visit_tasks(task_name, completed)`)
        .eq("senior_id", senior!.id)
        .order("planned_start", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as unknown as Visit[];
    },
  });

  // Opiekunowie
  const { data: caregivers } = useQuery({
    queryKey: ["caregivers-names"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, imie, nazwisko");
      return data ?? [];
    },
  });
  const cgMap = Object.fromEntries((caregivers ?? []).map((c) => [c.id, `${c.imie} ${c.nazwisko}`]));

  // Statystyki bieżącego miesiąca
  const now = new Date();
  const thisMonthStats = useMemo(() => {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();
    const thisMonth = (visits ?? []).filter((v) => {
      const t = new Date(v.planned_start).getTime();
      return t >= monthStart && t <= monthEnd;
    });
    return {
      total: thisMonth.length,
      completed: thisMonth.filter((v) => v.status === "completed").length,
      hours: thisMonth.filter((v) => v.status === "completed")
        .reduce((s, v) => s + (v.hours_billed ?? 0), 0),
    };
  }, [visits, now]);

  // Najbliższa wizyta
  const nextVisit = useMemo(() => {
    return (visits ?? [])
      .filter((v) => v.status === "planned" && new Date(v.planned_start) > now)
      .sort((a, b) => new Date(a.planned_start).getTime() - new Date(b.planned_start).getTime())[0];
  }, [visits]);

  if (seniorsLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="space-y-2 text-center text-sm text-gray-400">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#0F6E56] border-t-transparent" />
          Ładowanie danych...
        </div>
      </div>
    );
  }

  if (!senior) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-sm text-center space-y-4">
          <div className="text-4xl">🔒</div>
          <h2 className="text-lg font-semibold">Brak dostępu</h2>
          <p className="text-sm text-gray-500">
            Twoje konto nie jest przypisane do żadnego seniora.
            Skontaktuj się z koordynatorem Plan Seniora.
          </p>
          <Button variant="outline" onClick={handleLogout}>Wyloguj</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b bg-white shadow-sm">
        <div className="mx-auto max-w-3xl flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0F6E56] text-white text-sm font-bold">
              PS
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900">Strefa Klienta</div>
              <div className="text-xs text-gray-400">Plan Seniora</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Przełącznik seniorów jeśli rodzina ma więcej */}
            {seniors && seniors.length > 1 && (
              <select
                className="text-xs border rounded-lg px-2 py-1.5 bg-white"
                value={senior.id}
                onChange={(e) => setSelectedSeniorId(e.target.value)}
              >
                {seniors.map((s) => (
                  <option key={s.id} value={s.id}>{s.imie} {s.nazwisko}</option>
                ))}
              </select>
            )}
            <Button size="sm" variant="ghost" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        {/* Karta seniora */}
        <div className="rounded-2xl bg-[#0F6E56] p-5 text-white shadow-md">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-white/70 mb-1">
                {relacja ? `Twój/a ${relacja}` : "Podopieczny"}
              </div>
              <h2 className="text-2xl font-bold">{senior.imie} {senior.nazwisko}</h2>
              <div className="mt-2 flex items-center gap-1 text-sm text-white/80">
                <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                {senior.adres}
              </div>
              {senior.telefon && (
                <a href={`tel:${senior.telefon}`} className="mt-1 flex items-center gap-1 text-sm text-white/80 hover:text-white">
                  <Phone className="h-3.5 w-3.5" />{senior.telefon}
                </a>
              )}
            </div>
            <Badge className="bg-white/20 text-white border-0 text-xs flex-shrink-0">
              {FIN_LABEL[senior.typ_finansowania ?? ""] ?? "—"}
            </Badge>
          </div>

          {/* Mini statystyki */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-white/15 px-3 py-2 text-center">
              <div className="text-xl font-bold">{thisMonthStats.completed}</div>
              <div className="text-xs text-white/70">wizyt w tym mies.</div>
            </div>
            <div className="rounded-xl bg-white/15 px-3 py-2 text-center">
              <div className="text-xl font-bold">{thisMonthStats.hours}h</div>
              <div className="text-xs text-white/70">godzin opieki</div>
            </div>
            <div className="rounded-xl bg-white/15 px-3 py-2 text-center">
              <div className="text-xl font-bold">{senior.godziny_max ?? "—"}</div>
              <div className="text-xs text-white/70">godz./mies. limit</div>
            </div>
          </div>
        </div>

        {/* Najbliższa wizyta */}
        {nextVisit && (
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
              Najbliższa wizyta
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-gray-900">
                  {new Date(nextVisit.planned_start).toLocaleDateString("pl-PL", {
                    weekday: "long", day: "numeric", month: "long"
                  })}
                </div>
                <div className="text-sm text-gray-500 mt-0.5">
                  {fmtTime(nextVisit.planned_start)} – {fmtTime(nextVisit.planned_end)}
                  {nextVisit.caregiver_id && cgMap[nextVisit.caregiver_id] &&
                    ` · ${cgMap[nextVisit.caregiver_id]}`}
                </div>
              </div>
              <Badge variant="secondary" className={STATUS_TONE[nextVisit.status]}>
                {STATUS_LABEL[nextVisit.status]}
              </Badge>
            </div>
          </div>
        )}

        {/* Zakładki */}
        <Tabs defaultValue="wizyty">
          <TabsList className="w-full">
            <TabsTrigger value="wizyty" className="flex-1">📅 Wizyty</TabsTrigger>
            <TabsTrigger value="raporty" className="flex-1">📝 Raporty</TabsTrigger>
            <TabsTrigger value="dokumenty" className="flex-1">📁 Dokumenty</TabsTrigger>
          </TabsList>

          {/* WIZYTY — kalendarz miesięczny */}
          <TabsContent value="wizyty" className="mt-4">
            <FamilyKalendarz visits={visits ?? []} cgMap={cgMap} />
          </TabsContent>

          {/* RAPORTY — notatki z wizyt */}
          <TabsContent value="raporty" className="mt-4">
            <FamilyRaporty visits={(visits ?? []).filter(v => v.status === "completed")} cgMap={cgMap} />
          </TabsContent>

          {/* DOKUMENTY */}
          <TabsContent value="dokumenty" className="mt-4">
            <FamilyDokumenty seniorId={senior.id} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ─── Zakładka: Wizyty (kalendarz) ────────────────────────────────────────────

function FamilyKalendarz({ visits, cgMap }: { visits: Visit[]; cgMap: Record<string, string> }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const monthVisits = useMemo(() => {
    return visits.filter((v) => {
      const d = new Date(v.planned_start);
      return d.getFullYear() === viewYear && d.getMonth() === viewMonth;
    });
  }, [visits, viewYear, viewMonth]);

  const visitsByDay: Record<number, Visit[]> = {};
  monthVisits.forEach((v) => {
    const d = new Date(v.planned_start).getDate();
    if (!visitsByDay[d]) visitsByDay[d] = [];
    visitsByDay[d].push(v);
  });

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const firstMonday = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const DAYS = ["Pon","Wt","Śr","Czw","Pt","Sob","Nd"];

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{MONTHS_PL[viewMonth]} {viewYear}</h3>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="rounded-2xl border bg-white overflow-hidden shadow-sm">
        <div className="grid grid-cols-7 border-b">
          {DAYS.map(d => (
            <div key={d} className="py-2 text-center text-xs font-medium text-gray-400">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: firstMonday }).map((_, i) => (
            <div key={`e-${i}`} className="min-h-[60px] border-b border-r bg-gray-50/50" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dayVisits = visitsByDay[day] ?? [];
            const isToday = day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
            const col = (firstMonday + i) % 7;
            return (
              <div key={day} className={`min-h-[60px] border-b border-r p-1 ${col >= 5 ? "bg-gray-50/50" : ""}`}>
                <div className={`mb-1 h-5 w-5 flex items-center justify-center rounded-full text-xs ${isToday ? "bg-[#0F6E56] text-white font-bold" : "text-gray-700"}`}>
                  {day}
                </div>
                {dayVisits.map((v) => (
                  <div
                    key={v.id}
                    className={`rounded px-1 py-0.5 text-xs truncate mb-0.5 ${STATUS_TONE[v.status] ?? "bg-gray-100 text-gray-600"}`}
                    title={`${fmtTime(v.planned_start)}${v.caregiver_id && cgMap[v.caregiver_id] ? ` · ${cgMap[v.caregiver_id]}` : ""}`}
                  >
                    {fmtTime(v.planned_start)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Lista wizyt miesiąca */}
      {monthVisits.length > 0 && (
        <div className="space-y-2">
          {monthVisits.map((v) => (
            <div key={v.id} className="flex items-center justify-between rounded-xl border bg-white px-4 py-3 shadow-sm">
              <div>
                <div className="text-sm font-medium">
                  {new Date(v.planned_start).toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "short" })}
                  {" · "}{fmtTime(v.planned_start)} – {fmtTime(v.planned_end)}
                </div>
                {v.caregiver_id && cgMap[v.caregiver_id] && (
                  <div className="text-xs text-gray-400 mt-0.5">{cgMap[v.caregiver_id]}</div>
                )}
              </div>
              <Badge variant="secondary" className={STATUS_TONE[v.status]}>
                {STATUS_LABEL[v.status]}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {monthVisits.length === 0 && (
        <div className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-gray-400">
          Brak wizyt w {MONTHS_PL[viewMonth].toLowerCase()} {viewYear}.
        </div>
      )}
    </div>
  );
}

// ─── Zakładka: Raporty ────────────────────────────────────────────────────────

function FamilyRaporty({ visits, cgMap }: { visits: Visit[]; cgMap: Record<string, string> }) {
  if (visits.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-gray-400">
        Brak zakończonych wizyt.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visits.slice(0, 20).map((v) => {
        const completed = v.tasks.filter((t) => t.completed);
        const start = v.actual_start || v.planned_start;
        const end = v.actual_end || v.planned_end;

        return (
          <div key={v.id} className="rounded-2xl border bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between bg-gray-50 px-4 py-3 border-b">
              <div>
                <div className="text-sm font-semibold text-gray-900">
                  {new Date(start).toLocaleDateString("pl-PL", {
                    weekday: "long", day: "numeric", month: "long"
                  })}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {fmtTime(start)} – {fmtTime(end)}
                  {v.caregiver_id && cgMap[v.caregiver_id] && ` · ${cgMap[v.caregiver_id]}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {v.hours_billed != null && (
                  <span className="text-xs font-semibold text-[#0F6E56] bg-[#0F6E56]/10 px-2 py-0.5 rounded-full">
                    {v.hours_billed} h
                  </span>
                )}
                {v.actual_start && (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" title="Potwierdzone NFC" />
                )}
              </div>
            </div>

            <div className="px-4 py-3 space-y-3">
              {v.tasks.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                    Wykonane czynności ({completed.length}/{v.tasks.length})
                  </div>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {v.tasks.map((t, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <div className={`h-4 w-4 rounded-sm flex-shrink-0 flex items-center justify-center ${t.completed ? "bg-emerald-500 text-white" : "border border-gray-300"}`}>
                          {t.completed && <span className="text-xs leading-none">✓</span>}
                        </div>
                        <span className={t.completed ? "text-gray-900" : "text-gray-400 line-through"}>
                          {t.task_name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {v.notes && (
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                    Notatka opiekuna
                  </div>
                  <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700 whitespace-pre-wrap">
                    {v.notes}
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Zakładka: Dokumenty ─────────────────────────────────────────────────────

function FamilyDokumenty({ seniorId }: { seniorId: string }) {
  const { data: docs, isLoading } = useQuery({
    queryKey: ["family-documents", seniorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("senior_documents")
        .select("id, name, file_path, file_type, created_at")
        .eq("senior_id", seniorId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleDownload = async (path: string, name: string) => {
    const { data } = await supabase.storage.from("documents").createSignedUrl(path, 60);
    if (data?.signedUrl) {
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = name;
      a.click();
    }
  };

  if (isLoading) return <Skeleton className="h-24 w-full rounded-2xl" />;

  if (!docs || docs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-gray-400">
        Brak dokumentów do pobrania.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-white shadow-sm divide-y overflow-hidden">
      {docs.map((doc) => (
        <div key={doc.id} className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0F6E56]/10 text-[#0F6E56] flex-shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-gray-900">{doc.name}</div>
              <div className="text-xs text-gray-400">
                {new Date(doc.created_at).toLocaleDateString("pl-PL")}
              </div>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => handleDownload(doc.file_path, doc.name)}>
            Pobierz
          </Button>
        </div>
      ))}
    </div>
  );
}
