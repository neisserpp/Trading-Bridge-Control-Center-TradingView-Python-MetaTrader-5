import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { number } from "@/lib/format";
import { useBridge } from "@/lib/store";
import { CONTRACT, POINT, type RiskSettings } from "@/lib/types";

function estimateLots(balance: number, form: RiskSettings) {
  const slDist = form.default_sl_points * POINT;
  const riskMoney = balance * (form.risk_percent / 100);
  const lossPerLot = slDist * CONTRACT;
  if (lossPerLot <= 0) return form.default_volume;
  const lots = Math.floor((riskMoney / lossPerLot) * 100) / 100;
  return Math.min(form.max_volume, Math.max(0.01, lots));
}

export function SettingsForm() {
  const current = useBridge((s) => s.engine.settings);
  const balance = useBridge((s) => s.snapshot.account.balance);
  const save = useBridge((s) => s.saveSettings);
  const [form, setForm] = useState<RiskSettings>(current);
  const estimated = estimateLots(balance, form);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = await save(form);
    toast[result.ok ? "success" : "error"](result.message);
  }

  function num(key: keyof RiskSettings, value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setForm((prev) => ({ ...prev, [key]: parsed }));
  }

  return (
    <article className="panel rounded-lg p-4 sm:p-5">
      <p className="text-[11px] font-medium tracking-[0.14em] text-muted uppercase">Ejecución</p>
      <h2 className="mb-4 font-display text-base tracking-tight">Volumen y riesgo</h2>
      <form onSubmit={onSubmit} className="grid gap-4">
        <label className="flex items-center justify-between gap-4 rounded-md bg-bg px-3 py-3 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
          <span>
            <span className="block text-sm font-medium">Volumen fijo</span>
            <span className="text-xs text-muted">Desactívalo para calcular por riesgo.</span>
          </span>
          <Switch
            checked={form.use_fixed_volume}
            onCheckedChange={(checked) => setForm((p) => ({ ...p, use_fixed_volume: checked }))}
          />
        </label>

        <div className="grid grid-cols-2 gap-2.5">
          <Field
            label="Volumen por defecto"
            value={form.default_volume}
            step="0.01"
            min="0.01"
            digits={2}
            onChange={(v) => num("default_volume", v)}
          />
          <Field
            label="Volumen máximo"
            value={form.max_volume}
            step="0.01"
            min="0.01"
            digits={2}
            onChange={(v) => num("max_volume", v)}
          />
          <Field
            label="Riesgo por operación (%)"
            value={form.risk_percent}
            step="0.01"
            min="0.01"
            max="100"
            digits={2}
            onChange={(v) => num("risk_percent", v)}
          />
          <Field
            label="SL por defecto (puntos)"
            value={form.default_sl_points}
            step="1"
            min="0"
            digits={0}
            onChange={(v) => num("default_sl_points", v)}
          />
          <div className="col-span-2">
            <Field
              label="TP por defecto (puntos)"
              value={form.default_tp_points}
              step="1"
              min="0"
              digits={0}
              onChange={(v) => num("default_tp_points", v)}
            />
          </div>
        </div>

        <p className="text-xs leading-relaxed text-muted">
          Con riesgo al {form.risk_percent}% y SL de {form.default_sl_points} puntos, el lote
          estimado es <span className="font-mono text-fg">{number(estimated, 2)}</span>. El
          volumen nunca supera el máximo.
        </p>

        <Button type="submit">Guardar ajustes</Button>
      </form>
    </article>
  );
}

function Field({
  label,
  value,
  onChange,
  step,
  min,
  max,
  digits,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
  step: string;
  min: string;
  max?: string;
  digits: number;
}) {
  return (
    <label className="grid gap-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        value={Number(value).toFixed(digits)}
        onChange={(e) => onChange(e.target.value)}
        required
        className="font-mono tabular"
      />
    </label>
  );
}

export function SignalTester() {
  const send = useBridge((s) => s.sendSignal);

  async function fire(action: "BUY" | "SELL" | "CLOSE_SYMBOL") {
    const result = await send(action);
    toast[result.ok ? "success" : "error"](result.message);
  }

  return (
    <article className="panel rounded-lg p-4 sm:p-5">
      <p className="text-[11px] font-medium tracking-[0.14em] text-muted uppercase">Webhook</p>
      <h2 className="mb-1 font-display text-base tracking-tight">Probar señal</h2>
      <p className="mb-4 text-xs leading-relaxed text-muted">
        Envía una orden manual al motor real del bridge usando la misma lógica de ejecución que
        recibe TradingView.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" onClick={() => fire("BUY")}>
          BUY XAUUSD
        </Button>
        <Button type="button" variant="secondary" onClick={() => fire("SELL")}>
          SELL XAUUSD
        </Button>
        <Button type="button" variant="outline" onClick={() => fire("CLOSE_SYMBOL")}>
          CLOSE_SYMBOL
        </Button>
        <div className="rounded-md bg-bg px-3 py-2 text-[11px] leading-relaxed text-subtle">
          El ID de cada orden manual es único. La protección anti-duplicados se conserva para los
          webhooks de TradingView.
        </div>
      </div>
      <p className="mt-3 text-xs text-subtle">
        CLOSE ALL de emergencia sigue pidiendo confirmación en el panel de riesgo.
      </p>
    </article>
  );
}
