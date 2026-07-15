import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, RefreshCw, Lock, LockOpen, ShieldAlert, Mail, Send, CheckCircle2, XCircle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/_coordinator/historia")({
  component: HistoriaPage,
});

type AuditRow = {
  id: string;
  user_id: string | null;
  table_name: string;
  record_id: string | null;
  operation: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

const OPERATION_LABEL: Record<string, string> = {
  LOGIN: "Logowanie",
  INSERT: "Utworzenie",
  UPDATE: "Zmiana",
  DELETE: "Usunięcie",
  UPDATE_PESEL: "Zmiana PESEL",
  READ_PESEL: "Odczyt PESEL",
  LOCK_MONTH: "Zamknięcie miesiąca",
  UNLOCK_MONTH: "Odblokowanie miesiąca",
};

const OPERATION_TONE: Record<string, string> = {
  LOGIN: "bg-sky-500/15 text-sky-700",
  INSERT: "bg-emerald-500/15 text-emerald-700",
  UPDATE: "bg-amber-500/15 text-amber-700",
  DELETE: "bg-red-500/15 text-red-700",
  UPDATE_PESEL: "bg-amber-500/15 text-amber-700",
  READ_PESEL: "bg-muted text-muted-foreground",
  LOCK_MONTH: "bg-amber-500/15 text-amber-700",
  UNLOCK_MONTH: "bg-sky-500/15 text-sky-700",
};

const TABLE_LABEL: Record<string, string> = {
  seniors: "Seniorzy",
  auth_session: "Sesja logowania",
  period_locks: "Okresy rozliczeniowe",
};

function HistoriaPage() {
  const [operationFilter, setOperationFilter] = useState("__all__");
  const [tableFilter, setTableFilter] = useState("__all__");
  const [userFilter, setUserFilter] = useState("__all__");

  const { data: rows, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["audit-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, user_id, table_name, record_id, operation, details, created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as unknown as AuditRow[];
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ["profiles-names-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, imie, nazwisko");
      if (error) throw error;
      return data ?? [];
    },
  });
  const nameMap = useMemo(
    () => Object.fromEntries((profiles ?? []).map((p) => [p.id, `${p.imie} ${p.nazwisko}`])),
    [profiles],
  );

  const operations = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.operation))).sort(),
    [rows],
  );
  const tables = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.table_name))).sort(),
    [rows],
  );
  const users = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.user_id).filter(Boolean))) as string[],
    [rows],
  );

  const filteredRows = (rows ?? []).filter((r) => {
    if (operationFilter !== "__all__" && r.operation !== operationFilter) return false;
    if (tableFilter !== "__all__" && r.table_name !== tableFilter) return false;
    if (userFilter !== "__all__" && r.user_id !== userFilter) return false;
    return true;
  });

  const fmtDetails = (d: Record<string, unknown> | null) => {
    if (!d) return "—";
    const parts = Object.entries(d).map(([k, v]) => `${k}: ${String(v)}`);
    return parts.join(", ") || "—";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <History className="h-6 w-6" /> Historia logowania i audytu
          </h1>
          <p className="text-sm text-muted-foreground">
            Kto i kiedy się logował oraz jakie zmiany wprowadził w systemie. Ostatnie 300 zdarzeń.
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Odśwież
        </Button>
      </div>

      <PeriodLocksSection />

      <FamilyEmailLogSection />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={operationFilter} onValueChange={setOperationFilter}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="Operacja" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Wszystkie operacje</SelectItem>
            {operations.map((op) => (
              <SelectItem key={op} value={op}>{OPERATION_LABEL[op] ?? op}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tableFilter} onValueChange={setTableFilter}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="Tabela" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Wszystkie tabele</SelectItem>
            {tables.map((t) => (
              <SelectItem key={t} value={t}>{TABLE_LABEL[t] ?? t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={userFilter} onValueChange={setUserFilter}>
          <SelectTrigger className="h-9 w-[200px]">
            <SelectValue placeholder="Użytkownik" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Wszyscy użytkownicy</SelectItem>
            {users.map((u) => (
              <SelectItem key={u} value={u}>{nameMap[u] ?? u}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data i godzina</TableHead>
              <TableHead>Użytkownik</TableHead>
              <TableHead>Tabela</TableHead>
              <TableHead>Operacja</TableHead>
              <TableHead>Szczegóły</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))
            ) : filteredRows.length > 0 ? (
              filteredRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString("pl-PL")}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.user_id ? (nameMap[r.user_id] ?? "Nieznany użytkownik") : "System"}
                  </TableCell>
                  <TableCell className="text-sm">{TABLE_LABEL[r.table_name] ?? r.table_name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={OPERATION_TONE[r.operation] ?? ""}>
                      {OPERATION_LABEL[r.operation] ?? r.operation}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate" title={fmtDetails(r.details)}>
                    {fmtDetails(r.details)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  Brak zdarzeń pasujących do filtrów.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Logowania są rejestrowane od momentu wdrożenia tej funkcji. Zmiany w kartotekach seniorów
        (dodanie/edycja/usunięcie, odczyt i zmiana numeru PESEL) są rejestrowane automatycznie.
      </p>
    </div>
  );
}

type PeriodLock = { id: string; month: string; locked_by: string | null; locked_at: string; notes: string | null };

function monthOptions(count: number) {
  const now = new Date();
  const opts: { value: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const label = d.toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
    opts.push({ value, label });
  }
  return opts;
}

function PeriodLocksSection() {
  const qc = useQueryClient();
  const options = useMemo(() => monthOptions(15), []);
  const [selectedMonth, setSelectedMonth] = useState(options[1]?.value ?? options[0].value); // domyślnie poprzedni miesiąc

  const { data: locks, isLoading } = useQuery({
    queryKey: ["period-locks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("period_locks")
        .select("id, month, locked_by, locked_at, notes")
        .order("month", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PeriodLock[];
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ["profiles-names-all"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, imie, nazwisko");
      return data ?? [];
    },
  });
  const nameMap = Object.fromEntries((profiles ?? []).map((p) => [p.id, `${p.imie} ${p.nazwisko}`]));

  const lockMut = useMutation({
    mutationFn: async (month: string) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("period_locks").insert({
        month, locked_by: userData.user?.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Miesiąc zamknięty — wizyty i zlecenia dodatkowe z tego okresu są teraz niemodyfikowalne.");
      qc.invalidateQueries({ queryKey: ["period-locks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unlockMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("period_locks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Miesiąc odblokowany.");
      qc.invalidateQueries({ queryKey: ["period-locks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isLocked = (locks ?? []).some((l) => l.month === selectedMonth);
  const monthLabel = options.find((o) => o.value === selectedMonth)?.label ?? selectedMonth;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-600" />
        <h2 className="text-sm font-semibold">Zamknięcie okresu rozliczeniowego</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Po zamknięciu miesiąca żadna wizyta ani zlecenie dodatkowe z tego okresu nie może być
        dodane, zmienione ani usunięte — dotyczy to również opiekunów w aplikacji mobilnej.
        Wymagane przez kontrole finansowe (MOPS / Urząd Wojewódzki).
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="h-9 w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isLocked ? (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              const l = locks!.find((x) => x.month === selectedMonth)!;
              if (confirm(`Odblokować ${monthLabel}? Wizyty i zlecenia z tego miesiąca znów będą edytowalne.`)) {
                unlockMut.mutate(l.id);
              }
            }}
          >
            <LockOpen className="h-4 w-4" /> Odblokuj {monthLabel}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => {
              if (confirm(`Zamknąć ${monthLabel}? Po zamknięciu nie będzie można edytować ani usuwać wizyt i zleceń z tego miesiąca.`)) {
                lockMut.mutate(selectedMonth);
              }
            }}
          >
            <Lock className="h-4 w-4" /> Zamknij {monthLabel}
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : locks && locks.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {locks.map((l) => (
            <Badge key={l.id} variant="secondary" className="bg-amber-500/15 text-amber-700 text-xs">
              <Lock className="mr-1 h-3 w-3" />
              {new Date(l.month + "T12:00:00").toLocaleDateString("pl-PL", { month: "long", year: "numeric" })}
              {l.locked_by && ` · ${nameMap[l.locked_by] ?? ""}`}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Brak zamkniętych miesięcy.</p>
      )}
    </div>
  );
}

// ─── E-maile do rodzin (podsumowania dnia) ──────────────────────────────────

type FamilyEmailRow = {
  id: string;
  recipient_email: string;
  senior_id: string | null;
  visit_date: string;
  status: string;
  error_message: string | null;
  sent_at: string;
  seniors: { imie: string; nazwisko: string } | null;
};

function FamilyEmailLogSection() {
  const [sendDate, setSendDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sending, setSending] = useState(false);

  const { data: log, isLoading, refetch } = useQuery({
    queryKey: ["family-email-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("family_email_log")
        .select("id, recipient_email, senior_id, visit_date, status, error_message, sent_at, seniors:senior_id(imie, nazwisko)")
        .order("sent_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as FamilyEmailRow[];
    },
  });

  const sendNow = async () => {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-family-visit-emails", {
        body: { date: sendDate },
      });
      if (error) throw error;
      toast.success(`Wysłano: ${data?.sent ?? 0}. ${data?.message ?? ""}`);
      refetch();
    } catch (e) {
      toast.error(`Błąd wysyłki: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Mail className="h-4 w-4" /> E-maile do rodzin — podsumowania dnia
        </h2>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={sendDate}
            onChange={(e) => setSendDate(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          />
          <Button size="sm" onClick={sendNow} disabled={sending}>
            <Send className="h-4 w-4" />
            {sending ? "Wysyłanie..." : "Wyślij teraz za ten dzień"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Wysyłka idzie przez skrzynkę administracja@planseniora.pl — kopia trafia też do „Wysłane” w Outlooku.
        Normalnie uruchamia się automatycznie raz dziennie (Cron Job); tu możesz wysłać ręcznie dla wybranego dnia (np. do testów).
      </p>

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : !log || log.length === 0 ? (
        <p className="text-xs text-muted-foreground">Brak wysłanych jeszcze e-maili.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data wizyt</TableHead>
              <TableHead>Senior</TableHead>
              <TableHead>Odbiorca</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Wysłano</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {log.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-sm">{row.visit_date}</TableCell>
                <TableCell className="text-sm">
                  {row.seniors ? `${row.seniors.nazwisko} ${row.seniors.imie}` : "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{row.recipient_email}</TableCell>
                <TableCell>
                  {row.status === "sent" ? (
                    <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 text-xs">
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Wysłano
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-red-500/15 text-red-700 text-xs" title={row.error_message ?? ""}>
                      <XCircle className="mr-1 h-3 w-3" /> Błąd
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(row.sent_at).toLocaleString("pl-PL")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

