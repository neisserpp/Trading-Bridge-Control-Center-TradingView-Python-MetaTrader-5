# Trading Bridge — Real MT5/Exness setup

This project is split into two processes:

1. `bridge.py` — the real Python/Flask execution engine connected to MetaTrader 5.
2. React/Vite dashboard — the control center that reads and controls the real bridge.

There is no simulated trading engine in the dashboard.

## Requirements

- Windows
- MetaTrader 5 installed and logged into the intended Exness account
- Python 3.10+ recommended
- Node.js 20+ recommended

## 1. Configure MT5

Keep MT5 open and enable Algo Trading/AutoTrading when you want orders to be executable.
The current `config.json` is demo-first: `allow_live_trading` is false and the bridge only accepts servers containing `trial` or `demo` unless you explicitly change the safety configuration.

## 2. Start the real bridge

From this folder:

```powershell
.\run-bridge.ps1
```

Or manually:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe bridge.py
```

Check it:

```powershell
curl.exe http://127.0.0.1:5000/health
curl.exe http://127.0.0.1:5000/status
```

## 3. Start the dashboard

Open a second PowerShell in this folder:

```powershell
npm install
npm run dev
```

Open:

`http://localhost:8080`

The dashboard defaults to the real bridge at `http://127.0.0.1:5000`.

If needed, create `.env` from `.env.example` and set `VITE_BRIDGE_URL`.

## 4. Dashboard login

The dashboard authenticates against the Python bridge. If `dashboard_password` is not present in `config.json`, the bridge falls back to the configured webhook passphrase. For better separation, add a dedicated `dashboard_password` later.

## 5. TradingView

TradingView must NOT call `127.0.0.1`. For real TradingView webhooks, expose the bridge through a secure HTTPS tunnel/reverse proxy and use that public `/webhook` URL in TradingView.

The webhook payload remains compatible with the bridge engine:

```json
{
  "id": "unique-signal-id",
  "passphrase": "YOUR_WEBHOOK_PASSPHRASE",
  "action": "BUY",
  "symbol": "XAUUSD",
  "volume": 0.01,
  "sl": 0,
  "tp": 0
}
```

## Safety

- Do not enable live trading until the demo flow has been fully validated.
- Never expose `config.json` or the passphrase in a public repository.
- The dashboard's manual BUY/SELL buttons execute real MT5 orders through the bridge when MT5 permits trading.
- `CLOSE ALL` requires an explicit typed confirmation.
