import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  X,
  CalendarClock,
  User,
  Clock,
  StickyNote,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Printer,
  RefreshCw,
  Truck,
  Lock,
  AlertTriangle,
} from "lucide-react";
import { format, addDays, startOfDay, endOfDay } from "date-fns";
import { pl } from "date-fns/locale";

import { VisitsMap, type MapPin, type MapPinCategory, PIN_CATEGORY_COLOR } from "@/components/VisitsMap";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

type WizytySearch = { filter?: "alert" };

export const Route = createFileRoute("/_authenticated/_coordinator/wizyty")({
  validateSearch: (search: Record<string, unknown>): WizytySearch => ({
    filter: search.filter === "alert" ? "alert" : undefined,
  }),
  component: WizytyPage,
});

const NO_CAREGIVER = "__none__";

const visitSchema = z
  .object({
    senior_id: z.string().uuid("Wybierz seniora"),
    caregiver_id: z.string().optional(),
    planned_start: z.string().min(1, "Wymagane"),
    planned_end: z.string().min(1, "Wymagane"),
    planned_tasks: z.array(z.object({
      task_name: z.string(),
      requires_response: z.boolean().default(false),
    })),
    notes: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .refine((d) => new Date(d.planned_end) > new Date(d.planned_start), {
    path: ["planned_end"],
    message: "Koniec musi być po starcie",
  });

type VisitForm = z.infer<typeof visitSchema>;

// ─── Zlecenia dodatkowe (poza standardowymi wizytami opiekunek) ─────────────

const orderSchema = z.object({
  senior_id: z.string().uuid("Wybierz seniora"),
  order_type: z.string().trim().min(1, "Wymagane"),
  contractor: z.string().trim().optional().or(z.literal("")),
  scheduled_start: z.string().optional().or(z.literal("")),
  scheduled_end: z.string().optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

type OrderForm = z.infer<typeof orderSchema>;

const ORDER_TYPE_PRESETS = ["Transport medyczny", "Usługa złotej rączki", "Inne"];

type OrderRow = {
  id: string;
  order_type: string;
  contractor: string | null;
  scheduled_date: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  status: string;
  notes: string | null;
  requested_by_family: boolean;
  senior: { imie: string; nazwisko: string; lat: number | null; lng: number | null } | null;
};

const STATUS_TONE: Record<string, string> = {
  planned: "bg-muted text-muted-foreground",
  active: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  alert: "bg-red-500/15 text-red-700 dark:text-red-400",
  requires_verification: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  do_akceptacji: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  odrzucona: "bg-red-500/15 text-red-700 dark:text-red-400",
};

const STATUS_LABEL: Record<string, string> = {
  planned: "Zaplanowana",
  active: "W trakcie",
  completed: "Zakończona",
  alert: "Alarm",
  requires_verification: "Do weryfikacji",
  do_akceptacji: "Zgłoszenie od rodziny — do akceptacji",
  odrzucona: "Odrzucona",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Typ wizyty z bazy ───────────────────────────────────────────────────────

type VisitRow = {
  id: string;
  planned_start: string;
  planned_end: string;
  actual_start: string | null;
  actual_end: string | null;
  status: string;
  hours_billed: number | null;
  caregiver_id: string | null;
  notes: string | null;
  senior: { imie: string; nazwisko: string; lat: number | null; lng: number | null } | null;
  tasks: { id: string; task_name: string; completed: boolean }[];
};

// ─── Panel podglądu wizyty ───────────────────────────────────────────────────

function VisitDetailPanel({
  visit,
  caregivers,
  locked,
  onClose,
  onUpdated,
}: {
  visit: VisitRow;
  caregivers: { id: string; imie: string; nazwisko: string }[];
  locked: boolean;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const qc = useQueryClient();
  const [editingStatus, setEditingStatus] = useState(false);
  const [newStatus, setNewStatus] = useState(visit.status);
  const [editingCaregiver, setEditingCaregiver] = useState(false);
  const [newCaregiver, setNewCaregiver] = useState(visit.caregiver_id ?? NO_CAREGIVER);
  const [editingNotes, setEditingNotes] = useState(false);
  const [newNotes, setNewNotes] = useState(visit.notes ?? "");
  const [editingTime, setEditingTime] = useState(false);
  const [newStart, setNewStart] = useState(visit.planned_start.slice(0, 16));
  const [newEnd, setNewEnd] = useState(visit.planned_end.slice(0, 16));
  const [saving, setSaving] = useState(false);

  const senior = visit.senior;

  const save = async (patch: Record<string, unknown>) => {
    if (locked) {
      toast.error("Ten miesiąc jest zamknięty — edycja wizyt jest zablokowana. Poproś koordynatora o odblokowanie w Historii.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("visits").update(patch).eq("id", visit.id);
      if (error) throw error;
      toast.success("Zaktualizowano wizytę");
      qc.invalidateQueries({ queryKey: ["visits-list"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      onUpdated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const completedTasks = visit.tasks.filter((t) => t.completed);
  const pendingTasks = visit.tasks.filter((t) => !t.completed);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 h-full w-full max-w-md overflow-y-auto bg-background shadow-2xl">
        {/* Nagłówek */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-5 py-4">
          <div>
            <div className="font-semibold">
              {senior ? `${senior.nazwisko} ${senior.imie}` : "Wizyta"}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatDateTime(visit.planned_start)} – {formatTime(visit.planned_end)}
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {locked && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-sm text-amber-800">
              <Lock className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>Ten miesiąc jest zamknięty — edycja wizyt jest zablokowana. Odblokować można w zakładce Historia.</span>
            </div>
          )}
          {/* Status */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <CalendarClock className="h-4 w-4" /> Status wizyty
              </h3>
              <Badge variant="secondary" className={STATUS_TONE[visit.status] ?? ""}>
                {STATUS_LABEL[visit.status] ?? visit.status}
              </Badge>
            </div>
            {editingStatus ? (
              <div className="space-y-2">
                <Select value={newStatus} onValueChange={setNewStatus}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Button size="sm" disabled={saving} onClick={() => {
                    save({ status: newStatus });
                    setEditingStatus(false);
                  }}>
                    {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                    Zapisz
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingStatus(false)}>
                    Anuluj
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setEditingStatus(true)}>
                Zmień status
              </Button>
            )}
          </div>

          {/* Opiekun */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <User className="h-4 w-4" /> Opiekun
            </h3>
            {editingCaregiver ? (
              <div className="space-y-2">
                <Select value={newCaregiver} onValueChange={setNewCaregiver}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CAREGIVER}>Brak — przypiszę później</SelectItem>
                    {caregivers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nazwisko} {c.imie}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Button size="sm" disabled={saving} onClick={() => {
                    save({ caregiver_id: newCaregiver === NO_CAREGIVER ? null : newCaregiver });
                    setEditingCaregiver(false);
                  }}>
                    {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                    Zapisz
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingCaregiver(false)}>
                    Anuluj
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {visit.caregiver_id
                    ? caregivers.find((c) => c.id === visit.caregiver_id)
                        ? `${caregivers.find((c) => c.id === visit.caregiver_id)!.imie} ${caregivers.find((c) => c.id === visit.caregiver_id)!.nazwisko}`
                        : "Nieznany opiekun"
                    : "Nie przypisano"}
                </span>
                <Button size="sm" variant="outline" onClick={() => setEditingCaregiver(true)}>
                  Zmień
                </Button>
              </div>
            )}
          </div>

          {/* Czas */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4" /> Czas realizacji
            </h3>
            {editingTime ? (
              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground uppercase tracking-wide">Planowany start</label>
                    <input
                      type="datetime-local"
                      value={newStart}
                      onChange={(e) => setNewStart(e.target.value)}
                      className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground uppercase tracking-wide">Planowany koniec</label>
                    <input
                      type="datetime-local"
                      value={newEnd}
                      onChange={(e) => setNewEnd(e.target.value)}
                      className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={saving} onClick={() => {
                    if (new Date(newEnd) <= new Date(newStart)) {
                      toast.error("Koniec musi być po starcie");
                      return;
                    }
                    save({
                      planned_start: new Date(newStart).toISOString(),
                      planned_end: new Date(newEnd).toISOString(),
                    });
                    setEditingTime(false);
                  }}>
                    {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                    Zapisz
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingTime(false)}>
                    Anuluj
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Planowany start</div>
                    <div>{formatDateTime(visit.planned_start)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Planowany koniec</div>
                    <div>{formatTime(visit.planned_end)}</div>
                  </div>
                  {visit.actual_start && (
                    <div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">Faktyczny start (NFC)</div>
                      <div className="text-emerald-700">{formatDateTime(visit.actual_start)}</div>
                    </div>
                  )}
                  {visit.actual_end && (
                    <div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">Faktyczny koniec (NFC)</div>
                      <div className="text-emerald-700">{formatTime(visit.actual_end)}</div>
                    </div>
                  )}
                  {visit.hours_billed != null && visit.hours_billed > 0 && (
                    <div className="col-span-2">
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">Godziny rozliczeniowe</div>
                      <div className="text-lg font-semibold">{visit.hours_billed} h</div>
                    </div>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={() => setEditingTime(true)}>
                  Zmień termin
                </Button>
              </>
            )}
          </div>

          {/* Czynności */}
          {visit.tasks.length > 0 && (
            <div className="rounded-lg border bg-card p-4 space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <CheckSquare className="h-4 w-4" /> Czynności ({completedTasks.length}/{visit.tasks.length})
              </h3>
              <div className="space-y-1">
                {visit.tasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-sm">
                    <div className={`h-2 w-2 rounded-full flex-shrink-0 ${t.completed ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                    <span className={t.completed ? "line-through text-muted-foreground" : ""}>
                      {t.task_name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notatka */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <StickyNote className="h-4 w-4" /> Notatka
            </h3>
            {editingNotes ? (
              <div className="space-y-2">
                <Textarea
                  rows={4}
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Uwagi, obserwacje..."
                />
                <div className="flex gap-2">
                  <Button size="sm" disabled={saving} onClick={() => {
                    save({ notes: newNotes || null });
                    setEditingNotes(false);
                  }}>
                    {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                    Zapisz
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingNotes(false)}>
                    Anuluj
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {visit.notes || "Brak notatki"}
                </p>
                <Button size="sm" variant="outline" onClick={() => setEditingNotes(true)}>
                  {visit.notes ? "Edytuj notatką" : "Dodaj notatkę"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Główna strona ────────────────────────────────────────────────────────────

function WizytyPage() {
  const { filter } = Route.useSearch();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState<VisitRow | null>(null);
  const queryClient = useQueryClient();

  const seniorsQ = useQuery({
    queryKey: ["seniors-active-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seniors")
        .select("id, imie, nazwisko, status, plan_wsparcia")
        .neq("status", "nieaktywny")
        .order("nazwisko");
      if (error) throw error;
      return data ?? [];
    },
  });

  const caregiversQ = useQuery({
    queryKey: ["caregivers-list"],
    queryFn: async () => {
      const { data: roles, error: rolesErr } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "caregiver");
      if (rolesErr) throw rolesErr;
      const ids = (roles ?? []).map((r) => r.user_id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, imie, nazwisko")
        .in("id", ids)
        .order("nazwisko");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const dayStartISO = useMemo(() => startOfDay(selectedDate).toISOString(), [selectedDate]);
  const dayEndISO = useMemo(() => endOfDay(selectedDate).toISOString(), [selectedDate]);
  const dateKey = format(selectedDate, "yyyy-MM-dd");

  const { data: isMonthLocked } = useQuery({
    queryKey: ["is-month-locked", dateKey.slice(0, 7)],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_month_locked" as never, { check_date: dateKey } as never);
      if (error) return false;
      return !!data;
    },
  });

  const visitsQ = useQuery({
    queryKey: ["visits-list", filter, dateKey],
    refetchInterval: false,
    queryFn: async () => {
      let q = supabase
        .from("visits")
        .select(
          `id, planned_start, planned_end, actual_start, actual_end,
           status, hours_billed, caregiver_id, notes,
           senior:seniors(imie, nazwisko, lat, lng),
           tasks:visit_tasks(id, task_name, completed)`,
        )
        .gte("planned_start", dayStartISO)
        .lte("planned_start", dayEndISO)
        .order("planned_start", { ascending: true })
        .limit(200);
      if (filter === "alert") q = q.eq("status", "alert");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });

  const ordersQ = useQuery({
    queryKey: ["additional-orders-list", dateKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("additional_orders")
        .select(
          `id, order_type, contractor, scheduled_date, scheduled_start, scheduled_end,
           status, notes, requested_by_family,
           senior:seniors(imie, nazwisko, lat, lng)`,
        )
        .eq("scheduled_date", dateKey)
        .order("scheduled_start", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as OrderRow[];
    },
  });

  const form = useForm<VisitForm>({
    resolver: zodResolver(visitSchema),
    defaultValues: {
      senior_id: "",
      caregiver_id: NO_CAREGIVER,
      planned_start: "",
      planned_end: "",
      planned_tasks: [],
      notes: "",
    },
  });

  const selectedSeniorId = form.watch("senior_id");
  const selectedSenior = seniorsQ.data?.find((s) => s.id === selectedSeniorId);
  const planTasks: string[] = Array.isArray(selectedSenior?.plan_wsparcia)
    ? (selectedSenior!.plan_wsparcia as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];

  const watchedCaregiverId = form.watch("caregiver_id");
  const watchedStart = form.watch("planned_start");
  const watchedEnd = form.watch("planned_end");
  const hasRealCaregiver = !!watchedCaregiverId && watchedCaregiverId !== NO_CAREGIVER;

  // Okno ±8 dni wokół planowanej wizyty — wystarcza do sprawdzenia odpoczynku
  // dobowego i sumy godzin w tygodniu (ISO), bez pobierania całej historii opiekuna.
  const scheduleCheckWindowStart = watchedStart ? addDays(new Date(watchedStart), -8).toISOString() : null;
  const scheduleCheckWindowEnd = watchedStart ? addDays(new Date(watchedStart), 8).toISOString() : null;

  const { data: caregiverOtherVisits } = useQuery({
    queryKey: ["caregiver-schedule-check", watchedCaregiverId, scheduleCheckWindowStart],
    enabled: hasRealCaregiver && !!scheduleCheckWindowStart,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select("id, planned_start, planned_end, hours_billed")
        .eq("caregiver_id", watchedCaregiverId!)
        .gte("planned_start", scheduleCheckWindowStart!)
        .lte("planned_start", scheduleCheckWindowEnd!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const scheduleWarnings = useMemo(() => {
    if (!hasRealCaregiver || !watchedStart || !watchedEnd) return [];
    const warnings: string[] = [];
    const newStart = new Date(watchedStart);
    const newEnd = new Date(watchedEnd);
    if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) return [];

    const others = (caregiverOtherVisits ?? []).map((v) => ({
      start: new Date(v.planned_start),
      end: new Date(v.planned_end),
    }));

    // Odpoczynek dobowy — Kodeks pracy wymaga min. 11h nieprzerwanego odpoczynku
    for (const o of others) {
      const gapAfterOther = (newStart.getTime() - o.end.getTime()) / 3_600_000;
      const gapBeforeOther = (o.start.getTime() - newEnd.getTime()) / 3_600_000;
      if (gapAfterOther >= 0 && gapAfterOther < 11) {
        warnings.push(`Za mało odpoczynku przed tą wizytą — tylko ${gapAfterOther.toFixed(1)}h od poprzedniej (wymagane min. 11h).`);
      }
      if (gapBeforeOther >= 0 && gapBeforeOther < 11) {
        warnings.push(`Za mało odpoczynku po tej wizycie — tylko ${gapBeforeOther.toFixed(1)}h do kolejnej (wymagane min. 11h).`);
      }
    }

    // Suma godzin w tygodniu (Pon–Nd) — orientacyjny limit 48h/tydzień
    const dayOfWeek = newStart.getDay() === 0 ? 6 : newStart.getDay() - 1;
    const weekStart = new Date(newStart);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - dayOfWeek);
    const weekEnd = addDays(weekStart, 7);
    const thisWeekHours = others
      .filter((o) => o.start >= weekStart && o.start < weekEnd)
      .reduce((sum, o) => sum + (o.end.getTime() - o.start.getTime()) / 3_600_000, 0);
    const newHours = (newEnd.getTime() - newStart.getTime()) / 3_600_000;
    const totalWeekHours = thisWeekHours + newHours;
    if (totalWeekHours > 48) {
      warnings.push(`Suma godzin w tym tygodniu wyniesie ok. ${totalWeekHours.toFixed(1)}h — powyżej orientacyjnego limitu 48h/tydzień.`);
    }

    return warnings;
  }, [hasRealCaregiver, watchedStart, watchedEnd, caregiverOtherVisits]);

  const createMut = useMutation({
    mutationFn: async (v: VisitForm) => {
      const { data: visit, error } = await supabase
        .from("visits")
        .insert({
          senior_id: v.senior_id,
          caregiver_id:
            v.caregiver_id && v.caregiver_id !== NO_CAREGIVER ? v.caregiver_id : null,
          planned_start: new Date(v.planned_start).toISOString(),
          planned_end: new Date(v.planned_end).toISOString(),
          notes: v.notes || null,
          status: "planned",
        })
        .select("id")
        .single();
      if (error) throw error;
      if (v.planned_tasks.length > 0) {
        const { error: tErr } = await supabase.from("visit_tasks").insert(
          v.planned_tasks.map((t) => ({
            visit_id: visit.id,
            task_name: t.task_name,
            requires_response: t.requires_response,
          })),
        );
        if (tErr) throw tErr;
      }
    },
    onSuccess: () => {
      toast.success("Wizyta zaplanowana");
      queryClient.invalidateQueries({ queryKey: ["visits-list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      form.reset();
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decideOrderMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "planned" | "odrzucona" }) => {
      const { error } = await supabase.from("additional_orders").update({ status } as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.status === "planned" ? "Zgłoszenie zaakceptowane" : "Zgłoszenie odrzucone");
      queryClient.invalidateQueries({ queryKey: ["additional-orders-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ─── Zlecenia dodatkowe: formularz i mutacja ─────────────────────────────
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const orderForm = useForm<OrderForm>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      senior_id: "",
      order_type: "",
      contractor: "",
      scheduled_start: "",
      scheduled_end: "",
      notes: "",
    },
  });

  const createOrderMut = useMutation({
    mutationFn: async (v: OrderForm) => {
      const { error } = await supabase.from("additional_orders").insert({
        senior_id: v.senior_id,
        order_type: v.order_type,
        contractor: v.contractor || null,
        scheduled_date: dateKey,
        scheduled_start: v.scheduled_start || null,
        scheduled_end: v.scheduled_end || null,
        notes: v.notes || null,
        status: "planned",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Zlecenie dodatkowe dodane");
      queryClient.invalidateQueries({ queryKey: ["additional-orders-list"] });
      orderForm.reset();
      setOrderDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ─── Widok dnia: filtry, sekcje, mapa ────────────────────────────────────
  const [seniorFilter, setSeniorFilter] = useState<string>("__all__");
  const [caregiverFilter, setCaregiverFilter] = useState<string>("__all__");
  const [archiveOpen, setArchiveOpen] = useState(true);
  const [ordersOpen, setOrdersOpen] = useState(true);
  const [highlightCategory, setHighlightCategory] = useState<MapPinCategory | null>(null);

  const visitsForDay = visitsQ.data ?? [];
  const ordersForDay = ordersQ.data ?? [];

  // Filtrowanie po senior/opiekun wybranych w selektorach nad tabelą
  const visitsFilteredBySelectors = visitsForDay.filter((v) => {
    const matchesCaregiver = caregiverFilter === "__all__" || v.caregiver_id === caregiverFilter;
    const seniorLabel = v.senior ? `${v.senior.nazwisko} ${v.senior.imie}` : null;
    const matchesSenior = seniorFilter === "__all__" || seniorLabel === seniorFilter;
    return matchesCaregiver && matchesSenior;
  });

  const currentVisits = visitsFilteredBySelectors.filter((v) => v.status !== "completed");
  const archiveVisits = visitsFilteredBySelectors.filter((v) => v.status === "completed");
  const activeCount = currentVisits.filter((v) => v.status === "active").length;
  const plannedCount = currentVisits.filter((v) => v.status === "planned").length;
  const completedCount = archiveVisits.length;
  const ordersCount = ordersForDay.length;

  const mapPins: MapPin[] = useMemo(() => {
    const pins: MapPin[] = [];
    for (const v of currentVisits) {
      if (!v.senior?.lat || !v.senior?.lng) continue;
      pins.push({
        id: `visit-${v.id}`,
        lat: v.senior.lat,
        lng: v.senior.lng,
        label: `${v.senior.nazwisko} ${v.senior.imie} — ${formatTime(v.planned_start)} (${STATUS_LABEL[v.status] ?? v.status})`,
        category: v.status === "active" ? "active" : "planned",
      });
    }
    for (const v of archiveVisits) {
      if (!v.senior?.lat || !v.senior?.lng) continue;
      pins.push({
        id: `visit-${v.id}`,
        lat: v.senior.lat,
        lng: v.senior.lng,
        label: `${v.senior.nazwisko} ${v.senior.imie} — ${formatTime(v.planned_start)} (zakończona)`,
        category: "completed",
      });
    }
    for (const o of ordersForDay) {
      if (!o.senior?.lat || !o.senior?.lng) continue;
      pins.push({
        id: `order-${o.id}`,
        lat: o.senior.lat,
        lng: o.senior.lng,
        label: `${o.senior.nazwisko} ${o.senior.imie} — ${o.order_type}`,
        category: "additional",
      });
    }
    return pins;
  }, [currentVisits, archiveVisits, ordersForDay]);

  const isRefreshing = visitsQ.isFetching || ordersQ.isFetching;
  const refreshAll = () => {
    visitsQ.refetch();
    ordersQ.refetch();
  };

  const toggleHighlight = (cat: MapPinCategory) => {
    setHighlightCategory((prev) => (prev === cat ? null : cat));
  };

  const caregiverName = (id: string | null) => {
    if (!id) return <span className="text-muted-foreground">—</span>;
    const c = caregiversQ.data?.find((x) => x.id === id);
    return c ? `${c.imie} ${c.nazwisko}` : <span className="text-muted-foreground">—</span>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Monitor Wizyt</h1>
        <p className="text-sm text-muted-foreground">
          Przegląd działalności firmy w czasie rzeczywistym.
        </p>
      </div>

      {isMonthLocked && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
          <Lock className="h-4 w-4 flex-shrink-0" />
          Miesiąc {format(selectedDate, "LLLL yyyy", { locale: pl })} jest zamknięty — wizyty i zlecenia dodatkowe z tego okresu nie można dodawać, zmieniać ani usuwać. Odblokować można w zakładce Historia.
        </div>
      )}

      {/* Pasek dnia: nawigacja, filtry, druk, dodawanie */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <div className="font-medium">
          Aktualne i zaplanowane wizyty na dzień {format(selectedDate, "dd.MM.yyyy", { locale: pl })}r.
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setSelectedDate((d) => addDays(d, -1))}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setSelectedDate((d) => addDays(d, 1))}>
            <ChevronRight />
          </Button>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={seniorFilter} onValueChange={setSeniorFilter}>
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue placeholder="Wybierz Seniora" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Wszyscy seniorzy</SelectItem>
              {seniorsQ.data?.map((s) => (
                <SelectItem key={s.id} value={`${s.nazwisko} ${s.imie}`}>
                  {s.nazwisko} {s.imie}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={caregiverFilter} onValueChange={setCaregiverFilter}>
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue placeholder="Wybierz Opiekuna" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Wszyscy opiekunowie</SelectItem>
              {caregiversQ.data?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nazwisko} {c.imie}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer />
            Drukuj grafik (PDF)
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button disabled={!!isMonthLocked} title={isMonthLocked ? "Miesiąc zamknięty — dodawanie wyłączone" : undefined}>
                <Plus />
                Zaplanuj nową usługę
              </Button>
            </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Nowa wizyta</DialogTitle>
              <DialogDescription>
                Zaplanuj wizytę u seniora. Opiekuna możesz przypisać teraz lub później.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((v) => createMut.mutate(v))}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="senior_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Senior *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Wybierz seniora" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {seniorsQ.data?.length === 0 ? (
                            <div className="px-2 py-3 text-sm text-muted-foreground">
                              Brak seniorów — dodaj najpierw seniora.
                            </div>
                          ) : (
                            seniorsQ.data?.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.nazwisko} {s.imie}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="caregiver_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Opiekun</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Brak — przypiszę później" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={NO_CAREGIVER}>Brak — przypiszę później</SelectItem>
                          {caregiversQ.data?.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.nazwisko} {c.imie}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="planned_start"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Początek *</FormLabel>
                        <FormControl>
                          <Input type="datetime-local" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="planned_end"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Koniec *</FormLabel>
                        <FormControl>
                          <Input type="datetime-local" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="planned_tasks"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Planowane czynności</FormLabel>
                      {!selectedSeniorId ? (
                        <FormDescription>
                          Wybierz najpierw seniora, by zobaczyć jego plan wsparcia.
                        </FormDescription>
                      ) : (
                        <div className="space-y-3">
                          {/* Czynności z planu wsparcia */}
                          {planTasks.length > 0 && (
                            <div className="space-y-2 rounded-md border p-3">
                              <p className="text-xs font-medium text-muted-foreground">Z planu wsparcia:</p>
                              {planTasks.map((task) => {
                                const existing = field.value.find(t => t.task_name === task);
                                const checked = !!existing;
                                return (
                                  <div key={task} className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      <Checkbox
                                        checked={checked}
                                        onCheckedChange={(c) => {
                                          if (c) field.onChange([...field.value, { task_name: task, requires_response: false }]);
                                          else field.onChange(field.value.filter(t => t.task_name !== task));
                                        }}
                                      />
                                      <span className="text-sm flex-1">{task}</span>
                                      {checked && (
                                        <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                                          <Checkbox
                                            checked={existing?.requires_response ?? false}
                                            onCheckedChange={(c) => {
                                              field.onChange(field.value.map(t =>
                                                t.task_name === task ? { ...t, requires_response: !!c } : t
                                              ));
                                            }}
                                          />
                                          <span>+ pole odpowiedzi</span>
                                        </label>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Jednorazowe czynności dodatkowe */}
                          <div className="rounded-md border p-3 space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">Dodatkowe czynności dla tej wizyty:</p>
                            {field.value
                              .filter(t => !planTasks.includes(t.task_name))
                              .map((task, idx) => (
                                <div key={idx} className="space-y-1">
                                  <div className="flex items-center gap-2 text-sm">
                                    <CheckSquare className="h-4 w-4 text-primary flex-shrink-0" />
                                    <span className="flex-1">{task.task_name}</span>
                                    <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                                      <Checkbox
                                        checked={task.requires_response}
                                        onCheckedChange={(c) => {
                                          field.onChange(field.value.map(t =>
                                            t.task_name === task.task_name ? { ...t, requires_response: !!c } : t
                                          ));
                                        }}
                                      />
                                      <span>+ pole odpowiedzi</span>
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() => field.onChange(field.value.filter(t => t.task_name !== task.task_name))}
                                      className="text-muted-foreground hover:text-destructive"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            <AddCustomTaskInput
                              onAdd={(task) => field.onChange([...field.value, { task_name: task, requires_response: false }])}
                            />
                          </div>

                          {planTasks.length === 0 && field.value.length === 0 && (
                            <FormDescription>
                              Senior nie ma planu wsparcia — dodaj czynności ręcznie powyżej.
                            </FormDescription>
                          )}
                        </div>
                      )}
                      <FormDescription>
                        Opiekun zobaczy tę listę po zalogowaniu do wizyty.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notatka</FormLabel>
                      <FormControl>
                        <Textarea rows={3} placeholder="Opcjonalne uwagi..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {scheduleWarnings.length > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-xs text-amber-800">
                    <div className="mb-1 flex items-center gap-1.5 font-medium">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Grafik może naruszać Kodeks pracy — to tylko ostrzeżenie, nadal można zapisać:
                    </div>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {scheduleWarnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDialogOpen(false)}
                    disabled={createMut.isPending}
                  >
                    Anuluj
                  </Button>
                  <Button type="submit" disabled={createMut.isPending}>
                    {createMut.isPending && <Loader2 className="animate-spin" />}
                    Zaplanuj
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Tabela: Aktualne i zaplanowane wizyty */}
      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3 text-sm font-medium">Aktualne i zaplanowane wizyty</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Senior</TableHead>
              <TableHead>Godzina</TableHead>
              <TableHead>Opiekunka</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Kwota rozliczenia</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visitsQ.isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : currentVisits.length > 0 ? (
              currentVisits.map((v) => {
                const senior = v.senior;
                const tasks = v.tasks ?? [];
                const doneCount = tasks.filter((t) => t.completed).length;
                return (
                  <TableRow
                    key={v.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setSelectedVisit(v)}
                  >
                    <TableCell className="font-medium">
                      <div>{senior ? `${senior.nazwisko} ${senior.imie}` : "—"}</div>
                      {tasks.length > 0 && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {doneCount}/{tasks.length} czynności
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatTime(v.planned_start)}
                    </TableCell>
                    <TableCell>{caregiverName(v.caregiver_id)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS_TONE[v.status] ?? ""}>
                        {STATUS_LABEL[v.status] ?? v.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {v.hours_billed && v.hours_billed > 0 ? (
                        `${v.hours_billed}h`
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  Brak wizyt na ten dzień. Kliknij „Zaplanuj nową usługę", aby dodać pierwszą.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Zrealizowane wizyty (archiwum dnia) */}
      <Collapsible open={archiveOpen} onOpenChange={setArchiveOpen}>
        <div className="rounded-lg border bg-card">
          <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium">
            Zrealizowane Wizyty (Archiwum)
            {archiveOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Senior</TableHead>
                  <TableHead>Data wizyty</TableHead>
                  <TableHead>Godzina</TableHead>
                  <TableHead>Opiekunka</TableHead>
                  <TableHead>Kwota rozliczenia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {archiveVisits.length > 0 ? (
                  archiveVisits.map((v) => (
                    <TableRow
                      key={v.id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setSelectedVisit(v)}
                    >
                      <TableCell className="font-medium">
                        {v.senior ? `${v.senior.nazwisko} ${v.senior.imie}` : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(v.planned_start), "dd.MM.yyyy")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatTime(v.planned_start)}
                      </TableCell>
                      <TableCell>{caregiverName(v.caregiver_id)}</TableCell>
                      <TableCell>
                        {v.hours_billed && v.hours_billed > 0 ? `${v.hours_billed}h` : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                      Brak zrealizowanych wizyt tego dnia.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Zlecenia dodatkowe */}
      <Collapsible open={ordersOpen} onOpenChange={setOrdersOpen}>
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between px-4 py-3">
            <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium">
              Zlecenia dodatkowe
              {ordersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </CollapsibleTrigger>
            <Dialog open={orderDialogOpen} onOpenChange={setOrderDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={!!isMonthLocked} title={isMonthLocked ? "Miesiąc zamknięty — dodawanie wyłączone" : undefined}>
                  <Plus />
                  Dodaj zlecenie
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Nowe zlecenie dodatkowe</DialogTitle>
                  <DialogDescription>
                    Usługa wykraczająca poza standardową wizytę opiekunki (np. transport, drobna naprawa),
                    na dzień {format(selectedDate, "dd.MM.yyyy")}.
                  </DialogDescription>
                </DialogHeader>
                <Form {...orderForm}>
                  <form
                    onSubmit={orderForm.handleSubmit((v) => createOrderMut.mutate(v))}
                    className="space-y-4"
                  >
                    <FormField
                      control={orderForm.control}
                      name="senior_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Senior *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Wybierz seniora" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {seniorsQ.data?.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.nazwisko} {s.imie}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={orderForm.control}
                      name="order_type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Typ zlecenia *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Wybierz typ" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {ORDER_TYPE_PRESETS.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={orderForm.control}
                      name="contractor"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Wykonawca</FormLabel>
                          <FormControl>
                            <Input placeholder="np. Firma transportowa Kowalscy" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={orderForm.control}
                        name="scheduled_start"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Godzina od</FormLabel>
                            <FormControl>
                              <Input type="time" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={orderForm.control}
                        name="scheduled_end"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Godzina do</FormLabel>
                            <FormControl>
                              <Input type="time" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={orderForm.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notatka</FormLabel>
                          <FormControl>
                            <Textarea rows={3} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setOrderDialogOpen(false)}
                        disabled={createOrderMut.isPending}
                      >
                        Anuluj
                      </Button>
                      <Button type="submit" disabled={createOrderMut.isPending}>
                        {createOrderMut.isPending && <Loader2 className="animate-spin" />}
                        Dodaj
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
          <CollapsibleContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Senior</TableHead>
                  <TableHead>Typ zlecenia</TableHead>
                  <TableHead>Godzina</TableHead>
                  <TableHead>Wykonawca</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordersForDay.length > 0 ? (
                  ordersForDay.map((o) => (
                    <TableRow key={o.id} className={o.status === "do_akceptacji" ? "bg-violet-500/5" : ""}>
                      <TableCell className="font-medium">
                        {o.senior ? `${o.senior.nazwisko} ${o.senior.imie}` : "—"}
                      </TableCell>
                      <TableCell className="flex items-center gap-2 text-sm">
                        <Truck className="h-4 w-4 text-violet-600" />
                        {o.order_type}
                        {o.requested_by_family && (
                          <Badge variant="secondary" className="text-xs bg-violet-500/15 text-violet-700">Od rodziny</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {o.scheduled_start ? o.scheduled_start.slice(0, 5) : "—"}
                        {o.scheduled_end ? ` – ${o.scheduled_end.slice(0, 5)}` : ""}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {o.contractor || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={STATUS_TONE[o.status] ?? ""}>
                          {STATUS_LABEL[o.status] ?? o.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {o.status === "do_akceptacji" && (
                          <div className="flex gap-1.5">
                            <Button size="sm" onClick={() => decideOrderMut.mutate({ id: o.id, status: "planned" })}>
                              Akceptuj
                            </Button>
                            <Button
                              size="sm" variant="outline"
                              className="text-destructive hover:text-destructive"
                              onClick={() => decideOrderMut.mutate({ id: o.id, status: "odrzucona" })}
                            >
                              Odrzuć
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      Brak zleceń dodatkowych tego dnia.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Mapa + Szybkie filtry dnia */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="h-[420px] lg:col-span-2">
          <VisitsMap pins={mapPins} highlight={highlightCategory} />
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Szybkie Filtry Dnia</h2>
            <Button size="sm" variant="outline" onClick={refreshAll} disabled={isRefreshing}>
              <RefreshCw className={isRefreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Odśwież podgląd
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => toggleHighlight("active")}
              className={`rounded-lg border bg-card p-3 text-left transition-shadow ${
                highlightCategory === "active" ? "ring-2 ring-offset-1" : ""
              }`}
              style={{ ringColor: PIN_CATEGORY_COLOR.active } as React.CSSProperties}
            >
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                W trakcie realizacji
              </div>
              <div className="text-2xl font-bold" style={{ color: PIN_CATEGORY_COLOR.active }}>
                {activeCount}
              </div>
            </button>
            <button
              type="button"
              onClick={() => toggleHighlight("additional")}
              className={`rounded-lg border bg-card p-3 text-left transition-shadow ${
                highlightCategory === "additional" ? "ring-2 ring-offset-1" : ""
              }`}
            >
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Zlecenia dodatkowe
              </div>
              <div className="text-2xl font-bold" style={{ color: PIN_CATEGORY_COLOR.additional }}>
                {ordersCount}
              </div>
            </button>
            <button
              type="button"
              onClick={() => toggleHighlight("planned")}
              className={`rounded-lg border bg-card p-3 text-left transition-shadow ${
                highlightCategory === "planned" ? "ring-2 ring-offset-1" : ""
              }`}
            >
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Zaplanowane
              </div>
              <div className="text-2xl font-bold" style={{ color: PIN_CATEGORY_COLOR.planned }}>
                {plannedCount}
              </div>
            </button>
            <button
              type="button"
              onClick={() => toggleHighlight("completed")}
              className={`rounded-lg border bg-card p-3 text-left transition-shadow ${
                highlightCategory === "completed" ? "ring-2 ring-offset-1" : ""
              }`}
            >
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Zakończone dzisiaj
              </div>
              <div className="text-2xl font-bold" style={{ color: PIN_CATEGORY_COLOR.completed }}>
                {completedCount}
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Panel szczegółów wizyty */}
      {selectedVisit && (
        <VisitDetailPanel
          visit={selectedVisit}
          caregivers={caregiversQ.data ?? []}
          locked={!!isMonthLocked}
          onClose={() => setSelectedVisit(null)}
          onUpdated={() => {
            setSelectedVisit(null);
            visitsQ.refetch();
          }}
        />
      )}
    </div>
  );
}

// ─── Pole dodawania jednorazowej czynności ────────────────────────────────────

function AddCustomTaskInput({ onAdd }: { onAdd: (task: string) => void }) {
  const [value, setValue] = useState("");

  const handleAdd = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
  };

  return (
    <div className="flex gap-2 mt-1">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Wpisz dodatkową czynność..."
        className="h-8 text-sm flex-1"
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
        }}
      />
      <button
        type="button"
        onClick={handleAdd}
        disabled={!value.trim()}
        className="flex items-center gap-1 rounded-md border bg-muted px-3 py-1 text-xs font-medium hover:bg-muted/80 disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" /> Dodaj
      </button>
    </div>
  );
}
