#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
TradingView -> MetaTrader 5 bridge

- Receives TradingView webhook JSON
- Resolves Exness symbol names such as XAUUSD / XAUUSDm automatically
- Opens BUY/SELL market orders with SL/TP
- Supports CLOSE_SYMBOL and CLOSE_ALL
- Duplicate protection only after successful execution
- Demo-first safety controls
- Robust SL/TP validation for MT5 INVALID_STOPS (10016)
- Local authenticated dashboard
"""

import json
import hmac
import logging
import math
import os
import re
import secrets
import sys
import time

from collections import deque
from datetime import datetime, timezone
from functools import wraps
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

import MetaTrader5 as mt5
from flask import Flask, jsonify, render_template, request, session


# ============================================================
# CONFIGURATION
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
    CFG: Dict[str, Any] = json.load(fh)


# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(
            os.path.join(
                BASE_DIR,
                CFG.get("log_file", "bridge.log")
            ),
            encoding="utf-8",
        ),
    ],
)

log = logging.getLogger("tv2mt5")

app = Flask(__name__)

app.config.update(
    SECRET_KEY=str(
        CFG.get("dashboard_session_secret")
        or secrets.token_urlsafe(32)
    ),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)


# ============================================================
# CORS
# ============================================================

@app.after_request
def dashboard_cors(response):
    """Allow local React/Vite dashboard to call the bridge."""

    origin = request.headers.get("Origin", "")

    allowed_origins = {
        "http://localhost:8080",
        "http://127.0.0.1:8080", 
        "http://192.168.1.140:8080",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    }

    if origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = (
            "Content-Type, Authorization"
        )
        response.headers["Access-Control-Allow-Methods"] = (
            "GET, POST, OPTIONS"
        )
        response.headers["Vary"] = "Origin"

    return response




# ============================================================
# GLOBAL SETTINGS
# ============================================================

MAGIC = int(CFG.get("magic", 234000))
COMMENT = str(CFG.get("comment", "TV-XAUUSD"))
DEVIATION = int(CFG.get("deviation", 30))

PASSPHRASE = str(
    CFG.get("passphrase", "CHANGE_ME")
)

DASHBOARD_PASSWORD = str(
    CFG.get("dashboard_password", "")
).strip()

DASHBOARD_SESSIONS: Dict[str, float] = {}

DASHBOARD_SESSION_TTL = int(
    CFG.get(
        "dashboard_session_ttl_seconds",
        3600
    )
)

SEEN_IDS: Dict[str, float] = {}

DASHBOARD_STARTED_AT = time.time()

LAST_WEBHOOK_AT: Optional[float] = None
LAST_WEBHOOK_RESULT: Optional[str] = None

EQUITY_PEAK: Optional[float] = None

SIGNAL_HISTORY: deque = deque(maxlen=200)

DASHBOARD_LOCK = Lock()

PLACEHOLDER_DASHBOARD_PASSWORDS = {
    "",
    "CHANGE_ME",
    "CHANGE_ME_TO_A_LOCAL_DASHBOARD_PASSWORD",
}


# ============================================================
# DASHBOARD SUPPORT
# ============================================================

def utc_iso(timestamp: Optional[float] = None) -> str:
    """Format timestamp for dashboard."""

    value = time.time() if timestamp is None else timestamp

    return datetime.fromtimestamp(
        value,
        tz=timezone.utc
    ).isoformat().replace("+00:00", "Z")


def current_dashboard_password() -> str:
    """
    Read dashboard password from config.json.
    This allows password changes without restarting the bridge.
    """

    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
            file_config = json.load(fh)

        if "dashboard_password" in file_config:
            return str(
                file_config["dashboard_password"]
            ).strip()

    except (
        OSError,
        json.JSONDecodeError,
        TypeError
    ):
        pass

    return DASHBOARD_PASSWORD or PASSPHRASE


def dashboard_password_configured() -> bool:
    return (
        current_dashboard_password()
        not in PLACEHOLDER_DASHBOARD_PASSWORDS
    )


# ============================================================
# DASHBOARD AUTH
# ============================================================

def dashboard_required(view):
    """Protect dashboard API routes."""

    @wraps(view)
    def wrapped(*args, **kwargs):

        if request.method == "OPTIONS":
            return ("", 204)

        if not dashboard_password_configured():
            return jsonify({
                "ok": False,
                "error": (
                    "Dashboard authentication is not configured. "
                    "Set dashboard_password in config.json."
                ),
            }), 503

        if not session.get("dashboard_authenticated"):
            return jsonify({
                "ok": False,
                "error": "Dashboard authentication required",
            }), 401

        return view(*args, **kwargs)

    return wrapped


# ============================================================
# DASHBOARD TELEMETRY
# ============================================================

def record_signal_event(
    payload: Dict[str, Any],
    response: Dict[str, Any]
) -> None:

    global LAST_WEBHOOK_AT
    global LAST_WEBHOOK_RESULT

    action = str(
        payload.get("action")
        or payload.get("side")
        or payload.get("type")
        or "UNKNOWN"
    ).upper()

    event = {
        "time": utc_iso(),

        "id": str(
            payload.get("id")
            or payload.get("signal_id")
            or ""
        ),

        "action": action,

        "symbol": str(
            payload.get("symbol")
            or payload.get("ticker")
            or "XAUUSD"
        ).upper(),

        "ok": bool(response.get("ok")),

        "duplicate": bool(
            response.get("duplicate")
        ),

        "detail": str(
            response.get("error")
            or response.get("comment")
            or response.get("action")
            or "Accepted"
        )[:240],
    }

    with DASHBOARD_LOCK:
        LAST_WEBHOOK_AT = time.time()
        LAST_WEBHOOK_RESULT = event["detail"]
        SIGNAL_HISTORY.appendleft(event)


def record_dashboard_event(
    action: str,
    ok: bool,
    detail: str
) -> None:

    with DASHBOARD_LOCK:
        SIGNAL_HISTORY.appendleft({
            "time": utc_iso(),
            "id": "dashboard",
            "action": action,
            "symbol": "â€”",
            "ok": ok,
            "duplicate": False,
            "detail": detail[:240],
        })


# ============================================================
# LOG REDACTION
# ============================================================

def redacted_log_line(line: str) -> str:
    """Never expose authentication secrets in dashboard logs."""

    line = re.sub(
        r'(?i)(["\']?passphrase["\']?\s*[:=]\s*["\'])[^"\']*',
        r'\1[REDACTED]',
        line,
    )

    line = re.sub(
        r'(?i)(dashboard_password\s*[:=]\s*)\S+',
        r'\1[REDACTED]',
        line,
    )

    return line


def read_recent_logs(limit: int = 150) -> List[str]:

    log_path = os.path.join(
        BASE_DIR,
        str(
            CFG.get(
                "log_file",
                "bridge.log"
            )
        ),
    )

    try:
        with open(log_path, "rb") as fh:

            fh.seek(0, os.SEEK_END)

            size = fh.tell()

            fh.seek(
                max(
                    0,
                    size - 128 * 1024
                )
            )

            raw = fh.read().decode(
                "utf-8",
                errors="replace"
            )

    except OSError as exc:

        return [
            "Unable to read bridge log: "
            + str(exc)
        ]

    return [
        redacted_log_line(line)
        for line in raw.splitlines()[-limit:]
    ]


# ============================================================
# POSITION SERIALIZATION
# ============================================================

def position_to_dict(position: Any) -> Dict[str, Any]:

    side = (
        "BUY"
        if position.type == mt5.POSITION_TYPE_BUY
        else "SELL"
    )

    return {
        "ticket": int(position.ticket),
        "symbol": str(position.symbol),
        "side": side,
        "volume": float(position.volume),
        "price_open": float(position.price_open),
        "price_current": float(position.price_current),
        "sl": float(position.sl),
        "tp": float(position.tp),
        "profit": float(position.profit),
        "swap": float(
            getattr(
                position,
                "swap",
                0.0
            ) or 0.0
        ),
        "opened_at": utc_iso(
            float(position.time)
        ),
    }


# ============================================================
# TRADE STATISTICS
# ============================================================

def today_trade_statistics() -> Dict[str, Any]:

    now = datetime.now(timezone.utc)

    start = now.replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0
    )

    deals = mt5.history_deals_get(
        start,
        now
    ) or []

    exit_entries = {
        getattr(
            mt5,
            "DEAL_ENTRY_OUT",
            -1
        ),

        getattr(
            mt5,
            "DEAL_ENTRY_OUT_BY",
            -2
        ),
    }

    pnl_values: List[float] = []

    for deal in deals:

        if getattr(
            deal,
            "entry",
            None
        ) not in exit_entries:
            continue

        value = (
            float(
                getattr(
                    deal,
                    "profit",
                    0.0
                ) or 0.0
            )
            +
            float(
                getattr(
                    deal,
                    "commission",
                    0.0
                ) or 0.0
            )
            +
            float(
                getattr(
                    deal,
                    "swap",
                    0.0
                ) or 0.0
            )
            +
            float(
                getattr(
                    deal,
                    "fee",
                    0.0
                ) or 0.0
            )
        )

        pnl_values.append(value)

    wins = [
        value
        for value in pnl_values
        if value > 0
    ]

    losses = [
        value
        for value in pnl_values
        if value < 0
    ]

    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))

    avg_win = (
        gross_profit / len(wins)
        if wins else 0.0
    )

    avg_loss = (
        gross_loss / len(losses)
        if losses else 0.0
    )

    expectancy = (
        sum(pnl_values) / len(pnl_values)
        if pnl_values
        else 0.0
    )

    return {
        "period": "today_utc",
        "closed_trades": len(pnl_values),
        "wins": len(wins),
        "losses": len(losses),
        "realized_pnl": round(
            sum(pnl_values),
            2
        ),
        "win_rate": round(
            (
                len(wins)
                / len(pnl_values)
                * 100
            )
            if pnl_values
            else 0.0,
            1,
        ),
        "profit_factor": round(
            (
                gross_profit / gross_loss
                if gross_loss > 0
                else gross_profit
            ),
            2,
        ),
        "expectancy": round(
            expectancy,
            2
        ),
        "avg_win": round(
            avg_win,
            2
        ),
        "avg_loss": round(
            avg_loss,
            2
        ),
    }


# ============================================================
# MT5 INITIALIZATION
# ============================================================

def mt5_init_ok() -> bool:

    if not mt5.initialize():

        log.error(
            "MT5 initialize failed: %s",
            mt5.last_error()
        )

        return False

    return True


# ============================================================
# SYMBOL HANDLING
# ============================================================

def normalize_symbol(name: str) -> str:

    symbol = str(
        name or ""
    ).strip().upper()

    if ":" in symbol:
        symbol = symbol.split(":")[-1]

    return symbol


def resolve_symbol(
    name: str
) -> Optional[str]:

    requested = normalize_symbol(name)

    if not requested:
        return None

    aliases = CFG.get(
        "symbol_aliases",
        {}
    )

    requested = str(
        aliases.get(
            requested,
            requested
        )
    ).upper()

    allowed = [
        normalize_symbol(symbol)
        for symbol in CFG.get(
            "allowed_symbols",
            []
        )
    ]

    if allowed and requested not in allowed:

        log.warning(
            "Symbol blocked by config: %s",
            requested
        )

        return None

    # Exact match
    info = mt5.symbol_info(requested)

    if info is not None:
        return info.name

    # Prefix / broker suffix
    symbols = mt5.symbols_get() or []

    candidates = []

    for item in symbols:

        broker_symbol = item.name.upper()

        if broker_symbol == requested:

            candidates.append(
                item.name
            )

        elif broker_symbol.startswith(requested):

            candidates.append(
                item.name
            )

    if not candidates:

        log.warning(
            "Symbol not found in MT5: %s",
            requested
        )

        return None

    candidates.sort(
        key=len
    )

    chosen = candidates[0]

    log.info(
        "Symbol resolved: %s -> %s",
        requested,
        chosen
    )

    return chosen


def ensure_symbol_visible(
    symbol: str
) -> bool:

    info = mt5.symbol_info(symbol)

    if info is None:
        return False

    if not info.visible:

        if not mt5.symbol_select(
            symbol,
            True
        ):

            log.error(
                "Could not select symbol %s",
                symbol
            )

            return False

    return True


# ============================================================
# SYMBOL TRADE RULES
# ============================================================

def get_symbol_trade_rules(
    symbol: str
) -> Dict[str, Any]:

    info = mt5.symbol_info(symbol)

    if info is None:

        return {
            "ok": False,
            "error": (
                f"Symbol not found: {symbol}"
            ),
        }

    tick = mt5.symbol_info_tick(symbol)

    point = float(
        getattr(
            info,
            "point",
            0.0
        ) or 0.0
    )

    stops_level = int(
        getattr(
            info,
            "trade_stops_level",
            0
        ) or 0
    )

    freeze_level = int(
        getattr(
            info,
            "trade_freeze_level",
            0
        ) or 0
    )

    minimum_level = max(
        stops_level,
        freeze_level
    )

    return {
        "ok": True,
        "symbol": symbol,

        "bid": (
            float(tick.bid)
            if tick else None
        ),

        "ask": (
            float(tick.ask)
            if tick else None
        ),

        "point": point,

        "digits": int(
            getattr(
                info,
                "digits",
                2
            )
        ),

        "trade_stops_level": stops_level,

        "trade_freeze_level": freeze_level,

        "minimum_level": minimum_level,

        "minimum_distance": (
            minimum_level * point
        ),

        "volume_min": float(
            info.volume_min
        ),

        "volume_step": float(
            info.volume_step
        ),

        "volume_max": float(
            info.volume_max
        ),
    }


# ============================================================
# DUPLICATE PROTECTION
# ============================================================

def cleanup_seen() -> None:

    now = time.time()

    ttl = int(
        CFG.get(
            "duplicate_ttl_seconds",
            120
        )
    )

    for signal_id, timestamp in list(
        SEEN_IDS.items()
    ):

        if now - timestamp > ttl:
            SEEN_IDS.pop(
                signal_id,
                None
            )


def is_duplicate(
    signal_id: str
) -> bool:

    cleanup_seen()

    if not signal_id:
        return False

    return signal_id in SEEN_IDS


def mark_processed(
    signal_id: str
) -> None:

    if signal_id:
        SEEN_IDS[
            signal_id
        ] = time.time()


# ============================================================
# VOLUME / RISK
# ============================================================

def clamp_volume(
    symbol: str,
    volume: float
) -> float:

    info = mt5.symbol_info(symbol)

    if info is None:
        return 0.0

    step = max(
        float(info.volume_step),
        1e-9
    )

    volume = max(
        float(info.volume_min),
        min(
            float(info.volume_max),
            float(volume)
        )
    )

    volume = (
        math.floor(
            volume / step + 0.5
        )
        * step
    )

    decimals = 0

    if step < 1:

        decimals = max(
            0,
            int(
                round(
                    -math.log10(step)
                )
            )
        )

    return round(
        volume,
        decimals
    )


def risk_volume(
    symbol: str,
    price: float,
    sl: float
) -> float:

    risk_pct = float(
        CFG.get(
            "risk_percent",
            1.0
        )
    )

    account = mt5.account_info()

    if (
        account is None
        or risk_pct <= 0
        or sl <= 0
    ):
        return 0.0

    risk_money = (
        float(account.balance)
        * risk_pct
        / 100.0
    )

    loss_one_lot = mt5.order_calc_profit(
        mt5.ORDER_TYPE_BUY,
        symbol,
        1.0,
        price,
        sl
    )

    if (
        loss_one_lot is None
        or loss_one_lot == 0
    ):
        return 0.0

    return clamp_volume(
        symbol,
        risk_money
        / abs(
            float(loss_one_lot)
        )
    )


def compute_volume(
    symbol: str,
    price: float,
    sl: float,
    requested: float
) -> float:

    if requested > 0:

        return clamp_volume(
            symbol,
            requested
        )

    if bool(
        CFG.get(
            "use_fixed_volume",
            True
        )
    ):

        return clamp_volume(
            symbol,
            float(
                CFG.get(
                    "default_volume",
                    0.01
                )
            )
        )

    volume = risk_volume(
        symbol,
        price,
        sl
    )

    if volume > 0:
        return volume

    return clamp_volume(
        symbol,
        float(
            CFG.get(
                "default_volume",
                0.01
            )
        )
    )


# ============================================================
# ACCOUNT SAFETY
# ============================================================

def check_account_safety() -> Tuple[bool, str]:

    account = mt5.account_info()

    if account is None:

        return (
            False,
            "No MT5 account information"
        )

    if not bool(
        CFG.get(
            "allow_live_trading",
            False
        )
    ):

        server = str(
            account.server or ""
        ).lower()

        login = int(
            account.login
        )

        allowed_login = CFG.get(
            "allowed_demo_login"
        )

        if allowed_login not in (
            None,
            "",
            0
        ):

            try:

                if login != int(
                    allowed_login
                ):

                    return (
                        False,
                        "Account login is not the configured demo login"
                    )

            except (
                ValueError,
                TypeError
            ):

                return (
                    False,
                    "Invalid allowed_demo_login"
                )

        demo_markers = [
            str(x).lower()
            for x in CFG.get(
                "demo_server_markers",
                [
                    "trial",
                    "demo"
                ]
            )
        ]

        if not any(
            marker in server
            for marker in demo_markers
        ):

            return (
                False,
                "Live trading is disabled. "
                "Current MT5 server does not look like a demo: "
                + str(account.server)
            )

    return True, "OK"


# ============================================================
# SL / TP HELPERS
# ============================================================

def get_min_stop_distance(
    symbol: str
) -> Tuple[float, int, int]:

    info = mt5.symbol_info(symbol)

    if info is None:
        return 0.0, 0, 0

    point = float(
        getattr(
            info,
            "point",
            0.0
        ) or 0.0
    )

    stops_level = int(
        getattr(
            info,
            "trade_stops_level",
            0
        ) or 0
    )

    freeze_level = int(
        getattr(
            info,
            "trade_freeze_level",
            0
        ) or 0
    )

    # Use the stricter of the two.
    minimum_level = max(
        stops_level,
        freeze_level
    )

    return (
        minimum_level * point,
        stops_level,
        freeze_level
    )


def normalize_stops(
    symbol: str,
    side: str,
    price: float,
    sl: float,
    tp: float
) -> Tuple[float, float]:

    info = mt5.symbol_info(symbol)

    if info is None:
        return sl, tp

    digits = int(
        info.digits
    )

    tick = mt5.symbol_info_tick(
        symbol
    )

    if tick is None:
        return sl, tp

    bid = float(tick.bid)
    ask = float(tick.ask)

    min_distance, stops_level, freeze_level = (
        get_min_stop_distance(symbol)
    )

    # Add one point of safety.
    safety_buffer = float(
        info.point
    )

    required_distance = (
        min_distance
        + safety_buffer
    )

    side = side.upper()

    # IMPORTANT:
    #
    # BUY opens at ASK but protective
    # stops are checked against BID.
    #
    # SELL opens at BID but protective
    # stops are checked against ASK.

    if side == "BUY":

        reference_price = bid

        if sl > 0:

            if (
                reference_price - sl
                < required_distance
            ):

                sl = (
                    reference_price
                    - required_distance
                )

        if tp > 0:

            if (
                tp - reference_price
                < required_distance
            ):

                tp = (
                    reference_price
                    + required_distance
                )

    else:

        reference_price = ask

        if sl > 0:

            if (
                sl - reference_price
                < required_distance
            ):

                sl = (
                    reference_price
                    + required_distance
                )

        if tp > 0:

            if (
                reference_price - tp
                < required_distance
            ):

                tp = (
                    reference_price
                    - required_distance
                )

    sl = (
        round(sl, digits)
        if sl > 0
        else 0.0
    )

    tp = (
        round(tp, digits)
        if tp > 0
        else 0.0
    )

    log.info(
        "STOP NORMALIZATION: "
        "symbol=%s side=%s "
        "bid=%s ask=%s "
        "stops_level=%s freeze_level=%s "
        "required_distance=%s "
        "sl=%s tp=%s",
        symbol,
        side,
        bid,
        ask,
        stops_level,
        freeze_level,
        required_distance,
        sl,
        tp,
    )

    return sl, tp


def validate_stops(
    symbol: str,
    side: str,
    sl: float,
    tp: float
) -> Tuple[bool, str]:

    info = mt5.symbol_info(symbol)

    tick = mt5.symbol_info_tick(symbol)

    if info is None:
        return (
            False,
            f"Symbol unavailable: {symbol}"
        )

    if tick is None:
        return (
            False,
            f"No market tick for {symbol}"
        )

    side = side.upper()

    bid = float(tick.bid)
    ask = float(tick.ask)

    point = float(info.point)

    min_distance, stops_level, freeze_level = (
        get_min_stop_distance(symbol)
    )

    required_distance = (
        min_distance
        + point
    )

    if sl <= 0 or tp <= 0:

        return (
            False,
            "Valid SL and TP are required"
        )

    if side == "BUY":

        reference_price = bid

        sl_distance = (
            reference_price - sl
        )

        tp_distance = (
            tp - reference_price
        )

        if sl >= reference_price:

            return (
                False,
                (
                    f"BUY SL invalid: "
                    f"SL={sl} must be below BID={bid}"
                )
            )

        if tp <= reference_price:

            return (
                False,
                (
                    f"BUY TP invalid: "
                    f"TP={tp} must be above BID={bid}"
                )
            )

    else:

        reference_price = ask

        sl_distance = (
            sl - reference_price
        )

        tp_distance = (
            reference_price - tp
        )

        if sl <= reference_price:

            return (
                False,
                (
                    f"SELL SL invalid: "
                    f"SL={sl} must be above ASK={ask}"
                )
            )

        if tp >= reference_price:

            return (
                False,
                (
                    f"SELL TP invalid: "
                    f"TP={tp} must be below ASK={ask}"
                )
            )

    if sl_distance < required_distance:

        return (
            False,
            (
                f"SL too close: "
                f"distance={sl_distance:.8f}, "
                f"required={required_distance:.8f}, "
                f"stops_level={stops_level}, "
                f"freeze_level={freeze_level}"
            )
        )

    if tp_distance < required_distance:

        return (
            False,
            (
                f"TP too close: "
                f"distance={tp_distance:.8f}, "
                f"required={required_distance:.8f}, "
                f"stops_level={stops_level}, "
                f"freeze_level={freeze_level}"
            )
        )

    return True, "OK"


# ============================================================
# MARKET ORDER
# ============================================================

def place_market_order(
    symbol: str,
    side: str,
    requested_volume: float,
    sl: float,
    tp: float
) -> Tuple[bool, Dict[str, Any]]:

    if not ensure_symbol_visible(symbol):

        return (
            False,
            {
                "error":
                "Symbol unavailable: "
                + symbol
            }
        )

    info = mt5.symbol_info(symbol)

    tick = mt5.symbol_info_tick(
        symbol
    )

    if (
        info is None
        or tick is None
    ):

        return (
            False,
            {
                "error":
                "No market tick for "
                + symbol
            }
        )

    side = side.upper()

    if side == "BUY":

        order_type = (
            mt5.ORDER_TYPE_BUY
        )

        price = float(
            tick.ask
        )

    else:

        order_type = (
            mt5.ORDER_TYPE_SELL
        )

        price = float(
            tick.bid
        )

    # --------------------------------------------------------
    # Default SL
    # --------------------------------------------------------

    if sl <= 0:

        points = float(
            CFG.get(
                "default_sl_points",
                0
            )
        )

        if points > 0:

            sl = (
                price
                - points * float(info.point)
                if side == "BUY"
                else
                price
                + points * float(info.point)
            )

    # --------------------------------------------------------
    # Default TP
    # --------------------------------------------------------

    if tp <= 0:

        points = float(
            CFG.get(
                "default_tp_points",
                0
            )
        )

        if points > 0:

            tp = (
                price
                + points * float(info.point)
                if side == "BUY"
                else
                price
                - points * float(info.point)
            )

    # --------------------------------------------------------
    # SL / TP normalization
    # --------------------------------------------------------

    sl, tp = normalize_stops(
        symbol,
        side,
        price,
        sl,
        tp
    )

    # --------------------------------------------------------
    # Final SL / TP validation
    # --------------------------------------------------------

    valid, reason = validate_stops(
        symbol,
        side,
        sl,
        tp
    )

    if not valid:

        log.warning(
            "STOP VALIDATION BLOCKED ORDER: "
            "%s %s reason=%s",
            side,
            symbol,
            reason
        )

        return (
            False,
            {
                "error":
                    reason,
                "symbol":
                    symbol,
                "side":
                    side,
                "price":
                    price,
                "sl":
                    sl,
                "tp":
                    tp,
            }
        )

    # --------------------------------------------------------
    # Volume
    # --------------------------------------------------------

    volume = compute_volume(
        symbol,
        price,
        sl,
        requested_volume
    )

    if volume <= 0:

        return (
            False,
            {
                "error":
                "Calculated volume is zero"
            }
        )

    max_volume = float(
        CFG.get(
            "max_volume",
            0.10
        )
    )

    if volume > max_volume:

        return (
            False,
            {
                "error":
                f"Volume {volume} exceeds "
                f"max_volume {max_volume}"
            }
        )

    # --------------------------------------------------------
    # REQUEST
    # --------------------------------------------------------

    req = {
        "action":
            mt5.TRADE_ACTION_DEAL,

        "symbol":
            symbol,

        "volume":
            float(volume),

        "type":
            order_type,

        "price":
            price,

        "sl":
            sl,

        "tp":
            tp,

        "deviation":
            DEVIATION,

        "magic":
            MAGIC,

        "comment":
            COMMENT,

        "type_time":
            mt5.ORDER_TIME_GTC,

        "type_filling":
            mt5.ORDER_FILLING_IOC,
    }

    log.info(
        "ORDER REQUEST: "
        "side=%s symbol=%s "
        "volume=%s price=%s "
        "sl=%s tp=%s",
        side,
        symbol,
        volume,
        price,
        sl,
        tp,
    )

    # --------------------------------------------------------
    # PRE-FLIGHT
    # --------------------------------------------------------

    check = mt5.order_check(
        req
    )

    if check is None:

        return (
            False,
            {
                "error":
                "order_check failed",

                "mt5_error":
                str(
                    mt5.last_error()
                )
            }
        )

    check_retcode = getattr(
        check,
        "retcode",
        None
    )

    if check_retcode not in (
        0,
        mt5.TRADE_RETCODE_DONE
    ):

        return (
            False,
            {
                "error":
                "order_check rejected request",

                "retcode":
                check_retcode,

                "comment":
                getattr(
                    check,
                    "comment",
                    ""
                ),

                "price":
                price,

                "sl":
                sl,

                "tp":
                tp,
            }
        )

    # --------------------------------------------------------
    # SEND ORDER
    # --------------------------------------------------------

    result = mt5.order_send(
        req
    )

    if result is None:

        return (
            False,
            {
                "error":
                "order_send failed",

                "mt5_error":
                str(
                    mt5.last_error()
                )
            }
        )

    ok = (
        result.retcode
        == mt5.TRADE_RETCODE_DONE
    )

    response = {
        "retcode":
            result.retcode,

        "comment":
            result.comment,

        "ticket":
            result.order,

        "deal":
            result.deal,

        "volume":
            volume,

        "price":
            price,

        "sl":
            sl,

        "tp":
            tp,

        "symbol":
            symbol,
    }

    if ok:

        log.info(
            "ORDER EXECUTED: "
            "%s %s volume=%s "
            "price=%s sl=%s tp=%s "
            "ticket=%s deal=%s",
            side,
            symbol,
            volume,
            price,
            sl,
            tp,
            result.order,
            result.deal,
        )

    else:

        log.warning(
            "ORDER REJECTED: "
            "%s %s retcode=%s comment=%s",
            side,
            symbol,
            result.retcode,
            result.comment,
        )

    return ok, response


# ============================================================
# CLOSE SYMBOL
# ============================================================

def close_symbol(
    symbol: str,
    percent: float = 100.0
) -> List[Dict[str, Any]]:

    positions = (
        mt5.positions_get(
            symbol=symbol
        )
        or []
    )

    results = []

    for pos in positions:

        tick = mt5.symbol_info_tick(
            symbol
        )

        if tick is None:

            results.append({
                "ticket": int(
                    pos.ticket
                ),
                "ok": False,
                "error": "No tick",
            })

            continue

        volume = clamp_volume(
            symbol,
            float(pos.volume)
            * percent
            / 100.0
        )

        if volume <= 0:
            continue

        if pos.type == mt5.POSITION_TYPE_BUY:

            order_type = (
                mt5.ORDER_TYPE_SELL
            )

            price = tick.bid

        else:

            order_type = (
                mt5.ORDER_TYPE_BUY
            )

            price = tick.ask

        req = {
            "action":
                mt5.TRADE_ACTION_DEAL,

            "symbol":
                symbol,

            "volume":
                volume,

            "type":
                order_type,

            "position":
                int(pos.ticket),

            "price":
                price,

            "deviation":
                DEVIATION,

            "magic":
                MAGIC,

            "comment":
                COMMENT + "-CLOSE",

            "type_time":
                mt5.ORDER_TIME_GTC,

            "type_filling":
                mt5.ORDER_FILLING_IOC,
        }

        res = mt5.order_send(
            req
        )

        success = bool(
            res
            and res.retcode
            == mt5.TRADE_RETCODE_DONE
        )

        results.append({
            "ticket":
                int(pos.ticket),

            "ok":
                success,

            "retcode":
                res.retcode
                if res
                else None,

            "comment":
                res.comment
                if res
                else
                str(
                    mt5.last_error()
                ),
        })

    return results


# ============================================================
# CLOSE ALL
# ============================================================

def close_all() -> List[Dict[str, Any]]:

    positions = (
        mt5.positions_get()
        or []
    )

    results = []

    symbols = sorted({
        p.symbol
        for p in positions
    })

    for symbol in symbols:

        results.extend(
            close_symbol(
                symbol
            )
        )

    return results


# ============================================================
# CLOSE SINGLE POSITION
# ============================================================

def close_position_ticket(
    ticket: int
) -> Dict[str, Any]:

    positions = (
        mt5.positions_get()
        or []
    )

    target = next(
        (
            p
            for p in positions
            if int(p.ticket)
            == int(ticket)
        ),
        None
    )

    if target is None:

        return {
            "ok": False,
            "error":
                f"Position {ticket} not found"
        }

    tick = mt5.symbol_info_tick(
        target.symbol
    )

    if tick is None:

        return {
            "ok": False,
            "error":
                f"No market tick for {target.symbol}"
        }

    if target.type == mt5.POSITION_TYPE_BUY:

        order_type = (
            mt5.ORDER_TYPE_SELL
        )

        price = tick.bid

    else:

        order_type = (
            mt5.ORDER_TYPE_BUY
        )

        price = tick.ask

    req = {
        "action":
            mt5.TRADE_ACTION_DEAL,

        "symbol":
            target.symbol,

        "volume":
            clamp_volume(
                target.symbol,
                float(target.volume)
            ),

        "type":
            order_type,

        "position":
            int(target.ticket),

        "price":
            price,

        "deviation":
            DEVIATION,

        "magic":
            MAGIC,

        "comment":
            COMMENT + "-CLOSE",

        "type_time":
            mt5.ORDER_TIME_GTC,

        "type_filling":
            mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(
        req
    )

    ok = bool(
        result
        and result.retcode
        == mt5.TRADE_RETCODE_DONE
    )

    return {
        "ok":
            ok,

        "ticket":
            int(target.ticket),

        "retcode":
            result.retcode
            if result
            else None,

        "comment":
            result.comment
            if result
            else
            str(
                mt5.last_error()
            ),
    }


# ============================================================
# DASHBOARD SNAPSHOT
# ============================================================

def dashboard_snapshot() -> Dict[str, Any]:

    global EQUITY_PEAK

    if not mt5_init_ok():

        return {
            "ok": False,

            "bridge": {
                "online": True,
                "started_at":
                    utc_iso(
                        DASHBOARD_STARTED_AT
                    ),
            },

            "mt5": {
                "connected": False,
                "error":
                    "MT5 initialization failed",
            },
        }

    account = mt5.account_info()

    terminal = mt5.terminal_info()

    positions = (
        mt5.positions_get()
        or []
    )

    safe, safety_reason = (
        check_account_safety()
    )

    if account is not None:

        equity = float(
            account.equity
        )

        with DASHBOARD_LOCK:

            EQUITY_PEAK = max(
                EQUITY_PEAK or equity,
                equity
            )

            equity_peak = EQUITY_PEAK

    else:

        equity = 0.0

        equity_peak = (
            EQUITY_PEAK or 0.0
        )

    drawdown = max(
        0.0,
        equity_peak - equity
    )

    drawdown_pct = (
        drawdown
        / equity_peak
        * 100
        if equity_peak > 0
        else 0.0
    )

    with DASHBOARD_LOCK:

        signals = list(
            SIGNAL_HISTORY
        )[:80]

        last_webhook_at = (
            LAST_WEBHOOK_AT
        )

        last_webhook_result = (
            LAST_WEBHOOK_RESULT
        )

    requested_gold = normalize_symbol(
        "XAUUSD"
    )

    gold_symbol = (
        resolve_symbol(
            requested_gold
        )
        or requested_gold
    )

    gold_tick = (
        mt5.symbol_info_tick(
            gold_symbol
        )
    )

    gold_bid = (
        float(gold_tick.bid)
        if gold_tick
        else 0.0
    )

    gold_ask = (
        float(gold_tick.ask)
        if gold_tick
        else gold_bid
    )

    spread = (
        gold_ask - gold_bid
        if gold_tick
        else 0.0
    )

    return {

        "ok":
            account is not None,

        "generated_at":
            utc_iso(),

        "gold": {
            "symbol":
                gold_symbol,

            "bid":
                gold_bid,

            "ask":
                gold_ask,

            "spread":
                round(
                    spread,
                    3
                ),

            "change":
                0.0,
        },

        "bridge": {

            "online":
                True,

            "started_at":
                utc_iso(
                    DASHBOARD_STARTED_AT
                ),

            "uptime_seconds":
                int(
                    time.time()
                    - DASHBOARD_STARTED_AT
                ),
        },

        "mt5": {

            "connected":
                bool(
                    terminal
                    and getattr(
                        terminal,
                        "connected",
                        False
                    )
                ),

            "trade_allowed":
                bool(
                    terminal
                    and getattr(
                        terminal,
                        "trade_allowed",
                        False
                    )
                ),

            "safety_allowed":
                safe,

            "safety_reason":
                safety_reason,

            "company":
                str(
                    getattr(
                        terminal,
                        "company",
                        ""
                    )
                    or ""
                ),
        },

        "account": {

            "login":
                int(account.login)
                if account
                else None,

            "server":
                str(account.server)
                if account
                else None,

            "currency":
                str(account.currency)
                if account
                else "",

            "balance":
                float(account.balance)
                if account
                else 0.0,

            "equity":
                equity,

            "profit":
                float(account.profit)
                if account
                else 0.0,

            "margin":
                float(account.margin)
                if account
                else 0.0,

            "free_margin":
                float(account.margin_free)
                if account
                else 0.0,

            "margin_level":
                float(account.margin_level)
                if (
                    account
                    and getattr(
                        account,
                        "margin_level",
                        0
                    )
                )
                else None,

            "mode":
                (
                    "LIVE"
                    if bool(
                        CFG.get(
                            "allow_live_trading",
                            False
                        )
                    )
                    else "DEMO-ONLY"
                ),
        },

        "risk": {

            "equity_peak":
                round(
                    equity_peak,
                    2
                ),

            "drawdown":
                round(
                    drawdown,
                    2
                ),

            "drawdown_percent":
                round(
                    drawdown_pct,
                    2
                ),
        },

        "positions": [
            position_to_dict(pos)
            for pos in positions
        ],

        "position_totals": {

            "count":
                len(positions),

            "floating_pnl":
                round(
                    sum(
                        float(pos.profit)
                        +
                        float(
                            getattr(
                                pos,
                                "swap",
                                0.0
                            )
                            or 0.0
                        )
                        for pos in positions
                    ),
                    2
                ),

            "net_lots":
                round(
                    sum(
                        (
                            1
                            if pos.type
                            == mt5.POSITION_TYPE_BUY
                            else -1
                        )
                        * float(pos.volume)
                        for pos in positions
                    ),
                    2
                ),

            "exposure":
                round(
                    sum(
                        float(pos.volume)
                        * float(
                            pos.price_current
                        )
                        * 100
                        for pos in positions
                    ),
                    2
                ),
        },

        "tradingview": {

            "last_signal_at":
                (
                    utc_iso(
                        last_webhook_at
                    )
                    if last_webhook_at
                    else None
                ),

            "last_result":
                last_webhook_result,

            "receiving":
                last_webhook_at is not None,
        },

        "statistics":
            today_trade_statistics(),

        "signals":
            signals,
    }


# ============================================================
# DASHBOARD SETTINGS
# ============================================================

def dashboard_settings() -> Dict[str, Any]:

    return {

        "use_fixed_volume":
            bool(
                CFG.get(
                    "use_fixed_volume",
                    True
                )
            ),

        "default_volume":
            float(
                CFG.get(
                    "default_volume",
                    0.01
                )
            ),

        "max_volume":
            float(
                CFG.get(
                    "max_volume",
                    0.10
                )
            ),

        "risk_percent":
            float(
                CFG.get(
                    "risk_percent",
                    1.0
                )
            ),

        "default_sl_points":
            float(
                CFG.get(
                    "default_sl_points",
                    0
                )
            ),

        "default_tp_points":
            float(
                CFG.get(
                    "default_tp_points",
                    0
                )
            ),
    }


def save_dashboard_settings(
    data: Dict[str, Any]
) -> Dict[str, Any]:

    allowed_keys = {
        "use_fixed_volume",
        "default_volume",
        "max_volume",
        "risk_percent",
        "default_sl_points",
        "default_tp_points",
    }

    candidate = dashboard_settings()

    for key in allowed_keys:

        if key not in data:
            continue

        if key == "use_fixed_volume":

            candidate[key] = bool(
                data[key]
            )

            continue

        try:

            candidate[key] = float(
                data[key]
            )

        except (
            TypeError,
            ValueError
        ):

            raise ValueError(
                f"{key} must be numeric"
            )

    if candidate["default_volume"] <= 0:
        raise ValueError(
            "default_volume must be greater than zero"
        )

    if candidate["max_volume"] <= 0:
        raise ValueError(
            "max_volume must be greater than zero"
        )

    if (
        candidate["default_volume"]
        > candidate["max_volume"]
    ):
        raise ValueError(
            "default_volume cannot exceed max_volume"
        )

    if not 0 < candidate["risk_percent"] <= 100:
        raise ValueError(
            "risk_percent must be between 0 and 100"
        )

    if candidate["default_sl_points"] < 0:
        raise ValueError(
            "default_sl_points cannot be negative"
        )

    if candidate["default_tp_points"] < 0:
        raise ValueError(
            "default_tp_points cannot be negative"
        )

    new_config = dict(CFG)

    new_config.update(
        candidate
    )

    temporary_path = (
        CONFIG_PATH
        + ".dashboard.tmp"
    )

    with open(
        temporary_path,
        "w",
        encoding="utf-8"
    ) as fh:

        json.dump(
            new_config,
            fh,
            ensure_ascii=False,
            indent=2
        )

        fh.write("\n")

    os.replace(
        temporary_path,
        CONFIG_PATH
    )

    CFG.update(
        candidate
    )

    return dashboard_settings()


# ============================================================
# DASHBOARD SESSION
# ============================================================

def cleanup_dashboard_sessions() -> None:

    now = time.time()

    for token, created_at in list(
        DASHBOARD_SESSIONS.items()
    ):

        if (
            now - created_at
            > DASHBOARD_SESSION_TTL
        ):

            DASHBOARD_SESSIONS.pop(
                token,
                None
            )


def create_dashboard_session() -> str:

    cleanup_dashboard_sessions()

    token = secrets.token_urlsafe(
        32
    )

    DASHBOARD_SESSIONS[
        token
    ] = time.time()

    return token


def dashboard_token_from_request() -> Optional[str]:

    auth = request.headers.get(
        "Authorization",
        ""
    )

    if not auth.startswith(
        "Bearer "
    ):
        return None

    token = auth[7:].strip()

    return (
        token
        if token
        else None
    )


def dashboard_authenticated() -> bool:

    cleanup_dashboard_sessions()

    token = (
        dashboard_token_from_request()
    )

    if not token:
        return False

    created_at = (
        DASHBOARD_SESSIONS.get(
            token
        )
    )

    if created_at is None:
        return False

    if (
        time.time()
        - created_at
        > DASHBOARD_SESSION_TTL
    ):

        DASHBOARD_SESSIONS.pop(
            token,
            None
        )

        return False

    return True


def dashboard_auth_error():

    return jsonify({
        "ok": False,
        "error":
            "Dashboard authentication required"
    }), 401


# ============================================================
# SIGNAL PROCESSING
# ============================================================

def process_signal(
    payload: Dict[str, Any]
) -> Dict[str, Any]:

    cleanup_seen()

    # --------------------------------------------------------
    # PASSPHRASE
    # --------------------------------------------------------

    if payload.get(
        "passphrase"
    ) != PASSPHRASE:

        return {
            "ok": False,
            "error":
                "Invalid passphrase"
        }

    # --------------------------------------------------------
    # SIGNAL ID
    # --------------------------------------------------------

    signal_id = str(
        payload.get("id")
        or payload.get("signal_id")
        or ""
    )

    # --------------------------------------------------------
    # DUPLICATE
    # --------------------------------------------------------

    if is_duplicate(
        signal_id
    ):

        return {
            "ok":
                True,

            "duplicate":
                True,

            "id":
                signal_id
        }

    # --------------------------------------------------------
    # MT5
    # --------------------------------------------------------

    if not mt5_init_ok():

        return {
            "ok":
                False,

            "error":
                "MT5 initialization failed"
        }

    # --------------------------------------------------------
    # ACCOUNT SAFETY
    # --------------------------------------------------------

    safe, reason = (
        check_account_safety()
    )

    if not safe:

        log.error(
            "SAFETY BLOCK: %s",
            reason
        )

        return {
            "ok":
                False,

            "error":
                reason
        }

    # --------------------------------------------------------
    # ACTION
    # --------------------------------------------------------

    action = str(
        payload.get("action")
        or payload.get("side")
        or payload.get("type")
        or ""
    ).upper()

    raw_symbol = (
        payload.get("symbol")
        or payload.get("ticker")
        or "XAUUSD"
    )

    # --------------------------------------------------------
    # NUMERIC FIELDS
    # --------------------------------------------------------

    try:

        volume = float(
            payload.get(
                "volume"
            )
            or 0
        )

        sl = float(
            payload.get(
                "sl"
            )
            or 0
        )

        tp = float(
            payload.get(
                "tp"
            )
            or 0
        )

    except (
        TypeError,
        ValueError
    ):

        return {
            "ok":
                False,

            "error":
                "volume/sl/tp must be numeric"
        }

    # ========================================================
    # CLOSE ALL
    # ========================================================

    if action in (
        "CLOSE",
        "CLOSE_ALL",
        "FLAT"
    ):

        closed = close_all()

        failures = [
            item
            for item in closed
            if not item.get("ok")
        ]

        response = {
            "ok":
                not failures,

            "action":
                "CLOSE_ALL",

            "closed":
                closed,
        }

        if not failures and signal_id:
            mark_processed(
                signal_id
            )

        return response

    # ========================================================
    # CLOSE SYMBOL
    # ========================================================

    if action == "CLOSE_SYMBOL":

        symbol = resolve_symbol(
            raw_symbol
        )

        if symbol is None:

            return {
                "ok":
                    False,

                "error":
                    "Symbol unavailable: "
                    + str(raw_symbol)
            }

        try:

            percent = float(
                payload.get(
                    "percent"
                )
                or 100
            )

        except (
            TypeError,
            ValueError
        ):

            percent = 100

        percent = max(
            0,
            min(
                100,
                percent
            )
        )

        closed = close_symbol(
            symbol,
            percent
        )

        failures = [
            item
            for item in closed
            if not item.get("ok")
        ]

        response = {
            "ok":
                not failures,

            "action":
                "CLOSE_SYMBOL",

            "symbol":
                symbol,

            "closed":
                closed,
        }

        if not failures and signal_id:
            mark_processed(
                signal_id
            )

        return response

    # ========================================================
    # BUY / SELL
    # ========================================================

    if action not in (
        "BUY",
        "SELL",
        "LONG",
        "SHORT"
    ):

        return {
            "ok":
                False,

            "error":
                "Unsupported action: "
                + action
        }

    symbol = resolve_symbol(
        raw_symbol
    )

    if symbol is None:

        return {
            "ok":
                False,

            "error":
                "Symbol unavailable or blocked: "
                + str(raw_symbol)
        }

    side = (
        "BUY"
        if action in (
            "BUY",
            "LONG"
        )
        else
        "SELL"
    )

    # ========================================================
    # EXECUTE
    # ========================================================

    ok, detail = place_market_order(
        symbol,
        side,
        volume,
        sl,
        tp
    )

    response = {
        "ok":
            ok,

        "action":
            side,

        **detail
    }

    # ========================================================
    # ONLY MARK SUCCESSFUL EXECUTION
    # ========================================================

    if ok and signal_id:

        mark_processed(
            signal_id
        )

    return response


# ============================================================
# ROUTES
# ============================================================

@app.route(
    "/",
    methods=["GET"]
)
def dashboard_page():

    return render_template(
        "dashboard.html"
    )


# ============================================================
# DASHBOARD AUTH STATUS
# ============================================================

@app.route(
    "/api/dashboard/auth",
    methods=["GET"]
)
def dashboard_auth_status():

    return jsonify({

        "ok":
            True,

        "build":
            "dashboard-20260829-5",

        "config_path":
            CONFIG_PATH,

        "dashboard_password_length":
            len(
                current_dashboard_password()
            ),

        "configured":
            dashboard_password_configured(),

        "authenticated":
            bool(
                session.get(
                    "dashboard_authenticated"
                )
            ),
    })


# ============================================================
# DASHBOARD LOGIN
# ============================================================

@app.route(
    "/api/dashboard/login",
    methods=["POST"]
)
def dashboard_login():

    if not dashboard_password_configured():

        return jsonify({

            "ok":
                False,

            "error":
                (
                    "Set dashboard_password "
                    "in config.json before "
                    "using the dashboard."
                ),
        }), 503

    payload = (
        request.get_json(
            silent=True
        )
        or {}
    )

    password = str(
        payload.get(
            "password",
            ""
        )
    )

    if not hmac.compare_digest(
        password,
        current_dashboard_password()
    ):

        log.warning(
            "Dashboard login failed from %s",
            request.remote_addr
        )

        return jsonify({

            "ok":
                False,

            "error":
                "Invalid dashboard password",
        }), 401

    session.clear()

    session[
        "dashboard_authenticated"
    ] = True

    session[
        "dashboard_login_at"
    ] = int(
        time.time()
    )

    log.info(
        "Dashboard login succeeded from %s",
        request.remote_addr
    )

    return jsonify({
        "ok": True
    })


# ============================================================
# DASHBOARD LOGOUT
# ============================================================

@app.route(
    "/api/dashboard/logout",
    methods=["POST"]
)
def dashboard_logout():

    session.clear()

    return jsonify({
        "ok": True
    })


# ============================================================
# DASHBOARD SUMMARY
# ============================================================

@app.route(
    "/api/dashboard/summary",
    methods=["GET"]
)
@dashboard_required
def dashboard_summary():

    return jsonify(
        dashboard_snapshot()
    )


# ============================================================
# DASHBOARD LOGS
# ============================================================

@app.route(
    "/api/dashboard/logs",
    methods=["GET"]
)
@dashboard_required
def dashboard_logs():

    try:

        limit = int(
            request.args.get(
                "limit",
                150
            )
        )

    except (
        TypeError,
        ValueError
    ):

        limit = 150

    return jsonify({

        "ok":
            True,

        "lines":
            read_recent_logs(
                max(
                    10,
                    min(
                        limit,
                        500
                    )
                )
            ),
    })


# ============================================================
# DASHBOARD SETTINGS GET
# ============================================================

@app.route(
    "/api/dashboard/settings",
    methods=["GET"]
)
@dashboard_required
def dashboard_get_settings():

    return jsonify({

        "ok":
            True,

        "settings":
            dashboard_settings(),
    })


# ============================================================
# DASHBOARD SETTINGS POST
# ============================================================

@app.route(
    "/api/dashboard/settings",
    methods=["POST"]
)
@dashboard_required
def dashboard_update_settings():

    payload = (
        request.get_json(
            silent=True
        )
    )

    if not isinstance(
        payload,
        dict
    ):

        return jsonify({

            "ok":
                False,

            "error":
                "Expected JSON object",
        }), 400

    try:

        settings = (
            save_dashboard_settings(
                payload
            )
        )

    except ValueError as exc:

        return jsonify({

            "ok":
                False,

            "error":
                str(exc),
        }), 400

    except OSError as exc:

        log.exception(
            "Dashboard settings could not be saved"
        )

        return jsonify({

            "ok":
                False,

            "error":
                "Could not save settings: "
                + str(exc),
        }), 500

    log.warning(
        "Dashboard risk settings updated"
    )

    record_dashboard_event(
        "SETTINGS_UPDATED",
        True,
        "Risk settings saved",
    )

    return jsonify({

        "ok":
            True,

        "settings":
            settings,
    })


# ============================================================
# EMERGENCY CLOSE ALL
# ============================================================

@app.route(
    "/api/dashboard/emergency-close",
    methods=["POST"]
)
@dashboard_required
def dashboard_emergency_close():

    payload = (
        request.get_json(
            silent=True
        )
        or {}
    )

    confirmation = str(
        payload.get(
            "confirmation",
            ""
        )
    ).strip().upper()

    if confirmation != "CLOSE ALL":

        return jsonify({

            "ok":
                False,

            "error":
                'Type "CLOSE ALL" to confirm this action.',
        }), 400

    if not mt5_init_ok():

        record_dashboard_event(
            "EMERGENCY_CLOSE_ALL",
            False,
            "MT5 initialization failed",
        )

        return jsonify({

            "ok":
                False,

            "error":
                "MT5 initialization failed",
        }), 503

    safe, reason = (
        check_account_safety()
    )

    if not safe:

        log.error(
            "Dashboard emergency close blocked by safety: %s",
            reason
        )

        record_dashboard_event(
            "EMERGENCY_CLOSE_ALL",
            False,
            reason
        )

        return jsonify({

            "ok":
                False,

            "error":
                reason,
        }), 403

    results = close_all()

    failures = [
        result
        for result in results
        if not result.get("ok")
    ]

    succeeded = (
        len(results)
        - len(failures)
    )

    ok = not failures

    detail = (
        f"Closed {succeeded} position(s)"
        if results
        else
        "No open positions to close"
    )

    if failures:

        detail += (
            f"; {len(failures)} failed"
        )

    log.warning(
        "Dashboard emergency close: %s",
        detail
    )

    record_dashboard_event(
        "EMERGENCY_CLOSE_ALL",
        ok,
        detail
    )

    return jsonify({

        "ok":
            ok,

        "message":
            detail,

        "closed":
            results,

    }), (
        200
        if ok
        else 502
    )


# ============================================================
# DASHBOARD MANUAL SIGNAL
# ============================================================

@app.route(
    "/api/dashboard/signal",
    methods=["POST", "OPTIONS"]
)
@dashboard_required
def dashboard_signal():

    if request.method == "OPTIONS":
        return ("", 204)

    payload = (
        request.get_json(
            silent=True
        )
        or {}
    )

    action = str(
        payload.get(
            "action",
            ""
        )
    ).upper()

    if action not in {
        "BUY",
        "SELL",
        "CLOSE_SYMBOL"
    }:

        return jsonify({

            "ok":
                False,

            "error":
                "Unsupported dashboard action"
        }), 400

    signal_id = str(
        payload.get("id")
        or
        f"dashboard-{secrets.token_hex(8)}"
    )

    command = {

        "id":
            signal_id,

        "passphrase":
            PASSPHRASE,

        "action":
            action,

        "symbol":
            payload.get(
                "symbol"
            )
            or "XAUUSD",

        "volume":
            payload.get(
                "volume",
                0
            ),

        "sl":
            payload.get(
                "sl",
                0
            ),

        "tp":
            payload.get(
                "tp",
                0
            ),
    }

    if action == "CLOSE_SYMBOL":

        command["percent"] = payload.get(
            "percent",
            100
        )

    response = process_signal(
        command
    )

    record_signal_event(
        command,
        response
    )

    return jsonify(
        response
    ), (
        200
        if response.get("ok")
        else 400
    )


# ============================================================
# DASHBOARD CLOSE POSITION
# ============================================================

@app.route(
    "/api/dashboard/close-position",
    methods=["POST", "OPTIONS"]
)
@dashboard_required
def dashboard_close_position():

    if request.method == "OPTIONS":
        return ("", 204)

    payload = (
        request.get_json(
            silent=True
        )
        or {}
    )

    try:

        ticket = int(
            payload.get(
                "ticket"
            )
        )

    except (
        TypeError,
        ValueError
    ):

        return jsonify({

            "ok":
                False,

            "error":
                "Invalid position ticket"
        }), 400

    if not mt5_init_ok():

        return jsonify({

            "ok":
                False,

            "error":
                "MT5 initialization failed"
        }), 503

    safe, reason = (
        check_account_safety()
    )

    if not safe:

        return jsonify({

            "ok":
                False,

            "error":
                reason
        }), 403

    result = close_position_ticket(
        ticket
    )

    record_dashboard_event(
        "CLOSE_POSITION",
        bool(
            result.get("ok")
        ),
        str(
            result.get("comment")
            or
            result.get("error")
            or
            ""
        )
    )

    return jsonify(
        result
    ), (
        200
        if result.get("ok")
        else 502
    )


# ============================================================
# DEBUG SYMBOL
# ============================================================

@app.route(
    "/debug/symbol/<symbol>",
    methods=["GET"]
)
def debug_symbol(symbol):

    if not mt5_init_ok():

        return jsonify({

            "ok":
                False,

            "error":
                "MT5 initialization failed"
        }), 503

    resolved = resolve_symbol(
        symbol
    )

    if not resolved:

        return jsonify({

            "ok":
                False,

            "error":
                f"Could not resolve {symbol}"
        }), 404

    return jsonify(
        get_symbol_trade_rules(
            resolved
        )
    )


# ============================================================
# HEALTH
# ============================================================

@app.route(
    "/health",
    methods=["GET"]
)
def health():

    return jsonify({

        "ok":
            True,

        "service":
            "TradingView -> MT5",

        "version":
            "2.2"
    })


# ============================================================
# STATUS
# ============================================================

@app.route(
    "/status",
    methods=["GET"]
)
def status():

    if not mt5_init_ok():

        return jsonify({

            "ok":
                False,

            "error":
                "MT5 not initialized"
        }), 503

    acc = mt5.account_info()

    term = mt5.terminal_info()

    return jsonify({

        "ok":
            True,

        "account":
            acc.login
            if acc
            else None,

        "server":
            acc.server
            if acc
            else None,

        "balance":
            acc.balance
            if acc
            else None,

        "equity":
            acc.equity
            if acc
            else None,

        "currency":
            acc.currency
            if acc
            else None,

        "company":
            term.company
            if term
            else None,

        "trade_allowed":
            term.trade_allowed
            if term
            else None,

        "allow_live_trading":
            CFG.get(
                "allow_live_trading",
                False
            ),
    })


# ============================================================
# LEGACY DASHBOARD AUTH
# ============================================================

@app.route(
    "/dashboard/auth",
    methods=["GET"]
)
def dashboard_auth():

    if not dashboard_authenticated():

        return dashboard_auth_error()

    return jsonify({

        "ok":
            True,

        "authenticated":
            True
    })


# ============================================================
# TRADINGVIEW WEBHOOK
# ============================================================

@app.route(
    "/webhook",
    methods=["POST"]
)
def webhook():

    payload = request.get_json(
        silent=True
    )

    if not isinstance(
        payload,
        dict
    ):

        return jsonify({

            "ok":
                False,

            "error":
                "Expected JSON object"
        }), 400

    log.info(
        "Webhook received: "
        "id=%s action=%s symbol=%s",

        str(
            payload.get("id")
            or
            payload.get("signal_id")
            or
            ""
        ),

        str(
            payload.get("action")
            or
            payload.get("side")
            or
            payload.get("type")
            or
            ""
        ).upper(),

        str(
            payload.get("symbol")
            or
            payload.get("ticker")
            or
            "XAUUSD"
        ),
    )

    response = process_signal(
        payload
    )

    record_signal_event(
        payload,
        response
    )

    log.info(
        "Webhook result: %s",
        json.dumps(
            response,
            ensure_ascii=False,
            default=str
        )
    )

    return jsonify(
        response
    ), (
        200
        if response.get("ok")
        else 400
    )


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":

    if not mt5_init_ok():
        sys.exit(1)

    host = CFG.get(
        "host",
        "127.0.0.1"
    )

    port = int(
        CFG.get(
            "port",
            5000
        )
    )

    log.info(
        "Bridge listening on http://%s:%s",
        host,
        port
    )

    app.run(
        host=host,
        port=port,
        debug=False
    )



    

