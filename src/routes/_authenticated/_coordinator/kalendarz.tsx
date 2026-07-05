import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Plus, X, Loader2,
  Clock, User, Users, Calendar, CalendarDays, LayoutGrid,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField,
  FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/_coordinator/kalendarz")({
  component: KalendarzPage,
});

// ─── Typy ────────────────────────────────────────────────────────────────────

type Visit = {
  id: string;
  planned_start: string;
  planned_end: string;
  status: string;
  hours_billed: number | null;
  caregiver_id: string | null;
  senior_id: string;
  senior: { imie: string; nazwisko: string } | null;
};

type CalEvent = {
  id: string;
  senior_id: string;
  date: string;
  typ: string;
  tytul: string;
  opis: string | null;
};

type Senior = { id: string; imie: string; nazwisko: string };
type Caregiver = { id: string; imie: string; nazwisko: string };

// ─── Stałe ───────────────────────────────────────────────────────────────────

const MONTHS = ["Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec",
  "Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień"];
const DAYS = ["Pon","Wt","Śr","Czw","Pt","Sob","Nd"];

const VISIT_TONE: Record<string, string> = {
  planned: "bg-sky-500/20 text-sky-800 border-sky-300",
  active: "bg-amber-500/20 text-amber-800 border-amber-300",
  completed: "bg-emerald-500/20 text-emerald-800 border-emerald-300",
  alert: "bg-red-500/20 text-red-800 border-red-300",
  requires_verification: "bg-amber-500/20 text-amber-800 border-amber-300",
};

const EVENT_TONE: Record<string, string> = {
  notatka: "bg-sky-400/20 text-sky-700 border-sky-200",
  uwaga: "bg-amber-400/20 text-amber-700 border-amber-200",
  alarm: "bg-red-400/20 text-red-700 border-red-200",
  wizyta_lekarska: "bg-purple-400/20 text-purple-700 border-purple-200",
  inne: "bg-gray-400/20 text-gray-700 border-gray-200",
};
const EVENT_ICON: Record<string, string> = {
  notatka: "📝", uwaga: "⚠️", alarm: "🚨", wizyta_lekarska: "🏥", inne: "📌",
};

const NO_CAREGIVER = "__none__";
const NO_SENIOR = "__none__";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

// ─── Schematy formularzy ─────────────────────────────────────────────────────

const visitSchema = z.object({
  senior_id: z.string().min(1, "Wybierz seniora"),
  caregiver_id: z.string().optional(),
  planned_start: z.string().min(1, "Wymagane"),
  planned_end: z.string().min(1, "Wymagane"),
  notes: z.string().optional().or(z.literal("")),
}).refine(d => new Date(d.planned_end) > new Date(d.planned_start), {
  path: ["planned_end"], message: "Koniec musi być po starcie",
});

const eventSchema = z.object({
  senior_id: z.string().min(1, "Wybierz seniora"),
  typ: z.enum(["notatka", "uwaga", "alarm", "wizyta_lekarska", "inne"]),
  tytul: z.string().trim().min(1, "Wymagane").max(100),
  opis: z.string().trim().max(500).optional().or(z.literal("")),
});

type VisitForm = z.infer<typeof visitSchema>;
type EventForm = z.infer<typeof eventSchema>;

// ─── Główna strona ────────────────────────────────────────────────────────────


