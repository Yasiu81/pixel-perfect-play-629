import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  LogOut, Phone, MapPin, FileText, Loader2, MessageSquarePlus,
  CheckCircle2, ChevronLeft, ChevronRight,
} from "lucide-react";

export const Route = createFileRoute("/strefa/pulpit")({
  ssr: false,
  component: StrefaPulpit,
});

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

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

function StrefaPulpit() {
  const navigate = useNavigate();
  const [authChecked, setAuthChecked] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        navigate({ to: "/strefa/logowanie" });
        return;
      }
      // Sprawdź rolę family
      supabase.from("user_roles").select("role").eq("user_id", data.user.id).then(({ data: roles }) => {
        const hasFamily = (roles ?? []).some((r) => r.role === "family");
        if (!hasFamily) {
          supabase.auth.signOut().then(() => navigate({ to: "/strefa/logowanie" }));
          return;
        }
        setUserId(data.user.id);
        setAuthChecked(true);
      });
    });
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/strefa/logowanie" });
  };

  const { data: access } = useQuery({
    queryKey: ["family-access", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("family_access")
        .select("senior_id, relacja, dostep_finansowy, dostep_opiekunczy")
        .eq("user_id", userId!);
      return (data ?? []) as unknown as {
        senior_id: string; relacja: string | null;
        dostep_finansowy: boolean; dostep_opiekunczy: boolean;
      }[];
    },
  });

  const seniorIds = (access ?? []).map((a) => a.senior_id);

  const { data: seniors } = useQuery({
    queryKey: ["family-seniors", seniorIds.join(",")],
    enabled: seniorIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("seniors")
        .select("id, imie, nazwisko, adres, telefon, status, godziny_min, godziny_max, typ_finansowania, decyzja_od, decyzja_do")
        .in("id", seniorIds);
      return data ?? [];
    },
  });

  const [selectedSeniorId, setSelectedSeniorId] = useState<string | null>(null);
  const senior = seniors?.find((s) => s.id === selectedSeniorId) ?? seniors?.[0] ?? null;
  const relacja = access?.find((a) => a.senior_id === senior?.id)?.relacja;
  const myAccess = access?.find((a) => a.senior_id === senior?.id);
  const dostepFinansowy = myAccess?.dostep_finansowy ?? true;
  const dostepOpiekunczy = myAccess?.dostep_opiekunczy ?? true;

  const { data: visits } = useQuery({
    queryKey: ["family-visits", senior?.id],
    enabled: !!senior,
    queryFn: async () => {
      const { data } = await supabase
        .from("visits")
        .select(`id, planned_start, planned_end, actual_start, actual_end,
                 status, hours_billed, notes, caregiver_id,
                 tasks:visit_tasks(task_name, completed)`)
        .eq("senior_id", senior!.id)
        .order("planned_start", { ascending: false })
        .limit(60);
      return (data ?? []) as any[];
    },
  });

  const { data: caregivers } = useQuery({
    queryKey: ["caregivers-names"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, imie, nazwisko");
      return data ?? [];
    },
  });
  const cgMap = Object.fromEntries((caregivers ?? []).map((c) => [c.id, `${c.imie} ${c.nazwisko}`]));

  const now = new Date();

  const thisMonthStats = useMemo(() => {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();
    const thisMonth = (visits ?? []).filter((v) => {
      const t = new Date(v.planned_start).getTime();
      return t >= monthStart && t <= monthEnd;
    });
    return {
      completed: thisMonth.filter((v) => v.status === "completed").length,
      hours: thisMonth.filter((v) => v.status === "completed")
        .reduce((s: number, v: any) => s + (v.hours_billed ?? 0), 0),
    };
  }, [visits]);

  const nextVisit = useMemo(() => {
    return (visits ?? [])
      .filter((v) => v.status === "planned" && new Date(v.planned_start) > now)
      .sort((a: any, b: any) => new Date(a.planned_start).getTime() - new Date(b.planned_start).getTime())[0];
  }, [visits]);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0F6E56] border-t-transparent" />
      </div>
    );
  }

  if (!senior) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-sm text-center space-y-4">
          <div className="text-4xl">🔒</div>
          <h2 className="text-lg font-semibold">Brak dostępu</h2>
          <p className="text-sm text-gray-500">Twoje konto nie jest przypisane do żadnego seniora. Skontaktuj się z koordynatorem.</p>
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
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0F6E56] text-white text-sm font-bold">PS</div>
            <div>
              <div className="text-sm font-semibold text-gray-900">Strefa Klienta</div>
              <div className="text-xs text-gray-400">Plan Seniora</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {seniors && seniors.length > 1 && (
              <select
                className="text-xs border rounded-lg px-2 py-1.5 bg-white"
                value={senior.id}
                onChange={(e) => setSelectedSeniorId(e.target.value)}
              >
                {seniors.map((s: any) => (
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
                <MapPin className="h-3.5 w-3.5 flex-shrink-0" />{senior.adres}
              </div>
              {senior.telefon && (
                <a href={`tel:${senior.telefon}`} className="mt-1 flex items-center gap-1 text-sm text-white/80 hover:text-white">
                  <Phone className="h-3.5 w-3.5" />{senior.telefon}
                </a>
              )}
            </div>
            {dostepFinansowy && (
              <Badge className="bg-white/20 text-white border-0 text-xs flex-shrink-0">
                {FIN_LABEL[senior.typ_finansowania ?? ""] ?? "—"}
              </Badge>
            )}
          </div>
          <div className={`mt-4 grid gap-3 ${dostepFinansowy ? "grid-cols-3" : "grid-cols-2"}`}>
            <div className="rounded-xl bg-white/15 px-3 py-2 text-center">
              <div className="text-xl font-bold">{thisMonthStats.completed}</div>
              <div className="text-xs text-white/70">wizyt w mies.</div>
            </div>
            <div className="rounded-xl bg-white/15 px-3 py-2 text-center">
              <div className="text-xl font-bold">{thisMonthStats.hours}h</div>
              <div className="text-xs text-white/70">godzin opieki</div>
            </div>
            {dostepFinansowy && (
              <div className="rounded-xl bg-white/15 px-3 py-2 text-center">
                <div className="text-xl font-bold">{senior.godziny_max ?? "—"}</div>
                <div className="text-xs text-white/70">limit godz./mies.</div>
              </div>
            )}
          </div>
        </div>

        {/* Zgłoś zapotrzebowanie / zmianę terminu */}
        <RequestServiceButton seniorId={senior.id} userId={userId!} />

        {/* Najbliższa wizyta */}
        {nextVisit && (
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Najbliższa wizyta</div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-gray-900">
                  {new Date(nextVisit.planned_start).toLocaleDateString("pl-PL", {
                    weekday: "long", day: "numeric", month: "long"
                  })}
                </div>
                <div className="text-sm text-gray-500 mt-0.5">
                  {fmtTime(nextVisit.planned_start)} – {fmtTime(nextVisit.planned_end)}
                  {nextVisit.caregiver_id && cgMap[nextVisit.caregiver_id] && ` · ${cgMap[nextVisit.caregiver_id]}`}
                </div>
              </div>
              <Badge variant="secondary" className={STATUS_TONE[nextVisit.status]}>
                {STATUS_LABEL[nextVisit.status]}
              </Badge>
            </div>
          </div>
        )}

        {/* Zakładki */}
        <Tabs defaultValue={dostepOpiekunczy ? "wizyty" : "dokumenty"}>
          <TabsList className="w-full">
            {dostepOpiekunczy && <TabsTrigger value="wizyty" className="flex-1">📅 Wizyty</TabsTrigger>}
            {dostepOpiekunczy && <TabsTrigger value="raporty" className="flex-1">📝 Raporty</TabsTrigger>}
            {dostepFinansowy && <TabsTrigger value="dokumenty" className="flex-1">📁 Dokumenty</TabsTrigger>}
          </TabsList>

          {dostepOpiekunczy && (
            <TabsContent value="wizyty" className="mt-4">
              <FamilyKalendarz visits={visits ?? []} cgMap={cgMap} />
            </TabsContent>
          )}
          {dostepOpiekunczy && (
            <TabsContent value="raporty" className="mt-4">
              <FamilyRaporty visits={(visits ?? []).filter((v: any) => v.status === "completed")} cgMap={cgMap} />
            </TabsContent>
          )}
          {dostepFinansowy && (
            <TabsContent value="dokumenty" className="mt-4">
              <FamilyDokumenty seniorId={senior.id} userId={userId!} />
            </TabsContent>
          )}
        </Tabs>

        {!dostepOpiekunczy && !dostepFinansowy && (
          <div className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-gray-400">
            Twoje konto nie ma jeszcze przydzielonych uprawnień do przeglądania danych. Skontaktuj się z koordynatorem.
          </div>
        )}
      </main>
    </div>
  );
}

function FamilyKalendarz({ visits, cgMap }: { visits: any[]; cgMap: Record<string, string> }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const monthVisits = visits.filter((v) => {
    const d = new Date(v.planned_start);
    return d.getFullYear() === viewYear && d.getMonth() === viewMonth;
  });

  const visitsByDay: Record<number, any[]> = {};
  monthVisits.forEach((v) => {
    const d = new Date(v.planned_start).getDate();
    if (!visitsByDay[d]) visitsByDay[d] = [];
    visitsByDay[d].push(v);
  });

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const firstMonday = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const DAYS = ["Pon","Wt","Śr","Czw","Pt","Sob","Nd"];

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y-1); setViewMonth(11); } else setViewMonth(m => m-1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y+1); setViewMonth(0); } else setViewMonth(m => m+1); };

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
          {DAYS.map(d => <div key={d} className="py-2 text-center text-xs font-medium text-gray-400">{d}</div>)}
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
                <div className={`mb-1 h-5 w-5 flex items-center justify-center rounded-full text-xs ${isToday ? "bg-[#0F6E56] text-white font-bold" : "text-gray-700"}`}>{day}</div>
                {dayVisits.map((v: any) => (
                  <div key={v.id} className={`rounded px-1 py-0.5 text-xs truncate mb-0.5 ${STATUS_TONE[v.status] ?? "bg-gray-100"}`} title={fmtTime(v.planned_start)}>
                    {fmtTime(v.planned_start)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      {monthVisits.length === 0 && (
        <div className="rounded-2xl border border-dashed bg-white p-6 text-center text-sm text-gray-400">
          Brak wizyt w {MONTHS_PL[viewMonth].toLowerCase()} {viewYear}.
        </div>
      )}
      <div className="space-y-2">
        {monthVisits.map((v: any) => (
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
            <Badge variant="secondary" className={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function FamilyRaporty({ visits, cgMap }: { visits: any[]; cgMap: Record<string, string> }) {
  if (visits.length === 0) {
    return <div className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-gray-400">Brak zakończonych wizyt.</div>;
  }
  return (
    <div className="space-y-3">
      {visits.slice(0, 20).map((v: any) => {
        const completed = (v.tasks ?? []).filter((t: any) => t.completed);
        const start = v.actual_start || v.planned_start;
        const end = v.actual_end || v.planned_end;
        return (
          <div key={v.id} className="rounded-2xl border bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between bg-gray-50 px-4 py-3 border-b">
              <div>
                <div className="text-sm font-semibold">
                  {new Date(start).toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" })}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {fmtTime(start)} – {fmtTime(end)}
                  {v.caregiver_id && cgMap[v.caregiver_id] && ` · ${cgMap[v.caregiver_id]}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {v.hours_billed != null && (
                  <span className="text-xs font-semibold text-[#0F6E56] bg-[#0F6E56]/10 px-2 py-0.5 rounded-full">{v.hours_billed} h</span>
                )}
                {v.actual_start && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              </div>
            </div>
            <div className="px-4 py-3 space-y-3">
              {(v.tasks ?? []).length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                    Czynności ({completed.length}/{v.tasks.length} wykonanych)
                  </div>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {v.tasks.map((t: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <div className={`h-4 w-4 rounded-sm flex-shrink-0 flex items-center justify-center ${t.completed ? "bg-emerald-500 text-white" : "border border-gray-300"}`}>
                          {t.completed && <span className="text-xs leading-none">✓</span>}
                        </div>
                        <span className={t.completed ? "text-gray-900" : "text-gray-400 line-through"}>{t.task_name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {v.notes && (
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Notatka opiekuna</div>
                  <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700 whitespace-pre-wrap">{v.notes}</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FamilyDokumenty({ seniorId, userId }: { seniorId: string; userId: string }) {
  const { data: docs, isLoading } = useQuery({
    queryKey: ["family-documents", seniorId],
    queryFn: async () => {
      const { data } = await supabase
        .from("senior_documents")
        .select("id, name, file_path, file_type, created_at")
        .eq("senior_id", seniorId)
        .order("created_at", { ascending: false });
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
    // Log dostępu (RODO / kontrola MOPS) — widoczny koordynatorowi w zakładce Rodzina
    supabase.from("audit_log").insert({
      user_id: userId,
      table_name: "senior_documents",
      record_id: null,
      operation: "READ_DOCUMENT",
      details: { senior_id: seniorId, name },
    } as never).then(({ error }) => {
      if (error) console.error("Nie udało się zapisać logu dostępu:", error);
    });
  };

  if (isLoading) return <Skeleton className="h-24 w-full rounded-2xl" />;
  if (!docs || docs.length === 0) {
    return <div className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-gray-400">Brak dokumentów.</div>;
  }

  return (
    <div className="rounded-2xl border bg-white shadow-sm divide-y overflow-hidden">
      {docs.map((doc: any) => (
        <div key={doc.id} className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0F6E56]/10 text-[#0F6E56] flex-shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{doc.name}</div>
              <div className="text-xs text-gray-400">{new Date(doc.created_at).toLocaleDateString("pl-PL")}</div>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => handleDownload(doc.file_path, doc.name)}>Pobierz</Button>
        </div>
      ))}
    </div>
  );
}

// ─── Zgłoś zapotrzebowanie / zmianę terminu ─────────────────────────────────

const REQUEST_TYPE_PRESETS = ["Usługa złotej rączki", "Transport medyczny", "Zmiana terminu wizyty", "Inne"];

function RequestServiceButton({ seniorId, userId }: { seniorId: string; userId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [orderType, setOrderType] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      if (!orderType || !date) throw new Error("Wybierz rodzaj zgłoszenia i preferowaną datę.");
      const { error } = await supabase.from("additional_orders").insert({
        senior_id: seniorId,
        order_type: orderType,
        scheduled_date: date,
        notes: notes || null,
        status: "do_akceptacji",
        requested_by: userId,
        requested_by_family: true,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Zgłoszenie wysłane do koordynatora — otrzymasz informację po akceptacji.");
      qc.invalidateQueries({ queryKey: ["family-requests", seniorId] });
      setOpen(false);
      setOrderType(""); setDate(""); setNotes("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full justify-center gap-2 border-[#0F6E56] text-[#0F6E56] hover:bg-[#0F6E56]/5">
          <MessageSquarePlus className="h-4 w-4" />
          Zgłoś zapotrzebowanie / zmianę terminu
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Zgłoś zapotrzebowanie</DialogTitle>
          <DialogDescription>
            Prośba trafi do koordynatora jako zlecenie do akceptacji — nie musisz dzwonić.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Czego dotyczy?</label>
            <Select value={orderType} onValueChange={setOrderType}>
              <SelectTrigger><SelectValue placeholder="Wybierz" /></SelectTrigger>
              <SelectContent>
                {REQUEST_TYPE_PRESETS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Preferowana data</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Dodatkowe informacje</label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="np. godzina, szczegóły prośby..." />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={mut.isPending}>Anuluj</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Wyślij zgłoszenie
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
