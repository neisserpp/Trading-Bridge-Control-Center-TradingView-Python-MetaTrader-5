import type { RiskSettings, Snapshot } from "./types";

const BASE = (import.meta.env.VITE_BRIDGE_URL || "").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  let data: unknown = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || `HTTP ${response.status}` }; }
  if (!response.ok) {
    const message = typeof data === "object" && data && "error" in data ? String((data as { error: unknown }).error) : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export type ApiResult = { ok: boolean; message?: string; error?: string; [key: string]: unknown };

export const bridgeApi = {
  baseUrl: BASE,
  authStatus: () => request<{ ok: boolean; authenticated: boolean; configured: boolean; error?: string }>("/api/dashboard/auth"),
  login: (password: string) => request<ApiResult>("/api/dashboard/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<ApiResult>("/api/dashboard/logout", { method: "POST" }),
  summary: () => request<Snapshot>("/api/dashboard/summary"),
  logs: (limit = 200) => request<{ ok: boolean; lines: string[] }>(`/api/dashboard/logs?limit=${limit}`),
  settings: () => request<{ ok: boolean; settings: RiskSettings }>("/api/dashboard/settings"),
  saveSettings: (settings: RiskSettings) => request<{ ok: boolean; settings: RiskSettings }>("/api/dashboard/settings", { method: "POST", body: JSON.stringify(settings) }),
  signal: (action: "BUY" | "SELL" | "CLOSE_SYMBOL", payload: Partial<{ symbol: string; volume: number; sl: number; tp: number; percent: number }> = {}) =>
    request<ApiResult>("/api/dashboard/signal", { method: "POST", body: JSON.stringify({ action, ...payload }) }),
  closePosition: (ticket: number) => request<ApiResult>("/api/dashboard/close-position", { method: "POST", body: JSON.stringify({ ticket }) }),
  emergencyClose: () => request<ApiResult>("/api/dashboard/emergency-close", { method: "POST", body: JSON.stringify({ confirmation: "CLOSE ALL" }) }),
};
