import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CalendarCheck, Clock, Users,
  ChevronLeft, ChevronRight, Plus, Printer,
  CalendarDays, LayoutGrid, AlignJustify,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField,
  FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_coordinator/pulpit")({
  component: PulpitPage,
});

// ─── Typy ─────────────────────────────────────────────────────────────────────
type VisitStatus = "planned" | "active" | "completed" | "alert" | "requires_verification";

type Visit = {
  id: string;
  planned_start: string;
  planned_end: string;
  status: VisitStatus;
  hours_billed: number | null;
  caregiver_id: string | null;
  senior_id: string;
  senior: { imie: string; nazwisko: string } | null;
};

type Senior = { id: string; imie: string; nazwisko: string };
type Caregiver = { id: string; imie: string; nazwisko: string };

// ─── Stałe ───────────────────────────────────────────────────────────────────
const MONTHS = ["Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec",
  "Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień"];
const DAYS_SHORT = ["Pon","Wt","Śr","Czw","Pt","Sob","Nd"];
const HOURS = Array.from({ length: 15 }, (_, i) => i + 6); // 6:00–20:00

const VISIT_TONE: Record<string, string> = {
  planned:               "bg-sky-100 text-sky-800 border-sky-300",
  active:                "bg-amber-100 text-amber-800 border-amber-300",
  completed:             "bg-emerald-100 text-emerald-800 border-emerald-300",
  alert:                 "bg-red-100 text-red-800 border-red-300",
  requires_verification: "bg-orange-100 text-orange-800 border-orange-300",
};

const STATUS_LABEL: Record<string, string> = {
  planned: "Zaplanowana", active: "W trakcie", completed: "Zakończona",
  alert: "Alarm", requires_verification: "Do weryfikacji",
};

const NO_FILTER = "__all__";
const NO_CAREGIVER = "__none__";

