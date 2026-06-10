import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_coordinator/raporty")({
  component: RaportyPage,
});

function RaportyPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Raporty</h1>
        <p className="text-sm text-muted-foreground">Rozliczenia miesięczne dla MOPS.</p>
      </div>
      <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
        Raport miesięczny i eksport PDF pojawią się w kolejnym etapie.
      </div>
    </div>
  );
}
