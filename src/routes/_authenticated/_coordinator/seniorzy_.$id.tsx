import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  MapPin,
  Phone,
  Users,
  FileText,
  Clock,
  StickyNote,
  ExternalLink,
  Pencil,
  Plus,
  X,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  ChevronDown,
  ChevronUp,
  Calendar,
  Printer,
  Truck,
  Lock,
} from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
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

export const Route = createFileRoute("/_authenticated/_coordinator/seniorzy_/$id")({
  component: SeniorDetailPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">Nie udało się wczytać kartoteki</h2>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <Button
          onClick={() => {
            reset();
            router.invalidate();
          }}
        >
          Spróbuj ponownie
        </Button>
      </div>
    );
  },
  notFoundComponent: () => (
    <div className="space-y-4 p-6">
      <h2 className="text-lg font-semibold">Nie znaleziono seniora</h2>
      <Button asChild variant="outline">
        <Link to="/seniorzy">
          <ArrowLeft />
          Wróć do listy
        </Link>
      </Button>
    </div>
  ),
});

type SeniorStatus = "aktywny" | "wygasa" | "nieaktywny";

const STATUS_LABELS: Record<SeniorStatus, { label: string; tone: string }> = {
  aktywny: { label: "Aktywny", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  wygasa: { label: "Wygasa", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  nieaktywny: { label: "Nieaktywny", tone: "bg-muted text-muted-foreground" },
};

// ─── Schemat edycji seniora ───────────────────────────────────────────────────

const editSchema = z.object({
  imie: z.string().trim().min(1, "Wymagane").max(80),
  nazwisko: z.string().trim().min(1, "Wymagane").max(80),
  telefon: z.string().trim().max(20).optional().or(z.literal("")),
  telefon_rodziny: z.string().trim().max(20).optional().or(z.literal("")),
  adres: z.string().trim().min(1, "Wymagane").max(200),
  lat: z.string().trim().optional().or(z.literal("")).refine(
    (v) => !v || !Number.isNaN(Number(v)), "Liczba"
  ),
  lng: z.string().trim().optional().or(z.literal("")).refine(
    (v) => !v || !Number.isNaN(Number(v)), "Liczba"
  ),
  nfc_uid: z.string().trim().max(64).optional().or(z.literal("")),
  notatka_techniczna: z.string().trim().max(1000).optional().or(z.literal("")),
  decyzja_nr: z.string().trim().max(50).optional().or(z.literal("")),
  decyzja_data: z.string().optional().or(z.literal("")),
  decyzja_od: z.string().optional().or(z.literal("")),
  decyzja_do: z.string().optional().or(z.literal("")),
  godziny_min: z.string().optional().or(z.literal("")).refine(
    (v) => !v || (/^\d+$/.test(v) && Number(v) <= 1000), "Liczba 0–1000"
  ),
  godziny_max: z.string().optional().or(z.literal("")).refine(
    (v) => !v || (/^\d+$/.test(v) && Number(v) <= 1000), "Liczba 0–1000"
  ),
  stawka_h: z.string().optional().or(z.literal("")).refine(
    (v) => !v || (!Number.isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 1000), "Liczba 0–1000"
  ),
  status: z.enum(["aktywny", "wygasa", "nieaktywny"]),
  opiekun_id: z.string().optional().or(z.literal("")),
});

type EditForm = z.infer<typeof editSchema>;

// ─── Dialog edycji ────────────────────────────────────────────────────────────

function EditSeniorDialog({
  senior,
  open,
  onClose,
  onSaved,
}: {
  senior: SeniorDetail;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();

  // Lista opiekunów do dropdownu
  const { data: caregivers } = useQuery({
    queryKey: ["caregivers-list"],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "caregiver");
      const ids = (roles ?? []).map((r) => r.user_id);
      if (ids.length === 0) return [];
      const { data } = await supabase
        .from("profiles")
        .select("id, imie, nazwisko")
        .in("id", ids)
        .order("nazwisko");
      return data ?? [];
    },
  });

  const form = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      imie: senior.imie ?? "",
      nazwisko: senior.nazwisko ?? "",
      telefon: senior.telefon ?? "",
      telefon_rodziny: senior.telefon_rodziny ?? "",
      adres: senior.adres ?? "",
      lat: senior.lat != null ? String(senior.lat) : "",
      lng: senior.lng != null ? String(senior.lng) : "",
      nfc_uid: senior.nfc_uid ?? "",
      notatka_techniczna: senior.notatka_techniczna ?? "",
      decyzja_nr: senior.decyzja_nr ?? "",
      decyzja_data: senior.decyzja_data ?? "",
      decyzja_od: senior.decyzja_od ?? "",
      decyzja_do: senior.decyzja_do ?? "",
      godziny_min: senior.godziny_min != null ? String(senior.godziny_min) : "",
      godziny_max: senior.godziny_max != null ? String(senior.godziny_max) : "",
      stawka_h: senior.stawka_h != null ? String(senior.stawka_h) : "",
      status: senior.status,
      opiekun_id: senior.opiekun_id ?? "__none__",
    },
  });

  const mut = useMutation({
    mutationFn: async (v: EditForm) => {
      const { error } = await supabase.from("seniors").update({
        imie: v.imie.trim(),
        nazwisko: v.nazwisko.trim(),
        telefon: v.telefon?.trim() || null,
        telefon_rodziny: v.telefon_rodziny?.trim() || null,
        adres: v.adres.trim(),
        lat: v.lat ? Number(v.lat) : null,
        lng: v.lng ? Number(v.lng) : null,
        nfc_uid: v.nfc_uid?.trim() || null,
        notatka_techniczna: v.notatka_techniczna?.trim() || null,
        decyzja_nr: v.decyzja_nr?.trim() || null,
        decyzja_data: v.decyzja_data || null,
        decyzja_od: v.decyzja_od || null,
        decyzja_do: v.decyzja_do || null,
        godziny_min: v.godziny_min ? Number(v.godziny_min) : null,
        godziny_max: v.godziny_max ? Number(v.godziny_max) : null,
        stawka_h: v.stawka_h ? Number(v.stawka_h) : null,
        status: v.status,
        opiekun_id: (v.opiekun_id && v.opiekun_id !== "__none__") ? v.opiekun_id : null,
      }).eq("id", senior.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dane seniora zaktualizowane");
      qc.invalidateQueries({ queryKey: ["seniors"] });
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edytuj dane seniora</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mut.mutate(v))} className="space-y-5">

            {/* Dane osobowe */}
            <FormSection title="Dane osobowe">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FField form={form} name="imie" label="Imię *" />
                <FField form={form} name="nazwisko" label="Nazwisko *" />
                <FField form={form} name="telefon" label="Telefon" placeholder="np. 500 100 200" />
                <FField form={form} name="telefon_rodziny" label="Telefon rodziny" />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="aktywny">Aktywny</SelectItem>
                        <SelectItem value="wygasa">Wygasa</SelectItem>
                        <SelectItem value="nieaktywny">Nieaktywny</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </FormSection>

            {/* Adres */}
            <FormSection title="Adres i lokalizacja">
              <FField form={form} name="adres" label="Adres *" />
              <p className="text-xs text-muted-foreground">
                Współrzędne znajdziesz klikając prawym przyciskiem na Google Maps.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <FField form={form} name="lat" label="Szerokość (lat)" placeholder="54.3520" />
                <FField form={form} name="lng" label="Długość (lng)" placeholder="18.6466" />
              </div>
            </FormSection>

            {/* NFC i notatki */}
            <FormSection title="NFC i notatka techniczna">
              <FField form={form} name="nfc_uid" label="NFC UID" placeholder="Wpisz po przetestowaniu tagu" />
              <FormField control={form.control} name="notatka_techniczna" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notatka techniczna</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="Kod do domofonu, miejsce kluczy..." {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </FormSection>

            {/* Decyzja MOPS */}
            <FormSection title="Decyzja MOPS">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FField form={form} name="decyzja_nr" label="Numer decyzji" />
                <FField form={form} name="decyzja_data" label="Data decyzji" type="date" />
                <FField form={form} name="decyzja_od" label="Obowiązuje od" type="date" />
                <FField form={form} name="decyzja_do" label="Obowiązuje do" type="date" />
              </div>
            </FormSection>

            {/* Godziny i stawka */}
            <FormSection title="Godziny i stawka">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FField form={form} name="godziny_min" label="Godziny min" type="number" />
                <FField form={form} name="godziny_max" label="Godziny max" type="number" />
                <FField form={form} name="stawka_h" label="Stawka godz. (zł)" type="number" step="0.01" />
              </div>
            </FormSection>

            {/* Przypisany opiekun */}
            <FormSection title="Przypisany opiekun">
              <FormField
                control={form.control}
                name="opiekun_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Opiekun</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value ?? "__none__"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Nie przypisano" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">Nie przypisano</SelectItem>
                        {(caregivers ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.imie} {c.nazwisko}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormSection>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={mut.isPending}>
                Anuluj
              </Button>
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

// ─── Pomocniczy komponent sekcji formularza ───────────────────────────────────

// Lekka sekcja dla formularza edycji (bez ikony)
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function FField({
  form,
  name,
  label,
  placeholder,
  type = "text",
  step,
}: {
  form: ReturnType<typeof useForm<EditForm>>;
  name: keyof EditForm;
  label: string;
  placeholder?: string;
  type?: string;
  step?: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type={type}
              step={step}
              placeholder={placeholder}
              {...field}
              value={field.value as string ?? ""}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

type SeniorDetail = {
  id: string;
  imie: string;
  nazwisko: string;
  telefon: string | null;
  telefon_rodziny: string | null;
  adres: string;
  lat: number | null;
  lng: number | null;
  nfc_uid: string | null;
  notatka_techniczna: string | null;
  decyzja_nr: string | null;
  decyzja_data: string | null;
  decyzja_od: string | null;
  decyzja_do: string | null;
  godziny_min: number | null;
  godziny_max: number | null;
  stawka_h: number | null;
  status: SeniorStatus;
  pesel_last2: string | null;
  plan_wsparcia: unknown;
  opiekun_id: string | null;
};

type VisitRow = {
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

const VISIT_STATUS_TONE: Record<string, string> = {
  planned: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  active: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  alert: "bg-red-500/15 text-red-700 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};

function SeniorDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const { data: senior, isLoading } = useQuery({
    queryKey: ["seniors", "detail", id],
    queryFn: async (): Promise<SeniorDetail | null> => {
      const { data, error } = await supabase
        .from("seniors")
        .select(
          "id, imie, nazwisko, telefon, telefon_rodziny, adres, lat, lng, nfc_uid, notatka_techniczna, decyzja_nr, decyzja_data, decyzja_od, decyzja_do, godziny_min, godziny_max, stawka_h, status, pesel_last2, plan_wsparcia, opiekun_id",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data as SeniorDetail | null) ?? null;
    },
  });

  const { data: visits } = useQuery({
    queryKey: ["seniors", "visits", id],
    queryFn: async (): Promise<VisitRow[]> => {
      const { data, error } = await supabase
        .from("visits")
        .select(`id, planned_start, planned_end, actual_start, actual_end,
                 status, hours_billed, notes, caregiver_id,
                 tasks:visit_tasks(task_name, completed)`)
        .eq("senior_id", id)
        .order("planned_start", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });

  // WAŻNE: useMemo musi być wywołany bezwarunkowo, przed jakimkolwiek early return.
  // Hooki Reacta muszą się wykonywać w tej samej kolejności przy każdym renderze —
  // umieszczenie useMemo po warunkowych return powodowało błąd #418.
  const realizedThisMonth = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return (visits ?? []).reduce((sum, v) => {
      if (v.status !== "completed" || v.hours_billed == null) return sum;
      const ts = new Date(v.planned_start).getTime();
      return ts >= monthStart ? sum + v.hours_billed : sum;
    }, 0);
  }, [visits]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!senior) {
    return (
      <div className="space-y-4">
        <Button asChild variant="outline" size="sm">
          <Link to="/seniorzy">
            <ArrowLeft />
            Wróć do listy
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">Nie znaleziono seniora.</p>
      </div>
    );
  }

  const st = STATUS_LABELS[senior.status];

  return (
    <div className="space-y-6">
      {/* Nagłówek */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to="/seniorzy">
              <ArrowLeft />
              Wróć do listy
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {senior.nazwisko} {senior.imie}
            </h1>
            <Badge variant="secondary" className={st.tone}>
              {st.label}
            </Badge>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditOpen(true)}
          className="flex-shrink-0"
        >
          <Pencil className="h-4 w-4" />
          Edytuj dane
        </Button>
      </div>

      {/* Zakładki */}
      <Tabs defaultValue="przeglad">
        <TabsList>
          <TabsTrigger value="przeglad">📋 Przegląd</TabsTrigger>
          <TabsTrigger value="kalendarz">📅 Kalendarz</TabsTrigger>
          <TabsTrigger value="raporty">📝 Raporty wizyt</TabsTrigger>
          <TabsTrigger value="dokumenty">📁 Dokumenty</TabsTrigger>
          <TabsTrigger value="rodzina">👨‍👩‍👧 Rodzina</TabsTrigger>
        </TabsList>

        {/* ── PRZEGLĄD ── */}
        <TabsContent value="przeglad" className="mt-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="Dane osobowe" icon={<Users className="h-4 w-4" />}>
              <Field label="Imię" value={senior.imie} />
              <Field label="Nazwisko" value={senior.nazwisko} />
              <PeselRow seniorId={senior.id} last2={senior.pesel_last2} />
              <Field
                label="Telefon"
                value={senior.telefon ? (
                  <a className="hover:underline" href={`tel:${senior.telefon}`}>
                    <Phone className="mr-1 inline h-3.5 w-3.5" />
                    {senior.telefon}
                  </a>
                ) : "—"}
              />
              <Field
                label="Telefon rodziny"
                value={senior.telefon_rodziny ? (
                  <a className="hover:underline" href={`tel:${senior.telefon_rodziny}`}>
                    <Phone className="mr-1 inline h-3.5 w-3.5" />
                    {senior.telefon_rodziny}
                  </a>
                ) : "—"}
              />
            </Section>

            <Section title="Adres i lokalizacja" icon={<MapPin className="h-4 w-4" />}>
              <Field label="Adres" value={senior.adres} />
              <Field label="Szerokość (lat)" value={senior.lat ?? "—"} />
              <Field label="Długość (lng)" value={senior.lng ?? "—"} />
              {senior.lat != null && senior.lng != null && (
                <a
                  href={`https://www.google.com/maps?q=${senior.lat},${senior.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  Otwórz w Google Maps <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </Section>

            <Section title="Decyzja MOPS" icon={<FileText className="h-4 w-4" />}>
              <Field label="Numer decyzji" value={senior.decyzja_nr || "—"} />
              <Field label="Data decyzji" value={fmtDate(senior.decyzja_data)} />
              <Field label="Obowiązuje od" value={fmtDate(senior.decyzja_od)} />
              <Field label="Obowiązuje do" value={fmtDate(senior.decyzja_do)} />
            </Section>

            <Section title="Godziny i stawka" icon={<Clock className="h-4 w-4" />}>
              <SaldoBlock
                min={senior.godziny_min}
                max={senior.godziny_max}
                realized={realizedThisMonth}
              />
              <Field
                label="Stawka godz."
                value={senior.stawka_h != null ? `${Number(senior.stawka_h).toFixed(2)} zł` : "—"}
              />
              <Field label="NFC UID" value={senior.nfc_uid || "—"} />
            </Section>

            <Section
              title="Plan wsparcia"
              icon={<FileText className="h-4 w-4" />}
              className="lg:col-span-2"
            >
              <PlanWsparcia seniorId={senior.id} plan={senior.plan_wsparcia} />
            </Section>

            {senior.notatka_techniczna && (
              <Section
                title="Notatka techniczna"
                icon={<StickyNote className="h-4 w-4" />}
                className="lg:col-span-2"
              >
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {senior.notatka_techniczna}
                </p>
              </Section>
            )}
          </div>
        </TabsContent>

        {/* ── KALENDARZ ── */}
        <TabsContent value="kalendarz" className="mt-4">
          <KalendarzTab seniorId={id} seniorName={`${senior.imie} ${senior.nazwisko}`} />
        </TabsContent>

        {/* ── RAPORTY WIZYT ── */}
        <TabsContent value="raporty" className="mt-4">
          <RaportyWizytTab visits={visits ?? []} />
        </TabsContent>

        {/* ── DOKUMENTY ── */}
        <TabsContent value="dokumenty" className="mt-4">
          <DokumentyTab seniorId={id} />
        </TabsContent>

        {/* ── RODZINA ── */}
        <TabsContent value="rodzina" className="mt-4">
          <RodzinaTab seniorId={id} />
        </TabsContent>
      </Tabs>

      {/* Dialog edycji */}
      {editOpen && (
        <EditSeniorDialog
          senior={senior}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["seniors", "detail", id] });
          }}
        />
      )}
    </div>
  );
}

// ─── ZAKŁADKA: KALENDARZ ─────────────────────────────────────────────────────

const STATUS_TONE_CAL: Record<string, string> = {
  planned: "bg-sky-500/15 text-sky-700 border-sky-300",
  active: "bg-amber-500/15 text-amber-700 border-amber-300",
  completed: "bg-emerald-500/15 text-emerald-700 border-emerald-300",
  alert: "bg-red-500/15 text-red-700 border-red-300",
  requires_verification: "bg-amber-500/15 text-amber-700 border-amber-300",
};
const STATUS_LABEL_CAL: Record<string, string> = {
  planned: "Zaplanowana", active: "W trakcie", completed: "Zakończona",
  alert: "Alarm", requires_verification: "Do weryfikacji",
};

// ─── Typy eventów ─────────────────────────────────────────────────────────────

type SeniorEvent = {
  id: string;
  senior_id: string;
  date: string;
  typ: "notatka" | "uwaga" | "alarm" | "wizyta_lekarska" | "inne";
  tytul: string;
  opis: string | null;
  created_at: string;
};

const EVENT_TONE: Record<string, string> = {
  notatka: "bg-sky-500/15 text-sky-700 border-sky-300",
  uwaga: "bg-amber-500/15 text-amber-700 border-amber-300",
  alarm: "bg-red-500/15 text-red-700 border-red-300",
  wizyta_lekarska: "bg-purple-500/15 text-purple-700 border-purple-300",
  inne: "bg-muted text-muted-foreground border-border",
};
const EVENT_ICON: Record<string, string> = {
  notatka: "📝", uwaga: "⚠️", alarm: "🚨", wizyta_lekarska: "🏥", inne: "📌",
};
const EVENT_LABEL: Record<string, string> = {
  notatka: "Notatka", uwaga: "Uwaga", alarm: "Alarm",
  wizyta_lekarska: "Wizyta lekarska", inne: "Inne",
};

const eventSchema = z.object({
  typ: z.enum(["notatka", "uwaga", "alarm", "wizyta_lekarska", "inne"]),
  tytul: z.string().trim().min(1, "Wymagane").max(100),
  opis: z.string().trim().max(500).optional().or(z.literal("")),
});
type EventForm = z.infer<typeof eventSchema>;

function DayPanel({
  date, seniorId, visits, orders, cgMap, onClose,
}: {
  date: Date; seniorId: string;
  visits: { id: string; planned_start: string; planned_end: string; status: string; hours_billed: number | null; caregiver_id: string | null }[];
  orders: { id: string; order_type: string; contractor: string | null; scheduled_start: string | null; scheduled_end: string | null; status: string }[];
  cgMap: Record<string, string>; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const dateStr = date.toISOString().split("T")[0];

  const { data: events, isLoading } = useQuery({
    queryKey: ["senior-events", seniorId, dateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("senior_events")
        .select("id, senior_id, date, typ, tytul, opis, created_at")
        .eq("senior_id", seniorId).eq("date", dateStr).order("created_at");
      if (error) throw error;
      return (data ?? []) as SeniorEvent[];
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("senior_events").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Usunięto");
      qc.invalidateQueries({ queryKey: ["senior-events", seniorId, dateStr] });
      qc.invalidateQueries({ queryKey: ["senior-events-month", seniorId] });
    },
  });

  const dayLabel = date.toLocaleDateString("pl-PL", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 h-full w-full max-w-md overflow-y-auto bg-background shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-5 py-4">
          <div>
            <div className="font-semibold capitalize">{dayLabel}</div>
            <div className="text-xs text-muted-foreground">{visits.length} wizyt · {orders.length} zleceń dodatkowych · {(events ?? []).length} zdarzeń</div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Dodaj zdarzenie
            </Button>
            <button onClick={onClose} className="rounded-md p-1 hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-4 p-5">
          {visits.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Wizyty opiekuńcze</h3>
              <div className="space-y-2">
                {visits.map((v) => (
                  <div key={v.id} className={`rounded-lg border px-3 py-2.5 ${STATUS_TONE_CAL[v.status] ?? "bg-muted"}`}>
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm">
                        {new Date(v.planned_start).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                        {" – "}
                        {new Date(v.planned_end).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      {v.hours_billed != null && v.hours_billed > 0 && (
                        <span className="text-xs font-semibold">{v.hours_billed} h</span>
                      )}
                    </div>
                    {v.caregiver_id && cgMap[v.caregiver_id] && (
                      <div className="text-xs mt-0.5 opacity-80">{cgMap[v.caregiver_id]}</div>
                    )}
                    <Badge variant="secondary" className="mt-1 text-xs">
                      {STATUS_LABEL_CAL[v.status] ?? v.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {orders.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Zlecenia dodatkowe</h3>
              <div className="space-y-2">
                {orders.map((o) => (
                  <div key={o.id} className="rounded-lg border px-3 py-2.5 bg-violet-500/10 border-violet-300">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-medium text-sm">
                        <Truck className="h-3.5 w-3.5 text-violet-600" />
                        {o.order_type}
                      </div>
                      {(o.scheduled_start || o.scheduled_end) && (
                        <span className="text-xs">
                          {o.scheduled_start?.slice(0, 5) ?? "—"}
                          {o.scheduled_end ? ` – ${o.scheduled_end.slice(0, 5)}` : ""}
                        </span>
                      )}
                    </div>
                    {o.contractor && <div className="text-xs mt-0.5 opacity-80">{o.contractor}</div>}
                    <Badge variant="secondary" className="mt-1 text-xs">
                      {STATUS_LABEL_CAL[o.status] ?? o.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Zdarzenia i notatki</h3>
            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (events ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed bg-card p-4 text-center text-sm text-muted-foreground">
                Brak zdarzeń. Kliknij "Dodaj zdarzenie" aby dodać notatkę lub alarm.
              </div>
            ) : (
              <div className="space-y-2">
                {(events ?? []).map((ev) => (
                  <div key={ev.id} className={`rounded-lg border px-3 py-2.5 ${EVENT_TONE[ev.typ]}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 font-medium text-sm">
                          <span>{EVENT_ICON[ev.typ]}</span><span>{ev.tytul}</span>
                        </div>
                        {ev.opis && <p className="mt-1 text-xs opacity-80 whitespace-pre-wrap">{ev.opis}</p>}
                        <div className="mt-1 text-xs opacity-60">
                          {new Date(ev.created_at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                      <button
                        onClick={() => { if (confirm("Usunąć to zdarzenie?")) deleteMut.mutate(ev.id); }}
                        className="flex-shrink-0 opacity-60 hover:opacity-100"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {addOpen && (
          <AddEventDialog seniorId={seniorId} date={dateStr} open={addOpen} onClose={() => setAddOpen(false)} />
        )}
      </div>
    </div>
  );
}

function AddEventDialog({ seniorId, date, open, onClose }: { seniorId: string; date: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<EventForm>({
    resolver: zodResolver(eventSchema),
    defaultValues: { typ: "notatka", tytul: "", opis: "" },
  });

  const mut = useMutation({
    mutationFn: async (v: EventForm) => {
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase.from("senior_events").insert({
        senior_id: seniorId, date, typ: v.typ,
        tytul: v.tytul.trim(), opis: v.opis?.trim() || null,
        created_by: user.user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Zdarzenie dodane");
      qc.invalidateQueries({ queryKey: ["senior-events", seniorId, date] });
      qc.invalidateQueries({ queryKey: ["senior-events-month", seniorId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dodaj zdarzenie — {new Date(date + "T12:00:00").toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mut.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="typ" render={({ field }) => (
              <FormItem>
                <FormLabel>Typ zdarzenia *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {Object.entries(EVENT_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{EVENT_ICON[k]} {v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="tytul" render={({ field }) => (
              <FormItem>
                <FormLabel>Tytuł *</FormLabel>
                <FormControl><Input placeholder="np. Wizyta u kardiologa, Zmiana leku..." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="opis" render={({ field }) => (
              <FormItem>
                <FormLabel>Opis / szczegóły</FormLabel>
                <FormControl>
                  <Textarea rows={3} placeholder="Dodatkowe informacje..." {...field} value={field.value ?? ""} />
                </FormControl>
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

function KalendarzTab({ seniorId, seniorName }: { seniorId: string; seniorName: string }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const startOfMonth = new Date(viewYear, viewMonth, 1).toISOString();
  const endOfMonth = new Date(viewYear, viewMonth + 1, 0, 23, 59, 59).toISOString();
  const daysInMonthCount = new Date(viewYear, viewMonth + 1, 0).getDate();
  const monthDateFrom = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;

  const { data: isMonthLocked } = useQuery({
    queryKey: ["is-month-locked-senior", viewYear, viewMonth],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_month_locked" as never, { check_date: monthDateFrom } as never);
      if (error) return false;
      return !!data;
    },
  });
  const monthDateTo = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(daysInMonthCount).padStart(2, "0")}`;

  const { data: visits, isLoading } = useQuery({
    queryKey: ["senior-calendar", seniorId, viewYear, viewMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select("id, planned_start, planned_end, actual_start, actual_end, status, hours_billed, caregiver_id, notes")
        .eq("senior_id", seniorId)
        .gte("planned_start", startOfMonth)
        .lte("planned_start", endOfMonth)
        .order("planned_start");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: monthEvents } = useQuery({
    queryKey: ["senior-events-month", seniorId, viewYear, viewMonth],
    queryFn: async () => {
      const { data } = await supabase
        .from("senior_events")
        .select("id, date, typ")
        .eq("senior_id", seniorId)
        .gte("date", monthDateFrom).lte("date", monthDateTo);
      return data ?? [];
    },
  });

  const { data: monthOrders } = useQuery({
    queryKey: ["senior-additional-orders-month", seniorId, viewYear, viewMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("additional_orders")
        .select("id, order_type, contractor, scheduled_date, scheduled_start, scheduled_end, status")
        .eq("senior_id", seniorId)
        .gte("scheduled_date", monthDateFrom)
        .lte("scheduled_date", monthDateTo)
        .order("scheduled_date");
      if (error) throw error;
      return (data ?? []) as unknown as {
        id: string; order_type: string; contractor: string | null;
        scheduled_date: string; scheduled_start: string | null; scheduled_end: string | null; status: string;
      }[];
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

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const firstMonday = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = daysInMonthCount;

  const visitsByDay: Record<number, typeof visits> = {};
  (visits ?? []).forEach((v) => {
    const d = new Date(v.planned_start).getDate();
    if (!visitsByDay[d]) visitsByDay[d] = [];
    visitsByDay[d]!.push(v);
  });

  const ordersByDay: Record<number, typeof monthOrders> = {};
  (monthOrders ?? []).forEach((o) => {
    const d = Number(o.scheduled_date.slice(8, 10));
    if (!ordersByDay[d]) ordersByDay[d] = [];
    ordersByDay[d]!.push(o);
  });

  const eventsByDay: Record<number, { typ: string }[]> = {};
  (monthEvents ?? []).forEach((e) => {
    const d = new Date(e.date + "T12:00:00").getDate();
    if (!eventsByDay[d]) eventsByDay[d] = [];
    eventsByDay[d].push({ typ: e.typ });
  });

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y-1); setViewMonth(11); } else setViewMonth(m => m-1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y+1); setViewMonth(0); } else setViewMonth(m => m+1); };

  const MONTHS_PL = ["Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec","Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień"];
  const DAYS_PL = ["Pon","Wt","Śr","Czw","Pt","Sob","Nd"];

  const totalHours = (visits ?? []).filter(v => v.status === "completed").reduce((s, v) => s + (v.hours_billed ?? 0), 0);
  const selectedDayVisits = selectedDay ? (visitsByDay[selectedDay.getDate()] ?? []) : [];
  const selectedDayOrders = selectedDay ? (ordersByDay[selectedDay.getDate()] ?? []) : [];

  const fmtTimeShort = (iso: string) =>
    new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });

  type MonthRow = {
    key: string; sortKey: string; dateLabel: string;
    start: string; end: string; who: string; kind: string; status: string;
  };
  const visitRows: MonthRow[] = (visits ?? []).map((v) => ({
    key: `v-${v.id}`,
    sortKey: v.planned_start,
    dateLabel: new Date(v.planned_start).toLocaleDateString("pl-PL"),
    start: fmtTimeShort(v.planned_start),
    end: fmtTimeShort(v.planned_end),
    who: v.caregiver_id ? (cgMap[v.caregiver_id] ?? "—") : "—",
    kind: "Wizyta standardowa",
    status: STATUS_LABEL_CAL[v.status] ?? v.status,
  }));
  const orderRows: MonthRow[] = (monthOrders ?? []).map((o) => ({
    key: `o-${o.id}`,
    sortKey: `${o.scheduled_date}T${o.scheduled_start ?? "00:00"}`,
    dateLabel: new Date(o.scheduled_date + "T12:00:00").toLocaleDateString("pl-PL"),
    start: o.scheduled_start ? o.scheduled_start.slice(0, 5) : "—",
    end: o.scheduled_end ? o.scheduled_end.slice(0, 5) : "—",
    who: o.contractor || "—",
    kind: o.order_type,
    status: STATUS_LABEL_CAL[o.status] ?? o.status,
  }));
  const monthRows = [...visitRows, ...orderRows].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <h2 className="text-lg font-semibold">{MONTHS_PL[viewMonth]} {viewYear}</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Zrealizowane: <strong>{totalHours} h</strong></span>
          <Button size="sm" variant="outline" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); }}>Dziś</Button>
          <Button size="sm" variant="outline" onClick={nextMonth}><ChevronRightIcon className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Drukuj grafik
          </Button>
        </div>
      </div>

      {isMonthLocked && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 print:hidden">
          <Lock className="h-4 w-4 flex-shrink-0" />
          Ten miesiąc jest zamknięty — wizyty i zlecenia dodatkowe nie można zmieniać ani usuwać.
        </div>
      )}

      <div className="rounded-lg border bg-card overflow-hidden print:hidden">
        <div className="grid grid-cols-7 border-b">
          {DAYS_PL.map(d => <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: firstMonday }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-[80px] border-b border-r bg-muted/20" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dayVisits = visitsByDay[day] ?? [];
            const dayEvents = eventsByDay[day] ?? [];
            const dayOrders = ordersByDay[day] ?? [];
            const isToday = day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
            const col = (firstMonday + i) % 7;
            const isWeekend = col >= 5;
            const hasAlarm = dayEvents.some(e => e.typ === "alarm");

            return (
              <div
                key={day}
                className={`min-h-[80px] border-b border-r p-1.5 cursor-pointer transition-colors hover:bg-accent/50 ${isWeekend ? "bg-muted/10" : ""} ${hasAlarm ? "ring-1 ring-inset ring-red-400" : ""}`}
                onClick={() => setSelectedDay(new Date(viewYear, viewMonth, day))}
              >
                <div className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${isToday ? "bg-primary text-primary-foreground" : "text-foreground"}`}>
                  {day}
                </div>
                <div className="space-y-0.5">
                  {isLoading ? <Skeleton className="h-4 w-full" /> : (
                    <>
                      {dayVisits.map((v) => (
                        <div key={v.id} className={`rounded border px-1 py-0.5 text-xs truncate ${STATUS_TONE_CAL[v.status] ?? "bg-muted text-muted-foreground border-border"}`}>
                          {new Date(v.planned_start).toLocaleTimeString("pl-PL", {hour:"2-digit",minute:"2-digit"})}
                          {v.hours_billed ? ` (${v.hours_billed}h)` : ""}
                          {v.caregiver_id && cgMap[v.caregiver_id] ? ` · ${cgMap[v.caregiver_id].split(" ")[0]}` : ""}
                        </div>
                      ))}
                      {dayOrders.length > 0 && (
                        <div className="rounded border border-violet-300 bg-violet-500/10 px-1 py-0.5 text-xs truncate text-violet-700">
                          {dayOrders.length === 1 ? dayOrders[0].order_type : `${dayOrders.length} zlecenia dod.`}
                        </div>
                      )}
                      {dayEvents.length > 0 && (
                        <div className="flex gap-0.5 flex-wrap mt-0.5">
                          {dayEvents.slice(0, 4).map((e, idx) => (
                            <div key={idx} className={`h-2 w-2 rounded-full border ${EVENT_TONE[e.typ]}`} title={EVENT_LABEL[e.typ]} />
                          ))}
                          {dayEvents.length > 4 && <span className="text-xs text-muted-foreground">+{dayEvents.length - 4}</span>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs print:hidden">
        {Object.entries(STATUS_LABEL_CAL).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className={`h-3 w-3 rounded border ${STATUS_TONE_CAL[k]}`} /><span>{v}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-2 border-l pl-2">
          {Object.entries(EVENT_LABEL).map(([k]) => (
            <div key={k} className="flex items-center gap-1" title={EVENT_LABEL[k]}>
              <div className={`h-2 w-2 rounded-full border ${EVENT_TONE[k]}`} /><span>{EVENT_ICON[k]}</span>
            </div>
          ))}
          <span className="text-muted-foreground">— zdarzenia</span>
        </div>
        <div className="flex items-center gap-1.5 ml-2 border-l pl-2">
          <div className="h-3 w-3 rounded border border-violet-300 bg-violet-500/10" />
          <span>Zlecenie dodatkowe</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground print:hidden">Kliknij dowolny dzień aby zobaczyć szczegóły lub dodać zdarzenie/notatkę.</p>

      {/* Drukowalna tabela miesiąca — wizyty (opiekun, godz. od/do) + zlecenia dodatkowe */}
      <div className="hidden print:block mb-4">
        <h2 className="text-xl font-bold">Grafik wizyt — {seniorName}</h2>
        <p className="text-sm text-gray-500">{MONTHS_PL[viewMonth]} {viewYear} · Plan Seniora</p>
      </div>
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="border-b px-4 py-3 text-sm font-medium print:hidden">
          Tabela miesiąca — {MONTHS_PL[viewMonth]} {viewYear}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Godz. od</TableHead>
              <TableHead>Godz. do</TableHead>
              <TableHead>Opiekun / Wykonawca</TableHead>
              <TableHead>Rodzaj</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {monthRows.length > 0 ? (
              monthRows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="text-sm">{r.dateLabel}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.start}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.end}</TableCell>
                  <TableCell className="text-sm">{r.who}</TableCell>
                  <TableCell className="text-sm">
                    {r.kind !== "Wizyta standardowa" && <Truck className="mr-1 inline h-3.5 w-3.5 text-violet-600" />}
                    {r.kind}
                  </TableCell>
                  <TableCell><Badge variant="secondary" className="text-xs">{r.status}</Badge></TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  Brak wizyt i zleceń w tym miesiącu.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {selectedDay && (
        <DayPanel
          date={selectedDay}
          seniorId={seniorId}
          visits={selectedDayVisits as any}
          orders={selectedDayOrders as any}
          cgMap={cgMap}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}

function RaportyWizytTab({ visits }: { visits: VisitWithTasks[] }) {
  const completed = visits.filter((v) => v.status === "completed");

  const { data: caregivers } = useQuery({
    queryKey: ["caregivers-names"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, imie, nazwisko");
      return data ?? [];
    },
  });
  const cgMap = Object.fromEntries((caregivers ?? []).map((c) => [c.id, `${c.imie} ${c.nazwisko}`]));

  if (completed.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
        Brak zakończonych wizyt do wyświetlenia.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {completed.map((v) => {
        const completedTasks = v.tasks.filter((t) => t.completed);
        const pendingTasks = v.tasks.filter((t) => !t.completed);
        const start = v.actual_start || v.planned_start;
        const end = v.actual_end || v.planned_end;

        return (
          <div key={v.id} className="rounded-lg border bg-card overflow-hidden">
            {/* Nagłówek wizyty */}
            <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
              <div>
                <div className="font-medium text-sm">
                  {new Date(start).toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(start).toLocaleTimeString("pl-PL",{hour:"2-digit",minute:"2-digit"})}
                  {" – "}
                  {new Date(end).toLocaleTimeString("pl-PL",{hour:"2-digit",minute:"2-digit"})}
                  {v.caregiver_id && cgMap[v.caregiver_id] && ` • ${cgMap[v.caregiver_id]}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {v.hours_billed != null && (
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                    {v.hours_billed} h
                  </span>
                )}
                {v.actual_start && (
                  <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 text-xs">
                    ✓ NFC
                  </Badge>
                )}
              </div>
            </div>

            <div className="p-4 space-y-3">
              {/* Czynności wykonane */}
              {v.tasks.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Czynności ({completedTasks.length}/{v.tasks.length} wykonanych)
                  </div>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {v.tasks.map((t, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <div className={`h-4 w-4 rounded-sm border flex items-center justify-center flex-shrink-0 ${
                          t.completed ? "bg-emerald-500 border-emerald-500 text-white" : "border-muted-foreground/40"
                        }`}>
                          {t.completed && <span className="text-xs">✓</span>}
                        </div>
                        <span className={t.completed ? "" : "text-muted-foreground line-through"}>
                          {t.task_name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notatka opiekuna */}
              {v.notes && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    Notatka opiekuna
                  </div>
                  <p className="rounded-md bg-muted/30 px-3 py-2 text-sm text-foreground whitespace-pre-wrap">
                    {v.notes}
                  </p>
                </div>
              )}

              {/* Czas NFC */}
              {v.actual_start && (
                <div className="flex gap-4 text-xs text-muted-foreground border-t pt-2">
                  <span>Wejście NFC: <strong>{new Date(v.actual_start).toLocaleTimeString("pl-PL",{hour:"2-digit",minute:"2-digit"})}</strong></span>
                  {v.actual_end && <span>Wyjście NFC: <strong>{new Date(v.actual_end).toLocaleTimeString("pl-PL",{hour:"2-digit",minute:"2-digit"})}</strong></span>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── ZAKŁADKA: DOKUMENTY ─────────────────────────────────────────────────────

const DOC_CATEGORIES = [
  "decyzja_mops",
  "umowa",
  "rodo",
  "medyczne",
  "faktura",
  "inne",
] as const;
type DocCategory = (typeof DOC_CATEGORIES)[number];

const DOC_CATEGORY_LABEL: Record<DocCategory, string> = {
  decyzja_mops: "Decyzje MOPS",
  umowa: "Umowy",
  rodo: "Zgody RODO",
  medyczne: "Dokumentacja medyczna",
  faktura: "Faktury",
  inne: "Inne",
};

type SeniorDocument = {
  id: string;
  name: string;
  file_path: string;
  file_type: string | null;
  kategoria: DocCategory;
  created_at: string;
};

function DokumentyTab({ seniorId }: { seniorId: string }) {
  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<DocCategory>("inne");
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  const qc = useQueryClient();

  const { data: docs, isLoading } = useQuery({
    queryKey: ["senior-documents", seniorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("senior_documents")
        .select("id, name, file_path, file_type, kategoria, created_at")
        .eq("senior_id", seniorId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SeniorDocument[];
    },
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = `senior-docs/${seniorId}/${Date.now()}-${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from("documents")
        .upload(path, file);
      if (uploadErr) throw uploadErr;
      const { error: dbErr } = await supabase.from("senior_documents").insert({
        senior_id: seniorId,
        name: file.name,
        file_path: path,
        file_type: file.type,
        kategoria: uploadCategory,
      } as never);
      if (dbErr) throw dbErr;
      toast.success("Dokument wgrany");
      qc.invalidateQueries({ queryKey: ["senior-documents", seniorId] });
      setOpenCategories((prev) => ({ ...prev, [uploadCategory]: true }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDownload = async (path: string, name: string) => {
    const { data } = await supabase.storage.from("documents").createSignedUrl(path, 60);
    if (data?.signedUrl) {
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = name;
      a.click();
    }
  };

  const handleDelete = async (id: string, path: string) => {
    if (!confirm("Usunąć ten dokument?")) return;
    await supabase.storage.from("documents").remove([path]);
    await supabase.from("senior_documents").delete().eq("id", id);
    toast.success("Dokument usunięty");
    qc.invalidateQueries({ queryKey: ["senior-documents", seniorId] });
  };

  const docsByCategory: Record<DocCategory, SeniorDocument[]> = {
    decyzja_mops: [], umowa: [], rodo: [], medyczne: [], faktura: [], inne: [],
  };
  (docs ?? []).forEach((d) => {
    const cat = DOC_CATEGORIES.includes(d.kategoria) ? d.kategoria : "inne";
    docsByCategory[cat].push(d);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Decyzje MOPS, umowy, zgody RODO, dokumentacja medyczna, faktury — pogrupowane wg kategorii.
        </p>
        <div className="flex items-center gap-2">
          <Select value={uploadCategory} onValueChange={(v) => setUploadCategory(v as DocCategory)}>
            <SelectTrigger className="h-9 w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOC_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{DOC_CATEGORY_LABEL[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className={`cursor-pointer inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium shadow-sm hover:bg-muted transition-colors ${uploading ? "opacity-50 cursor-not-allowed" : ""}`}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Wgraj dokument
            <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" />
          </label>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : !docs || docs.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          Brak dokumentów. Wybierz kategorię i wgraj pierwszy dokument.
        </div>
      ) : (
        <div className="space-y-3">
          {DOC_CATEGORIES.map((cat) => {
            const items = docsByCategory[cat];
            if (items.length === 0) return null;
            const isOpen = openCategories[cat] ?? true;
            return (
              <Collapsible
                key={cat}
                open={isOpen}
                onOpenChange={(v) => setOpenCategories((prev) => ({ ...prev, [cat]: v }))}
              >
                <div className="rounded-lg border bg-card overflow-hidden">
                  <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors">
                    <span>{DOC_CATEGORY_LABEL[cat]} <span className="text-muted-foreground font-normal">({items.length})</span></span>
                    {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="divide-y border-t">
                      {items.map((doc) => (
                        <div key={doc.id} className="flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                              <FileText className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{doc.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {new Date(doc.created_at).toLocaleDateString("pl-PL")}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Button size="sm" variant="outline" onClick={() => handleDownload(doc.file_path, doc.name)}>
                              Pobierz
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleDelete(doc.id, doc.file_path)} className="text-destructive hover:text-destructive">
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── ZAKŁADKA: RODZINA ────────────────────────────────────────────────────────

type FamilyAccessRow = {
  id: string;
  user_id: string;
  relacja: string | null;
  created_at: string;
  email?: string;
  dostep_opiekunczy: boolean;
  dostep_finansowy: boolean;
};

const inviteSchema = z.object({
  email: z.string().trim().email("Niepoprawny adres e-mail"),
  password: z.string().min(8, "Minimum 8 znaków"),
  relacja: z.string().trim().min(1, "Wymagane").max(50),
  dostep_opiekunczy: z.boolean(),
  dostep_finansowy: z.boolean(),
});

type InviteForm = z.infer<typeof inviteSchema>;

function RodzinaTab({ seniorId }: { seniorId: string }) {
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<FamilyAccessRow | null>(null);

  const { data: accessList, isLoading } = useQuery({
    queryKey: ["family-access", seniorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("family_access")
        .select("id, user_id, relacja, created_at, dostep_opiekunczy, dostep_finansowy")
        .eq("senior_id", seniorId);
      if (error) throw error;
      return (data ?? []) as unknown as FamilyAccessRow[];
    },
  });

  const userIds = (accessList ?? []).map((a) => a.user_id);
  const { data: activityLog } = useQuery({
    queryKey: ["family-activity", seniorId, userIds.join(",")],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("user_id, operation, table_name, details, created_at")
        .in("user_id", userIds)
        .in("operation", ["LOGIN", "READ_DOCUMENT"])
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const lastActivityByUser = useMemo(() => {
    const m: Record<string, { lastLogin?: string; lastDoc?: { name: string; at: string } }> = {};
    for (const row of activityLog ?? []) {
      const uid = row.user_id as string;
      if (!m[uid]) m[uid] = {};
      if (row.operation === "LOGIN" && !m[uid].lastLogin) m[uid].lastLogin = row.created_at as string;
      if (row.operation === "READ_DOCUMENT" && !m[uid].lastDoc) {
        const details = row.details as { document_name?: string } | null;
        m[uid].lastDoc = { name: details?.document_name ?? "dokument", at: row.created_at as string };
      }
    }
    return m;
  }, [activityLog]);

  const removeMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("family_access").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dostęp odebrany");
      qc.invalidateQueries({ queryKey: ["family-access", seniorId] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Osoby z rodziny mające dostęp do podglądu wizyt, raportów i dokumentów tego seniora w Strefie Klienta.
        </p>
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <Plus className="h-4 w-4" />
          Zaproś rodzinę
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : !accessList || accessList.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          Nikt z rodziny nie ma jeszcze dostępu. Kliknij "Zaproś rodzinę" aby utworzyć konto.
        </div>
      ) : (
        <div className="rounded-lg border bg-card divide-y">
          {accessList.map((a) => {
            const activity = lastActivityByUser[a.user_id];
            return (
              <div key={a.id} className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{a.relacja || "Członek rodziny"}</div>
                    <div className="text-xs text-muted-foreground">
                      Dostęp od {new Date(a.created_at).toLocaleDateString("pl-PL")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(a)}>
                      <Pencil className="h-3.5 w-3.5" /> Uprawnienia
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm("Odebrać dostęp tej osobie?")) removeMut.mutate(a.id);
                      }}
                    >
                      <X className="h-4 w-4" />
                      Odbierz dostęp
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className={a.dostep_opiekunczy ? "bg-sky-500/15 text-sky-700 text-xs" : "bg-muted text-muted-foreground text-xs"}>
                    {a.dostep_opiekunczy ? "✓" : "✗"} Dostęp opiekuńczy
                  </Badge>
                  <Badge variant="secondary" className={a.dostep_finansowy ? "bg-emerald-500/15 text-emerald-700 text-xs" : "bg-muted text-muted-foreground text-xs"}>
                    {a.dostep_finansowy ? "✓" : "✗"} Dostęp finansowy
                  </Badge>
                </div>
                {(activity?.lastLogin || activity?.lastDoc) && (
                  <div className="text-xs text-muted-foreground border-t pt-2 space-y-0.5">
                    {activity.lastLogin && (
                      <div>Ostatnie logowanie: <strong>{new Date(activity.lastLogin).toLocaleString("pl-PL")}</strong></div>
                    )}
                    {activity.lastDoc && (
                      <div>Ostatnio przeglądany dokument: <strong>{activity.lastDoc.name}</strong> ({new Date(activity.lastDoc.at).toLocaleString("pl-PL")})</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {inviteOpen && (
        <InviteFamilyDialog
          seniorId={seniorId}
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
        />
      )}
      {editing && (
        <EditFamilyAccessDialog
          seniorId={seniorId}
          access={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EditFamilyAccessDialog({
  seniorId, access, onClose,
}: { seniorId: string; access: FamilyAccessRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [opiekunczy, setOpiekunczy] = useState(access.dostep_opiekunczy);
  const [finansowy, setFinansowy] = useState(access.dostep_finansowy);

  const mut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("family_access").update({
        dostep_opiekunczy: opiekunczy,
        dostep_finansowy: finansowy,
      } as never).eq("id", access.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Uprawnienia zaktualizowane");
      qc.invalidateQueries({ queryKey: ["family-access", seniorId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Uprawnienia — {access.relacja || "Członek rodziny"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={opiekunczy} onChange={(e) => setOpiekunczy(e.target.checked)} />
            <span><strong>Dostęp opiekuńczy</strong> — raporty z wizyt, parametry życiowe, kalendarz</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={finansowy} onChange={(e) => setFinansowy(e.target.checked)} />
            <span><strong>Dostęp finansowy</strong> — dokumenty (w tym faktury), saldo godzin i stawka</span>
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={mut.isPending}>Anuluj</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Zapisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteFamilyDialog({
  seniorId,
  open,
  onClose,
}: {
  seniorId: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", password: "", relacja: "", dostep_opiekunczy: true, dostep_finansowy: true },
  });

  const mut = useMutation({
    mutationFn: async (v: InviteForm) => {
      // 1. Zarejestruj konto (Supabase Auth)
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: v.email.trim(),
        password: v.password,
      });
      if (signUpErr) throw signUpErr;
      if (!signUpData.user) throw new Error("Nie udało się utworzyć konta");

      // 2. Nadaj rolę family
      const { error: roleErr } = await supabase.from("user_roles").insert({
        user_id: signUpData.user.id,
        role: "family",
      });
      if (roleErr) throw roleErr;

      // 3. Przypisz dostęp do seniora (z poziomami uprawnień)
      const { error: accessErr } = await supabase.from("family_access").insert({
        senior_id: seniorId,
        user_id: signUpData.user.id,
        relacja: v.relacja.trim(),
        dostep_opiekunczy: v.dostep_opiekunczy,
        dostep_finansowy: v.dostep_finansowy,
      } as never);
      if (accessErr) throw accessErr;
    },
    onSuccess: (_data, v) => {
      toast.success(`Konto utworzone! Przekaż dane logowania: ${v.email} / ${v.password}`);
      qc.invalidateQueries({ queryKey: ["family-access", seniorId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Zaproś rodzinę do Strefy Klienta</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Utworzymy konto logowania. Hasło przekaż osobiście lub telefonicznie — nie jest wysyłane automatycznie.
        </p>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mut.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="relacja" render={({ field }) => (
              <FormItem>
                <FormLabel>Relacja do seniora *</FormLabel>
                <FormControl><Input placeholder="np. córka, syn, mąż" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Adres e-mail *</FormLabel>
                <FormControl><Input type="email" placeholder="rodzina@email.pl" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem>
                <FormLabel>Hasło tymczasowe *</FormLabel>
                <FormControl><Input type="text" placeholder="min. 8 znaków" {...field} /></FormControl>
                <p className="text-xs text-muted-foreground">
                  Wymyśl proste, ale bezpieczne hasło — przekażesz je osobiście.
                </p>
                <FormMessage />
              </FormItem>
            )} />
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">Poziom dostępu</p>
              <FormField control={form.control} name="dostep_opiekunczy" render={({ field }) => (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />
                  <span><strong>Dostęp opiekuńczy</strong> — raporty z wizyt, parametry życiowe, kalendarz</span>
                </label>
              )} />
              <FormField control={form.control} name="dostep_finansowy" render={({ field }) => (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />
                  <span><strong>Dostęp finansowy</strong> — dokumenty (w tym faktury), saldo godzin i stawka</span>
                </label>
              )} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={mut.isPending}>
                Anuluj
              </Button>
              <Button type="submit" disabled={mut.isPending}>
                {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Utwórz konto i przypisz
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function SaldoBlock({
  min,
  max,
  realized,
}: {
  min: number | null;
  max: number | null;
  realized: number;
}) {
  if (max == null || max <= 0) {
    return (
      <div className="space-y-1">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Saldo godzin w tym miesiącu
        </div>
        <p className="text-sm text-muted-foreground">
          Brak przyznanego limitu godzin (decyzja MOPS nie została jeszcze uzupełniona).
        </p>
      </div>
    );
  }
  const pct = Math.min(100, Math.round((realized / max) * 100));
  const overMin = min != null && realized >= min;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Saldo godzin w tym miesiącu
        </div>
        <div className="text-sm font-medium">
          {realized} / {max} h {min != null && <span className="text-muted-foreground">(min {min} h)</span>}
        </div>
      </div>
      <Progress value={pct} />
      <p className="text-xs text-muted-foreground">
        {overMin ? "Minimum zrealizowane." : min != null ? `Do minimum pozostało ${Math.max(0, min - realized)} h.` : null}
      </p>
    </div>
  );
}

function PlanWsparcia({ seniorId, plan }: { seniorId: string; plan: unknown }) {
  const qc = useQueryClient();
  const [newItem, setNewItem] = useState("");
  const [saving, setSaving] = useState(false);

  const items = Array.isArray(plan)
    ? (plan as unknown[]).map((v) => String(v)).filter(Boolean)
    : [];

  const saveItems = async (updated: string[]) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("seniors")
        .update({ plan_wsparcia: updated })
        .eq("id", seniorId);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["seniors", "detail", seniorId] });
      toast.success("Plan wsparcia zaktualizowany");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const addItem = async () => {
    const val = newItem.trim();
    if (!val) return;
    await saveItems([...items, val]);
    setNewItem("");
  };

  const removeItem = async (i: number) => {
    await saveItems(items.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Brak czynności. Dodaj pierwszą poniżej.
        </p>
      )}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((t, i) => (
          <li
            key={i}
            className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm"
          >
            <span>• {t}</span>
            <button
              onClick={() => removeItem(i)}
              disabled={saving}
              className="ml-2 flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
              title="Usuń czynność"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="Nowa czynność (np. Pomoc w higienie)"
          className="h-8 text-sm"
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addItem())}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={addItem}
          disabled={saving || !newItem.trim()}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Dodaj
        </Button>
      </div>
    </div>
  );
}

function VisitsTable({ visits }: { visits: VisitRow[] }) {
  if (visits.length === 0) {
    return <p className="text-sm text-muted-foreground">Brak wizyt dla tego seniora.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data i godzina</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Rozliczone h</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {visits.map((v) => (
          <TableRow key={v.id}>
            <TableCell>
              {fmtDateTime(v.planned_start)} – {fmtTime(v.planned_end)}
            </TableCell>
            <TableCell>
              <Badge
                variant="secondary"
                className={VISIT_STATUS_TONE[v.status] ?? "bg-muted text-muted-foreground"}
              >
                {v.status}
              </Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">{v.hours_billed ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("pl-PL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

const REVEAL_SECONDS = 10;

function PeselRow({ seniorId, last2 }: { seniorId: string; last2: string | null }) {
  const [pesel, setPesel] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    timeoutRef.current = null;
    tickRef.current = null;
  };

  const hide = () => {
    clearTimers();
    setPesel(null);
    setSecondsLeft(0);
  };

  // Auto-ukrycie przy odmontowaniu komponentu (wyjście z kartoteki).
  useEffect(() => {
    return () => {
      clearTimers();
      setPesel(null);
    };
  }, []);

  const reveal = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_senior_pesel", {
        _senior_id: seniorId,
      });
      if (error) throw error;
      if (!data) {
        toast.info("Brak zapisanego PESEL-a dla tego seniora.");
        return;
      }
      setPesel(data as string);
      setSecondsLeft(REVEAL_SECONDS);
      clearTimers();
      tickRef.current = setInterval(() => {
        setSecondsLeft((s) => Math.max(0, s - 1));
      }, 1000);
      timeoutRef.current = setTimeout(hide, REVEAL_SECONDS * 1000);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const masked = last2 ? `•••••••••${last2}` : "—";

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">PESEL</div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-base tracking-wider">{pesel ?? masked}</span>
        {pesel ? (
          <>
            <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
              Ukryje się za {secondsLeft}s
            </Badge>
            <Button size="sm" variant="outline" onClick={hide}>
              <EyeOff />
              Ukryj teraz
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={reveal} disabled={loading || !last2}>
            {loading ? <Loader2 className="animate-spin" /> : <Eye />}
            Pokaż PESEL
          </Button>
        )}
      </div>
      {!last2 && (
        <p className="text-xs text-muted-foreground">
          PESEL nie został jeszcze zapisany dla tego seniora.
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-3 rounded-lg border bg-card p-4 ${className ?? ""}`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon}
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("pl-PL");
  } catch {
    return d;
  }
}
