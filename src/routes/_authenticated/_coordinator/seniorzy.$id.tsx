import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/_coordinator/seniorzy/$id")({
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

  const { data: senior, isLoading } = useQuery({
    queryKey: ["seniors", "detail", id],
    queryFn: async (): Promise<SeniorDetail | null> => {
      const { data, error } = await supabase
        .from("seniors")
        .select(
          "id, imie, nazwisko, telefon, telefon_rodziny, adres, lat, lng, nfc_uid, notatka_techniczna, decyzja_nr, decyzja_data, decyzja_od, decyzja_do, godziny_min, godziny_max, stawka_h, status, pesel_last2, plan_wsparcia",
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
          <PlanWsparcia plan={senior.plan_wsparcia} />
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

function PlanWsparcia({ plan }: { plan: unknown }) {
  const items = Array.isArray(plan)
    ? (plan as unknown[]).map((v) => String(v)).filter(Boolean)
    : [];
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Brak zdefiniowanego planu wsparcia. Uzupełnij listę czynności w kartotece, aby pojawiły się
        jako pre-fill przy planowaniu wizyt.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((t, i) => (
        <li
          key={i}
          className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-foreground"
        >
          • {t}
        </li>
      ))}
    </ul>
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
