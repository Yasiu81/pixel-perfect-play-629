import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Plus, Loader2, X, CalendarClock, User, Clock, StickyNote, CheckSquare } from "lucide-react";

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
    planned_tasks: z.array(z.string()),
    notes: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .refine((d) => new Date(d.planned_end) > new Date(d.planned_start), {
    path: ["planned_end"],
    message: "Koniec musi być po starcie",
  });

type VisitForm = z.infer<typeof visitSchema>;

const STATUS_TONE: Record<string, string> = {
  planned: "bg-muted text-muted-foreground",
  active: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  alert: "bg-red-500/15 text-red-700 dark:text-red-400",
  requires_verification: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

const STATUS_LABEL: Record<string, string> = {
  planned: "Zaplanowana",
  active: "W trakcie",
  completed: "Zakończona",
  alert: "Alarm",
  requires_verification: "Do weryfikacji",
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
  senior: { imie: string; nazwisko: string } | null;
  tasks: { id: string; task_name: string; completed: boolean }[];
};

// ─── Panel podglądu wizyty ───────────────────────────────────────────────────

function VisitDetailPanel({
  visit,
  caregivers,
  onClose,
  onUpdated,
}: {
  visit: VisitRow;
  caregivers: { id: string; imie: string; nazwisko: string }[];
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
  const [saving, setSaving] = useState(false);

  const senior = visit.senior;

  const save = async (patch: Record<string, unknown>) => {
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
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4" /> Czas realizacji
            </h3>
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

  const visitsQ = useQuery({
    queryKey: ["visits-list", filter],
    refetchInterval: 30_000,
    queryFn: async () => {
      let q = supabase
        .from("visits")
        .select(
          `id, planned_start, planned_end, actual_start, actual_end,
           status, hours_billed, caregiver_id, notes,
           senior:seniors(imie, nazwisko),
           tasks:visit_tasks(id, task_name, completed)`,
        )
        .order("planned_start", { ascending: false })
        .limit(100);
      if (filter === "alert") q = q.eq("status", "alert");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
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
          v.planned_tasks.map((t) => ({ visit_id: visit.id, task_name: t })),
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

  const caregiverName = (id: string | null) => {
    if (!id) return <span className="text-muted-foreground">—</span>;
    const c = caregiversQ.data?.find((x) => x.id === id);
    return c ? `${c.imie} ${c.nazwisko}` : <span className="text-muted-foreground">—</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Monitor wizyt</h1>
          <p className="text-sm text-muted-foreground">
            Lista zaplanowanych wizyt{filter === "alert" ? " — filtr: alarmy" : ""}.{" "}
            <span className="text-xs">Kliknij w wiersz aby zobaczyć szczegóły.</span>
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus />
              Dodaj wizytę
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
                      ) : planTasks.length === 0 ? (
                        <FormDescription>
                          Senior nie ma jeszcze zdefiniowanego planu wsparcia.
                        </FormDescription>
                      ) : (
                        <div className="space-y-2 rounded-md border p-3">
                          {planTasks.map((task) => {
                            const checked = field.value.includes(task);
                            return (
                              <label
                                key={task}
                                className="flex cursor-pointer items-center gap-2 text-sm"
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(c) => {
                                    if (c) field.onChange([...field.value, task]);
                                    else
                                      field.onChange(
                                        field.value.filter((t) => t !== task),
                                      );
                                  }}
                                />
                                <span>{task}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      <FormDescription>
                        Pre-fill listy zadań, którą opiekun zobaczy podczas wizyty.
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

      {/* Tabela wizyt */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Senior</TableHead>
              <TableHead>Termin</TableHead>
              <TableHead>Opiekun</TableHead>
              <TableHead>Godz.</TableHead>
              <TableHead>Status</TableHead>
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
            ) : visitsQ.data && visitsQ.data.length > 0 ? (
              visitsQ.data.map((v) => {
                const senior = v.senior;
                const tasks = v.tasks ?? [];
                const completedCount = tasks.filter((t) => t.completed).length;
                return (
                  <TableRow
                    key={v.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setSelectedVisit(v)}
                  >
                    <TableCell className="font-medium">
                      <div>{senior ? `${senior.nazwisko} ${senior.imie}` : "—"}</div>
                      {/* Tooltip z czynnościami */}
                      {tasks.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {tasks.slice(0, 3).map((t) => (
                            <span
                              key={t.id}
                              className={`inline-block rounded px-1.5 py-0.5 text-xs ${
                                t.completed
                                  ? "bg-emerald-500/15 text-emerald-700 line-through"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {t.task_name}
                            </span>
                          ))}
                          {tasks.length > 3 && (
                            <span className="text-xs text-muted-foreground">
                              +{tasks.length - 3} więcej
                            </span>
                          )}
                        </div>
                      )}
                      {tasks.length > 0 && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {completedCount}/{tasks.length} czynności
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(v.planned_start)} → {formatTime(v.planned_end)}
                    </TableCell>
                    <TableCell>{caregiverName(v.caregiver_id)}</TableCell>
                    <TableCell>
                      {v.hours_billed && v.hours_billed > 0 ? (
                        `${v.hours_billed}h`
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS_TONE[v.status] ?? ""}>
                        {STATUS_LABEL[v.status] ?? v.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  Brak wizyt. Kliknij „Dodaj wizytę", aby zaplanować pierwszą.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Panel szczegółów wizyty */}
      {selectedVisit && (
        <VisitDetailPanel
          visit={selectedVisit}
          caregivers={caregiversQ.data ?? []}
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
