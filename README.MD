ENGLISH

# Trading Bridge Control Center

### Real-Time TradingView → Python → MetaTrader 5 Automation

Trading Bridge Control Center is a local trading automation and monitoring platform that connects TradingView signals with MetaTrader 5 through a Python execution bridge.

The system receives trading signals, validates them, applies risk and safety rules, communicates with MetaTrader 5, and exposes a real-time control dashboard for monitoring positions, account metrics, execution history and bridge health.

## Architecture

```text
TradingView
    │
    │ Webhook
    ▼
Python / Flask Bridge
    │
    ├── Signal validation
    ├── Duplicate protection
    ├── Symbol resolution
    ├── Risk management
    ├── SL / TP calculation
    ├── Safety controls
    │
    ▼
MetaTrader 5
    │
    ├── Orders
    ├── Positions
    ├── Balance
    ├── Equity
    └── P&L
    │
    ▼
React / Vite Control Center
```

## Key Features

* TradingView webhook integration
* MetaTrader 5 Python API integration
* BUY / SELL execution
* Symbol-specific position closing
* Emergency close-all functionality
* Duplicate signal protection
* Broker symbol/suffix resolution
* Risk-based position sizing
* Stop Loss / Take Profit calculation
* MT5 `order_check()` validation
* MT5 `order_send()` execution
* Real-time position monitoring
* Balance and equity monitoring
* P&L and trading statistics
* Execution logs and history
* Dashboard authentication
* CORS protection for the local frontend
* Demo-first safety controls
* Local React/Vite control center

## Technology Stack

### Backend

* Python
* Flask
* MetaTrader 5 Python API
* REST API
* Webhooks

### Frontend

* React
* TypeScript
* Vite
* TanStack Start
* Tailwind CSS

### Trading Infrastructure

* TradingView
* MetaTrader 5
* Broker symbol resolution
* Risk management
* Order validation and execution

## Why I Built It

The goal was to build a real-world trading infrastructure system rather than a simple frontend application.

The project explores how automated trading signals can move through a controlled execution pipeline while maintaining validation, risk management, authentication, observability and emergency controls.

## Disclaimer

This project is intended for educational and engineering purposes. Automated trading involves financial risk. Never deploy an automated trading system with real funds without extensive testing, validation and appropriate risk controls.




SPANISH

Trading Bridge Control Center
Automatización en tiempo real TradingView → Python → MetaTrader 5
El Trading Bridge Control Center es una plataforma local de automatización y monitoreo de operaciones que conecta señales de TradingView con MetaTrader 5 a través de un puente de ejecución en Python.
El sistema recibe las señales de trading, las valida, aplica reglas de riesgo y seguridad, se comunica con MetaTrader 5 y expone un panel de control en tiempo real para supervisar posiciones, métricas de cuenta, historial de ejecución y el estado del puente.

Arquitectura
TradingView
│
│ Webhook
▼
Puente de Python / Flask
│
├── Validación de señales
├── Protección contra duplicados
├── Resolución de símbolos
├── Gestión de riesgos
├── Cálculo de SL / TP
├── Controles de seguridad
│
▼
MetaTrader 5
│
├── Órdenes
├── Posiciones
├── Balance
├── Equity (Patrimonio)
└── P&L (Ganancias y Pérdidas)
│
▼
Panel de Control React / Vite
Características Principales
Integración de webhooks de TradingView
Integración con la API de Python para MetaTrader 5
Ejecución de compra (BUY) y venta (SELL)
Cierre de posiciones por símbolo específico
Funcionalidad de emergencia para cerrar todo (Close-all)
Protección contra señales duplicadas
Resolución de símbolos y sufijos del bróker
Dimensionamiento de posiciones basado en riesgo
Cálculo de Stop Loss / Take Profit
Validación mediante order_check() de MT5
Ejecución mediante order_send() de MT5
Monitoreo de posiciones en tiempo real
Monitoreo de balance y patrimonio
P&L y estadísticas de trading
Registros e historial de ejecución
Autenticación en el panel de control
Protección CORS para el frontend local
Controles de seguridad orientados primero a cuentas demo
Panel de control local en React / Vite
Stack Tecnológico
Backend
Python
Flask
API de Python para MetaTrader 5
API REST
Webhooks
Frontend
React
TypeScript
Vite
TanStack Start
Tailwind CSS
Infraestructura de Trading
TradingView
MetaTrader 5
Resolución de símbolos del bróker
Gestión de riesgos
Validación y ejecución de órdenes
Por qué lo construí
El objetivo fue construir un sistema de infraestructura de trading del mundo real en lugar de una simple aplicación frontend.
El proyecto explora cómo las señales de trading automatizadas pueden fluir a través de un canal de ejecución controlado mientras se mantiene la validación, la gestión de riesgos, la autenticación, la observabilidad y los controles de emergencia.

Aviso Legal
Este proyecto está destinado a fines educativos y de ingeniería. El trading automatizado conlleva riesgos financieros. Nunca despliegues un sistema de trading automatizado con fondos reales sin pruebas exhaustivas, validación y los controles de riesgo adecuados.