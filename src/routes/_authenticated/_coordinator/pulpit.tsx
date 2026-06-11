import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarCheck, Clock, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_coordinator/pulpit")({
  component: PulpitPage,
});

type VisitStatus = "planned" | "active" | "completed" | "alert" | "requires_verification";

type DashboardStats = {
  activeSeniors: number;
  visitsToday: { total: number; byStatus: Record<VisitStatus, number> };
  hoursThisMonth: number;
  activeAlerts: number;
};

async function fetchDashboardStats(): Promise<DashboardStats> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  const [seniorsRes, visitsTodayRes, hoursRes, alertsRes] = await Promise.all([
    supabase.from("seniors").select("id", { count: "exact", head: true }).eq("status", "aktywny"),
    supabase
      .from("visits")
      .select("status")
      .gte("planned_start", startOfDay)
      .lt("planned_start", endOfDay),
    supabase
      .from("visits")
      .select("hours_billed")
      .eq("status", "completed")
      .gte("actual_end", startOfMonth)
      .lt("actual_end", startOfNextMonth),
    supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("resolved", false),
  ]);

  if (seniorsRes.error) throw seniorsRes.error;
  if (visitsTodayRes.error) throw visitsTodayRes.error;
  if (hoursRes.error) throw hoursRes.error;
  if (alertsRes.error) throw alertsRes.error;

  const byStatus: Record<VisitStatus, number> = {
    planned: 0,
    active: 0,
    completed: 0,
    alert: 0,
    requires_verification: 0,
  };
  for (const v of visitsTodayRes.data ?? []) {
    byStatus[v.status as VisitStatus] += 1;
  }

  const hoursThisMonth = (hoursRes.data ?? []).reduce(
    (acc, v) => acc + Number(v.hours_billed ?? 0),
    0,
  );

  return {
    activeSeniors: seniorsRes.count ?? 0,
    visitsToday: { total: visitsTodayRes.data?.length ?? 0, byStatus },
    hoursThisMonth,
    activeAlerts: alertsRes.count ?? 0,
  };
}

function formatHours(h: number) {
  return h.toLocaleString("pl-PL", { maximumFractionDigits: 1 });
}

function PulpitPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: fetchDashboardStats,
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pulpit</h1>
        <p className="text-sm text-muted-foreground">
          Przegląd działalności firmy w czasie rzeczywistym.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive-soft p-4 text-sm text-destructive">
          Nie udało się załadować wskaźników: {(error as Error).message}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          to="/seniorzy"
          label="Aktywni seniorzy"
          value={data?.activeSeniors}
          loading={isLoading}
          icon={<Users className="h-5 w-5" />}
          tone="primary"
          hint="Podopieczni o statusie aktywny"
        />

        <KpiCard
          to="/wizyty"
          label="Wizyty dziś"
          value={data?.visitsToday.total}
          loading={isLoading}
          icon={<CalendarCheck className="h-5 w-5" />}
          tone="info"
          hint={
            data
              ? `${data.visitsToday.byStatus.completed} zrealizowane • ${data.visitsToday.byStatus.active} w trakcie • ${data.visitsToday.byStatus.planned} zaplanowane`
              : undefined
          }
        />

        <KpiCard
          to="/raporty"
          label="Godziny w tym miesiącu"
          value={data ? formatHours(data.hoursThisMonth) : undefined}
          loading={isLoading}
          icon={<Clock className="h-5 w-5" />}
          tone="success"
          hint="Suma godzin ze zrealizowanych wizyt"
        />

        <KpiCard
          to="/wizyty"
          toSearch={{ filter: "alert" }}
          label="Aktywne alarmy"
          value={data?.activeAlerts}
          loading={isLoading}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={data && data.activeAlerts > 0 ? "destructive" : "muted"}
          hint="Kliknij, aby otworzyć monitor wizyt"
        />
      </div>
    </div>
  );
}

type KpiTone = "primary" | "info" | "success" | "destructive" | "muted";

const toneStyles: Record<KpiTone, { icon: string; ring: string }> = {
  primary: { icon: "bg-primary-soft text-primary", ring: "group-hover:ring-primary/30" },
  info: { icon: "bg-info-soft text-info", ring: "group-hover:ring-info/30" },
  success: { icon: "bg-success-soft text-success", ring: "group-hover:ring-success/30" },
  destructive: {
    icon: "bg-destructive-soft text-destructive",
    ring: "group-hover:ring-destructive/30",
  },
  muted: { icon: "bg-muted text-muted-foreground", ring: "group-hover:ring-border" },
};

function KpiCard({
  to,
  toSearch,
  label,
  value,
  loading,
  icon,
  tone,
  hint,
}: {
  to: string;
  toSearch?: Record<string, string>;
  label: string;
  value: number | string | undefined;
  loading: boolean;
  icon: React.ReactNode;
  tone: KpiTone;
  hint?: string;
}) {
  const styles = toneStyles[tone];
  return (
    <Link
      to={to}
      search={toSearch as never}
      className={cn(
        "group rounded-xl border bg-card p-5 shadow-card ring-1 ring-transparent transition-all",
        "hover:shadow-elevated hover:-translate-y-0.5",
        styles.ring,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">
            {loading ? <span className="inline-block h-8 w-16 animate-pulse rounded bg-muted" /> : (value ?? 0)}
          </div>
        </div>
        <div className={cn("rounded-lg p-2", styles.icon)}>{icon}</div>
      </div>
      {hint ? <div className="mt-3 text-xs text-muted-foreground">{hint}</div> : null}
    </Link>
  );
}
