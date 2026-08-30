import { create } from "zustand";
import { bridgeApi } from "./bridge-api";
import { engineFromSnapshot, type EngineState } from "./engine";
import type { AlertItem, LogLine, RiskSettings, Snapshot } from "./types";

const AUTH_KEY = "tb.auth";

const emptySnapshot: Snapshot = {
  generated_at: new Date(0).toISOString(),
  gold: { bid: 0, ask: 0, spread: 0, change: 0 },
  bridge: { online: false, started_at: new Date(0).toISOString(), uptime_seconds: 0 },
  mt5: { connected: false, trade_allowed: false, safety_allowed: false, safety_reason: "Sin conexión", company: "" },
  account: { login: 0, server: "", currency: "USD", balance: 0, equity: 0, profit: 0, margin: 0, free_margin: 0, margin_level: null, mode: "DEMO-ONLY" },
  risk: { equity_peak: 0, drawdown: 0, drawdown_percent: 0 },
  positions: [], position_totals: { count: 0, floating_pnl: 0, net_lots: 0, exposure: 0 },
  tradingview: { last_signal_at: null, last_result: null, receiving: false },
  statistics: { period: "today_utc", closed_trades: 0, wins: 0, losses: 0, realized_pnl: 0, win_rate: 0, profit_factor: 0, expectancy: 0, avg_win: 0, avg_loss: 0 },
  signals: [],
};

interface Store {
  ready: boolean;
  authenticated: boolean;
  engine: EngineState;
  snapshot: Snapshot;
  loginError: string;
  login: (password: string) => Promise<boolean>;
  checkSession: () => Promise<void>;
  logout: () => Promise<void>;
  tick: () => Promise<void>;
  closeAll: (confirmation: string) => Promise<{ ok: boolean; message: string }>;
  closePosition: (ticket: number) => Promise<{ ok: boolean; message: string }>;
  saveSettings: (settings: RiskSettings) => Promise<{ ok: boolean; message: string }>;
  sendSignal: (action: "BUY" | "SELL" | "CLOSE_SYMBOL" | "CLOSE_ALL") => Promise<{ ok: boolean; message: string }>;
  dismissAlert: (id: string) => void;
  dismissAllAlerts: () => void;
  estimatedVolume: () => number;
  logs: () => LogLine[];
  alerts: () => AlertItem[];
  settings: () => RiskSettings;
  equityHistory: () => { t: number; equity: number }[];
}

function makeState(snapshot: Snapshot, previous: EngineState, logs: string[] = [], settings?: RiskSettings): EngineState {
  const next = engineFromSnapshot(snapshot, logs, settings || previous.settings);
  const history = [...previous.equityHistory];
  const now = Date.now();
  if (!history.length || now - history[history.length - 1].t >= 3000) history.push({ t: now, equity: snapshot.account.equity });
  return { ...next, equityHistory: history.slice(-180) };
}

export const useBridge = create<Store>((set, get) => ({
  ready: false,
  authenticated: false,
  engine: engineFromSnapshot(emptySnapshot),
  snapshot: emptySnapshot,
  loginError: "",

  login: async (password) => {
    try {
      await bridgeApi.login(password);
      sessionStorage.setItem(AUTH_KEY, "1");
      const summary = await bridgeApi.summary();
      const logData = await bridgeApi.logs();
      const settings = await bridgeApi.settings();
      const previous = get().engine;
      set({ authenticated: true, ready: true, loginError: "", snapshot: summary, engine: makeState(summary, previous, logData.lines, settings.settings) });
      return true;
    } catch (error) {
      set({ loginError: error instanceof Error ? error.message : "No se pudo iniciar sesión." });
      return false;
    }
  },

  checkSession: async () => {
    try {
      const auth = await bridgeApi.authStatus();
      if (!auth.authenticated) {
        set({ ready: true, authenticated: false });
        return;
      }
      const summary = await bridgeApi.summary();
      const logData = await bridgeApi.logs();
      const settings = await bridgeApi.settings();
      set({ ready: true, authenticated: true, snapshot: summary, engine: makeState(summary, get().engine, logData.lines, settings.settings) });
    } catch {
      set({ ready: true, authenticated: false });
    }
  },

  logout: async () => {
    try { await bridgeApi.logout(); } catch { /* ignore */ }
    try { sessionStorage.removeItem(AUTH_KEY); } catch { /* ignore */ }
    set({ authenticated: false, loginError: "" });
  },

  tick: async () => {
    if (!get().authenticated) return;
    try {
      const [summary, logData, settings] = await Promise.all([bridgeApi.summary(), bridgeApi.logs(), bridgeApi.settings()]);
      set({ snapshot: summary, engine: makeState(summary, get().engine, logData.lines, settings.settings) });
    } catch (error) {
      const snapshot = { ...get().snapshot, bridge: { ...get().snapshot.bridge, online: false } };
      set({ snapshot, engine: get().engine });
      if (error instanceof Error) set({ loginError: error.message });
    }
  },

  closeAll: async (confirmation) => {
    if (confirmation.trim().toUpperCase() !== "CLOSE ALL") return { ok: false, message: 'Escribe "CLOSE ALL" para confirmar.' };
    try {
      const result = await bridgeApi.emergencyClose();
      await get().tick();
      return { ok: true, message: String(result.message || "Cierre ejecutado.") };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "No se pudo cerrar." }; }
  },

  closePosition: async (ticket) => {
    try {
      const result = await bridgeApi.closePosition(ticket);
      await get().tick();
      return { ok: true, message: String(result.comment || `Posición #${ticket} cerrada.`) };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "No se pudo cerrar." }; }
  },

  saveSettings: async (settings) => {
    try {
      const result = await bridgeApi.saveSettings(settings);
      set({ engine: { ...get().engine, settings: result.settings } });
      await get().tick();
      return { ok: true, message: "Ajustes de riesgo guardados en config.json." };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "No se pudo guardar." }; }
  },

  sendSignal: async (action) => {
    try {
      if (action === "CLOSE_ALL") return get().closeAll("CLOSE ALL");
      const result = await bridgeApi.signal(action);
      await get().tick();
      return { ok: Boolean(result.ok), message: String(result.comment || result.message || result.error || `${action} procesado.`) };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "No se pudo enviar la señal." }; }
  },

  dismissAlert: (id) => set({ engine: { ...get().engine, alerts: get().engine.alerts.map((a) => a.id === id ? { ...a, dismissed: true } : a) } }),
  dismissAllAlerts: () => set({ engine: { ...get().engine, alerts: get().engine.alerts.map((a) => ({ ...a, dismissed: true })) } }),
  estimatedVolume: () => get().engine.settings.default_volume,
  logs: () => get().engine.logs,
  alerts: () => get().engine.alerts,
  settings: () => get().engine.settings,
  equityHistory: () => get().engine.equityHistory,
}));
