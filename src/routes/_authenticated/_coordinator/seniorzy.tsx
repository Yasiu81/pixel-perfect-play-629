import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Plus, Search, Loader2, MapPin } from "lucide-react";

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
  FormDescription,
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/_coordinator/seniorzy")({
  component: SeniorzyPage,
});

type SeniorStatus = "aktywny" | "wygasa" | "nieaktywny";

const STATUS_LABELS: Record<SeniorStatus, { label: string; tone: string }> = {
  aktywny: { label: "Aktywny", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  wygasa: { label: "Wygasa", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  nieaktywny: { label: "Nieaktywny", tone: "bg-muted text-muted-foreground" },
};

const seniorSchema = z.object({
  imie: z.string().trim().min(1, "Wymagane").max(80),
  nazwisko: z.string().trim().min(1, "Wymagane").max(80),
  pesel: z
    .string()
    .trim()
    .max(11)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || /^\d{11}$/.test(v), "PESEL musi mieć 11 cyfr"),
  telefon: z.string().trim().max(20).optional().or(z.literal("")),
  telefon_rodziny: z.string().trim().max(20).optional().or(z.literal("")),
  adres: z.string().trim().min(1, "Wymagane").max(200),
  lat: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || !Number.isNaN(Number(v)), "Liczba"),
  lng: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || !Number.isNaN(Number(v)), "Liczba"),
  nfc_uid: z.string().trim().max(64).optional().or(z.literal("")),
  notatka_techniczna: z.string().trim().max(1000).optional().or(z.literal("")),
  decyzja_nr: z.string().trim().max(50).optional().or(z.literal("")),
  decyzja_data: z.string().optional().or(z.literal("")),
  decyzja_od: z.string().optional().or(z.literal("")),
  decyzja_do: z.string().optional().or(z.literal("")),
  godziny_min: z.coerce.number().int().min(0).max(1000),
  godziny_max: z.coerce.number().int().min(0).max(1000),
  stawka_h: z.coerce.number().min(0).max(1000),
  status: z.enum(["aktywny", "wygasa", "nieaktywny"]),
});

type SeniorFormValues = z.infer<typeof seniorSchema>;

type SeniorRow = {
  id: string;
  imie: string;
  nazwisko: string;
  adres: string;
  telefon: string | null;
  godziny_min: number;
  godziny_max: number;
  status: SeniorStatus;
};

function SeniorzyPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["seniors", "list"],
    queryFn: async (): Promise<SeniorRow[]> => {
      const { data, error } = await supabase
        .from("seniors")
        .select("id, imie, nazwisko, adres, telefon, godziny_min, godziny_max, status")
        .order("nazwisko", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SeniorRow[];
    },
  });

  const filtered = (data ?? []).filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.imie.toLowerCase().includes(q) ||
      s.nazwisko.toLowerCase().includes(q) ||
      s.adres.toLowerCase().includes(q)
    );
  });

  const createMutation = useMutation({
    mutationFn: async (values: SeniorFormValues) => {
      const payload = {
        imie: values.imie.trim(),
        nazwisko: values.nazwisko.trim(),
        pesel: values.pesel?.trim() || null,
        telefon: values.telefon?.trim() || null,
        telefon_rodziny: values.telefon_rodziny?.trim() || null,
        adres: values.adres.trim(),
        lat: values.lat ? Number(values.lat) : null,
        lng: values.lng ? Number(values.lng) : null,
        nfc_uid: values.nfc_uid?.trim() || null,
        notatka_techniczna: values.notatka_techniczna?.trim() || null,
        decyzja_nr: values.decyzja_nr?.trim() || null,
        decyzja_data: values.decyzja_data || null,
        decyzja_od: values.decyzja_od || null,
        decyzja_do: values.decyzja_do || null,
        godziny_min: values.godziny_min,
        godziny_max: values.godziny_max,
        stawka_h: values.stawka_h,
        status: values.status,
      };
      const { error } = await supabase.from("seniors").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Senior dodany");
      qc.invalidateQueries({ queryKey: ["seniors"] });
      setOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Seniorzy</h1>
          <p className="text-sm text-muted-foreground">
            Lista podopiecznych — {data?.length ?? 0} w bazie.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus />
              Dodaj seniora
            </Button>
          </DialogTrigger>
          <SeniorForm
            onSubmit={(v) => createMutation.mutate(v)}
            submitting={createMutation.isPending}
          />
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Szukaj po imieniu, nazwisku lub adresie..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nazwisko i imię</TableHead>
              <TableHead>Adres</TableHead>
              <TableHead>Telefon</TableHead>
              <TableHead>Godziny (min/max)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  {search
                    ? "Brak wyników dla podanej frazy."
                    : "Brak seniorów. Dodaj pierwszego korzystając z przycisku powyżej."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((s) => {
                const st = STATUS_LABELS[s.status];
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {s.nazwisko} {s.imie}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {s.adres}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.telefon ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.godziny_min} / {s.godziny_max} h
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={st.tone}>
                        {st.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="ghost">
                        <Link
                          to="/seniorzy/$id"
                          params={{ id: s.id }}
                          disabled
                          aria-disabled
                          onClick={(e) => e.preventDefault()}
                        >
                          Otwórz
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SeniorForm({
  onSubmit,
  submitting,
}: {
  onSubmit: (v: SeniorFormValues) => void;
  submitting: boolean;
}) {
  const form = useForm<SeniorFormValues>({
    resolver: zodResolver(seniorSchema),
    defaultValues: {
      imie: "",
      nazwisko: "",
      pesel: "",
      telefon: "",
      telefon_rodziny: "",
      adres: "",
      lat: "",
      lng: "",
      nfc_uid: "",
      notatka_techniczna: "",
      decyzja_nr: "",
      decyzja_data: "",
      decyzja_od: "",
      decyzja_do: "",
      godziny_min: 0,
      godziny_max: 0,
      stawka_h: 0,
      status: "aktywny",
    },
  });

  return (
    <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Dodaj seniora</DialogTitle>
        <DialogDescription>
          Wypełnij dane podopiecznego. Pola oznaczone gwiazdką są wymagane.
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <Section title="Dane osobowe">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField form={form} name="imie" label="Imię *" />
              <TextField form={form} name="nazwisko" label="Nazwisko *" />
              <TextField form={form} name="pesel" label="PESEL" placeholder="11 cyfr" />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="aktywny">Aktywny</SelectItem>
                        <SelectItem value="wygasa">Wygasa</SelectItem>
                        <SelectItem value="nieaktywny">Nieaktywny</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <TextField form={form} name="telefon" label="Telefon" />
              <TextField form={form} name="telefon_rodziny" label="Telefon rodziny" />
            </div>
          </Section>

          <Section title="Adres i lokalizacja">
            <TextField form={form} name="adres" label="Adres *" />
            <p className="text-xs text-muted-foreground">
              Współrzędne możesz znaleźć klikając prawym przyciskiem na Google Maps i kopiując pozycję.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <TextField form={form} name="lat" label="Szerokość (lat)" placeholder="52.2297" />
              <TextField form={form} name="lng" label="Długość (lng)" placeholder="21.0122" />
            </div>
          </Section>

          <Section title="NFC i notatki">
            <TextField
              form={form}
              name="nfc_uid"
              label="NFC UID"
              placeholder="Wpisz po przetestowaniu tagu"
            />
            <FormField
              control={form.control}
              name="notatka_techniczna"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notatka techniczna</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </Section>

          <Section title="Decyzja MOPS">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField form={form} name="decyzja_nr" label="Numer decyzji" />
              <TextField form={form} name="decyzja_data" label="Data decyzji" type="date" />
              <TextField form={form} name="decyzja_od" label="Obowiązuje od" type="date" />
              <TextField form={form} name="decyzja_do" label="Obowiązuje do" type="date" />
            </div>
          </Section>

          <Section title="Godziny i stawka">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <TextField form={form} name="godziny_min" label="Godziny min *" type="number" />
              <TextField form={form} name="godziny_max" label="Godziny max *" type="number" />
              <TextField
                form={form}
                name="stawka_h"
                label="Stawka godz. (zł) *"
                type="number"
                step="0.01"
              />
            </div>
          </Section>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" />}
              Zapisz seniora
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

function TextField({
  form,
  name,
  label,
  placeholder,
  type = "text",
  step,
}: {
  form: ReturnType<typeof useForm<SeniorFormValues>>;
  name: keyof SeniorFormValues;
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
              value={field.value as string | number}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
