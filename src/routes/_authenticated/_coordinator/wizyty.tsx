import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";

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

function WizytyPage() {
  const { filter } = Route.useSearch();
  const [dialogOpen, setDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const seniorsQ = useQuery({
    queryKey: ["seniors-active-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seniors")
        .select("id, imie, nazwisko, status")
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
    queryFn: async () => {
      let q = supabase
        .from("visits")
        .select(
          "id, planned_start, planned_end, status, hours_billed, caregiver_id, senior:seniors(imie, nazwisko)",
        )
        .order("planned_start", { ascending: false })
        .limit(100);
      if (filter === "alert") q = q.eq("status", "alert");
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const form = useForm<VisitForm>({
    resolver: zodResolver(visitSchema),
    defaultValues: {
      senior_id: "",
      caregiver_id: NO_CAREGIVER,
      planned_start: "",
      planned_end: "",
      hours_billed: "4",
      notes: "",
    },
  });

  const createMut = useMutation({
    mutationFn: async (v: VisitForm) => {
      const { error } = await supabase.from("visits").insert({
        senior_id: v.senior_id,
        caregiver_id: v.caregiver_id && v.caregiver_id !== NO_CAREGIVER ? v.caregiver_id : null,
        planned_start: new Date(v.planned_start).toISOString(),
        planned_end: new Date(v.planned_end).toISOString(),
        hours_billed: Number(v.hours_billed),
        notes: v.notes || null,
        status: "planned",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Wizyta zaplanowana");
      queryClient.invalidateQueries({ queryKey: ["visits-list"] });
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
            Lista zaplanowanych wizyt{filter === "alert" ? " — filtr: alarmy" : ""}.
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
                  name="hours_billed"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Godziny do rozliczenia *</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} max={24} step={1} {...field} />
                      </FormControl>
                      <FormDescription>
                        Liczba godzin zaliczana do limitu MOPS (zwykle = długość wizyty).
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
                const senior = v.senior as { imie: string; nazwisko: string } | null;
                return (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">
                      {senior ? `${senior.nazwisko} ${senior.imie}` : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(v.planned_start)} → {formatDateTime(v.planned_end)}
                    </TableCell>
                    <TableCell>{caregiverName(v.caregiver_id)}</TableCell>
                    <TableCell>{v.hours_billed}h</TableCell>
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
    </div>
  );
}
