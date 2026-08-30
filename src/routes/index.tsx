import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/dashboard/shell";
import { LoginGate } from "@/components/dashboard/login-gate";
import { useBridge } from "@/lib/store";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const authenticated = useBridge((s) => s.authenticated);
  const ready = useBridge((s) => s.ready);
  const checkSession = useBridge((s) => s.checkSession);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg text-sm text-muted">
        Conectando con el bridge…
      </div>
    );
  }

  return authenticated ? <DashboardShell /> : <LoginGate />;
}
