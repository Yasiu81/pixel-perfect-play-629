import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { FileDown, Printer, ChevronDown, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_coordinator/raporty")({
  component: RaportyPage,
});

// ─── Typy ───────────────────────────────────────────────────────────────────

type VisitRow = {
  id: string;
  planned_start: string;
  planned_end: string;
  actual_start: string | null;
  actual_end: string | null;
  hours_billed: number | null;
  status: string;
  notes: string | null;
  caregiver_id: string | null;
  senior: { imie: string; nazwisko: string; adres: string; decyzja_nr: string | null; godziny_max: number | null; stawka_h: number | null } | null;
  tasks: { task_name: string; completed: boolean }[];
};

type SeniorSummary = {
  seniorId: string;
  imie: string;
  nazwisko: string;
  adres: string;
  decyzja_nr: string | null;
  godziny_max: number | null;
  stawka_h: number | null;
  visits: VisitRow[];
  totalHours: number;
  kwota: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTHS = [
  "Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec",
  "Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień",
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}
function fmtTimeRange(start: string, end: string) {
  return `${fmtTime(start)} – ${fmtTime(end)}`;
}

// ─── Główna strona ────────────────────────────────────────────────────────────

function RaportyPage() {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth()));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [expandedSenior, setExpandedSenior] = useState<string | null>(null);

  const years = [String(now.getFullYear() - 1), String(now.getFullYear()), String(now.getFullYear() + 1)];

  const startDate = new Date(Number(year), Number(month), 1).toISOString();
  const endDate = new Date(Number(year), Number(month) + 1, 0, 23, 59, 59).toISOString();

  const { data: visits, isLoading } = useQuery({
    queryKey: ["raporty-visits", month, year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(`
          id, planned_start, planned_end, actual_start, actual_end,
          hours_billed, status, notes, caregiver_id,
          senior:seniors(imie, nazwisko, adres, decyzja_nr, godziny_max, stawka_h),
          tasks:visit_tasks(task_name, completed)
        `)
        .gte("planned_start", startDate)
        .lte("planned_start", endDate)
        .eq("status", "completed")
        .order("planned_start");
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });

  const { data: caregivers } = useQuery({
    queryKey: ["caregivers-names"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, imie, nazwisko");
      return data ?? [];
    },
  });

  const caregiversMap = useMemo(() => {
    const m: Record<string, string> = {};
    (caregivers ?? []).forEach((c) => { m[c.id] = `${c.imie} ${c.nazwisko}`; });
    return m;
  }, [caregivers]);

  // Grupuj wizyty per senior
  const summaries = useMemo((): SeniorSummary[] => {
    const map = new Map<string, SeniorSummary>();
    (visits ?? []).forEach((v) => {
      const s = v.senior;
      if (!s) return;
      const key = `${s.nazwisko}_${s.imie}_${s.adres}`;
      if (!map.has(key)) {
        map.set(key, {
          seniorId: key,
          imie: s.imie,
          nazwisko: s.nazwisko,
          adres: s.adres,
          decyzja_nr: s.decyzja_nr,
          godziny_max: s.godziny_max,
          stawka_h: s.stawka_h,
          visits: [],
          totalHours: 0,
          kwota: 0,
        });
      }
      const entry = map.get(key)!;
      entry.visits.push(v);
      entry.totalHours += v.hours_billed ?? 0;
      entry.kwota = entry.totalHours * (s.stawka_h ?? 0);
    });
    return Array.from(map.values()).sort((a, b) =>
      a.nazwisko.localeCompare(b.nazwisko, "pl")
    );
  }, [visits]);

  const totalHours = summaries.reduce((s, x) => s + x.totalHours, 0);
  const totalKwota = summaries.reduce((s, x) => s + x.kwota, 0);

  const monthLabel = `${MONTHS[Number(month)]} ${year}`;

  const handlePrint = () => window.print();

  return (
    <div className="space-y-6">
      {/* Nagłówek */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Raporty</h1>
          <p className="text-sm text-muted-foreground">
            Rozliczenia miesięczne dla MOPS — {monthLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i} value={String(i)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={y}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            Drukuj / PDF
          </Button>
        </div>
      </div>

      {/* Podsumowanie */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Seniorów w raporcie</div>
          <div className="mt-1 text-2xl font-semibold">{summaries.length}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Łączne godziny</div>
          <div className="mt-1 text-2xl font-semibold">{totalHours} h</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Łączna kwota</div>
          <div className="mt-1 text-2xl font-semibold">
            {totalKwota.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} zł
          </div>
        </div>
      </div>

      {/* Tabela zbiorcza */}
      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Zestawienie zbiorcze — {monthLabel}</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Senior</TableHead>
              <TableHead>Nr decyzji MOPS</TableHead>
              <TableHead className="text-right">Godz. przyznane</TableHead>
              <TableHead className="text-right">Godz. zrealizowane</TableHead>
              <TableHead className="text-right">Stawka/h</TableHead>
              <TableHead className="text-right">Kwota</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))
            ) : summaries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  Brak zrealizowanych wizyt w wybranym miesiącu.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {summaries.map((s) => {
                  const isExpanded = expandedSenior === s.seniorId;
                  const pct = s.godziny_max ? Math.round((s.totalHours / s.godziny_max) * 100) : null;
                  const statusTone = pct == null ? "bg-muted text-muted-foreground"
                    : pct >= 100 ? "bg-emerald-500/15 text-emerald-700"
                    : pct >= 50 ? "bg-sky-500/15 text-sky-700"
                    : "bg-amber-500/15 text-amber-700";
                  const statusLabel = pct == null ? "brak limitu"
                    : pct >= 100 ? "limit osiągnięty"
                    : `${pct}% limitu`;

                  return (
                    <>
                      <TableRow
                        key={s.seniorId}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedSenior(isExpanded ? null : s.seniorId)}
                      >
                        <TableCell>
                          {isExpanded
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-medium">
                          {s.nazwisko} {s.imie}
                          <div className="text-xs text-muted-foreground">{s.adres}</div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{s.decyzja_nr || "—"}</TableCell>
                        <TableCell className="text-right">{s.godziny_max != null ? `${s.godziny_max} h` : "—"}</TableCell>
                        <TableCell className="text-right font-semibold">{s.totalHours} h</TableCell>
                        <TableCell className="text-right">{s.stawka_h != null ? `${Number(s.stawka_h).toFixed(2)} zł` : "—"}</TableCell>
                        <TableCell className="text-right font-semibold">
                          {s.kwota > 0 ? `${s.kwota.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} zł` : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={statusTone}>{statusLabel}</Badge>
                        </TableCell>
                      </TableRow>

                      {/* Rozwinięte wizyty */}
                      {isExpanded && (
                        <TableRow key={`${s.seniorId}-detail`}>
                          <TableCell colSpan={8} className="bg-muted/20 p-0">
                            <div className="px-6 py-3">
                              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                                Szczegół wizyt — {s.imie} {s.nazwisko}
                              </div>
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-xs text-muted-foreground">
                                    <th className="text-left py-1 pr-4">Lp.</th>
                                    <th className="text-left py-1 pr-4">Data</th>
                                    <th className="text-left py-1 pr-4">Godz. realizacji</th>
                                    <th className="text-right py-1 pr-4">Godz. rozlicz.</th>
                                    <th className="text-left py-1 pr-4">Wykonane czynności</th>
                                    <th className="text-left py-1">Opiekun</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {s.visits.map((v, idx) => {
                                    const completedTasks = v.tasks.filter((t) => t.completed).map((t) => t.task_name);
                                    const start = v.actual_start || v.planned_start;
                                    const end = v.actual_end || v.planned_end;
                                    return (
                                      <tr key={v.id} className="border-t border-border/50">
                                        <td className="py-1.5 pr-4 text-muted-foreground">{idx + 1}.</td>
                                        <td className="py-1.5 pr-4">{fmtDate(start)}</td>
                                        <td className="py-1.5 pr-4">{fmtTimeRange(start, end)}</td>
                                        <td className="py-1.5 pr-4 text-right font-medium">{v.hours_billed ?? "—"} h</td>
                                        <td className="py-1.5 pr-4 text-muted-foreground">
                                          {completedTasks.length > 0 ? completedTasks.join(", ") : "—"}
                                        </td>
                                        <td className="py-1.5 text-muted-foreground">
                                          {v.caregiver_id ? (caregiversMap[v.caregiver_id] ?? "—") : "—"}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                  <tr className="border-t-2 border-border font-semibold">
                                    <td colSpan={3} className="py-2 text-right pr-4">Łącznie:</td>
                                    <td className="py-2 pr-4 text-right">{s.totalHours} h</td>
                                    <td colSpan={2}></td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}

                {/* Wiersz łączny */}
                <TableRow className="font-semibold bg-muted/30">
                  <TableCell></TableCell>
                  <TableCell>ŁĄCZNIE</TableCell>
                  <TableCell></TableCell>
                  <TableCell></TableCell>
                  <TableCell className="text-right">{totalHours} h</TableCell>
                  <TableCell></TableCell>
                  <TableCell className="text-right">
                    {totalKwota.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} zł
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Stopka z informacją o druku */}
      <p className="text-xs text-muted-foreground">
        Przycisk "Drukuj / PDF" otwiera okno drukowania systemu — wybierz "Zapisz jako PDF" aby wygenerować plik.
        Raport zawiera wyłącznie wizyty o statusie "Zakończona".
      </p>
    </div>
  );
}
