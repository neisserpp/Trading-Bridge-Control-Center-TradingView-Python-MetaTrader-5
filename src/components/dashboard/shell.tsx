import { useEffect, useState } from "react";
import { LogOut, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDate, number } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBridge } from "@/lib/store";
import { AlertsBanner } from "./alerts-banner";
import { LogsPanel, SignalsList } from "./activity";
import { EquityChart, StatsPanel } from "./charts-stats";
import { PositionsPanel } from "./positions-panel";
import { RiskPanel } from "./risk-panel";
import { SettingsForm, SignalTester } from "./settings-tester";
import { MetricGrid, StatusStrip } from "./status-metrics";

export function DashboardShell() {
  const tick = useBridge((s) => s.tick);
  const logout = useBridge((s) => s.logout);
  const snap = useBridge((s) => s.snapshot);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => {
      tick();
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(id);
  }, [tick]);

  const goldUp = snap.gold.change >= 0;

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/92 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex size-9 items-center justify-center rounded-sm bg-surface-2 font-mono text-xs tracking-tight text-accent shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
              TB
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-[0.16em] text-muted uppercase">
                TradingView → MT5 / Exness
              </p>
              <h1 className="font-display text-lg tracking-tight sm:text-xl">
                Trading Bridge <span className="font-normal text-muted">Control Center</span>
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="rounded-sm bg-surface px-3 py-1.5 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
              <p className="text-[10px] tracking-wide text-muted uppercase">XAUUSD</p>
              <p className="font-mono text-sm tabular">
                {number(snap.gold.bid, 2)}
                <span className={cn("ml-2 text-xs", goldUp ? "text-profit" : "text-loss")}>
                  {goldUp ? "+" : ""}
                  {number(snap.gold.change, 2)}
                </span>
              </p>
            </div>
            <p className="text-xs text-muted">
              {now.toLocaleTimeString("es-ES", { hour12: false })} UTC · actualizado{" "}
              {formatDate(snap.generated_at)}
            </p>
            <Button
              type="button"
              variant="quiet"
              size="sm"
              onClick={() => {
                tick();
                toast.success("Resumen actualizado.");
              }}
            >
              <RefreshCw className="size-3.5" />
              Actualizar
            </Button>
            <Button type="button" variant="quiet" size="sm" onClick={logout}>
              <LogOut className="size-3.5" />
              Salir
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-4 py-4 sm:px-6 sm:py-6">
        <p className="text-xs text-subtle">
          Datos en tiempo real del bridge Python conectado a tu terminal MetaTrader 5. Las
          acciones manuales se ejecutan sobre la cuenta actualmente conectada.
        </p>
        <AlertsBanner />
        <StatusStrip />
        <MetricGrid />

        <section className="grid gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
          <PositionsPanel />
          <RiskPanel />
        </section>

        <section className="grid gap-3 lg:grid-cols-2">
          <EquityChart />
          <StatsPanel />
        </section>

        <section className="grid gap-3 lg:grid-cols-3">
          <SignalsList />
          <SettingsForm />
          <SignalTester />
        </section>

        <LogsPanel />
      </main>
    </div>
  );
}
