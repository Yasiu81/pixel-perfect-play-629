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
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  status: string;
  hours_billed: number | null;
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
        .select("id, planned_start, planned_end, status, hours_billed")
        .eq("senior_id", id)
        .order("planned_start", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as VisitRow[];
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Dane osobowe" icon={<Users className="h-4 w-4" />}>
          <Field label="Imię" value={senior.imie} />
          <Field label="Nazwisko" value={senior.nazwisko} />
          <PeselRow seniorId={senior.id} last2={senior.pesel_last2} />
          <Field
            label="Telefon"
            value={
              senior.telefon ? (
                <a className="hover:underline" href={`tel:${senior.telefon}`}>
                  <Phone className="mr-1 inline h-3.5 w-3.5" />
                  {senior.telefon}
                </a>
              ) : (
                "—"
              )
            }
          />
          <Field
            label="Telefon rodziny"
            value={
              senior.telefon_rodziny ? (
                <a className="hover:underline" href={`tel:${senior.telefon_rodziny}`}>
                  <Phone className="mr-1 inline h-3.5 w-3.5" />
                  {senior.telefon_rodziny}
                </a>
              ) : (
                "—"
              )
            }
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

        <Section
          title="Historia wizyt"
          icon={<Clock className="h-4 w-4" />}
          className="lg:col-span-2"
        >
          <VisitsTable visits={visits ?? []} />
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
