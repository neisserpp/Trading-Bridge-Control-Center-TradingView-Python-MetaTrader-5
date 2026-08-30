import { FormEvent, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBridge } from "@/lib/store";

export function LoginGate() {
  const login = useBridge((s) => s.login);
  const loginError = useBridge((s) => s.loginError);
  const [value, setValue] = useState("");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    login(value);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <form
        onSubmit={onSubmit}
        className="panel w-full max-w-md rounded-xl p-6 sm:p-8"
        aria-labelledby="login-title"
      >
        <div className="mb-6 flex size-11 items-center justify-center rounded-md bg-surface-2 text-accent shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
          <LockKeyhole className="size-5" />
        </div>
        <p className="mb-2 text-[11px] font-medium tracking-[0.16em] text-muted uppercase">
          Acceso local protegido
        </p>
        <h1 id="login-title" className="font-display text-2xl tracking-tight text-fg">
          Trading Bridge
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Panel de control TradingView → MT5. Introduce la contraseña del dashboard — nunca la
          de tu bróker.
        </p>

        <div className="mt-6 grid gap-2">
          <Label htmlFor="dashboard-password">Contraseña</Label>
          <Input
            id="dashboard-password"
            type="password"
            autoComplete="current-password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            autoFocus
          />
        </div>

        <p className="mt-2 min-h-5 text-sm text-loss" role="alert">
          {loginError}
        </p>

        <Button type="submit" className="mt-3 w-full">
          Entrar al dashboard
        </Button>

        <p className="mt-5 text-xs leading-relaxed text-subtle">
          El acceso se valida directamente contra el bridge Python local. No introduzcas aquí la
          contraseña de tu cuenta de MetaTrader 5.
        </p>
      </form>
    </div>
  );
}