function KalendarzPage() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    monday.setHours(0, 0, 0, 0);
    return monday;
  });
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [addVisit, setAddVisit] = useState(false);
  const [addEvent, setAddEvent] = useState(false);
  const [filterSenior, setFilterSenior] = useState<string>("all");
  const [filterCaregiver, setFilterCaregiver] = useState<string>("all");

  const startOfMonth = new Date(viewYear, viewMonth, 1).toISOString();
  const endOfMonth = new Date(viewYear, viewMonth + 1, 0, 23, 59, 59).toISOString();
  const dateFrom = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;
  const dateTo = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(new Date(viewYear, viewMonth + 1, 0).getDate()).padStart(2, "0")}`;

  // Tydzień: poniedziałek → niedziela
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const { data: visits } = useQuery({
    queryKey: ["cal-visits", viewYear, viewMonth],
    queryFn: async () => {
      const { data } = await supabase
        .from("visits")
        .select("id, planned_start, planned_end, status, hours_billed, caregiver_id, senior_id, senior:seniors(imie, nazwisko)")
        .gte("planned_start", startOfMonth)
        .lte("planned_start", endOfMonth)
        .order("planned_start");
      return (data ?? []) as unknown as Visit[];
    },
  });

  const { data: weekVisits } = useQuery({
    queryKey: ["cal-week-visits", weekStart.toISOString()],
    queryFn: async () => {
      const { data } = await supabase
        .from("visits")
        .select("id, planned_start, planned_end, status, hours_billed, caregiver_id, senior_id, senior:seniors(imie, nazwisko)")
        .gte("planned_start", weekStart.toISOString())
        .lte("planned_start", weekEnd.toISOString())
        .order("planned_start");
      return (data ?? []) as unknown as Visit[];
    },
  });

  const { data: events } = useQuery({
    queryKey: ["cal-events", viewYear, viewMonth],
    queryFn: async () => {
      const { data } = await supabase
        .from("senior_events")
        .select("id, senior_id, date, typ, tytul, opis")
        .gte("date", dateFrom).lte("date", dateTo)
        .order("date");
      return (data ?? []) as CalEvent[];
    },
  });

  const { data: seniors } = useQuery({
    queryKey: ["seniors-list-cal"],
    queryFn: async () => {
      const { data } = await supabase.from("seniors").select("id, imie, nazwisko").order("nazwisko");
      return (data ?? []) as Senior[];
    },
  });

  const { data: caregivers } = useQuery({
    queryKey: ["caregivers-list-cal"],
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "caregiver");
      const ids = (roles ?? []).map(r => r.user_id);
      if (!ids.length) return [];
      const { data } = await supabase.from("profiles").select("id, imie, nazwisko").in("id", ids).order("nazwisko");
      return (data ?? []) as Caregiver[];
    },
  });

  const cgMap = useMemo(() => Object.fromEntries((caregivers ?? []).map(c => [c.id, `${c.imie} ${c.nazwisko}`])), [caregivers]);

  const filteredVisits = useMemo(() => (visits ?? []).filter(v => {
    if (filterSenior !== "all" && v.senior_id !== filterSenior) return false;
    if (filterCaregiver !== "all" && v.caregiver_id !== filterCaregiver) return false;
    return true;
  }), [visits, filterSenior, filterCaregiver]);

  const filteredEvents = useMemo(() => (events ?? []).filter(e =>
    filterSenior === "all" || e.senior_id === filterSenior
  ), [events, filterSenior]);

  const visitsByDay = useMemo(() => {
    const m: Record<number, Visit[]> = {};
    filteredVisits.forEach(v => {
      const d = new Date(v.planned_start).getDate();
      if (!m[d]) m[d] = [];
      m[d].push(v);
    });
    return m;
  }, [filteredVisits]);

  const eventsByDay = useMemo(() => {
    const m: Record<number, CalEvent[]> = {};
    filteredEvents.forEach(e => {
      const d = new Date(e.date + "T12:00:00").getDate();
      if (!m[d]) m[d] = [];
      m[d].push(e);
    });
    return m;
  }, [filteredEvents]);

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const firstMonday = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y-1); setViewMonth(11); } else setViewMonth(m => m-1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y+1); setViewMonth(0); } else setViewMonth(m => m+1); };

  const prevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d); };
  const nextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d); };
  const goToday = () => {
    const d = new Date();
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    monday.setHours(0, 0, 0, 0);
    setWeekStart(monday);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const totalVisits = filteredVisits.length;
  const totalHours = filteredVisits.filter(v => v.status === "completed").reduce((s, v) => s + (v.hours_billed ?? 0), 0);

  const selectedDateStr = selectedDay
    ? `${selectedDay.getFullYear()}-${String(selectedDay.getMonth()+1).padStart(2,"0")}-${String(selectedDay.getDate()).padStart(2,"0")}`
    : null;

  const selectedVisits = selectedDay ? (visitsByDay[selectedDay.getDate()] ?? []) : [];
  const selectedEvents = selectedDay ? (eventsByDay[selectedDay.getDate()] ?? []) : [];

  // Filtry JSX
  const Filtry = (
    <div className="flex gap-2 flex-wrap">
      <Select value={filterSenior} onValueChange={setFilterSenior}>
        <SelectTrigger className="h-8 w-44 text-xs">
          <Users className="h-3 w-3 mr-1" /><SelectValue placeholder="Wszyscy seniorzy" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Wszyscy seniorzy</SelectItem>
          {(seniors ?? []).map(s => <SelectItem key={s.id} value={s.id}>{s.nazwisko} {s.imie}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filterCaregiver} onValueChange={setFilterCaregiver}>
        <SelectTrigger className="h-8 w-44 text-xs">
          <User className="h-3 w-3 mr-1" /><SelectValue placeholder="Wszyscy opiekunowie" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Wszyscy opiekunowie</SelectItem>
          {(caregivers ?? []).map(c => <SelectItem key={c.id} value={c.id}>{c.nazwisko} {c.imie}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Nagłówek */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kalendarz</h1>
          <p className="text-sm text-muted-foreground">
            {MONTHS[viewMonth]} {viewYear} · {totalVisits} wizyt · {totalHours} h zrealizowanych
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setAddVisit(true)}>
            <Plus className="h-4 w-4" /> Nowa wizyta
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAddEvent(true)}>
            <Calendar className="h-4 w-4" /> Nowe zdarzenie
          </Button>
        </div>
      </div>

      <Tabs defaultValue="miesiac">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="miesiac"><LayoutGrid className="h-3.5 w-3.5 mr-1" />Miesiąc</TabsTrigger>
            <TabsTrigger value="tydzien"><CalendarDays className="h-3.5 w-3.5 mr-1" />Tydzień</TabsTrigger>
            <TabsTrigger value="grafik"><Users className="h-3.5 w-3.5 mr-1" />Grafik opiekunów</TabsTrigger>
          </TabsList>
          {Filtry}
        </div>

        {/* ── WIDOK MIESIĘCZNY ── */}
        <TabsContent value="miesiac" className="mt-4">
          <div className="flex items-center gap-2 mb-3">
            <Button size="sm" variant="outline" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" onClick={goToday}>Dziś</Button>
            <Button size="sm" variant="outline" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
            <span className="font-semibold text-sm">{MONTHS[viewMonth]} {viewYear}</span>
          </div>

          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              <div className="rounded-lg border bg-card overflow-hidden">
                <div className="grid grid-cols-7 border-b bg-muted/30">
                  {DAYS.map(d => <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground">{d}</div>)}
                </div>
                <div className="grid grid-cols-7">
                  {Array.from({ length: firstMonday }).map((_, i) => (
                    <div key={`e-${i}`} className="min-h-[100px] border-b border-r bg-muted/10" />
                  ))}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const dayVisits = visitsByDay[day] ?? [];
                    const dayEvents = eventsByDay[day] ?? [];
                    const isToday = day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
                    const isSelected = selectedDay?.getDate() === day && selectedDay?.getMonth() === viewMonth && selectedDay?.getFullYear() === viewYear;
                    const col = (firstMonday + i) % 7;
                    const isWeekend = col >= 5;
                    const hasAlarm = dayEvents.some(e => e.typ === "alarm") || dayVisits.some(v => v.status === "alert");
                    return (
                      <div
                        key={day}
                        className={`min-h-[100px] border-b border-r p-1 cursor-pointer transition-colors
                          ${isWeekend ? "bg-muted/10" : ""}
                          ${isSelected ? "bg-primary/5 ring-1 ring-inset ring-primary" : "hover:bg-accent/40"}
                          ${hasAlarm ? "ring-1 ring-inset ring-red-400" : ""}`}
                        onClick={() => setSelectedDay(new Date(viewYear, viewMonth, day))}
                      >
                        <div className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium
                          ${isToday ? "bg-primary text-primary-foreground" : "text-foreground"}`}>
                          {day}
                        </div>
                        <div className="space-y-0.5">
                          {dayVisits.slice(0, 3).map(v => (
                            <div key={v.id} className={`rounded border px-1 py-0.5 text-xs truncate leading-tight ${VISIT_TONE[v.status] ?? "bg-muted"}`}
                              title={`${v.senior?.nazwisko} ${v.senior?.imie} · ${fmtTime(v.planned_start)}`}>
                              <span className="font-medium">{fmtTime(v.planned_start)}</span>{" "}
                              <span className="opacity-80">{v.senior?.nazwisko}</span>
                            </div>
                          ))}
                          {dayVisits.length > 3 && <div className="text-xs text-muted-foreground px-1">+{dayVisits.length - 3} więcej</div>}
                          {dayEvents.slice(0, 2).map((e, idx) => (
                            <div key={idx} className={`rounded border px-1 py-0.5 text-xs truncate leading-tight ${EVENT_TONE[e.typ]}`}>
                              {EVENT_ICON[e.typ]} <span>{e.tytul}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                {Object.entries({ planned: "Zaplanowana", active: "W trakcie", completed: "Zakończona", alert: "Alarm" }).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <div className={`h-3 w-3 rounded border ${VISIT_TONE[k]}`} /><span>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {selectedDay && (
              <div className="w-72 flex-shrink-0">
                <DayDetailPanel
                  date={selectedDay}
                  visits={selectedVisits}
                  events={selectedEvents}
                  cgMap={cgMap}
                  seniors={seniors ?? []}
                  caregivers={caregivers ?? []}
                  onClose={() => setSelectedDay(null)}
                  onAddVisit={() => setAddVisit(true)}
                  onAddEvent={() => setAddEvent(true)}
                  defaultDate={selectedDateStr!}
                />
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── WIDOK TYGODNIOWY ── */}
        <TabsContent value="tydzien" className="mt-4">
          <div className="flex items-center gap-2 mb-3">
            <Button size="sm" variant="outline" onClick={prevWeek}><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" onClick={goToday}>Dziś</Button>
            <Button size="sm" variant="outline" onClick={nextWeek}><ChevronRight className="h-4 w-4" /></Button>
            <span className="font-semibold text-sm">
              {weekStart.toLocaleDateString("pl-PL", { day: "numeric", month: "short" })} –{" "}
              {weekEnd.toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </div>
          <WeekView
            weekStart={weekStart}
            visits={weekVisits ?? []}
            cgMap={cgMap}
            today={today}
            onDayClick={(d) => setSelectedDay(d)}
          />
        </TabsContent>

        {/* ── GRAFIK OPIEKUNÓW ── */}
        <TabsContent value="grafik" className="mt-4">
          <div className="flex items-center gap-2 mb-3">
            <Button size="sm" variant="outline" onClick={prevWeek}><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" onClick={goToday}>Dziś</Button>
            <Button size="sm" variant="outline" onClick={nextWeek}><ChevronRight className="h-4 w-4" /></Button>
            <span className="font-semibold text-sm">
              {weekStart.toLocaleDateString("pl-PL", { day: "numeric", month: "short" })} –{" "}
              {weekEnd.toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </div>
          <GrafikOpiekunow
            weekStart={weekStart}
            visits={weekVisits ?? []}
            caregivers={caregivers ?? []}
            cgMap={cgMap}
            today={today}
          />
        </TabsContent>
      </Tabs>

      {addVisit && (
        <AddVisitDialog
          seniors={seniors ?? []}
          caregivers={caregivers ?? []}
          defaultDate={selectedDateStr ?? new Date().toISOString().split("T")[0]}
          open={addVisit}
          onClose={() => setAddVisit(false)}
          viewYear={viewYear}
          viewMonth={viewMonth}
        />
      )}
      {addEvent && (
        <AddEventDialog
          seniors={seniors ?? []}
          defaultDate={selectedDateStr ?? new Date().toISOString().split("T")[0]}
          open={addEvent}
          onClose={() => setAddEvent(false)}
          viewYear={viewYear}
          viewMonth={viewMonth}
        />
      )}
    </div>
  );
}

// ─── WIDOK TYGODNIOWY ────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 7:00 – 20:00

function WeekView({ weekStart, visits, cgMap, today, onDayClick }: {
  weekStart: Date; visits: Visit[]; cgMap: Record<string, string>;
  today: Date; onDayClick: (d: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const DAY_NAMES = ["Pon","Wt","Śr","Czw","Pt","Sob","Nd"];

  // Pogrupuj wizyty per dzień
  const visitsByDayOfWeek: Record<number, Visit[]> = {};
  days.forEach((d, idx) => {
    visitsByDayOfWeek[idx] = visits.filter(v => {
      const vd = new Date(v.planned_start);
      return vd.toDateString() === d.toDateString();
    });
  });

  function getTopPercent(iso: string) {
    const d = new Date(iso);
    const mins = (d.getHours() - 7) * 60 + d.getMinutes();
    return Math.max(0, (mins / (13 * 60)) * 100);
  }

  function getHeightPercent(start: string, end: string) {
    const s = new Date(start); const e = new Date(end);
    const mins = (e.getTime() - s.getTime()) / 60000;
    return Math.max(3, (mins / (13 * 60)) * 100);
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Nagłówki dni */}
      <div className="grid border-b bg-muted/30" style={{ gridTemplateColumns: "48px repeat(7, 1fr)" }}>
        <div className="py-2" />
        {days.map((d, idx) => {
          const isToday = d.toDateString() === today.toDateString();
          return (
            <div
              key={idx}
              className="py-2 text-center cursor-pointer hover:bg-accent/30 transition-colors"
              onClick={() => onDayClick(d)}
            >
              <div className="text-xs text-muted-foreground">{DAY_NAMES[idx]}</div>
              <div className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
                isToday ? "bg-primary text-primary-foreground" : ""
              }`}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Siatka godzinowa */}
      <div className="overflow-y-auto max-h-[600px]">
        <div className="relative grid" style={{ gridTemplateColumns: "48px repeat(7, 1fr)" }}>
          {/* Oś czasu */}
          <div className="col-start-1">
            {HOURS.map(h => (
              <div key={h} className="h-16 border-b flex items-start pt-1 pr-1 justify-end">
                <span className="text-xs text-muted-foreground">{String(h).padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>

          {/* Kolumny dni */}
          {days.map((d, dayIdx) => {
            const dayVisits = visitsByDayOfWeek[dayIdx] ?? [];
            const isToday = d.toDateString() === today.toDateString();

            return (
              <div
                key={dayIdx}
                className={`relative border-l ${isToday ? "bg-primary/3" : ""}`}
                style={{ height: `${HOURS.length * 64}px` }}
                onClick={() => onDayClick(d)}
              >
                {/* Linie godzinowe */}
                {HOURS.map((_, i) => (
                  <div key={i} className="absolute w-full border-b border-border/40" style={{ top: `${i * 64}px`, height: "64px" }} />
                ))}

                {/* Wizyty */}
                {dayVisits.map(v => {
                  const top = getTopPercent(v.planned_start);
                  const height = getHeightPercent(v.planned_start, v.planned_end);
                  const totalH = HOURS.length * 64;
                  return (
                    <div
                      key={v.id}
                      className={`absolute left-0.5 right-0.5 rounded px-1 py-0.5 text-xs overflow-hidden cursor-pointer border ${VISIT_TONE[v.status] ?? "bg-muted"}`}
                      style={{ top: `${(top / 100) * totalH}px`, height: `${Math.max(24, (height / 100) * totalH)}px` }}
                      title={`${v.senior?.nazwisko} ${v.senior?.imie} · ${fmtTime(v.planned_start)} – ${fmtTime(v.planned_end)}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="font-medium leading-tight truncate">{v.senior?.nazwisko}</div>
                      <div className="opacity-75 leading-tight">{fmtTime(v.planned_start)}</div>
                      {cgMap[v.caregiver_id ?? ""] && (
                        <div className="opacity-60 leading-tight truncate text-[10px]">{cgMap[v.caregiver_id!]}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── GRAFIK OPIEKUNÓW ─────────────────────────────────────────────────────────

function GrafikOpiekunow({ weekStart, visits, caregivers, cgMap, today }: {
  weekStart: Date; visits: Visit[]; caregivers: Caregiver[];
  cgMap: Record<string, string>; today: Date;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const DAY_NAMES = ["Pon","Wt","Śr","Czw","Pt","Sob","Nd"];

  // Pogrupuj wizyty: caregiver → dzień → wizyty
  const grid: Record<string, Record<number, Visit[]>> = {};
  const unassigned: Record<number, Visit[]> = {};

  visits.forEach(v => {
    const dayIdx = days.findIndex(d => d.toDateString() === new Date(v.planned_start).toDateString());
    if (dayIdx === -1) return;

    if (v.caregiver_id) {
      if (!grid[v.caregiver_id]) grid[v.caregiver_id] = {};
      if (!grid[v.caregiver_id][dayIdx]) grid[v.caregiver_id][dayIdx] = [];
      grid[v.caregiver_id][dayIdx].push(v);
    } else {
      if (!unassigned[dayIdx]) unassigned[dayIdx] = [];
      unassigned[dayIdx].push(v);
    }
  });

  // Sumuj godziny per opiekun na tydzień
  const weekHours: Record<string, number> = {};
  visits.forEach(v => {
    if (!v.caregiver_id) return;
    weekHours[v.caregiver_id] = (weekHours[v.caregiver_id] ?? 0) + (v.hours_billed ?? 0);
  });

  const allCaregivers = caregivers.length > 0 ? caregivers : [];
  const hasUnassigned = Object.values(unassigned).some(arr => arr.length > 0);

  if (allCaregivers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
        Brak opiekunów w systemie. Dodaj opiekunów w panelu Opiekunowie.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: "700px" }}>
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="py-3 px-4 text-left font-semibold text-sm w-40">Opiekun</th>
            {days.map((d, idx) => {
              const isToday = d.toDateString() === today.toDateString();
              const isWeekend = idx >= 5;
              return (
                <th key={idx} className={`py-3 px-2 text-center font-medium text-sm ${isWeekend ? "text-muted-foreground/70" : ""}`}>
                  <div className={`text-xs text-muted-foreground`}>{DAY_NAMES[idx]}</div>
                  <div className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                    isToday ? "bg-primary text-primary-foreground font-bold" : ""
                  }`}>
                    {d.getDate()}
                  </div>
                </th>
              );
            })}
            <th className="py-3 px-3 text-right font-semibold text-xs text-muted-foreground">Tydzień</th>
          </tr>
        </thead>
        <tbody>
          {allCaregivers.map(c => (
            <tr key={c.id} className="border-b hover:bg-muted/20">
              <td className="py-3 px-4">
                <div className="font-medium">{c.imie} {c.nazwisko}</div>
                <div className="text-xs text-muted-foreground">
                  {Object.values(grid[c.id] ?? {}).flat().length} wizyt
                </div>
              </td>
              {days.map((_, dayIdx) => {
                const dayVisits = grid[c.id]?.[dayIdx] ?? [];
                const isWeekend = dayIdx >= 5;
                const dayHours = dayVisits.reduce((s, v) => s + (v.hours_billed ?? 0), 0);
                return (
                  <td key={dayIdx} className={`px-2 py-2 align-top ${isWeekend ? "bg-muted/10" : ""}`}>
                    {dayVisits.length === 0 ? (
                      <div className="h-8 flex items-center justify-center">
                        <div className="h-0.5 w-4 bg-border rounded" />
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {dayVisits.map(v => (
                          <div
                            key={v.id}
                            className={`rounded px-1.5 py-1 text-xs border ${VISIT_TONE[v.status] ?? "bg-muted"}`}
                            title={`${v.senior?.nazwisko} ${v.senior?.imie} · ${fmtTime(v.planned_start)} – ${fmtTime(v.planned_end)}`}
                          >
                            <div className="font-medium truncate">{v.senior?.nazwisko}</div>
                            <div className="opacity-75">{fmtTime(v.planned_start)} – {fmtTime(v.planned_end)}</div>
                          </div>
                        ))}
                        {dayHours > 0 && (
                          <div className="text-xs text-muted-foreground text-right">{dayHours}h</div>
                        )}
                      </div>
                    )}
                  </td>
                );
              })}
              <td className="px-3 py-2 text-right">
                <div className="font-semibold text-sm">{weekHours[c.id] ?? 0}h</div>
                <div className="text-xs text-muted-foreground">
                  {Object.values(grid[c.id] ?? {}).flat().length} wiz.
                </div>
              </td>
            </tr>
          ))}

          {/* Nieprzypisane wizyty */}
          {hasUnassigned && (
            <tr className="border-b bg-amber-500/5">
              <td className="py-3 px-4">
                <div className="font-medium text-amber-700">Nieprzypisane</div>
                <div className="text-xs text-muted-foreground">brak opiekuna</div>
              </td>
              {days.map((_, dayIdx) => {
                const dayVisits = unassigned[dayIdx] ?? [];
                return (
                  <td key={dayIdx} className="px-2 py-2 align-top">
                    {dayVisits.length === 0 ? (
                      <div className="h-8 flex items-center justify-center">
                        <div className="h-0.5 w-4 bg-border rounded" />
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {dayVisits.map(v => (
                          <div key={v.id} className="rounded px-1.5 py-1 text-xs bg-amber-500/15 text-amber-800 border border-amber-300">
                            <div className="font-medium truncate">{v.senior?.nazwisko}</div>
                            <div className="opacity-75">{fmtTime(v.planned_start)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                );
              })}
              <td className="px-3 py-2 text-right">
                <div className="text-xs text-amber-700">
                  {Object.values(unassigned).flat().length} wiz.
                </div>
              </td>
            </tr>
          )}

          {/* Wiersz sumaryczny */}
          <tr className="bg-muted/20 font-semibold">
            <td className="py-2 px-4 text-sm">Łącznie</td>
            {days.map((_, dayIdx) => {
              const total = [...Object.values(grid).map(cg => cg[dayIdx]?.length ?? 0), unassigned[dayIdx]?.length ?? 0]
                .reduce((s, n) => s + n, 0);
              const totalH = [
                ...Object.values(grid).map(cg => (cg[dayIdx] ?? []).reduce((s, v) => s + (v.hours_billed ?? 0), 0)),
              ].reduce((s, n) => s + n, 0);
              return (
                <td key={dayIdx} className="px-2 py-2 text-center text-xs">
                  {total > 0 ? (
                    <><div>{total} wiz.</div>{totalH > 0 && <div className="text-muted-foreground">{totalH}h</div>}</>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>
              );
            })}
            <td className="px-3 py-2 text-right text-sm">
              {Object.values(weekHours).reduce((s, n) => s + n, 0)}h
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}


function DayDetailPanel({ date, visits, events, cgMap, seniors, caregivers, onClose, onAddVisit, onAddEvent, defaultDate }: {
  date: Date; visits: Visit[]; events: CalEvent[]; cgMap: Record<string, string>;
  seniors: Senior[]; caregivers: Caregiver[]; onClose: () => void;
  onAddVisit: () => void; onAddEvent: () => void; defaultDate: string;
}) {
  const qc = useQueryClient();

  const deleteVisit = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("visits").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Wizyta usunięta");
      qc.invalidateQueries({ queryKey: ["cal-visits"] });
    },
  });

  const deleteEvent = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("senior_events").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Zdarzenie usunięte");
      qc.invalidateQueries({ queryKey: ["cal-events"] });
    },
  });

  const dayLabel = date.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="rounded-lg border bg-card overflow-hidden sticky top-4">
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
        <div>
          <div className="font-semibold text-sm capitalize">{dayLabel}</div>
          <div className="text-xs text-muted-foreground">{visits.length} wizyt · {events.length} zdarzeń</div>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
      </div>

      <div className="p-3 space-y-3 max-h-[70vh] overflow-y-auto">
        {/* Przyciski dodawania */}
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 h-7 text-xs" onClick={onAddVisit}>
            <Plus className="h-3 w-3" /> Wizyta
          </Button>
          <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onAddEvent}>
            <Plus className="h-3 w-3" /> Zdarzenie
          </Button>
        </div>

        {/* Wizyty */}
        {visits.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Wizyty</div>
            <div className="space-y-1.5">
              {visits.map(v => (
                <div key={v.id} className={`rounded-lg border px-3 py-2 ${VISIT_TONE[v.status] ?? "bg-muted"}`}>
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <div className="font-semibold text-xs truncate">
                        {v.senior?.nazwisko} {v.senior?.imie}
                      </div>
                      <div className="text-xs opacity-80 flex items-center gap-1 mt-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        {fmtTime(v.planned_start)} – {fmtTime(v.planned_end)}
                      </div>
                      {v.caregiver_id && cgMap[v.caregiver_id] && (
                        <div className="text-xs opacity-70 truncate">{cgMap[v.caregiver_id]}</div>
                      )}
                    </div>
                    {v.status === "planned" && (
                      <button
                        onClick={() => { if (confirm("Usunąć wizytę?")) deleteVisit.mutate(v.id); }}
                        className="opacity-60 hover:opacity-100 flex-shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Zdarzenia */}
        {events.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Zdarzenia</div>
            <div className="space-y-1.5">
              {events.map(ev => (
                <div key={ev.id} className={`rounded-lg border px-3 py-2 ${EVENT_TONE[ev.typ]}`}>
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{EVENT_ICON[ev.typ]} {ev.tytul}</div>
                      {ev.opis && <div className="text-xs opacity-70 mt-0.5 line-clamp-2">{ev.opis}</div>}
                      {/* Nazwa seniora */}
                      <div className="text-xs opacity-60 mt-0.5 truncate">
                        {seniors.find(s => s.id === ev.senior_id)?.nazwisko ?? ""}
                      </div>
                    </div>
                    <button
                      onClick={() => { if (confirm("Usunąć zdarzenie?")) deleteEvent.mutate(ev.id); }}
                      className="opacity-60 hover:opacity-100 flex-shrink-0"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {visits.length === 0 && events.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Brak wizyt ani zdarzeń w tym dniu.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Dialog: dodaj wizytę ─────────────────────────────────────────────────────

function AddVisitDialog({ seniors, caregivers, defaultDate, open, onClose, viewYear, viewMonth }: {
  seniors: Senior[]; caregivers: Caregiver[]; defaultDate: string;
  open: boolean; onClose: () => void; viewYear: number; viewMonth: number;
}) {
  const qc = useQueryClient();
  const form = useForm<VisitForm>({
    resolver: zodResolver(visitSchema),
    defaultValues: {
      senior_id: "",
      caregiver_id: NO_CAREGIVER,
      planned_start: `${defaultDate}T08:00`,
      planned_end: `${defaultDate}T10:00`,
      notes: "",
    },
  });

  const mut = useMutation({
    mutationFn: async (v: VisitForm) => {
      const { error } = await supabase.from("visits").insert({
        senior_id: v.senior_id,
        caregiver_id: v.caregiver_id && v.caregiver_id !== NO_CAREGIVER ? v.caregiver_id : null,
        planned_start: new Date(v.planned_start).toISOString(),
        planned_end: new Date(v.planned_end).toISOString(),
        notes: v.notes || null,
        status: "planned",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Wizyta zaplanowana");
      qc.invalidateQueries({ queryKey: ["cal-visits", viewYear, viewMonth] });
      qc.invalidateQueries({ queryKey: ["visits-list"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      form.reset();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Zaplanuj wizytę</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(v => mut.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="senior_id" render={({ field }) => (
              <FormItem>
                <FormLabel>Senior *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Wybierz seniora" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {seniors.map(s => <SelectItem key={s.id} value={s.id}>{s.nazwisko} {s.imie}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="caregiver_id" render={({ field }) => (
              <FormItem>
                <FormLabel>Opiekun</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Brak — przypisz później" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value={NO_CAREGIVER}>Brak — przypisz później</SelectItem>
                    {caregivers.map(c => <SelectItem key={c.id} value={c.id}>{c.nazwisko} {c.imie}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="planned_start" render={({ field }) => (
                <FormItem>
                  <FormLabel>Początek *</FormLabel>
                  <FormControl><Input type="datetime-local" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="planned_end" render={({ field }) => (
                <FormItem>
                  <FormLabel>Koniec *</FormLabel>
                  <FormControl><Input type="datetime-local" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notatka</FormLabel>
                <FormControl><Textarea rows={2} placeholder="Opcjonalne uwagi..." {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={mut.isPending}>Anuluj</Button>
              <Button type="submit" disabled={mut.isPending}>
                {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Zaplanuj
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog: dodaj zdarzenie ─────────────────────────────────────────────────

function AddEventDialog({ seniors, defaultDate, open, onClose, viewYear, viewMonth }: {
  seniors: Senior[]; defaultDate: string;
  open: boolean; onClose: () => void; viewYear: number; viewMonth: number;
}) {
  const qc = useQueryClient();
  const form = useForm<EventForm>({
    resolver: zodResolver(eventSchema),
    defaultValues: { senior_id: NO_SENIOR, typ: "notatka", tytul: "", opis: "" },
  });

  const mut = useMutation({
    mutationFn: async (v: EventForm) => {
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase.from("senior_events").insert({
        senior_id: v.senior_id,
        date: defaultDate,
        typ: v.typ,
        tytul: v.tytul.trim(),
        opis: v.opis?.trim() || null,
        created_by: user.user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Zdarzenie dodane");
      qc.invalidateQueries({ queryKey: ["cal-events", viewYear, viewMonth] });
      form.reset();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Dodaj zdarzenie — {new Date(defaultDate + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(v => mut.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="senior_id" render={({ field }) => (
              <FormItem>
                <FormLabel>Senior *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Wybierz seniora" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {seniors.map(s => <SelectItem key={s.id} value={s.id}>{s.nazwisko} {s.imie}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="typ" render={({ field }) => (
              <FormItem>
                <FormLabel>Typ zdarzenia *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {[["notatka","📝 Notatka"],["uwaga","⚠️ Uwaga"],["alarm","🚨 Alarm"],["wizyta_lekarska","🏥 Wizyta lekarska"],["inne","📌 Inne"]].map(([k,v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="tytul" render={({ field }) => (
              <FormItem>
                <FormLabel>Tytuł *</FormLabel>
                <FormControl><Input placeholder="np. Wizyta u kardiologa, Zmiana leków..." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="opis" render={({ field }) => (
              <FormItem>
                <FormLabel>Opis</FormLabel>
                <FormControl><Textarea rows={2} {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={mut.isPending}>Anuluj</Button>
              <Button type="submit" disabled={mut.isPending}>
                {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Zapisz
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
