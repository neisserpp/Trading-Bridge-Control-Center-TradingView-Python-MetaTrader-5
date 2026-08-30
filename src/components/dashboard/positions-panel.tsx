import { useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { money, number, signedMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBridge } from "@/lib/store";
import type { Position } from "@/lib/types";

export function PositionsPanel() {
  const snap = useBridge((s) => s.snapshot);
  const closePosition = useBridge((s) => s.closePosition);
  const [target, setTarget] = useState<Position | null>(null);
  const ccy = snap.account.currency;

  async function confirmClose() {
    if (!target) return;
    const result = await closePosition(target.ticket);
    toast[result.ok ? "success" : "error"](result.message);
    if (result.ok) setTarget(null);
  }

  return (
    <article className="panel flex min-w-0 flex-col rounded-lg p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-[0.14em] text-muted uppercase">En mercado</p>
          <h2 className="font-display text-base tracking-tight">Posiciones abiertas</h2>
        </div>
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-surface-2 px-2 text-xs font-medium text-accent">
          {snap.position_totals.count}
        </span>
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="text-[11px] tracking-wide text-muted uppercase">
              <th className="pb-2 font-medium">Símbolo</th>
              <th className="pb-2 font-medium">Dir.</th>
              <th className="pb-2 font-medium">Vol.</th>
              <th className="pb-2 font-medium">Entrada / actual</th>
              <th className="pb-2 font-medium">SL / TP</th>
              <th className="pb-2 text-right font-medium">P&L</th>
              <th className="pb-2 font-medium">
                <span className="sr-only">Cerrar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {snap.positions.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm text-muted">
                  No hay posiciones abiertas.
                </td>
              </tr>
            ) : (
              snap.positions.map((pos) => (
                <tr key={pos.ticket} className="border-t border-border">
                  <td className="py-3 pr-2">
                    <p className="font-medium">{pos.symbol}</p>
                    <p className="font-mono text-[11px] text-muted">#{pos.ticket}</p>
                  </td>
                  <td className="py-3 pr-2">
                    <Badge variant={pos.side === "BUY" ? "buy" : "sell"}>{pos.side}</Badge>
                  </td>
                  <td className="py-3 pr-2 font-mono tabular">{number(pos.volume, 2)}</td>
                  <td className="py-3 pr-2 font-mono text-xs tabular">
                    {number(pos.price_open, 2)}
                    <span className="mt-0.5 block text-muted">{number(pos.price_current, 2)}</span>
                  </td>
                  <td className="py-3 pr-2 font-mono text-xs tabular">
                    {number(pos.sl, 2)}
                    <span className="mt-0.5 block text-muted">{number(pos.tp, 2)}</span>
                  </td>
                  <td
                    className={cn(
                      "py-3 pr-2 text-right font-mono text-sm font-medium tabular",
                      pos.profit >= 0 ? "text-profit" : "text-loss",
                    )}
                  >
                    {signedMoney(pos.profit, ccy)}
                    <span className="mt-0.5 block text-[11px] font-normal text-muted">
                      Swap {number(pos.swap, 2)}
                    </span>
                  </td>
                  <td className="py-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      aria-label={`Cerrar posición ${pos.ticket}`}
                      onClick={() => setTarget(pos)}
                    >
                      <X className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted">
        Neto {number(snap.position_totals.net_lots, 2)} lotes · exposición{" "}
        {money(snap.position_totals.exposure, ccy)}
      </p>

      <Dialog open={Boolean(target)} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar posición #{target?.ticket}</DialogTitle>
            <DialogDescription>
              Se enviará una orden de mercado para {target?.side} {target?.symbol}{" "}
              {target ? number(target.volume, 2) : ""} lotes. El P&L flotante se realizará al
              precio actual.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="quiet" type="button" onClick={() => setTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" type="button" onClick={confirmClose}>
              Cerrar ahora
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
