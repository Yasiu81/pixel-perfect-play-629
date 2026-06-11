import { createFileRoute } from "@tanstack/react-router";

type WizytySearch = { filter?: "alert" };

export const Route = createFileRoute("/_authenticated/_coordinator/wizyty")({
  validateSearch: (search: Record<string, unknown>): WizytySearch => ({
    filter: search.filter === "alert" ? "alert" : undefined,
  }),
  component: WizytyPage,
});

function WizytyPage() {
  const { filter } = Route.useSearch();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Monitor wizyt</h1>
        <p className="text-sm text-muted-foreground">
          Oś czasu dzisiejszych wizyt i alerty{filter === "alert" ? " — filtr: alarmy" : ""}.
        </p>
      </div>
      <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
        Oś czasu z kolorowymi statusami wizyt pojawi się w punkcie 3 tego kroku.
      </div>
    </div>
  );
}
