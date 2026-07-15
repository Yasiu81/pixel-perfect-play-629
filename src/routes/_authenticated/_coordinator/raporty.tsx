import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell,
  TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Printer, ChevronDown, ChevronRight, Users, User, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_coordinator/raporty")({
  component: RaportyPage,
});

// ─── Typy ────────────────────────────────────────────────────────────────────

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
  senior: { id: string; imie: string; nazwisko: string; adres: string; decyzja_nr: string | null; godziny_max: number | null; stawka_h: number | null } | null;
  tasks: { task_name: string; completed: boolean }[];
};

type CaregiverProfile = { id: string; imie: string; nazwisko: string };

type IncidentVisitRow = {
  id: string;
  planned_start: string;
  notes: string | null;
  caregiver_id: string | null;
  status: string;
  senior: { id: string; imie: string; nazwisko: string } | null;
  tasks: { id: string; task_name: string; uwagi: string | null; requires_response: boolean | null; response: string | null }[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTHS = ["Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec",
  "Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień"];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}
function fmtTimeRange(s: string, e: string) { return `${fmtTime(s)} – ${fmtTime(e)}`; }

// ─── Główna strona ────────────────────────────────────────────────────────────

function RaportyPage() {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth()));
  const [year, setYear]   = useState(String(now.getFullYear()));
  const years = [String(now.getFullYear()-1), String(now.getFullYear()), String(now.getFullYear()+1)];

  const startDate = new Date(Number(year), Number(month), 1).toISOString();
  const endDate   = new Date(Number(year), Number(month)+1, 0, 23, 59, 59).toISOString();
  const monthLabel = `${MONTHS[Number(month)]} ${year}`;

  const { data: visits, isLoading } = useQuery({
    queryKey: ["raporty-visits", month, year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(`id, planned_start, planned_end, actual_start, actual_end,
                 hours_billed, status, notes, caregiver_id,
                 senior:seniors(id, imie, nazwisko, adres, decyzja_nr, godziny_max, stawka_h),
                 tasks:visit_tasks(task_name, completed)`)
        .gte("planned_start", startDate)
        .lte("planned_start", endDate)
        .eq("status", "completed")
        .order("planned_start");
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });

  const { data: incidentVisits, isLoading: incidentsLoading } = useQuery({
    queryKey: ["raporty-incidents", month, year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(`id, planned_start, notes, caregiver_id, status,
                 senior:seniors(id, imie, nazwisko),
                 tasks:visit_tasks(id, task_name, uwagi, requires_response, response)`)
        .gte("planned_start", startDate)
        .lte("planned_start", endDate)
        .order("planned_start", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as IncidentVisitRow[];
    },
  });

  const { data: caregivers } = useQuery({
    queryKey: ["caregivers-profiles"],
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "caregiver");
      const ids = (roles ?? []).map(r => r.user_id);
      if (ids.length === 0) return [];
      const { data } = await supabase.from("profiles").select("id, imie, nazwisko").in("id", ids).order("nazwisko");
      return (data ?? []) as CaregiverProfile[];
    },
  });

  const cgMap = useMemo(() => {
    const m: Record<string, string> = {};
    (caregivers ?? []).forEach(c => { m[c.id] = `${c.imie} ${c.nazwisko}`; });
    return m;
  }, [caregivers]);

  // Grupuj per senior
  const bySenior = useMemo(() => {
    const m = new Map<string, { imie: string; nazwisko: string; adres: string; decyzja_nr: string|null; godziny_max: number|null; stawka_h: number|null; visits: VisitRow[]; totalHours: number; kwota: number }>();
    (visits ?? []).forEach(v => {
      const s = v.senior; if (!s) return;
      if (!m.has(s.id)) m.set(s.id, { imie: s.imie, nazwisko: s.nazwisko, adres: s.adres, decyzja_nr: s.decyzja_nr, godziny_max: s.godziny_max, stawka_h: s.stawka_h, visits: [], totalHours: 0, kwota: 0 });
      const e = m.get(s.id)!;
      e.visits.push(v);
      e.totalHours += v.hours_billed ?? 0;
      e.kwota = e.totalHours * (s.stawka_h ?? 0);
    });
    return Array.from(m.entries()).sort((a,b) => a[1].nazwisko.localeCompare(b[1].nazwisko, "pl"));
  }, [visits]);

  // Grupuj per opiekun
  const byCaregiver = useMemo(() => {
    const m = new Map<string, { name: string; visits: VisitRow[]; totalHours: number; kwota: number }>();
    (visits ?? []).forEach(v => {
      const cid = v.caregiver_id ?? "__none__";
      const name = v.caregiver_id ? (cgMap[v.caregiver_id] ?? "Nieznany") : "Nie przypisano";
      if (!m.has(cid)) m.set(cid, { name, visits: [], totalHours: 0, kwota: 0 });
      const e = m.get(cid)!;
      e.visits.push(v);
      e.totalHours += v.hours_billed ?? 0;
      e.kwota += (v.hours_billed ?? 0) * (v.senior?.stawka_h ?? 0);
    });
    return Array.from(m.entries()).sort((a,b) => a[1].name.localeCompare(b[1].name, "pl"));
  }, [visits, cgMap]);

  const totalHours = bySenior.reduce((s, [,x]) => s + x.totalHours, 0);
  const totalKwota = bySenior.reduce((s, [,x]) => s + x.kwota, 0);

  return (
    <div className="space-y-6">
      {/* Nagłówek */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Raporty</h1>
          <p className="text-sm text-muted-foreground">Rozliczenia miesięczne — {monthLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTHS.map((m,i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Drukuj / PDF
          </Button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-4 print:hidden">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Seniorów w raporcie</div>
          <div className="mt-1 text-2xl font-semibold">{bySenior.length}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Łączne godziny</div>
          <div className="mt-1 text-2xl font-semibold">{totalHours} h</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Łączna kwota</div>
          <div className="mt-1 text-2xl font-semibold">{totalKwota.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} zł</div>
        </div>
      </div>

      {/* Zakładki */}
      <Tabs defaultValue="seniorzy" className="print:block">
        <TabsList className="print:hidden">
          <TabsTrigger value="seniorzy"><Users className="h-4 w-4 mr-1" />Wg seniorów</TabsTrigger>
          <TabsTrigger value="opiekunowie"><User className="h-4 w-4 mr-1" />Wg opiekunów</TabsTrigger>
          <TabsTrigger value="incydenty"><AlertTriangle className="h-4 w-4 mr-1" />Incydenty i uwagi</TabsTrigger>
        </TabsList>

        {/* ── WG SENIORÓW ── */}
        <TabsContent value="seniorzy" className="mt-4">
          <RaportSeniorzy
            bySenior={bySenior}
            cgMap={cgMap}
            monthLabel={monthLabel}
            totalHours={totalHours}
            totalKwota={totalKwota}
            isLoading={isLoading}
          />
        </TabsContent>

        {/* ── WG OPIEKUNÓW ── */}
        <TabsContent value="opiekunowie" className="mt-4">
          <RaportOpiekunowie
            byCaregiver={byCaregiver}
            cgMap={cgMap}
            monthLabel={monthLabel}
            isLoading={isLoading}
          />
        </TabsContent>

        {/* ── INCYDENTY I UWAGI ── */}
        <TabsContent value="incydenty" className="mt-4">
          <RaportIncydenty
            visits={incidentVisits ?? []}
            cgMap={cgMap}
            monthLabel={monthLabel}
            isLoading={incidentsLoading}
          />
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground print:hidden">
        Przycisk "Drukuj / PDF" drukuje aktywną zakładkę. Raport zawiera wyłącznie wizyty o statusie "Zakończona".
      </p>
    </div>
  );
}

// ─── RAPORT WG SENIORÓW ───────────────────────────────────────────────────────

type SeniorEntry = { imie: string; nazwisko: string; adres: string; decyzja_nr: string|null; godziny_max: number|null; stawka_h: number|null; visits: VisitRow[]; totalHours: number; kwota: number };

function RaportSeniorzy({ bySenior, cgMap, monthLabel, totalHours, totalKwota, isLoading }: {
  bySenior: [string, SeniorEntry][];
  cgMap: Record<string, string>;
  monthLabel: string;
  totalHours: number;
  totalKwota: number;
  isLoading: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {/* Tytuł wydruku */}
      <div className="hidden print:block mb-6">
        <h2 className="text-xl font-bold">Zestawienie wg seniorów — {monthLabel}</h2>
        <p className="text-sm text-gray-500">Plan Seniora · Raport miesięczny</p>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6 print:hidden"></TableHead>
              <TableHead>Senior</TableHead>
              <TableHead>Nr decyzji MOPS</TableHead>
              <TableHead className="text-right">Godz. przyznane</TableHead>
              <TableHead className="text-right">Godz. zrealizowane</TableHead>
              <TableHead className="text-right">Stawka/h</TableHead>
              <TableHead className="text-right">Kwota</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({length:3}).map((_,i) => (
                <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ))
            ) : bySenior.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Brak zrealizowanych wizyt w wybranym miesiącu.</TableCell></TableRow>
            ) : (
              <>
                {bySenior.map(([sid, s]) => {
                  const isExp = expanded === sid;
                  const pct = s.godziny_max ? Math.round((s.totalHours / s.godziny_max) * 100) : null;
                  const tone = pct == null ? "bg-muted text-muted-foreground" : pct >= 100 ? "bg-emerald-500/15 text-emerald-700" : pct >= 50 ? "bg-sky-500/15 text-sky-700" : "bg-amber-500/15 text-amber-700";
                  const label = pct == null ? "brak limitu" : pct >= 100 ? "limit osiągnięty" : `${pct}% limitu`;

                  return (
                    <>
                      <TableRow key={sid} className="cursor-pointer hover:bg-muted/50 print:cursor-auto" onClick={() => setExpanded(isExp ? null : sid)}>
                        <TableCell className="print:hidden">
                          {isExp ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-medium">
                          {s.nazwisko} {s.imie}
                          <div className="text-xs text-muted-foreground">{s.adres}</div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{s.decyzja_nr || "—"}</TableCell>
                        <TableCell className="text-right">{s.godziny_max != null ? `${s.godziny_max} h` : "—"}</TableCell>
                        <TableCell className="text-right font-semibold">{s.totalHours} h</TableCell>
                        <TableCell className="text-right">{s.stawka_h != null ? `${Number(s.stawka_h).toFixed(2)} zł` : "—"}</TableCell>
                        <TableCell className="text-right font-semibold">{s.kwota > 0 ? `${s.kwota.toLocaleString("pl-PL", {minimumFractionDigits:2})} zł` : "—"}</TableCell>
                      </TableRow>

                      {/* Szczegół wizyt seniora */}
                      {(isExp) && (
                        <TableRow key={`${sid}-detail`}>
                          <TableCell colSpan={7} className="bg-muted/20 p-0">
                            <div className="px-6 py-4">
                              <DetailSenior visits={s.visits} cgMap={cgMap} />
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
                <TableRow className="font-semibold bg-muted/30">
                  <TableCell className="print:hidden"></TableCell>
                  <TableCell colSpan={3}>ŁĄCZNIE</TableCell>
                  <TableCell className="text-right">{totalHours} h</TableCell>
                  <TableCell></TableCell>
                  <TableCell className="text-right">{totalKwota.toLocaleString("pl-PL", {minimumFractionDigits:2})} zł</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DetailSenior({ visits, cgMap }: { visits: VisitRow[]; cgMap: Record<string, string> }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Szczegół wizyt
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="text-left py-1 pr-3">Lp.</th>
            <th className="text-left py-1 pr-3">Data</th>
            <th className="text-left py-1 pr-3">Godziny</th>
            <th className="text-right py-1 pr-3">Godz. rozlicz.</th>
            <th className="text-left py-1 pr-3">Opiekun</th>
            <th className="text-left py-1">Wykonane czynności</th>
          </tr>
        </thead>
        <tbody>
          {visits.map((v, idx) => {
            const start = v.actual_start || v.planned_start;
            const end   = v.actual_end   || v.planned_end;
            const done  = (v.tasks ?? []).filter(t => t.completed).map(t => t.task_name);
            return (
              <tr key={v.id} className="border-t border-border/50">
                <td className="py-1.5 pr-3 text-muted-foreground">{idx+1}.</td>
                <td className="py-1.5 pr-3">{fmtDate(start)}</td>
                <td className="py-1.5 pr-3">{fmtTimeRange(start, end)}</td>
                <td className="py-1.5 pr-3 text-right font-medium">{v.hours_billed ?? "—"} h</td>
                <td className="py-1.5 pr-3 text-muted-foreground">{v.caregiver_id ? (cgMap[v.caregiver_id] ?? "—") : "—"}</td>
                <td className="py-1.5 text-muted-foreground text-xs">{done.length > 0 ? done.join(", ") : "—"}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-border font-semibold">
            <td colSpan={3} className="py-2 text-right pr-3">Łącznie:</td>
            <td className="py-2 pr-3 text-right">{visits.reduce((s,v) => s + (v.hours_billed ?? 0), 0)} h</td>
            <td colSpan={2}></td>
          </tr>
        </tbody>
      </table>
      {/* Notatki */}
      {visits.filter(v => v.notes).map(v => (
        <div key={v.id} className="mt-1 text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1">
          <span className="font-medium">{fmtDate(v.planned_start)}:</span> {v.notes}
        </div>
      ))}
    </div>
  );
}

// ─── RAPORT WG OPIEKUNÓW ──────────────────────────────────────────────────────

type CaregiverEntry = { name: string; visits: VisitRow[]; totalHours: number; kwota: number };

function RaportOpiekunowie({ byCaregiver, cgMap, monthLabel, isLoading }: {
  byCaregiver: [string, CaregiverEntry][];
  cgMap: Record<string, string>;
  monthLabel: string;
  isLoading: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const totalHours = byCaregiver.reduce((s,[,x]) => s + x.totalHours, 0);
  const totalKwota = byCaregiver.reduce((s,[,x]) => s + x.kwota, 0);

  return (
    <div className="space-y-4">
      <div className="hidden print:block mb-6">
        <h2 className="text-xl font-bold">Zestawienie wg opiekunów — {monthLabel}</h2>
        <p className="text-sm text-gray-500">Plan Seniora · Raport miesięczny</p>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6 print:hidden"></TableHead>
              <TableHead>Opiekun</TableHead>
              <TableHead className="text-right">Liczba wizyt</TableHead>
              <TableHead className="text-right">Godz. zrealizowane</TableHead>
              <TableHead className="text-right">Kwota łączna</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({length:3}).map((_,i) => (
                <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ))
            ) : byCaregiver.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Brak zrealizowanych wizyt w wybranym miesiącu.</TableCell></TableRow>
            ) : (
              <>
                {byCaregiver.map(([cid, c]) => {
                  const isExp = expanded === cid;
                  // Seniorzy obsługiwani przez tego opiekuna
                  const seniorSet = new Map<string, { imie: string; nazwisko: string; hours: number; kwota: number; visits: VisitRow[] }>();
                  c.visits.forEach(v => {
                    const s = v.senior; if (!s) return;
                    if (!seniorSet.has(s.id)) seniorSet.set(s.id, { imie: s.imie, nazwisko: s.nazwisko, hours: 0, kwota: 0, visits: [] });
                    const e = seniorSet.get(s.id)!;
                    e.visits.push(v);
                    e.hours += v.hours_billed ?? 0;
                    e.kwota += (v.hours_billed ?? 0) * (s.stawka_h ?? 0);
                  });
                  const seniors = Array.from(seniorSet.values()).sort((a,b) => a.nazwisko.localeCompare(b.nazwisko, "pl"));

                  return (
                    <>
                      <TableRow key={cid} className="cursor-pointer hover:bg-muted/50 print:cursor-auto" onClick={() => setExpanded(isExp ? null : cid)}>
                        <TableCell className="print:hidden">
                          {isExp ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell className="text-right">{c.visits.length}</TableCell>
                        <TableCell className="text-right font-semibold">{c.totalHours} h</TableCell>
                        <TableCell className="text-right font-semibold">
                          {c.kwota > 0 ? `${c.kwota.toLocaleString("pl-PL", {minimumFractionDigits:2})} zł` : "—"}
                        </TableCell>
                      </TableRow>

                      {isExp && (
                        <TableRow key={`${cid}-detail`}>
                          <TableCell colSpan={5} className="bg-muted/20 p-0">
                            <div className="px-6 py-4 space-y-6">
                              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Szczegół wizyt — {c.name}
                              </div>
                              {seniors.map((s, si) => (
                                <div key={si}>
                                  <div className="text-sm font-semibold mb-1">{s.nazwisko} {s.imie}</div>
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="text-xs text-muted-foreground">
                                        <th className="text-left py-1 pr-3">Lp.</th>
                                        <th className="text-left py-1 pr-3">Data</th>
                                        <th className="text-left py-1 pr-3">Godziny</th>
                                        <th className="text-right py-1 pr-3">Godz.</th>
                                        <th className="text-right py-1 pr-3">Kwota</th>
                                        <th className="text-left py-1">Wykonane czynności</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {s.visits.map((v, idx) => {
                                        const start = v.actual_start || v.planned_start;
                                        const end   = v.actual_end   || v.planned_end;
                                        const done  = (v.tasks ?? []).filter(t => t.completed).map(t => t.task_name);
                                        const kwotaV = (v.hours_billed ?? 0) * (v.senior?.stawka_h ?? 0);
                                        return (
                                          <tr key={v.id} className="border-t border-border/50">
                                            <td className="py-1.5 pr-3 text-muted-foreground">{idx+1}.</td>
                                            <td className="py-1.5 pr-3">{fmtDate(start)}</td>
                                            <td className="py-1.5 pr-3">{fmtTimeRange(start, end)}</td>
                                            <td className="py-1.5 pr-3 text-right font-medium">{v.hours_billed ?? "—"} h</td>
                                            <td className="py-1.5 pr-3 text-right">{kwotaV > 0 ? `${kwotaV.toFixed(2)} zł` : "—"}</td>
                                            <td className="py-1.5 text-muted-foreground text-xs">{done.length > 0 ? done.join(", ") : "—"}</td>
                                          </tr>
                                        );
                                      })}
                                      <tr className="border-t border-border font-semibold text-sm">
                                        <td colSpan={3} className="py-1.5 text-right pr-3">Razem u {s.imie} {s.nazwisko}:</td>
                                        <td className="py-1.5 pr-3 text-right">{s.hours} h</td>
                                        <td className="py-1.5 pr-3 text-right">{s.kwota > 0 ? `${s.kwota.toFixed(2)} zł` : "—"}</td>
                                        <td></td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              ))}
                              {/* Podsumowanie opiekuna */}
                              <div className="rounded-lg bg-muted/40 px-4 py-3 flex justify-between text-sm font-semibold">
                                <span>Łącznie {c.name}:</span>
                                <span>{c.totalHours} h · {c.kwota > 0 ? `${c.kwota.toLocaleString("pl-PL", {minimumFractionDigits:2})} zł` : "—"}</span>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
                <TableRow className="font-semibold bg-muted/30">
                  <TableCell className="print:hidden"></TableCell>
                  <TableCell>ŁĄCZNIE</TableCell>
                  <TableCell className="text-right">{byCaregiver.reduce((s,[,x]) => s + x.visits.length, 0)}</TableCell>
                  <TableCell className="text-right">{totalHours} h</TableCell>
                  <TableCell className="text-right">{totalKwota.toLocaleString("pl-PL", {minimumFractionDigits:2})} zł</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── RAPORT: INCYDENTY I UWAGI ────────────────────────────────────────────────
// Zbiorczy wyciąg wszystkich notatek dziennych i uwag przy czynnościach,
// wpisanych przez opiekunów w aplikacji mobilnej — do szybkiego przeglądu
// sytuacji wymagających uwagi (np. "Senior odmówił przyjęcia leków").

function RaportIncydenty({
  visits, cgMap, monthLabel, isLoading,
}: {
  visits: IncidentVisitRow[];
  cgMap: Record<string, string>;
  monthLabel: string;
  isLoading: boolean;
}) {
  const [onlyRequiresResponse, setOnlyRequiresResponse] = useState(false);
  const [query, setQuery] = useState("");

  type Entry = {
    key: string;
    visitId: string;
    date: string;
    senior: string;
    caregiver: string;
    source: "notatka dzienna" | "uwaga przy czynności";
    taskName?: string;
    text: string;
    requiresResponse: boolean;
    response: string | null;
  };

  const entries: Entry[] = [];
  for (const v of visits) {
    const seniorName = v.senior ? `${v.senior.nazwisko} ${v.senior.imie}` : "—";
    const caregiverName = v.caregiver_id ? (cgMap[v.caregiver_id] ?? "—") : "—";
    if (v.notes && v.notes.trim()) {
      entries.push({
        key: `note-${v.id}`, visitId: v.id, date: v.planned_start,
        senior: seniorName, caregiver: caregiverName,
        source: "notatka dzienna", text: v.notes.trim(),
        requiresResponse: false, response: null,
      });
    }
    for (const t of v.tasks ?? []) {
      if (t.uwagi && t.uwagi.trim()) {
        entries.push({
          key: `task-${t.id}`, visitId: v.id, date: v.planned_start,
          senior: seniorName, caregiver: caregiverName,
          source: "uwaga przy czynności", taskName: t.task_name, text: t.uwagi.trim(),
          requiresResponse: !!t.requires_response, response: t.response,
        });
      }
    }
  }
  entries.sort((a, b) => b.date.localeCompare(a.date));

  const filtered = entries.filter((e) => {
    if (onlyRequiresResponse && !e.requiresResponse) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay = `${e.senior} ${e.caregiver} ${e.text} ${e.taskName ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="hidden print:block mb-6">
        <h2 className="text-xl font-bold">Incydenty i uwagi — {monthLabel}</h2>
        <p className="text-sm text-gray-500">Plan Seniora · Zbiorczy wyciąg notatek z wizyt</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Szukaj: senior, opiekun, treść uwagi..."
          className="h-9 w-64 rounded-md border bg-background px-3 text-sm"
        />
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={onlyRequiresResponse}
            onChange={(e) => setOnlyRequiresResponse(e.target.checked)}
          />
          Tylko wymagające odpowiedzi koordynatora
        </label>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} wpisów</span>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          Brak notatek i uwag pasujących do filtrów w tym miesiącu.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => (
            <div key={e.key} className={`rounded-lg border bg-card p-4 ${e.requiresResponse ? "border-red-300" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <div className="text-sm font-medium">
                  {e.senior} <span className="text-muted-foreground font-normal">· {fmtDate(e.date)} {fmtTime(e.date)} · {e.caregiver}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="secondary" className="text-xs">
                    {e.source === "uwaga przy czynności" ? `Czynność: ${e.taskName}` : "Notatka dzienna"}
                  </Badge>
                  {e.requiresResponse && (
                    <Badge variant="secondary" className="text-xs bg-red-500/15 text-red-700">
                      <AlertTriangle className="mr-1 h-3 w-3" /> Wymaga odpowiedzi
                    </Badge>
                  )}
                </div>
              </div>
              <p className="text-sm whitespace-pre-wrap">{e.text}</p>
              {e.response && (
                <p className="mt-2 text-xs text-muted-foreground border-t pt-2">
                  <strong>Odpowiedź koordynatora:</strong> {e.response}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
