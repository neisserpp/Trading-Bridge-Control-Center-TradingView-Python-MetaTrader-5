export type Side = "BUY" | "SELL";
export type SignalAction =
  | "BUY"
  | "SELL"
  | "CLOSE_ALL"
  | "CLOSE_SYMBOL"
  | "SETTINGS_UPDATED"
  | "EMERGENCY_CLOSE_ALL"
  | "CLOSE_POSITION";

export type LogLevel = "INFO" | "WARNING" | "ERROR";

export interface Position {
  ticket: number;
  symbol: string;
  side: Side;
  volume: number;
  price_open: number;
  price_current: number;
  sl: number;
  tp: number;
  profit: number;
  swap: number;
  opened_at: string;
}

export interface SignalEvent {
  time: string;
  id: string;
  action: string;
  symbol: string;
  ok: boolean;
  duplicate: boolean;
  detail: string;
}

export interface LogLine {
  time: string;
  level: LogLevel;
  message: string;
}

export interface AlertItem {
  id: string;
  time: string;
  level: "error" | "warning";
  title: string;
  detail: string;
  dismissed: boolean;
}

export interface RiskSettings {
  use_fixed_volume: boolean;
  default_volume: number;
  max_volume: number;
  risk_percent: number;
  default_sl_points: number;
  default_tp_points: number;
}

export interface EquityPoint {
  t: number;
  equity: number;
}

export interface ClosedTrade {
  ticket: number;
  symbol: string;
  side: Side;
  volume: number;
  pnl: number;
  closed_at: string;
  reason: string;
}

export interface Snapshot {
  generated_at: string;
  gold: {
    bid: number;
    ask: number;
    spread: number;
    change: number;
  };
  bridge: {
    online: boolean;
    started_at: string;
    uptime_seconds: number;
  };
  mt5: {
    connected: boolean;
    trade_allowed: boolean;
    safety_allowed: boolean;
    safety_reason: string;
    company: string;
  };
  account: {
    login: number;
    server: string;
    currency: string;
    balance: number;
    equity: number;
    profit: number;
    margin: number;
    free_margin: number;
    margin_level: number | null;
    mode: "DEMO-ONLY" | "LIVE";
  };
  risk: {
    equity_peak: number;
    drawdown: number;
    drawdown_percent: number;
  };
  positions: Position[];
  position_totals: {
    count: number;
    floating_pnl: number;
    net_lots: number;
    exposure: number;
  };
  tradingview: {
    last_signal_at: string | null;
    last_result: string | null;
    receiving: boolean;
  };
  statistics: {
    period: string;
    closed_trades: number;
    wins: number;
    losses: number;
    realized_pnl: number;
    win_rate: number;
    profit_factor: number;
    expectancy: number;
    avg_win: number;
    avg_loss: number;
  };
  signals: SignalEvent[];
}

export const POINT = 0.01;
export const CONTRACT = 100;
