import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Plus, Loader2, X, Phone, MapPin, Award,
  Calendar, ChevronRight, AlertTriangle, CheckCircle2,
  Users, Pencil, Package, RotateCcw, ArrowDownToLine,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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

export const Route = createFileRoute(
  "/_authenticated/_coordinator/opiekunowie"
)({ component: OpiekunowiePage });

// ─── Typy ────────────────────────────────────────────────────────────────────

type Caregiver = {
  id: string;
  imie: string;
  nazwisko: string;
  email: string | null;
  telefon: string | null;
  dzielnice: string[] | null;
  rola: string | null;
  szkolenie_data: string | null;
  szkolenie_wazne_do: string | null;
  uwagi: string | null;
};

type Training = {
  id: string;
  caregiver_id: string;
  nazwa: string;
  data_szkolenia: string;
  wazne_do: string | null;
  instytucja: string | null;
};

// ─── Schematy ─────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  imie: z.string().trim().min(1, "Wymagane").max(80),
  nazwisko: z.string().trim().min(1, "Wymagane").max(80),
  telefon: z.string().trim().max(20).optional().or(z.literal("")),
  rola: z.string().min(1, "Wymagane"),
  dzielnice: z.string().trim().optional().or(z.literal("")),
  uwagi: z.string().trim().max(500).optional().or(z.literal("")),
});

const trainingSchema = z.object({
  nazwa: z.string().trim().min(1, "Wymagane"),
  data_szkolenia: z.string().min(1, "Wymagane"),
  wazne_do: z.string().optional().or(z.literal("")),
  instytucja: z.string().trim().optional().or(z.literal("")),
});

type ProfileForm = z.infer<typeof profileSchema>;
type TrainingForm = z.infer<typeof trainingSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pl-PL");
}

function trainingStatus(wazne_do: string | null) {
  if (!wazne_do) return { tone: "bg-muted text-muted-foreground", label: "bezterminowe" };
  const days = Math.ceil((new Date(wazne_do).getTime() - Date.now()) / 86400000);
  if (days < 0) return { tone: "bg-red-500/15 text-red-700", label: "wygasło" };
  if (days <= 30) return { tone: "bg-amber-500/15 text-amber-700", label: `wygasa za ${days} dni` };
  return { tone: "bg-emerald-500/15 text-emerald-700", label: `ważne do ${fmtDate(wazne_do)}` };
}

// ─── Główna strona ─────────────────────────────────────────────────────────

