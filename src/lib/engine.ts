import type { AlertItem, EquityPoint, LogLine, RiskSettings, Snapshot } from "./types";

export interface EngineState {
  settings: RiskSettings;
  logs: LogLine[];
  alerts: AlertItem[];
  equityHistory: EquityPoint[];
}

export function engineFromSnapshot(snapshot: Snapshot, logs: string[] = [], settings?: RiskSettings): EngineState {
  const alerts: AlertItem[] = snapshot.signals
    .filter((s) => !s.ok && !s.duplicate)
    .slice(0, 8)
    .map((s, index) => ({
      id: `signal-${s.id || index}`,
      time: s.time,
      level: "error" as const,
      title: `Señal ${s.action} rechazada`,
      detail: `${s.symbol} · ${s.detail}`,
      dismissed: false,
    }));
  const logLines: LogLine[] = logs.map((message) => {
    const match = message.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})[,.]?\s+(INFO|WARNING|ERROR)\s+(.*)$/);
    if (match) return { time: new Date(match[1].replace(" ", "T") + "Z").toISOString(), level: match[2] as LogLine["level"], message: match[3] };
    return { time: new Date().toISOString(), level: "INFO", message };
  });
  return { settings: settings || { use_fixed_volume: true, default_volume: 0.01, max_volume: 0.1, risk_percent: 1, default_sl_points: 500, default_tp_points: 1000 }, logs: logLines, alerts, equityHistory: [] };
}
