import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useBridge } from "@/lib/store";

export function RiskPanel() {
  const snap = useBridge((s) => s.snapshot);
  const closeAll = useBridge((s) => s.closeAll);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const ready = confirm.trim().toUpperCase() === "CLOSE ALL";

  async function submit() {
    const result = await closeAll(confirm);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    toast.success(result.message);
    setOpen(false);
    setConfirm("");
    setError("");
  }

  const rows = [
    { label: "Modo de cuenta", value: snap.account.mode, ok: snap.account.mode !== "LIVE" },
    {
      label: "Permiso de trading",
      value: snap.mt5.trade_allowed ? "Permitido en MT5" : "Bloqueado en MT5",
      ok: snap.mt5.trade_allowed,
    },
    {
      label: "Protección demo",
      value: snap.mt5.safety_allowed ? "Activa" : snap.mt5.safety_reason,
      ok: snap.mt5.safety_allowed,
    },
    {
      label: "Última señal",
      value: snap.tradingview.last_result || "Aún no hay señales",
      ok: true,
    },
  ];

  return (
    <aside className="panel flex flex-col rounded-lg p-4 sm:p-5">
      <p className="text-[11px] font-medium tracking-[0.14em] text-muted uppercase">Protección</p>
      <h2 className="mb-4 font-display text-base tracking-tight">Control de riesgo</h2>
      <dl className="mb-5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-b-0"
          >
            <dt className="text-xs text-muted">{row.label}</dt>
            <dd
              className={cn(
                "max-w-[60%] text-right text-xs font-medium",
                row.ok ? "text-fg" : "text-loss",
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <Button
        variant="danger"
        className="mt-auto w-full"
        type="button"
        onClick={() => {
          setConfirm("");
          setError("");
          setOpen(true);
        }}
      >
        Cerrar todas las posiciones
      </Button>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Exige sesión activa y escribir <code className="font-mono text-warn">CLOSE ALL</code> antes
        de enviar la orden.
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <p className="text-[11px] font-medium tracking-[0.14em] text-loss uppercase">
              Acción irreversible
            </p>
            <DialogTitle>¿Cerrar todas las posiciones?</DialogTitle>
            <DialogDescription>
              Se enviará una orden de cierre para cada posición abierta. Esta acción no puede
              deshacerse.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="close-confirmation">
              Escribe <span className="text-fg">CLOSE ALL</span> para confirmar
            </Label>
            <Input
              id="close-confirmation"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="CLOSE ALL"
            />
            {error ? (
              <p className="text-sm text-loss" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="quiet" type="button" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="danger" type="button" disabled={!ready} onClick={submit}>
              Cerrar todo ahora
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