function OpiekunowiePage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Caregiver | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const { data: caregivers, isLoading } = useQuery({
    queryKey: ["caregivers-full"],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles").select("user_id").eq("role", "caregiver");
      const ids = (roles ?? []).map((r) => r.user_id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, imie, nazwisko, email, telefon, dzielnice, rola, szkolenie_data, szkolenie_wazne_do, uwagi")
        .in("id", ids)
        .order("nazwisko");
      if (error) throw error;
      return (data ?? []) as Caregiver[];
    },
  });

  const { data: seniors } = useQuery({
    queryKey: ["seniors-per-caregiver"],
    queryFn: async () => {
      const { data } = await supabase
        .from("seniors")
        .select("id, imie, nazwisko, opiekun_id")
        .eq("status", "aktywny")
        .not("opiekun_id", "is", null);
      return data ?? [];
    },
  });

  const seniorsByCaregiver = useMemo(() => {
    const m: Record<string, { imie: string; nazwisko: string }[]> = {};
    (seniors ?? []).forEach((s) => {
      if (!s.opiekun_id) return;
      if (!m[s.opiekun_id]) m[s.opiekun_id] = [];
      m[s.opiekun_id].push({ imie: s.imie, nazwisko: s.nazwisko });
    });
    return m;
  }, [seniors]);

  const selected = caregivers?.find((c) => c.id === selectedId) ?? null;

  // Alerty — opiekunowie z wygasającym szkoleniem
  const alerts = (caregivers ?? []).filter((c) => {
    if (!c.szkolenie_wazne_do) return false;
    const days = Math.ceil((new Date(c.szkolenie_wazne_do).getTime() - Date.now()) / 86400000);
    return days <= 30;
  });

  return (
    <div className="space-y-6">
      {/* Nagłówek */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Opiekunowie</h1>
          <p className="text-sm text-muted-foreground">
            Zarządzanie zespołem — {caregivers?.length ?? 0} osób
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Dodaj opiekuna
        </Button>
      </div>

      {/* Alert wygasające szkolenia */}
      {alerts.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700 mb-2">
            <AlertTriangle className="h-4 w-4" />
            {alerts.length === 1 ? "1 opiekun ma" : `${alerts.length} opiekunów ma`} wygasające szkolenie
          </div>
          <div className="flex flex-wrap gap-2">
            {alerts.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className="text-xs bg-amber-500/15 text-amber-700 rounded px-2 py-1 hover:bg-amber-500/25"
              >
                {c.imie} {c.nazwisko} — {fmtDate(c.szkolenie_wazne_do)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-6">
        {/* Lista opiekunów */}
        <div className="w-72 flex-shrink-0 space-y-2">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))
          ) : !caregivers || caregivers.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
              Brak opiekunów.<br />
              Kliknij <strong>"Dodaj opiekuna"</strong> aby utworzyć pierwsze konto.
            </div>
          ) : (
            caregivers.map((c) => {
              const st = c.szkolenie_wazne_do
                ? trainingStatus(c.szkolenie_wazne_do)
                : null;
              const podopieczni = seniorsByCaregiver[c.id]?.length ?? 0;
              const isSelected = selectedId === c.id;

              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full rounded-xl border p-4 text-left transition-all ${
                    isSelected
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "bg-card hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">
                        {c.nazwisko} {c.imie}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {c.rola ?? "Opiekun"} · {podopieczni} podopiecznych
                      </div>
                      {st && (
                        <Badge variant="secondary" className={`mt-1.5 text-xs ${st.tone}`}>
                          {st.label}
                        </Badge>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Panel szczegółów */}
        {selected ? (
          <div className="flex-1 space-y-4">
            {/* Nagłówek opiekuna */}
            <div className="rounded-xl border bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">
                      {selected.imie[0]}{selected.nazwisko[0]}
                    </div>
                    <div>
                      <div className="font-semibold text-lg">
                        {selected.imie} {selected.nazwisko}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {selected.rola ?? "Opiekun senioralny"}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
                    {selected.telefon && (
                      <a href={`tel:${selected.telefon}`} className="flex items-center gap-1 hover:text-primary">
                        <Phone className="h-3.5 w-3.5" />{selected.telefon}
                      </a>
                    )}
                    {selected.email && (
                      <a href={`mailto:${selected.email}`} className="hover:text-primary">
                        {selected.email}
                      </a>
                    )}
                    {selected.dzielnice && selected.dzielnice.length > 0 && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {selected.dzielnice.join(", ")}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setEditTarget(selected); setEditOpen(true); }}
                >
                  <Pencil className="h-4 w-4" />
                  Edytuj
                </Button>
              </div>

              {selected.uwagi && (
                <div className="mt-3 rounded-md bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  {selected.uwagi}
                </div>
              )}
            </div>

            {/* Podopieczni */}
            <div className="rounded-xl border bg-card p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
                <Users className="h-4 w-4" />
                Podopieczni ({seniorsByCaregiver[selected.id]?.length ?? 0})
              </h3>
              {!seniorsByCaregiver[selected.id] || seniorsByCaregiver[selected.id].length === 0 ? (
                <p className="text-sm text-muted-foreground">Brak przypisanych podopiecznych.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {seniorsByCaregiver[selected.id].map((s, i) => (
                    <span key={i} className="rounded-full bg-muted px-3 py-1 text-sm">
                      {s.imie} {s.nazwisko}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Szkolenia */}
            <TrainingsPanel caregiverId={selected.id} />
            <EquipmentPanel caregiverId={selected.id} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center rounded-xl border border-dashed bg-card text-sm text-muted-foreground">
            Wybierz opiekuna z listy aby zobaczyć szczegóły
          </div>
        )}
      </div>

      {/* Dialog edycji profilu */}
      {editOpen && editTarget && (
        <EditProfileDialog
          caregiver={editTarget}
          open={editOpen}
          onClose={() => { setEditOpen(false); setEditTarget(null); }}
        />
      )}

      {addOpen && (
        <AddCaregiverDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Panel szkoleń ────────────────────────────────────────────────────────────

function TrainingsPanel({ caregiverId }: { caregiverId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const { data: trainings, isLoading } = useQuery({
    queryKey: ["trainings", caregiverId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("caregiver_trainings")
        .select("id, caregiver_id, nazwa, data_szkolenia, wazne_do, instytucja")
        .eq("caregiver_id", caregiverId)
        .order("data_szkolenia", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Training[];
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("caregiver_trainings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Szkolenie usunięte");
      qc.invalidateQueries({ queryKey: ["trainings", caregiverId] });
    },
  });

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Award className="h-4 w-4" />
          Szkolenia i kwalifikacje
        </h3>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          Dodaj
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : !trainings || trainings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Brak wpisanych szkoleń. Kliknij "Dodaj" aby dodać pierwsze.
        </p>
      ) : (
        <div className="space-y-2">
          {trainings.map((t) => {
            const st = trainingStatus(t.wazne_do ?? null);
            return (
              <div key={t.id} className="flex items-start justify-between rounded-lg border bg-muted/20 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t.nazwa}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {fmtDate(t.data_szkolenia)}
                    {t.instytucja && ` · ${t.instytucja}`}
                  </div>
                  <Badge variant="secondary" className={`mt-1 text-xs ${st.tone}`}>
                    {st.label}
                  </Badge>
                </div>
                <button
                  onClick={() => deleteMut.mutate(t.id)}
                  className="ml-2 flex-shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {addOpen && (
        <AddTrainingDialog
          caregiverId={caregiverId}
          open={addOpen}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Dialog: dodaj szkolenie ──────────────────────────────────────────────────

function AddTrainingDialog({
  caregiverId,
  open,
  onClose,
}: {
  caregiverId: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<TrainingForm>({
    resolver: zodResolver(trainingSchema),
    defaultValues: { nazwa: "", data_szkolenia: "", wazne_do: "", instytucja: "" },
  });

  const mut = useMutation({
    mutationFn: async (v: TrainingForm) => {
      const { error } = await supabase.from("caregiver_trainings").insert({
        caregiver_id: caregiverId,
        nazwa: v.nazwa.trim(),
        data_szkolenia: v.data_szkolenia,
        wazne_do: v.wazne_do || null,
        instytucja: v.instytucja?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Szkolenie dodane");
      qc.invalidateQueries({ queryKey: ["trainings", caregiverId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dodaj szkolenie</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mut.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="nazwa" render={({ field }) => (
              <FormItem>
                <FormLabel>Nazwa szkolenia *</FormLabel>
                <FormControl><Input placeholder="np. Kurs pierwszej pomocy" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="data_szkolenia" render={({ field }) => (
                <FormItem>
                  <FormLabel>Data szkolenia *</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="wazne_do" render={({ field }) => (
                <FormItem>
                  <FormLabel>Ważne do</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="instytucja" render={({ field }) => (
              <FormItem>
                <FormLabel>Instytucja szkoląca</FormLabel>
                <FormControl><Input placeholder="np. Centrum Kształcenia" {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Anuluj</Button>
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

// ─── Dialog: edytuj profil ────────────────────────────────────────────────────

// ─── Panel wyposażenia (wydania z magazynu) ───────────────────────────────────

const KATEGORIA_LABEL: Record<string, string> = {
  sprzet_medyczny: "Sprzęt medyczny",
  srodki_higieniczne: "Środki higieniczne",
  narzedzia: "Narzędzia",
  dokumenty: "Dokumenty",
  inne: "Inne",
};

const KATEGORIA_TONE: Record<string, string> = {
  sprzet_medyczny: "bg-red-500/15 text-red-700",
  srodki_higieniczne: "bg-sky-500/15 text-sky-700",
  narzedzia: "bg-amber-500/15 text-amber-700",
  dokumenty: "bg-violet-500/15 text-violet-700",
  inne: "bg-muted text-muted-foreground",
};

type EquipmentLoan = {
  id: string;
  nazwa: string;
  kategoria: string;
  nr_seryjny: string | null;
  ilosc: number;
  data_wydania: string;
  data_zwrotu: string | null;
  notatka: string | null;
};

const equipmentSchema = z.object({
  nazwa: z.string().trim().min(1, "Wymagane").max(100),
  kategoria: z.enum(["sprzet_medyczny", "srodki_higieniczne", "narzedzia", "dokumenty", "inne"]),
  nr_seryjny: z.string().trim().max(50).optional().or(z.literal("")),
  ilosc: z.string().refine(v => !v || (Number(v) > 0 && Number(v) <= 999), "Liczba 1–999"),
  data_wydania: z.string().min(1, "Wymagane"),
  notatka: z.string().trim().max(300).optional().or(z.literal("")),
});

type EquipmentForm = z.infer<typeof equipmentSchema>;

function EquipmentPanel({ caregiverId }: { caregiverId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const { data: loans, isLoading } = useQuery({
    queryKey: ["equipment", caregiverId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("equipment_loans")
        .select("id, nazwa, kategoria, nr_seryjny, ilosc, data_wydania, data_zwrotu, notatka")
        .eq("caregiver_id", caregiverId)
        .order("data_wydania", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EquipmentLoan[];
    },
  });

  const returnMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("equipment_loans")
        .update({ data_zwrotu: new Date().toISOString().split("T")[0] })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Oznaczono jako zwrócone");
      qc.invalidateQueries({ queryKey: ["equipment", caregiverId] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("equipment_loans").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Usunięto wpis");
      qc.invalidateQueries({ queryKey: ["equipment", caregiverId] });
    },
  });

  const active = (loans ?? []).filter(l => !l.data_zwrotu);
  const returned = (loans ?? []).filter(l => l.data_zwrotu);

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Package className="h-4 w-4" />
          Wydane wyposażenie / materiały
        </h3>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <ArrowDownToLine className="h-4 w-4" />
          Wydaj
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (loans ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Brak wydanego wyposażenia. Kliknij "Wydaj" aby dodać wpis.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Aktualnie w posiadaniu */}
          {active.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                W posiadaniu ({active.length})
              </div>
              <div className="space-y-2">
                {active.map((l) => (
                  <div key={l.id} className="flex items-start justify-between rounded-lg border bg-muted/20 px-3 py-2.5 gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{l.nazwa}</span>
                        {l.ilosc > 1 && (
                          <span className="text-xs bg-muted px-1.5 py-0.5 rounded">×{l.ilosc}</span>
                        )}
                        <Badge variant="secondary" className={`text-xs ${KATEGORIA_TONE[l.kategoria]}`}>
                          {KATEGORIA_LABEL[l.kategoria]}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                        <span>Wydano: {new Date(l.data_wydania).toLocaleDateString("pl-PL")}</span>
                        {l.nr_seryjny && <span>Nr: {l.nr_seryjny}</span>}
                      </div>
                      {l.notatka && (
                        <p className="text-xs text-muted-foreground mt-0.5 italic">{l.notatka}</p>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 px-2"
                        onClick={() => returnMut.mutate(l.id)}
                        disabled={returnMut.isPending}
                        title="Oznacz jako zwrócone"
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Zwrot
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => { if (confirm("Usunąć wpis?")) deleteMut.mutate(l.id); }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Historia zwrotów */}
          {returned.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Historia zwrotów ({returned.length})
              </div>
              <div className="space-y-1.5">
                {returned.map((l) => (
                  <div key={l.id} className="flex items-center justify-between rounded-lg border bg-muted/10 px-3 py-2 gap-2 opacity-70">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm line-through text-muted-foreground">{l.nazwa}</span>
                        {l.ilosc > 1 && <span className="text-xs text-muted-foreground">×{l.ilosc}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground flex gap-3">
                        <span>Wydano: {new Date(l.data_wydania).toLocaleDateString("pl-PL")}</span>
                        <span>Zwrócono: {new Date(l.data_zwrotu!).toLocaleDateString("pl-PL")}</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive flex-shrink-0"
                      onClick={() => { if (confirm("Usunąć wpis?")) deleteMut.mutate(l.id); }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {addOpen && (
        <AddEquipmentDialog
          caregiverId={caregiverId}
          open={addOpen}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}

function AddEquipmentDialog({
  caregiverId, open, onClose,
}: { caregiverId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<EquipmentForm>({
    resolver: zodResolver(equipmentSchema),
    defaultValues: {
      nazwa: "",
      kategoria: "inne",
      nr_seryjny: "",
      ilosc: "1",
      data_wydania: new Date().toISOString().split("T")[0],
      notatka: "",
    },
  });

  const mut = useMutation({
    mutationFn: async (v: EquipmentForm) => {
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase.from("equipment_loans").insert({
        caregiver_id: caregiverId,
        nazwa: v.nazwa.trim(),
        kategoria: v.kategoria,
        nr_seryjny: v.nr_seryjny?.trim() || null,
        ilosc: v.ilosc ? Number(v.ilosc) : 1,
        data_wydania: v.data_wydania,
        notatka: v.notatka?.trim() || null,
        wydal_id: user.user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Wyposażenie wydane i zapisane");
      qc.invalidateQueries({ queryKey: ["equipment", caregiverId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Wydaj wyposażenie</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mut.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="nazwa" render={({ field }) => (
              <FormItem>
                <FormLabel>Nazwa przedmiotu / środka *</FormLabel>
                <FormControl>
                  <Input placeholder="np. Ciśnieniomierz, Rękawice lateksowe, Karta opieki" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="kategoria" render={({ field }) => (
                <FormItem>
                  <FormLabel>Kategoria *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {Object.entries(KATEGORIA_LABEL).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="ilosc" render={({ field }) => (
                <FormItem>
                  <FormLabel>Ilość</FormLabel>
                  <FormControl><Input type="number" min="1" max="999" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="nr_seryjny" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nr seryjny / ID</FormLabel>
                  <FormControl>
                    <Input placeholder="opcjonalnie" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="data_wydania" render={({ field }) => (
                <FormItem>
                  <FormLabel>Data wydania *</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="notatka" render={({ field }) => (
              <FormItem>
                <FormLabel>Notatka</FormLabel>
                <FormControl>
                  <Textarea rows={2} placeholder="Stan techniczny, uwagi do wydania..." {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={mut.isPending}>Anuluj</Button>
              <Button type="submit" disabled={mut.isPending}>
                {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Zapisz wydanie
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog: dodaj opiekuna ───────────────────────────────────────────────────

const addCaregiverSchema = z.object({
  imie: z.string().trim().min(1, "Wymagane").max(80),
  nazwisko: z.string().trim().min(1, "Wymagane").max(80),
  email: z.string().trim().email("Niepoprawny email"),
  password: z.string().min(8, "Min. 8 znaków"),
  telefon: z.string().trim().max(20).optional().or(z.literal("")),
  rola: z.string().min(1),
  dzielnice: z.string().trim().optional().or(z.literal("")),
});

type AddCaregiverForm = z.infer<typeof addCaregiverSchema>;

function AddCaregiverDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<AddCaregiverForm>({
    resolver: zodResolver(addCaregiverSchema),
    defaultValues: { imie: "", nazwisko: "", email: "", password: "", telefon: "", rola: "opiekun", dzielnice: "" },
  });

  const mut = useMutation({
    mutationFn: async (v: AddCaregiverForm) => {
      // 1. Utwórz konto Supabase Auth
      const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
        email: v.email.trim(),
        password: v.password,
      });
      if (signUpErr) throw signUpErr;
      if (!signUp.user) throw new Error("Nie udało się utworzyć konta");

      const uid = signUp.user.id;

      // 2. Nadaj rolę caregiver
      const { error: roleErr } = await supabase.from("user_roles").insert({ user_id: uid, role: "caregiver" });
      if (roleErr) throw roleErr;

      // 3. Uzupełnij profil
      const dzielnice = v.dzielnice
        ? v.dzielnice.split(",").map(d => d.trim()).filter(Boolean)
        : [];

      const { error: profileErr } = await supabase.from("profiles").upsert({
        id: uid,
        imie: v.imie.trim(),
        nazwisko: v.nazwisko.trim(),
        email: v.email.trim(),
        telefon: v.telefon?.trim() || null,
        rola: v.rola,
        dzielnice: dzielnice.length > 0 ? dzielnice : null,
      });
      if (profileErr) throw profileErr;
    },
    onSuccess: (_data, v) => {
      toast.success(`Konto opiekuna utworzone. Dane logowania: ${v.email} / ${v.password}`);
      qc.invalidateQueries({ queryKey: ["caregivers-full"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dodaj opiekuna</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Zostanie utworzone konto logowania. Przekaż dane logowania opiekunowi osobiście.
        </p>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(v => mut.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="imie" render={({ field }) => (
                <FormItem><FormLabel>Imię *</FormLabel>
                  <FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="nazwisko" render={({ field }) => (
                <FormItem><FormLabel>Nazwisko *</FormLabel>
                  <FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem><FormLabel>E-mail *</FormLabel>
                <FormControl><Input type="email" placeholder="opiekun@email.pl" {...field} /></FormControl>
                <FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem><FormLabel>Hasło tymczasowe *</FormLabel>
                <FormControl><Input type="text" placeholder="min. 8 znaków" {...field} /></FormControl>
                <p className="text-xs text-muted-foreground">Przekaż hasło osobiście — nie jest wysyłane automatycznie.</p>
                <FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="telefon" render={({ field }) => (
                <FormItem><FormLabel>Telefon</FormLabel>
                  <FormControl><Input placeholder="500 100 200" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="rola" render={({ field }) => (
                <FormItem><FormLabel>Rola *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="opiekun">Opiekun</SelectItem>
                      <SelectItem value="opiekun_specjalistyczny">Opiekun specjalistyczny</SelectItem>
                      <SelectItem value="opiekun_psychiatryczny">Opiekun spec. psychiatryczny</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="dzielnice" render={({ field }) => (
              <FormItem><FormLabel>Rejony / dzielnice</FormLabel>
                <FormControl><Input placeholder="np. Śródmieście, Wrzeszcz" {...field} value={field.value ?? ""} /></FormControl>
                <p className="text-xs text-muted-foreground">Rozdziel przecinkami</p>
                <FormMessage /></FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={mut.isPending}>Anuluj</Button>
              <Button type="submit" disabled={mut.isPending}>
                {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Utwórz konto
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function EditProfileDialog({
  caregiver,
  open,
  onClose,
}: {
  caregiver: Caregiver;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      imie: caregiver.imie,
      nazwisko: caregiver.nazwisko,
      telefon: caregiver.telefon ?? "",
      rola: caregiver.rola ?? "opiekun",
      dzielnice: caregiver.dzielnice?.join(", ") ?? "",
      uwagi: caregiver.uwagi ?? "",
    },
  });

  const mut = useMutation({
    mutationFn: async (v: ProfileForm) => {
      const dzielnice = v.dzielnice
        ? v.dzielnice.split(",").map((d) => d.trim()).filter(Boolean)
        : [];
      const { error } = await supabase.from("profiles").update({
        imie: v.imie.trim(),
        nazwisko: v.nazwisko.trim(),
        telefon: v.telefon?.trim() || null,
        rola: v.rola,
        dzielnice: dzielnice.length > 0 ? dzielnice : null,
        uwagi: v.uwagi?.trim() || null,
      }).eq("id", caregiver.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profil zaktualizowany");
      qc.invalidateQueries({ queryKey: ["caregivers-full"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edytuj profil opiekuna</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mut.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="imie" render={({ field }) => (
                <FormItem><FormLabel>Imię *</FormLabel>
                  <FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="nazwisko" render={({ field }) => (
                <FormItem><FormLabel>Nazwisko *</FormLabel>
                  <FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="telefon" render={({ field }) => (
              <FormItem><FormLabel>Telefon służbowy</FormLabel>
                <FormControl><Input placeholder="500 100 200" {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="rola" render={({ field }) => (
              <FormItem><FormLabel>Rola *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="opiekun">Opiekun</SelectItem>
                    <SelectItem value="opiekun_specjalistyczny">Opiekun specjalistyczny</SelectItem>
                    <SelectItem value="opiekun_psychiatryczny">Opiekun spec. psychiatryczny</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="dzielnice" render={({ field }) => (
              <FormItem>
                <FormLabel>Rejony / dzielnice</FormLabel>
                <FormControl>
                  <Input placeholder="np. Śródmieście, Wrzeszcz, Oliwa" {...field} value={field.value ?? ""} />
                </FormControl>
                <p className="text-xs text-muted-foreground">Rozdziel przecinkami</p>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="uwagi" render={({ field }) => (
              <FormItem><FormLabel>Uwagi</FormLabel>
                <FormControl>
                  <Textarea rows={2} placeholder="Dodatkowe informacje..." {...field} value={field.value ?? ""} />
                </FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={mut.isPending}>Anuluj</Button>
              <Button type="submit" disabled={mut.isPending}>
                {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Zapisz zmiany
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
