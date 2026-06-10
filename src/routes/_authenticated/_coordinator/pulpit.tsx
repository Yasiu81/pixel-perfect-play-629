import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_coordinator/pulpit")({
  component: PulpitPage,
});

function PulpitPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pulpit</h1>
        <p className="text-sm text-muted-foreground">
          Przegląd działalności firmy w czasie rzeczywistym.
        </p>
      </div>
      <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
        Wskaźniki, alerty i podsumowanie miesiąca pojawią się tutaj w KROKU 2.
      </div>
    </div>
  );
}
