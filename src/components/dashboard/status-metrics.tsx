import { Activity, Radio, Shield, Wifi } from "lucide-react";
import { formatDuration, money, number, signedMoney, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBridge } from "@/lib/store";

function StatusCard({
  label,
  value,
  ok,
  icon: Icon,
}: {
  label: string;
  value: string;
  ok: boolean;
  icon: typeof Wifi;
}) {
  return (
    <article className="panel flex min-w-0 items-center gap-3 rounded-md px-3.5 py-3">
      <span
        className={cn(
          "relative flex size-8 shrink-0 items-center justify-center rounded-sm",
          ok ? "bg-profit/12 text-profit" : "bg-loss/12 text-loss",
        )}
      >
        <Icon className="size-4" />
        <span
          className={cn(
            "pulse-dot absolute -top-0.5 -right-0.5 size-2 rounded-full",
            ok ? "bg-profit text-profit" : "bg-loss text-loss",
          )}
        />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] tracking-wide text-muted uppercase">{label}</p>
        <p className="truncate text-sm font-medium text-fg">{value}</p>
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "profit" | "loss" | "neutral";
}) {
  return (
    <article className="panel rounded-lg p-4">
      <p className="text-[11px] tracking-wide text-muted uppercase">{label}</p>
      <p
        className={cn(
          "mt-2 font-mono text-2xl tracking-tight tabular",
          tone === "profit" && "text-profit",
          tone === "loss" && "text-loss",
          !tone && "text-fg",
        )}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-xs text-muted">{hint}</p>
    </article>
  );
}

export function StatusStrip() {
  const snap = useBridge((s) => s.snapshot);
  const tvOk = Boolean(snap.tradingview.last_signal_at);
  return (
    <section className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Estado del sistema">
      <StatusCard
        label="Bridge"
        value={snap.bridge.online ? `Online · ${formatDuration(snap.bridge.uptime_seconds)}` : "Sin respuesta"}
        ok={snap.bridge.online}
        icon={Wifi}
      />
      <StatusCard
        label="MT5"
        value={
          snap.mt5.connected
            ? `${snap.mt5.company} · ${snap.mt5.trade_allowed ? "Trading ON" : "Bloqueado"}`
            : "Desconectado"
        }
        ok={snap.mt5.connected && snap.mt5.trade_allowed}
        icon={Activity}
      />
      <StatusCard
        label="TradingView"
        value={tvOk ? timeAgo(snap.tradingview.last_signal_at) : "Esperando señal"}
        ok={tvOk}
        icon={Radio}
      />
      <StatusCard
        label="Protección"
        value={snap.mt5.safety_allowed ? `${snap.account.mode}` : snap.mt5.safety_reason}
        ok={snap.mt5.safety_allowed && snap.account.mode !== "LIVE"}
        icon={Shield}
      />
    </section>
  );
}

export function MetricGrid() {
  const snap = useBridge((s) => s.snapshot);
  const ccy = snap.account.currency;
  const floating = snap.position_totals.floating_pnl;
  const dd = snap.risk.drawdown;
  return (
    <section className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Resumen de cuenta">
      <Metric
        label="Balance"
        value={money(snap.account.balance, ccy)}
        hint={`${snap.account.server} · #${snap.account.login}`}
      />
      <Metric
        label="Equity"
        value={money(snap.account.equity, ccy)}
        hint={`Flotante ${signedMoney(floating, ccy)}`}
        tone={floating >= 0 ? "profit" : "loss"}
      />
      <Metric
        label="Drawdown de sesión"
        value={`${money(dd, ccy)} · ${number(snap.risk.drawdown_percent, 2)}%`}
        hint={`Pico ${money(snap.risk.equity_peak, ccy)}`}
        tone={dd > 0 ? "loss" : "profit"}
      />
      <Metric
        label="Margen libre"
        value={money(snap.account.free_margin, ccy)}
        hint={
          snap.account.margin_level
            ? `Usado ${money(snap.account.margin, ccy)} · nivel ${number(snap.account.margin_level, 1)}%`
            : `Usado ${money(snap.account.margin, ccy)}`
        }
      />
    </section>
  );
}
