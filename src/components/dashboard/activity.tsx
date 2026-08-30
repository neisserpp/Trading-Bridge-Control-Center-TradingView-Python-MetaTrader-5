import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBridge } from "@/lib/store";
import type { LogLevel } from "@/lib/types";

export function SignalsList() {
  const signals = useBridge((s) => s.snapshot.signals);

  return (
    <article className="panel flex min-h-72 flex-col rounded-lg p-4 sm:p-5">
      <p className="text-[11px] font-medium tracking-[0.14em] text-muted uppercase">
        Actividad entrante
      </p>
      <h2 className="mb-4 font-display text-base tracking-tight">Señales recientes</h2>
      {signals.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          Las señales de TradingView aparecerán aquí.
        </p>
      ) : (
        <ol className="min-h-0 flex-1 space-y-0 overflow-auto">
          {signals.map((signal, i) => (
            <li
              key={`${signal.id}-${signal.time}-${i}`}
              className="grid grid-cols-[10px_minmax(0,1fr)_auto] gap-2.5 border-b border-border py-2.5 last:border-b-0"
            >
              <span
                className={cn(
                  "mt-1.5 size-2 rounded-full",
                  signal.ok ? "bg-profit" : "bg-loss",
                )}
              />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {signal.action}
                  <span className="font-normal text-muted">{signal.symbol}</span>
                  {signal.duplicate ? (
                    <span className="rounded-full bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">
                      Duplicada
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted">{signal.detail}</p>
              </div>
              <time className="shrink-0 text-[11px] text-muted" dateTime={signal.time}>
                {formatDate(signal.time)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

const LEVELS: Array<LogLevel | "ALL"> = ["ALL", "INFO", "WARNING", "ERROR"];

export function LogsPanel() {
  const generatedAt = useBridge((s) => s.snapshot.generated_at);
  const logs = useBridge((s) => s.engine.logs);
  const [level, setLevel] = useState<LogLevel | "ALL">("ALL");
  const filtered = useMemo(() => {
    const newestFirst = [...logs].reverse();
    return level === "ALL" ? newestFirst : newestFirst.filter((l) => l.level === level);
  }, [logs, level, generatedAt]);

  return (
    <article className="panel rounded-lg p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-[0.14em] text-muted uppercase">
            Diagnóstico
          </p>
          <h2 className="font-display text-base tracking-tight">Logs del bridge</h2>
        </div>
        <div className="flex rounded-sm bg-surface-2 p-0.5 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
          {LEVELS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setLevel(item)}
              className={cn(
                "h-8 rounded-xs px-2.5 text-[11px] font-medium transition-colors duration-150",
                level === item ? "bg-bg text-fg" : "text-muted hover:text-fg",
              )}
            >
              {item === "ALL" ? "Todos" : item}
            </button>
          ))}
        </div>
      </div>
      <pre className="max-h-72 overflow-auto rounded-md bg-bg p-3 font-mono text-[11px] leading-relaxed text-info shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
        {filtered.length === 0
          ? "Sin líneas para este filtro."
          : filtered
              .map((line) => {
                const stamp = new Date(line.time).toISOString().replace("T", " ").slice(0, 19);
                return `${stamp} ${line.level.padEnd(7)} ${line.message}`;
              })
              .join("\n")}
      </pre>
    </article>
  );
}
