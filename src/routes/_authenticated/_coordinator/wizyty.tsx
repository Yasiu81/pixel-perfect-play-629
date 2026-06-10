import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_coordinator/wizyty")({
  component: WizytyPage,
});

function WizytyPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Monitor wizyt</h1>
        <p className="text-sm text-muted-foreground">Oś czasu dzisiejszych wizyt i alerty.</p>
      </div>
      <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
        Oś czasu z kolorowymi statusami wizyt pojawi się w KROKU 2.
      </div>
    </div>
  );
}
