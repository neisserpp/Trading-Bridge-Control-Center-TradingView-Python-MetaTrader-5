"use strict";

const state = {
  authenticated: false,
  settingsLoaded: false,
  refreshTimer: null,
  logTimer: null,
};

const $ = (selector) => document.querySelector(selector);
const dashboard = $("#dashboard");
const overlay = $("#login-overlay");
const loginError = $("#login-error");
const toast = $("#toast");
const emergencyDialog = $("#emergency-dialog");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value, currency = "USD") {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function number(value, digits = 2) {
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "Aún no recibida";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function timeAgo(value) {
  if (!value) return "Esperando señal";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `Hace ${seconds}s`;
  if (seconds < 3600) return `Hace ${Math.floor(seconds / 60)} min`;
  return `Hace ${Math.floor(seconds / 3600)} h`;
}

function notify(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  window.clearTimeout(notify.timeout);
  notify.timeout = window.setTimeout(() => toast.classList.remove("visible"), 4200);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : {};
  if (!response.ok || body.ok === false) {
    const error = new Error(body.error || `La petición ha fallado (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function setStatus(id, ok, title) {
  const item = $(id);
  item.classList.toggle("good", Boolean(ok));
  item.classList.toggle("bad", !ok);
  item.querySelector("strong").textContent = title;
}

function setText(id, text, className = "") {
  const element = $(id);
  element.textContent = text;
  element.classList.remove("positive", "negative", "good", "bad");
  if (className) element.classList.add(className);
}

function renderPositions(positions, currency) {
  $("#positions-count").textContent = positions.length;
  const body = $("#positions-body");
  if (!positions.length) {
    body.innerHTML = '<tr><td class="empty-table" colspan="6">No hay posiciones abiertas.</td></tr>';
    return;
  }

  body.innerHTML = positions.map((position) => {
    const sideClass = position.side === "BUY" ? "buy" : "sell";
    const profitClass = Number(position.profit) >= 0 ? "positive" : "negative";
    return `<tr>
      <td><strong>${escapeHtml(position.symbol)}</strong><span class="subvalue">#${escapeHtml(position.ticket)}</span></td>
      <td><span class="side ${sideClass}">${escapeHtml(position.side)}</span></td>
      <td>${number(position.volume, 2)}</td>
      <td>${number(position.price_open, 3)}<span class="subvalue">${number(position.price_current, 3)}</span></td>
      <td>${number(position.sl, 3)}<span class="subvalue">${number(position.tp, 3)}</span></td>
      <td class="numeric ${profitClass}">${money(position.profit, currency)}<span class="subvalue">Swap ${number(position.swap, 2)}</span></td>
    </tr>`;
  }).join("");
}

function renderSignals(signals) {
  const list = $("#signals-list");
  if (!signals.length) {
    list.innerHTML = '<li class="empty-state">Las señales que recibamos de TradingView aparecerán aquí.</li>';
    return;
  }
  list.innerHTML = signals.slice(0, 12).map((signal) => `
    <li>
      <span class="timeline-dot ${signal.ok ? "" : "bad"}" aria-hidden="true"></span>
      <div>
        <div class="signal-main">${escapeHtml(signal.action)} <span>${escapeHtml(signal.symbol)}</span>${signal.duplicate ? "<span>Duplicada</span>" : ""}</div>
        <p class="signal-detail">${escapeHtml(signal.detail)}</p>
      </div>
      <time datetime="${escapeHtml(signal.time)}">${escapeHtml(formatDate(signal.time))}</time>
    </li>`).join("");
}

function populateSettings(settings) {
  $("#fixed-volume").checked = Boolean(settings.use_fixed_volume);
  $("#default-volume").value = settings.default_volume;
  $("#max-volume").value = settings.max_volume;
  $("#risk-percent").value = settings.risk_percent;
  $("#default-sl-points").value = settings.default_sl_points;
  $("#default-tp-points").value = settings.default_tp_points;
}

function renderSummary(data) {
  const account = data.account || {};
  const mt5 = data.mt5 || {};
  const currency = account.currency || "USD";
  const floating = Number(data.position_totals?.floating_pnl || 0);
  const dd = Number(data.risk?.drawdown || 0);
  const stats = data.statistics || {};

  setStatus("#bridge-status", data.bridge?.online, data.bridge?.online ? "Online" : "Sin respuesta");
  setStatus("#mt5-status", data.ok && mt5.connected, data.ok && mt5.connected ? "Conectado" : (mt5.error || "Desconectado"));
  setStatus("#account-status", Boolean(mt5.safety_allowed), account.mode || "No disponible");
  setStatus("#tv-status", Boolean(data.tradingview?.last_signal_at), timeAgo(data.tradingview?.last_signal_at));

  setText("#balance-value", money(account.balance, currency));
  setText("#account-server", account.server ? `${account.server} · #${account.login}` : "Sin cuenta conectada");
  setText("#equity-value", money(account.equity, currency));
  setText("#floating-pnl", `P&L flotante: ${money(floating, currency)}`, floating >= 0 ? "positive" : "negative");
  setText("#drawdown-value", `${money(dd, currency)} · ${number(data.risk?.drawdown_percent, 2)}%`, dd > 0 ? "negative" : "positive");
  setText("#peak-equity", `Pico de equity: ${money(data.risk?.equity_peak, currency)}`);
  setText("#free-margin-value", money(account.free_margin, currency));
  setText("#margin-value", `Margen usado: ${money(account.margin, currency)}`);

  setText("#account-mode", account.mode || "—", account.mode === "LIVE" ? "bad" : "good");
  setText("#trade-permission", mt5.trade_allowed ? "Permitido en MT5" : "Bloqueado en MT5", mt5.trade_allowed ? "good" : "bad");
  setText("#demo-safety", mt5.safety_allowed ? "Activa" : (mt5.safety_reason || "Bloqueada"), mt5.safety_allowed ? "good" : "bad");
  setText("#last-signal", data.tradingview?.last_signal_at ? `${timeAgo(data.tradingview.last_signal_at)} · ${data.tradingview.last_result || "Recibida"}` : "Aún no hay señales");

  renderPositions(data.positions || [], currency);
  renderSignals(data.signals || []);
  setText("#closed-trades", String(stats.closed_trades || 0));
  setText("#win-rate", `${number(stats.win_rate, 1)}%`);
  setText("#realized-pnl", money(stats.realized_pnl, currency), Number(stats.realized_pnl || 0) >= 0 ? "positive" : "negative");
  setText("#profit-factor", number(stats.profit_factor, 2));
  $("#last-updated").textContent = `Actualizado ${formatDate(data.generated_at)}`;
}

async function refreshSummary(showError = true) {
  if (!state.authenticated) return;
  try {
    const data = await api("/api/dashboard/summary");
    renderSummary(data);
  } catch (error) {
    if (error.status === 401) return showLogin();
    $("#last-updated").textContent = "No se pudo actualizar";
    if (showError) notify(error.message, true);
  }
}

async function refreshLogs(showError = false) {
  if (!state.authenticated) return;
  try {
    const data = await api("/api/dashboard/logs?limit=180");
    $("#logs-output").textContent = data.lines.join("\n") || "El archivo de log todavía no contiene líneas.";
  } catch (error) {
    if (showError) notify(error.message, true);
  }
}

function startPolling() {
  window.clearInterval(state.refreshTimer);
  window.clearInterval(state.logTimer);
  refreshSummary(false);
  refreshLogs(false);
  state.refreshTimer = window.setInterval(() => refreshSummary(false), 5000);
  state.logTimer = window.setInterval(() => refreshLogs(false), 15000);
}

function showLogin(message = "") {
  state.authenticated = false;
  dashboard.hidden = true;
  overlay.hidden = false;
  loginError.textContent = message;
  $("#dashboard-password").focus();
  window.clearInterval(state.refreshTimer);
  window.clearInterval(state.logTimer);
}

async function checkAuth() {
  try {
    const auth = await api("/api/dashboard/auth");
    if (!auth.configured) {
      $("#login-description").textContent = "Para activar este panel, añade dashboard_password a config.json y reinicia el bridge.";
      $("#login-form button").disabled = true;
      loginError.textContent = "La autenticación del dashboard aún no está configurada.";
      overlay.hidden = false;
      return;
    }
    if (auth.authenticated) {
      state.authenticated = true;
      overlay.hidden = true;
      dashboard.hidden = false;
      startPolling();
    } else {
      showLogin();
    }
  } catch (error) {
    showLogin("No se puede contactar con el bridge local.");
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    await api("/api/dashboard/login", {
      method: "POST",
      body: JSON.stringify({ password: $("#dashboard-password").value }),
    });
    $("#dashboard-password").value = "";
    state.authenticated = true;
    overlay.hidden = true;
    dashboard.hidden = false;
    startPolling();
  } catch (error) {
    loginError.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#logout-button").addEventListener("click", async () => {
  try { await api("/api/dashboard/logout", { method: "POST", body: "{}" }); } catch (_) { /* Session is still cleared locally. */ }
  showLogin();
});

$("#refresh-button").addEventListener("click", () => refreshSummary(true));
$("#logs-button").addEventListener("click", () => refreshLogs(true));

$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const payload = {
    use_fixed_volume: $("#fixed-volume").checked,
    default_volume: $("#default-volume").value,
    max_volume: $("#max-volume").value,
    risk_percent: $("#risk-percent").value,
    default_sl_points: $("#default-sl-points").value,
    default_tp_points: $("#default-tp-points").value,
  };
  button.disabled = true;
  try {
    const data = await api("/api/dashboard/settings", { method: "POST", body: JSON.stringify(payload) });
    populateSettings(data.settings);
    notify("Ajustes de riesgo guardados.");
    refreshSummary(false);
  } catch (error) {
    notify(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("#emergency-button").addEventListener("click", () => {
  $("#close-confirmation").value = "";
  $("#emergency-error").textContent = "";
  $("#confirm-emergency").disabled = true;
  emergencyDialog.showModal();
  $("#close-confirmation").focus();
});

$("#cancel-emergency").addEventListener("click", () => emergencyDialog.close());
$("#close-confirmation").addEventListener("input", (event) => {
  $("#confirm-emergency").disabled = event.target.value.trim().toUpperCase() !== "CLOSE ALL";
});

$("#emergency-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#confirm-emergency");
  button.disabled = true;
  $("#emergency-error").textContent = "";
  try {
    const data = await api("/api/dashboard/emergency-close", {
      method: "POST",
      body: JSON.stringify({ confirmation: $("#close-confirmation").value }),
    });
    emergencyDialog.close();
    notify(data.message || "Orden de cierre enviada.");
    refreshSummary(false);
    refreshLogs(false);
  } catch (error) {
    $("#emergency-error").textContent = error.message;
  } finally {
    button.disabled = $("#close-confirmation").value.trim().toUpperCase() !== "CLOSE ALL";
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshSummary(false);
});

checkAuth();
