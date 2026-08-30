import { TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBridge } from "@/lib/store";

export function AlertsBanner() {
  const generatedAt = useBridge((s) => s.snapshot.generated_at);
  const alerts = useBridge((s) => s.engine.alerts);
  const dismiss = useBridge((s) => s.dismissAlert);
  const dismissAll = useBridge((s) => s.dismissAllAlerts);
  const visible = alerts.filter((a) => !a.dismissed);
  void generatedAt;

  if (visible.length === 0) return null;

  return (
    <section aria-label="Alertas de error" className="grid gap-2">
      {visible.slice(0, 3).map((alert) => (
        <article
          key={alert.id}
          className={cn(
            "flex items-start gap-3 rounded-md px-3.5 py-3",
            alert.level === "error"
              ? "bg-loss/10 shadow-[0_0_0_1px_rgba(209,93,108,0.28)]"
              : "bg-warn/10 shadow-[0_0_0_1px_rgba(196,161,90,0.28)]",
          )}
        >
          <TriangleAlert
            className={cn(
              "mt-0.5 size-4 shrink-0",
              alert.level === "error" ? "text-loss" : "text-warn",
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{alert.title}</p>
            <p className="text-xs text-muted">
              {alert.detail} · {formatDate(alert.time)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Descartar alerta"
            onClick={() => dismiss(alert.id)}
          >
            <X className="size-4" />
          </Button>
        </article>
      ))}
      {visible.length > 1 ? (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={dismissAll}>
            Descartar todas ({visible.length})
          </Button>
        </div>
      ) : null}
    </section>
  );
}
