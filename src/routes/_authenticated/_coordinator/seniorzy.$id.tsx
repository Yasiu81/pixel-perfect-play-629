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
  godziny_min: number;
  godziny_max: number;
  stawka_h: number;
  status: SeniorStatus;
  pesel_last2: string | null;
};

function SeniorDetailPage() {
  const { id } = Route.useParams();

  const { data: senior, isLoading } = useQuery({
    queryKey: ["seniors", "detail", id],
    queryFn: async (): Promise<SeniorDetail | null> => {
      const { data, error } = await supabase
        .from("seniors")
        .select(
          "id, imie, nazwisko, telefon, telefon_rodziny, adres, lat, lng, nfc_uid, notatka_techniczna, decyzja_nr, decyzja_data, decyzja_od, decyzja_do, godziny_min, godziny_max, stawka_h, status, pesel_last2",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data as SeniorDetail | null) ?? null;
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
          <Field
            label="Godziny w miesiącu (min / max)"
            value={`${senior.godziny_min} / ${senior.godziny_max} h`}
          />
          <Field label="Stawka godz." value={`${senior.stawka_h.toFixed(2)} zł`} />
          <Field label="NFC UID" value={senior.nfc_uid || "—"} />
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
