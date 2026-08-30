import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money, number, signedMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBridge } from "@/lib/store";

export function EquityChart() {
  const generatedAt = useBridge((s) => s.snapshot.generated_at);
  const history = useBridge((s) => s.engine.equityHistory);
  const snap = useBridge((s) => s.snapshot);
  const data = history.map((p) => ({
    t: new Date(p.t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
    equity: p.equity,
  }));
  void generatedAt;
  const last = history[history.length - 1]?.equity ?? snap.account.equity;
  const first = history[0]?.equity ?? last;
  const up = last >= first;

  return (
    <article className="panel rounded-lg p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-[0.14em] text-muted uppercase">Curva</p>
          <h2 className="font-display text-base tracking-tight">Equity de sesión</h2>
        </div>
        <p className={cn("font-mono text-sm tabular", up ? "text-profit" : "text-loss")}>
          {signedMoney(last - first, snap.account.currency)}
        </p>
      </div>
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="t" hide />
            <YAxis hide domain={["dataMin - 8", "dataMax + 8"]} />
            <Tooltip
              contentStyle={{
                background: "var(--color-surface-2)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--color-fg)",
              }}
              formatter={(value) => [
                money(Number(value), snap.account.currency),
                "Equity",
              ]}
            />
            <Area
              type="monotone"
              dataKey="equity"
              stroke="var(--color-accent)"
              strokeWidth={1.5}
              fill="url(#eqFill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

export function StatsPanel() {
  const snap = useBridge((s) => s.snapshot);
  const s = snap.statistics;
  const ccy = snap.account.currency;
  const items = [
    { label: "Cerradas hoy", value: String(s.closed_trades) },
    { label: "Acierto", value: `${number(s.win_rate, 1)}%` },
    { label: "P&L realizado", value: signedMoney(s.realized_pnl, ccy), tone: s.realized_pnl >= 0 },
    { label: "Profit factor", value: number(s.profit_factor, 2) },
    { label: "Expectativa", value: signedMoney(s.expectancy, ccy), tone: s.expectancy >= 0 },
    { label: "Ganancia / pérdida media", value: `${money(s.avg_win, ccy)} / ${money(s.avg_loss, ccy)}` },
  ];

  return (
    <article className="panel rounded-lg p-4 sm:p-5">
      <p className="text-[11px] font-medium tracking-[0.14em] text-muted uppercase">
        Desde las 00:00 UTC
      </p>
      <h2 className="mb-4 font-display text-base tracking-tight">Estadísticas</h2>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-md bg-bg px-3 py-3 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
            <p className="text-[11px] text-muted">{item.label}</p>
            <p
              className={cn(
                "mt-1 font-mono text-sm tabular",
                item.tone === true && "text-profit",
                item.tone === false && "text-loss",
              )}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        {s.wins} ganadoras · {s.losses} perdedoras
      </p>
    </article>
  );
}
