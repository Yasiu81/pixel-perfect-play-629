import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_coordinator/seniorzy")({
  component: SeniorzyPage,
});

function SeniorzyPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Seniorzy</h1>
        <p className="text-sm text-muted-foreground">Lista podopiecznych i ich kartoteki.</p>
      </div>
      <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
        Tabela seniorów oraz formularz dodawania pojawią się w KROKU 2.
      </div>
    </div>
  );
}