// ─── Schema formularza wizyty ─────────────────────────────────────────────────
const visitSchema = z.object({
  senior_id: z.string().min(1, "Wybierz seniora"),
  caregiver_id: z.string().optional(),
  planned_start: z.string().min(1, "Wymagane"),
  planned_end: z.string().min(1, "Wymagane"),
  notes: z.string().optional(),
  planned_tasks: z.array(z.object({
    task_name: z.string(),
    requires_response: z.boolean().default(false),
  })).default([]),
}).refine(d => new Date(d.planned_end) > new Date(d.planned_start), {
  path: ["planned_end"], message: "Koniec musi być po starcie",
});
type VisitForm = z.infer<typeof visitSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}
function getMonday(d: Date) {
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// ─── Główna strona ────────────────────────────────────────────────────────────
function PulpitPage() {
  const today = new Date();
  const [viewMode, setViewMode] = useState<"week" | "day" | "month">("week");
  const [weekStart, setWeekStart] = useState(() => getMonday(today));
  const [dayView, setDayView] = useState(today);
  const [monthView, setMonthView] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [filterSenior, setFilterSenior] = useState(NO_FILTER);
  const [filterCaregiver, setFilterCaregiver] = useState(NO_FILTER);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);
  const [defaultDate, setDefaultDate] = useState(today.toISOString().split("T")[0]);

  // Zakresy dat dla zapytań
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59);

  const dayStart = new Date(dayView);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayView);
  dayEnd.setHours(23, 59, 59);

  const monthStart = new Date(monthView.year, monthView.month, 1);
  const monthEnd = new Date(monthView.year, monthView.month + 1, 0, 23, 59, 59);

  const rangeStart = viewMode === "week" ? weekStart : viewMode === "day" ? dayStart : monthStart;
  const rangeEnd   = viewMode === "week" ? weekEnd   : viewMode === "day" ? dayEnd   : monthEnd;

  // KPI
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const now = new Date();
      const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const eod = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
      const som = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const eom = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

      const [seniorsR, visitsTodayR, hoursR, alertsR] = await Promise.all([
        supabase.from("seniors").select("id", { count: "exact", head: true }).eq("status", "aktywny"),
        supabase.from("visits").select("status").gte("planned_start", sod).lt("planned_start", eod),
        supabase.from("visits").select("hours_billed").eq("status", "completed").gte("actual_end", som).lt("actual_end", eom),
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("resolved", false),
      ]);

      const byStatus: Record<string, number> = { planned:0,active:0,completed:0,alert:0,requires_verification:0 };
      for (const v of visitsTodayR.data ?? []) byStatus[v.status] = (byStatus[v.status] ?? 0) + 1;
      const hours = (hoursR.data ?? []).reduce((s, v) => s + Number(v.hours_billed ?? 0), 0);

      // Alerty ze szczegółami
      const { data: alertDetails } = await supabase
        .from("alerts")
        .select("type, description, senior_id, seniors(imie, nazwisko)")
        .eq("resolved", false)
        .limit(3);

      return {
        activeSeniors: seniorsR.count ?? 0,
        visitsToday: { total: visitsTodayR.data?.length ?? 0, byStatus },
        hoursThisMonth: hours,
        activeAlerts: alertsR.count ?? 0,
        alertDetails: alertDetails ?? [],
      };
    },
    refetchInterval: 60_000,
  });

  // Wizyty dla kalendarza
  const { data: visits } = useQuery({
    queryKey: ["pulpit-visits", rangeStart.toISOString(), rangeEnd.toISOString()],
    queryFn: async () => {
      const { data } = await supabase
        .from("visits")
        .select("id, planned_start, planned_end, status, hours_billed, caregiver_id, senior_id, senior:seniors(imie, nazwisko)")
        .gte("planned_start", rangeStart.toISOString())
        .lte("planned_start", rangeEnd.toISOString())
        .order("planned_start");
      return (data ?? []) as unknown as Visit[];
    },
    refetchInterval: 30_000,
  });

  const { data: seniors } = useQuery({
    queryKey: ["seniors-cal"],
    queryFn: async () => {
      const { data } = await supabase.from("seniors").select("id, imie, nazwisko").order("nazwisko");
      return (data ?? []) as Senior[];
    },
  });

  const { data: caregivers } = useQuery({
    queryKey: ["caregivers-cal"],
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "caregiver");
      const ids = (roles ?? []).map(r => r.user_id);
      if (!ids.length) return [];
      const { data } = await supabase.from("profiles").select("id, imie, nazwisko").in("id", ids).order("nazwisko");
      return (data ?? []) as Caregiver[];
    },
  });

  const cgMap = useMemo(() =>
    Object.fromEntries((caregivers ?? []).map(c => [c.id, `${c.imie} ${c.nazwisko}`])),
    [caregivers]);

  // Filtrowanie
  const filteredVisits = useMemo(() =>
    (visits ?? []).filter(v => {
      if (filterSenior !== NO_FILTER && v.senior_id !== filterSenior) return false;
      if (filterCaregiver !== NO_FILTER && v.caregiver_id !== filterCaregiver) return false;
      return true;
    }), [visits, filterSenior, filterCaregiver]);

  // Nawigacja
  const prevPeriod = () => {
    if (viewMode === "week") { const d = new Date(weekStart); d.setDate(d.getDate()-7); setWeekStart(d); }
    else if (viewMode === "day") { const d = new Date(dayView); d.setDate(d.getDate()-1); setDayView(d); }
    else setMonthView(m => m.month === 0 ? {year:m.year-1,month:11} : {year:m.year,month:m.month-1});
  };
  const nextPeriod = () => {
    if (viewMode === "week") { const d = new Date(weekStart); d.setDate(d.getDate()+7); setWeekStart(d); }
    else if (viewMode === "day") { const d = new Date(dayView); d.setDate(d.getDate()+1); setDayView(d); }
    else setMonthView(m => m.month === 11 ? {year:m.year+1,month:0} : {year:m.year,month:m.month+1});
  };
  const goToday = () => {
    setWeekStart(getMonday(today));
    setDayView(new Date(today));
    setMonthView({ year: today.getFullYear(), month: today.getMonth() });
  };

  const periodLabel = viewMode === "week"
    ? `${weekStart.toLocaleDateString("pl-PL",{day:"numeric",month:"short"})} – ${weekEnd.toLocaleDateString("pl-PL",{day:"numeric",month:"short",year:"numeric"})}`
    : viewMode === "day"
    ? dayView.toLocaleDateString("pl-PL",{weekday:"long",day:"numeric",month:"long",year:"numeric"})
    : `${MONTHS[monthView.month]} ${monthView.year}`;

  return (
    <div className="space-y-6">
      {/* Nagłówek — ukrywany na wydruku */}
      <div data-print-hide>
        <h1 className="text-2xl font-semibold tracking-tight">Pulpit</h1>
        <p className="text-sm text-muted-foreground">Przegląd działalności firmy w czasie rzeczywistym.</p>
      </div>

      {/* KPI — ukrywane na wydruku przez [data-print-hide] */}
      <div data-print-hide className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard to="/seniorzy" label="Aktywni seniorzy" value={stats?.activeSeniors}
          loading={statsLoading} icon={<Users className="h-5 w-5"/>} tone="primary"
          hint="Podopieczni o statusie aktywny" />
        <KpiCard to="/wizyty" label="Wizyty dziś" value={stats?.visitsToday.total}
          loading={statsLoading} icon={<CalendarCheck className="h-5 w-5"/>} tone="info"
          hint={stats ? `${stats.visitsToday.byStatus.completed} zrealizowane · ${stats.visitsToday.byStatus.active} w trakcie · ${stats.visitsToday.byStatus.planned} zaplanowane` : undefined} />
        <KpiCard to="/raporty" label="Godziny w tym miesiącu" value={stats?.hoursThisMonth}
          loading={statsLoading} icon={<Clock className="h-5 w-5"/>} tone="success"
          hint="Suma godzin ze zrealizowanych wizyt" />
        <KpiCard to="/wizyty" label="Aktywne alarmy" value={stats?.activeAlerts}
          loading={statsLoading} icon={<AlertTriangle className="h-5 w-5"/>}
          tone={stats && stats.activeAlerts > 0 ? "destructive" : "muted"}
          hint={stats?.alertDetails?.length
            ? stats.alertDetails.map((a: any) => `${(a.seniors as any)?.nazwisko ?? "?"}: ${a.description?.slice(0,40)}`).join(" | ")
            : "Kliknij, aby otworzyć monitor wizyt"} />
      </div>

      {/* Kalendarz */}
      <div className="rounded-xl border bg-card shadow-sm" data-print-area>
        {/* Nagłówek wydruku — widoczny tylko przy druku */}
        <div className="print-header hidden">
          <h1>
            {filterSenior !== NO_FILTER
              ? `Grafik wizyt — senior: ${seniors?.find(s => s.id === filterSenior)?.nazwisko} ${seniors?.find(s => s.id === filterSenior)?.imie}`
              : "Grafik wizyt"}
          </h1>
          <p className="print-header-line">
            <span>
              Okres: {periodLabel}
              {" · "}Widok: {viewMode === "week" ? "Tydzień" : viewMode === "day" ? "Dzień" : "Miesiąc"}
              {" · "}Wydrukowano: {new Date().toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" })} o godz. {new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="print-header-gap">
              Filtr — senior: {filterSenior !== NO_FILTER
                ? `${seniors?.find(s => s.id === filterSenior)?.nazwisko} ${seniors?.find(s => s.id === filterSenior)?.imie}`
                : "wszyscy seniorzy"}
              {" · "}Filtr — opiekun: {filterCaregiver !== NO_FILTER
                ? `${caregivers?.find(c => c.id === filterCaregiver)?.nazwisko} ${caregivers?.find(c => c.id === filterCaregiver)?.imie}`
                : "wszyscy opiekunowie"}
            </span>
          </p>
        </div>
        {/* Pasek kontrolny kalendarza — ukrywany na wydruku przez [data-print-hide] */}
        <div data-print-hide className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={prevPeriod}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={goToday}>Dziś</Button>
            <Button size="sm" variant="outline" onClick={nextPeriod}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="font-semibold text-sm ml-1">{periodLabel}</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Widok */}
            <div className="flex rounded-lg border overflow-hidden">
              {([["day","Dzień",AlignJustify],["week","Tydzień",CalendarDays],["month","Miesiąc",LayoutGrid]] as const).map(([mode, label, Icon]) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                    viewMode === mode ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />{label}
                </button>
              ))}
            </div>

            {/* Filtry */}
            <Select value={filterSenior} onValueChange={setFilterSenior}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue placeholder="Wszyscy seniorzy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_FILTER}>Wszyscy seniorzy</SelectItem>
                {(seniors ?? []).map(s => <SelectItem key={s.id} value={s.id}>{s.nazwisko} {s.imie}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filterCaregiver} onValueChange={setFilterCaregiver}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue placeholder="Wszyscy opiekunowie" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_FILTER}>Wszyscy opiekunowie</SelectItem>
                {(caregivers ?? []).map(c => <SelectItem key={c.id} value={c.id}>{c.nazwisko} {c.imie}</SelectItem>)}
              </SelectContent>
            </Select>

            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
            </Button>

            <Button size="sm" onClick={() => { setDefaultDate(today.toISOString().split("T")[0]); setAddOpen(true); }}>
              <Plus className="h-4 w-4" /> Zaplanuj usługę
            </Button>
          </div>
        </div>

        {/* Treść kalendarza */}
        <div className="overflow-hidden">
          {viewMode === "week" && (
            <WeekView
              weekStart={weekStart}
              visits={filteredVisits}
              cgMap={cgMap}
              today={today}
              onVisitClick={setSelectedVisit}
              onDayClick={(d) => {
                setDefaultDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
                setAddOpen(true);
              }}
            />
          )}
          {viewMode === "day" && (
            <DayView
              day={dayView}
              visits={filteredVisits}
              cgMap={cgMap}
              today={today}
              onVisitClick={setSelectedVisit}
            />
          )}
          {viewMode === "month" && (
            <MonthView
              year={monthView.year}
              month={monthView.month}
              visits={filteredVisits}
              cgMap={cgMap}
              today={today}
              onVisitClick={setSelectedVisit}
              onDayClick={(d) => {
                setDefaultDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
                setAddOpen(true);
              }}
            />
          )}
        </div>
      </div>

      {/* Dialog szczegółów wizyty */}
      {selectedVisit && (
        <VisitDetailDialog visit={selectedVisit} cgMap={cgMap} onClose={() => setSelectedVisit(null)} />
      )}

      {/* Dialog dodawania wizyty */}
      {addOpen && (
        <AddVisitDialog
          seniors={seniors ?? []}
          caregivers={caregivers ?? []}
          defaultDate={defaultDate}
          open={addOpen}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}

// ─── WIDOK TYGODNIOWY ─────────────────────────────────────────────────────────
function WeekView({ weekStart, visits, cgMap, today, onVisitClick, onDayClick, hourPx = 56 }: {
  weekStart: Date; visits: Visit[]; cgMap: Record<string,string>;
  today: Date; onVisitClick: (v: Visit) => void; onDayClick: (d: Date) => void; hourPx?: number;
}) {
  const days = Array.from({length:7}, (_,i) => {
    const d = new Date(weekStart); d.setDate(weekStart.getDate()+i); return d;
  });

  function topPct(iso: string) {
    const d = new Date(iso);
    const mins = (d.getHours()-6)*60 + d.getMinutes();
    return Math.max(0, (mins/(15*60))*100);
  }
  function heightPct(s: string, e: string) {
    const mins = (new Date(e).getTime()-new Date(s).getTime())/60000;
    return Math.max(3, (mins/(15*60))*100);
  }

  const visitsByDay: Record<number, Visit[]> = {};
  days.forEach((d,idx) => {
    visitsByDay[idx] = visits.filter(v =>
      new Date(v.planned_start).toDateString() === d.toDateString()
    );
  });

  const TOTAL_H = HOURS.length * hourPx;

  return (
    <div className="overflow-auto" style={{ maxHeight: "580px" }} data-print-zoom>
      <div className="grid" style={{ gridTemplateColumns: "52px repeat(7, 1fr)", minWidth: "700px" }}>
        {/* Nagłówki dni */}
        <div className="border-b bg-muted/20" />
        {days.map((d,idx) => {
          const isToday = d.toDateString() === today.toDateString();
          const isWeekend = idx >= 5;
          return (
            <div
              key={idx}
              className={`border-b border-l py-2 text-center cursor-pointer hover:bg-accent/30 transition-colors ${isWeekend ? "bg-muted/10" : ""}`}
              onClick={() => onDayClick(d)}
            >
              <div className={`text-xs font-medium ${isWeekend ? "text-muted-foreground" : "text-muted-foreground"}`}>
                {DAYS_SHORT[idx]}
              </div>
              <div className={`mx-auto mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                isToday ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}>
                {d.getDate()}
              </div>
            </div>
          );
        })}

        {/* Siatka godzinowa */}
        <div>
          {HOURS.map(h => (
            <div key={h} className="flex items-start justify-end pr-2 border-b" style={{height:`${hourPx}px`}}>
              <span className="text-xs text-muted-foreground mt-1">{String(h).padStart(2,"0")}:00</span>
            </div>
          ))}
        </div>

        {days.map((d, dayIdx) => {
          const dayVisits = visitsByDay[dayIdx] ?? [];
          const isToday = d.toDateString() === today.toDateString();
          const isWeekend = dayIdx >= 5;
          return (
            <div
              key={dayIdx}
              className={`relative border-l ${isWeekend ? "bg-muted/5" : ""} ${isToday ? "bg-primary/[0.02]" : ""}`}
              style={{ height: `${TOTAL_H}px` }}
            >
              {/* Linie godzinowe */}
              {HOURS.map((_,i) => (
                <div key={i} className="absolute w-full border-b border-border/30" style={{top:`${i*hourPx}px`}} />
              ))}
              {/* Linia "teraz" */}
              {isToday && (() => {
                const now = new Date();
                const mins = (now.getHours()-6)*60 + now.getMinutes();
                const top = (mins/(15*60))*100;
                if (top < 0 || top > 100) return null;
                return (
                  <div className="absolute w-full z-10 pointer-events-none" style={{top:`${(top/100)*TOTAL_H}px`}}>
                    <div className="flex items-center">
                      <div className="h-2.5 w-2.5 rounded-full bg-red-500 -ml-1.5 flex-shrink-0" />
                      <div className="flex-1 border-t-2 border-red-500" />
                    </div>
                  </div>
                );
              })()}
              {/* Wizyty */}
              {dayVisits.map(v => {
                const top = topPct(v.planned_start);
                const height = heightPct(v.planned_start, v.planned_end);
                return (
                  <div
                    key={v.id}
                    className={`absolute left-0.5 right-0.5 rounded-md border px-1.5 py-1 text-xs overflow-hidden cursor-pointer hover:brightness-95 hover:shadow-md transition-all z-20 ${VISIT_TONE[v.status] ?? "bg-muted"}`}
                    style={{
                      top: `${(top/100)*TOTAL_H}px`,
                      height: `${Math.max(hourPx*0.4, (height/100)*TOTAL_H)}px`,
                    }}
                    title={`${v.senior?.nazwisko} ${v.senior?.imie} · ${fmtTime(v.planned_start)} – ${fmtTime(v.planned_end)}${v.caregiver_id && cgMap[v.caregiver_id] ? " · " + cgMap[v.caregiver_id] : ""}`}
                    onClick={(e) => { e.stopPropagation(); onVisitClick(v); }}
                  >
                    <div className="font-semibold leading-tight truncate">{v.senior?.nazwisko} {v.senior?.imie}</div>
                    <div className="leading-tight opacity-80">{fmtTime(v.planned_start)}–{fmtTime(v.planned_end)}</div>
                    {v.caregiver_id && cgMap[v.caregiver_id] && (
                      <div className="leading-tight opacity-70 truncate text-[10px]">{cgMap[v.caregiver_id]}</div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── WIDOK DZIENNY ────────────────────────────────────────────────────────────
function DayView({ day, visits, cgMap, today, onVisitClick, hourPx = 64 }: {
  day: Date; visits: Visit[]; cgMap: Record<string,string>;
  today: Date; onVisitClick: (v: Visit) => void; hourPx?: number;
}) {
  const dayVisits = visits.filter(v =>
    new Date(v.planned_start).toDateString() === day.toDateString()
  );
  const isToday = day.toDateString() === today.toDateString();
  const TOTAL_H = HOURS.length * hourPx;

  function topPct(iso: string) {
    const d = new Date(iso);
    return Math.max(0, ((d.getHours()-6)*60 + d.getMinutes()) / (15*60) * 100);
  }
  function heightPct(s: string, e: string) {
    return Math.max(3, (new Date(e).getTime()-new Date(s).getTime())/60000/(15*60)*100);
  }

  return (
    <div className="overflow-auto" style={{ maxHeight: "580px" }} data-print-zoom>
      <div className="grid" style={{ gridTemplateColumns: "52px 1fr", minWidth: "400px" }}>
        <div /><div className="border-b py-3 text-center">
          <div className="text-sm font-semibold">{day.toLocaleDateString("pl-PL",{weekday:"long",day:"numeric",month:"long"})}</div>
          <div className="text-xs text-muted-foreground">{dayVisits.length} wizyt</div>
        </div>
        <div>
          {HOURS.map(h => (
            <div key={h} className="flex items-start justify-end pr-2 border-b" style={{height:`${hourPx}px`}}>
              <span className="text-xs text-muted-foreground mt-1">{String(h).padStart(2,"0")}:00</span>
            </div>
          ))}
        </div>
        <div className={`relative border-l ${isToday ? "bg-primary/[0.02]" : ""}`} style={{height:`${TOTAL_H}px`}}>
          {HOURS.map((_,i) => <div key={i} className="absolute w-full border-b border-border/30" style={{top:`${i*hourPx}px`}} />)}
          {isToday && (() => {
            const now = new Date();
            const top = ((now.getHours()-6)*60+now.getMinutes())/(15*60)*100;
            if (top<0||top>100) return null;
            return (
              <div className="absolute w-full z-10 pointer-events-none" style={{top:`${(top/100)*TOTAL_H}px`}}>
                <div className="flex items-center">
                  <div className="h-3 w-3 rounded-full bg-red-500 -ml-1.5 flex-shrink-0"/>
                  <div className="flex-1 border-t-2 border-red-500"/>
                </div>
              </div>
            );
          })()}
          {dayVisits.map(v => {
            const top = topPct(v.planned_start);
            const height = heightPct(v.planned_start, v.planned_end);
            return (
              <div
                key={v.id}
                className={`absolute left-1 right-1 rounded-lg border px-2 py-1.5 cursor-pointer hover:brightness-95 hover:shadow-md transition-all z-20 ${VISIT_TONE[v.status] ?? "bg-muted"}`}
                style={{top:`${(top/100)*TOTAL_H}px`,height:`${Math.max(hourPx*0.45,(height/100)*TOTAL_H)}px`}}
                onClick={() => onVisitClick(v)}
              >
                <div className="font-semibold text-sm leading-tight">{v.senior?.nazwisko} {v.senior?.imie}</div>
                <div className="text-xs opacity-80">{fmtTime(v.planned_start)} – {fmtTime(v.planned_end)}</div>
                {v.caregiver_id && cgMap[v.caregiver_id] && (
                  <div className="text-xs opacity-70">{cgMap[v.caregiver_id]}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── WIDOK MIESIĘCZNY ─────────────────────────────────────────────────────────
function MonthView({ year, month, visits, cgMap, today, onVisitClick, onDayClick }: {
  year: number; month: number; visits: Visit[]; cgMap: Record<string,string>;
  today: Date; onVisitClick: (v: Visit) => void; onDayClick: (d: Date) => void;
}) {
  const firstDay = new Date(year, month, 1).getDay();
  const firstMonday = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(year, month+1, 0).getDate();

  const visitsByDay: Record<number, Visit[]> = {};
  visits.forEach(v => {
    const d = new Date(v.planned_start).getDate();
    if (!visitsByDay[d]) visitsByDay[d] = [];
    visitsByDay[d].push(v);
  });

  // Liczba wierszy siatki (5 lub 6) — używana na wydruku, żeby wiersze
  // rozciągnęły się równo i wypełniły całą stronę zamiast zostawiać pustą
  // przestrzeń u dołu przy miesiącach z mniejszą liczbą wierszy.
  const monthRows = Math.ceil((firstMonday + daysInMonth) / 7);

  return (
    <div>
      <div className="grid grid-cols-7 border-b bg-muted/20">
        {DAYS_SHORT.map(d => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground">{d}</div>
        ))}
      </div>
      <div
        className="grid grid-cols-7"
        data-month-grid
        style={{ "--month-rows": monthRows } as any}
      >
        {Array.from({length:firstMonday}).map((_,i) => (
          <div key={`e-${i}`} className="min-h-[90px] border-b border-r bg-muted/10" data-month-cell />
        ))}
        {Array.from({length:daysInMonth}).map((_,i) => {
          const day = i+1;
          const dayVisits = visitsByDay[day] ?? [];
          const isToday = day===today.getDate() && month===today.getMonth() && year===today.getFullYear();
          const col = (firstMonday+i) % 7;
          const isWeekend = col >= 5;
          return (
            <div
              key={day}
              data-month-cell
              className={`min-h-[90px] border-b border-r p-1.5 cursor-pointer hover:bg-accent/30 transition-colors ${isWeekend ? "bg-muted/10" : ""}`}
              onClick={() => onDayClick(new Date(year, month, day))}
            >
              <div className={`mb-1 flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium ${
                isToday ? "bg-primary text-primary-foreground font-bold" : ""
              }`}>
                {day}
              </div>
              <div className="space-y-0.5">
                {dayVisits.slice(0,3).map(v => (
                  <div
                    key={v.id}
                    className={`rounded px-1 py-0.5 text-xs truncate border cursor-pointer hover:brightness-95 ${VISIT_TONE[v.status] ?? "bg-muted"}`}
                    onClick={e => { e.stopPropagation(); onVisitClick(v); }}
                    title={`${v.senior?.nazwisko} ${v.senior?.imie} · ${fmtTime(v.planned_start)}`}
                  >
                    <span className="font-medium">{fmtTime(v.planned_start)}</span>{" "}
                    <span className="opacity-80">{v.senior?.nazwisko}</span>
                    {v.caregiver_id && cgMap[v.caregiver_id] && (
                      <span className="hidden print:block opacity-70 text-[9px] leading-tight truncate">
                        {fmtTime(v.planned_start)}–{fmtTime(v.planned_end)} · {cgMap[v.caregiver_id]}
                      </span>
                    )}
                  </div>
                ))}
                {dayVisits.length > 3 && (
                  <div className="text-xs text-muted-foreground px-1">+{dayVisits.length-3} więcej</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap gap-3 px-4 py-2 border-t text-xs text-muted-foreground">
        {Object.entries({planned:"Zaplanowana",active:"W trakcie",completed:"Zakończona",alert:"Alarm",requires_verification:"Do weryfikacji"}).map(([k,v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className={`h-3 w-3 rounded border ${VISIT_TONE[k]}`}/>{v}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Dialog szczegółów wizyty ─────────────────────────────────────────────────
function VisitDetailDialog({ visit, cgMap, onClose }: {
  visit: Visit; cgMap: Record<string,string>; onClose: () => void;
}) {
  const { data: tasks } = useQuery({
    queryKey: ["visit-tasks-detail", visit.id],
    queryFn: async () => {
      const { data } = await supabase.from("visit_tasks")
        .select("id, task_name, completed, uwagi, requires_response, response")
        .eq("visit_id", visit.id);
      return data ?? [];
    },
  });

  const { data: visitDetail } = useQuery({
    queryKey: ["visit-detail", visit.id],
    queryFn: async () => {
      const { data } = await supabase.from("visits")
        .select("id, planned_start, planned_end, actual_start, actual_end, status, hours_billed, notes, caregiver_id")
        .eq("id", visit.id).single();
      return data;
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {visit.senior?.nazwisko} {visit.senior?.imie}
            <Badge variant="secondary" className={VISIT_TONE[visit.status]}>
              {STATUS_LABEL[visit.status]}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Czas */}
          <div className="rounded-lg bg-muted/30 px-4 py-3 text-sm space-y-1">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-muted-foreground">Planowany start</div>
                <div className="font-medium">{new Date(visit.planned_start).toLocaleDateString("pl-PL")} {fmtTime(visit.planned_start)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Planowany koniec</div>
                <div className="font-medium">{fmtTime(visit.planned_end)}</div>
              </div>
              {visitDetail?.actual_start && (
                <div>
                  <div className="text-xs text-muted-foreground">Faktyczny start (NFC)</div>
                  <div className="font-medium text-emerald-700">{fmtTime(visitDetail.actual_start)}</div>
                </div>
              )}
              {visitDetail?.actual_end && (
                <div>
                  <div className="text-xs text-muted-foreground">Faktyczny koniec (NFC)</div>
                  <div className="font-medium text-emerald-700">{fmtTime(visitDetail.actual_end)}</div>
                </div>
              )}
              {visitDetail?.hours_billed != null && (
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground">Godziny rozliczeniowe</div>
                  <div className="text-lg font-bold">{visitDetail.hours_billed} h</div>
                </div>
              )}
            </div>
          </div>

          {/* Opiekun */}
          {visit.caregiver_id && (
            <div className="text-sm">
              <div className="text-xs text-muted-foreground mb-0.5">Opiekun</div>
              <div className="font-medium">{cgMap[visit.caregiver_id] ?? "—"}</div>
            </div>
          )}

          {/* Czynności */}
          {tasks && tasks.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Czynności ({tasks.filter(t => t.completed).length}/{tasks.length})
              </div>
              <div className="space-y-1.5">
                {tasks.map((t: any) => (
                  <div key={t.id} className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <div className={`h-4 w-4 rounded-sm flex-shrink-0 flex items-center justify-center border ${
                        t.completed ? "bg-emerald-500 border-emerald-500 text-white" : "border-muted-foreground/40"
                      }`}>
                        {t.completed && <span className="text-[10px] leading-none">✓</span>}
                      </div>
                      <span className={t.completed ? "text-muted-foreground line-through" : ""}>{t.task_name}</span>
                    </div>
                    {t.uwagi && (
                      <div className="ml-6 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">⚠️ {t.uwagi}</div>
                    )}
                    {t.requires_response && t.response && (
                      <div className="ml-6 text-xs text-blue-700 bg-blue-50 rounded px-2 py-1">📋 {t.response}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notatka */}
          {visitDetail?.notes && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Notatka</div>
              <p className="text-sm bg-muted/30 rounded-lg px-3 py-2 whitespace-pre-wrap">{visitDetail.notes}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" asChild>
            <Link to="/wizyty">Otwórz w monitorze wizyt</Link>
          </Button>
          <Button onClick={onClose}>Zamknij</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog dodawania wizyty ──────────────────────────────────────────────────
function AddVisitDialog({ seniors, caregivers, defaultDate, open, onClose }: {
  seniors: Senior[]; caregivers: Caregiver[];
  defaultDate: string; open: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [newTask, setNewTask] = useState("");

  const form = useForm<VisitForm>({
    resolver: zodResolver(visitSchema),
    defaultValues: {
      senior_id: "", caregiver_id: NO_CAREGIVER,
      planned_start: `${defaultDate}T08:00`,
      planned_end: `${defaultDate}T10:00`,
      notes: "",
      planned_tasks: [],
    },
  });

  const selectedSeniorId = form.watch("senior_id");
  const { data: seniorData } = useQuery({
    queryKey: ["senior-plan", selectedSeniorId],
    enabled: !!selectedSeniorId,
    queryFn: async () => {
      const { data } = await supabase.from("seniors").select("plan_wsparcia").eq("id", selectedSeniorId).single();
      return data;
    },
  });

  const planTasks: string[] = Array.isArray(seniorData?.plan_wsparcia)
    ? (seniorData!.plan_wsparcia as unknown[]).map(String).filter(Boolean)
    : [];

  const handleSubmit = async (v: VisitForm) => {
    const { data: visit, error } = await supabase.from("visits").insert({
      senior_id: v.senior_id,
      caregiver_id: v.caregiver_id && v.caregiver_id !== NO_CAREGIVER ? v.caregiver_id : null,
      planned_start: new Date(v.planned_start).toISOString(),
      planned_end: new Date(v.planned_end).toISOString(),
      notes: v.notes || null,
      status: "planned",
    }).select("id").single();
    if (error) { toast.error(error.message); return; }

    if (v.planned_tasks.length > 0 && visit?.id) {
      await supabase.from("visit_tasks").insert(
        v.planned_tasks.map((t: any) => ({
          visit_id: visit.id,
          task_name: t.task_name,
          requires_response: t.requires_response,
        }))
      );
    }

    toast.success("Wizyta zaplanowana");
    qc.invalidateQueries({ queryKey: ["pulpit-visits"] });
    qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Zaplanuj nową usługę</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField control={form.control} name="senior_id" render={({ field }) => (
              <FormItem><FormLabel>Senior *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Wybierz seniora" /></SelectTrigger></FormControl>
                  <SelectContent>{seniors.map(s => <SelectItem key={s.id} value={s.id}>{s.nazwisko} {s.imie}</SelectItem>)}</SelectContent>
                </Select><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="caregiver_id" render={({ field }) => (
              <FormItem><FormLabel>Opiekun</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Brak — przypisz później" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value={NO_CAREGIVER}>Brak — przypisz później</SelectItem>
                    {caregivers.map(c => <SelectItem key={c.id} value={c.id}>{c.nazwisko} {c.imie}</SelectItem>)}
                  </SelectContent>
                </Select><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="planned_start" render={({ field }) => (
                <FormItem><FormLabel>Początek *</FormLabel>
                  <FormControl><Input type="datetime-local" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="planned_end" render={({ field }) => (
                <FormItem><FormLabel>Koniec *</FormLabel>
                  <FormControl><Input type="datetime-local" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="planned_tasks" render={({ field }) => (
              <FormItem>
                <FormLabel>Planowane czynności</FormLabel>
                {!selectedSeniorId ? (
                  <p className="text-xs text-muted-foreground">Wybierz seniora, aby zobaczyć plan wsparcia.</p>
                ) : (
                  <div className="space-y-3">
                    {planTasks.length > 0 && (
                      <div className="rounded-md border p-3 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Z planu wsparcia:</p>
                        {planTasks.map((task: string) => {
                          const existing = field.value.find((t: any) => t.task_name === task);
                          return (
                            <div key={task} className="flex items-center gap-2">
                              <input type="checkbox" checked={!!existing}
                                onChange={e => {
                                  if (e.target.checked) field.onChange([...field.value, { task_name: task, requires_response: false }]);
                                  else field.onChange(field.value.filter((t: any) => t.task_name !== task));
                                }}
                                className="h-4 w-4 rounded border-gray-300"
                              />
                              <span className="text-sm flex-1">{task}</span>
                              {existing && (
                                <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                                  <input type="checkbox" checked={(existing as any).requires_response}
                                    onChange={e => field.onChange(field.value.map((t: any) =>
                                      t.task_name === task ? { ...t, requires_response: e.target.checked } : t
                                    ))}
                                    className="h-3 w-3 rounded"
                                  />
                                  + pole odpowiedzi
                                </label>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="rounded-md border p-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Dodatkowe czynności:</p>
                      {field.value.filter((t: any) => !planTasks.includes(t.task_name)).map((task: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-2 text-sm">
                          <span className="text-primary text-xs">✓</span>
                          <span className="flex-1">{task.task_name}</span>
                          <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                            <input type="checkbox" checked={task.requires_response}
                              onChange={e => field.onChange(field.value.map((t: any) =>
                                t.task_name === task.task_name ? { ...t, requires_response: e.target.checked } : t
                              ))}
                              className="h-3 w-3 rounded"
                            />
                            + pole odpowiedzi
                          </label>
                          <button type="button"
                            onClick={() => field.onChange(field.value.filter((t: any) => t.task_name !== task.task_name))}
                            className="text-muted-foreground hover:text-destructive text-xs px-1">✕</button>
                        </div>
                      ))}
                      <div className="flex gap-2 mt-1">
                        <Input value={newTask} onChange={e => setNewTask(e.target.value)}
                          placeholder="Wpisz czynność i naciśnij Enter..."
                          className="h-8 text-sm"
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (newTask.trim()) { field.onChange([...field.value, { task_name: newTask.trim(), requires_response: false }]); setNewTask(""); }
                            }
                          }}
                        />
                        <Button type="button" size="sm" variant="outline"
                          onClick={() => { if (newTask.trim()) { field.onChange([...field.value, { task_name: newTask.trim(), requires_response: false }]); setNewTask(""); } }}>
                          Dodaj
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notatka</FormLabel>
                <FormControl><Textarea rows={2} placeholder="Uwagi..." {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage /></FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Anuluj</Button>
              <Button type="submit">Zaplanuj</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}


// ─── KPI Card ─────────────────────────────────────────────────────────────────
type KpiTone = "primary"|"info"|"success"|"destructive"|"muted";
const toneStyles: Record<KpiTone,{icon:string;ring:string}> = {
  primary:     {icon:"bg-primary/10 text-primary",        ring:"group-hover:ring-primary/30"},
  info:        {icon:"bg-sky-500/10 text-sky-600",         ring:"group-hover:ring-sky-300"},
  success:     {icon:"bg-emerald-500/10 text-emerald-600", ring:"group-hover:ring-emerald-300"},
  destructive: {icon:"bg-red-500/10 text-red-600",         ring:"group-hover:ring-red-300"},
  muted:       {icon:"bg-muted text-muted-foreground",     ring:"group-hover:ring-border"},
};

function KpiCard({ to, label, value, loading, icon, tone, hint }: {
  to: string; label: string; value: number|string|undefined;
  loading: boolean; icon: React.ReactNode; tone: KpiTone; hint?: string;
}) {
  const s = toneStyles[tone];
  return (
    <Link to={to} className={cn(
      "group rounded-xl border bg-card p-5 shadow-sm ring-1 ring-transparent transition-all hover:-translate-y-0.5 hover:shadow-md",
      s.ring,
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-2 text-3xl font-bold tabular-nums">
            {loading ? <span className="inline-block h-8 w-16 animate-pulse rounded bg-muted"/> : (value ?? 0)}
          </div>
        </div>
        <div className={cn("rounded-lg p-2.5", s.icon)}>{icon}</div>
      </div>
      {hint && <div className="mt-3 text-xs text-muted-foreground line-clamp-2">{hint}</div>}
    </Link>
  );
}
