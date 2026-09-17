"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Truck, LogOut, Loader2 } from "lucide-react";
import { ROLE_LABEL } from "@/lib/traffic/model";
import { TrafficBoard } from "@/components/traffic/traffic-board";
import { trafficRequest, useTraffic } from "@/components/traffic/use-traffic";
import { TrafficPwa } from "@/components/traffic/install-traffic-app";
import { TrafficShiftControls } from "@/components/traffic/traffic-shift-controls";
import { supabase } from "@/lib/supabase/client";
import { parseCanonicalRole } from "@/lib/auth/role-contract";
import { getDefaultPathForRole } from "@/lib/auth/role-access";
import { TRAVKINFLOW_2_FUNCTIONS_RELEASED } from "@/lib/travkinflow-2/release";

type CabinetMode = "checking" | "operator" | "redirect" | "error";
const PTC_BOARD_V2 = TRAVKINFLOW_2_FUNCTIONS_RELEASED;
const TRAFFIC_OPERATOR_ROLES = new Set(["mechanic_operator", "vegetable_brigadier"]);

export default function TrafficOperatorPage() {
  const router = useRouter();
  const [mode, setMode] = useState<CabinetMode>("checking");
  const [gateError, setGateError] = useState("");

  const detectCabinet = useCallback(async (): Promise<CabinetMode> => {
    setGateError("");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setMode("redirect");
      router.replace("/auth/login");
      return "redirect";
    }
    try {
      const payload = await trafficRequest("/api/auth/actor", "GET", undefined, true);
      const role = parseCanonicalRole(payload?.actor?.role);
      if (!role) throw new Error("Не удалось определить роль аккаунта");
      if (TRAFFIC_OPERATOR_ROLES.has(role)) {
        setMode("operator");
        return "operator";
      }
      setMode("redirect");
      router.replace(getDefaultPathForRole(role));
      return "redirect";
    } catch (caught) {
      const failure = caught as Error & { status?: number };
      if (failure.status === 401) {
        setMode("redirect");
        router.replace("/auth/login");
        return "redirect";
      }
      setGateError(failure.message || "Не удалось определить рабочий кабинет");
      setMode("error");
      return "error";
    }
  }, [router]);

  useEffect(() => {
    void detectCabinet();
  }, [detectCabinet]);

  if (mode === "checking" || mode === "redirect") {
    if (!PTC_BOARD_V2) {
      return <TrafficPwaShell><div role="status" className="flex justify-center py-20"><Loader2 className="animate-spin" /><span className="sr-only">Определяем кабинет</span></div></TrafficPwaShell>;
    }
    return <TrafficPwaShell>
      <header className="mb-6 border-b border-border pb-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-800">TravkinFlow · полевая линия</p>
        <h1 className="tf-manor-heading mt-1 text-2xl font-semibold tracking-tight">Оборот машин</h1>
      </header>
      <div role="status" className="tf2-panel flex items-center justify-center gap-3 rounded-2xl py-16 text-foreground">
        <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
        <span>{mode === "redirect" ? "Открываем Ваш кабинет…" : "Проверяем рабочую сессию…"}</span>
      </div>
    </TrafficPwaShell>;
  }
  if (mode === "error") {
    if (!PTC_BOARD_V2) {
      return <TrafficPwaShell><div role="alert" className="py-10 text-amber-800">{gateError}<button type="button" onClick={() => { setMode("checking"); void detectCabinet(); }} className="mt-3 block min-h-[48px] underline">Повторить</button></div></TrafficPwaShell>;
    }
    return <TrafficPwaShell>
      <header className="mb-6 border-b border-border pb-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-800">TravkinFlow · полевая линия</p>
        <h1 className="tf-manor-heading mt-1 text-2xl font-semibold tracking-tight">Оборот машин</h1>
      </header>
      <div role="alert" className="tf2-panel rounded-2xl p-5 text-amber-800">
        {gateError}
        <button type="button" onClick={() => { setMode("checking"); void detectCabinet(); }} className="mt-3 block min-h-[48px] underline">Повторить</button>
      </div>
    </TrafficPwaShell>;
  }
  return <TrafficOperatorCabinet />;
}

function TrafficPwaShell({ children }: { children: React.ReactNode }) {
  return (
    <main className={PTC_BOARD_V2
      ? "tf2-shell tf2-traffic-shell min-h-[100dvh] touch-pan-y pb-[max(2.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1.5rem,env(safe-area-inset-top))] text-foreground sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]"
      : "min-h-[100dvh] touch-pan-y bg-card pb-[max(2.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1.5rem,env(safe-area-inset-top))] text-foreground sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]"}>
      <TrafficPwa />
      <div className={PTC_BOARD_V2 ? "mx-auto w-full max-w-6xl" : "mx-auto max-w-5xl"}>{children}</div>
    </main>
  );
}

function TrafficOperatorCabinet() {
  const router = useRouter();
  const live = useTraffic(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (live.needsLogin) router.replace("/auth/login");
  }, [live.needsLogin, router]);

  async function logout() {
    setBusy(true);
    try {
      const { error: authError } = await supabase.auth.signOut({
        scope: "local",
      });
      if (authError) throw authError;
      router.replace("/auth/login");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <TrafficPwaShell>
      {PTC_BOARD_V2 ? (
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-300/10 text-amber-800">
              <Truck aria-hidden size={24} />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-800">
                TravkinFlow · полевая линия
              </p>
              <h1 className="tf-manor-heading mt-0.5 truncate text-2xl font-semibold tracking-tight">
                {live.data ? ROLE_LABEL[live.data.role] : "Оборот машин"}
              </h1>
              {live.data ? (
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {live.data.personName} · рабочая сессия активна
                </p>
              ) : null}
            </div>
          </div>
          {live.data ? (
            <div className="flex items-center gap-1">
              {live.data.role === "harvester" ? (
                <TrafficShiftControls snapshot={live.data} stale={live.stale} refresh={live.refresh} onCommitted={live.auxiliaryCommitted} />
              ) : null}
              <button
                onClick={() => void logout()}
                disabled={busy}
                type="button"
                className="flex min-h-[48px] items-center gap-2 rounded-xl px-3 text-sm text-muted-foreground hover:bg-accent/40"
              >
                <LogOut size={16} /> Выйти
              </button>
            </div>
          ) : null}
        </header>
      ) : (
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.2em] text-amber-800">
              TRAVKINFLOW
            </p>
            <h1 className="tf-manor-heading mt-2 text-2xl font-semibold">
              {live.data ? ROLE_LABEL[live.data.role] : "Оборот машин"}
            </h1>
            {live.data ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {live.data.personName}
              </p>
            ) : null}
          </div>
          {live.data ? (
            <div className="flex items-center gap-1">
              {live.data.role === "harvester" ? (
                <TrafficShiftControls snapshot={live.data} stale={live.stale} refresh={live.refresh} onCommitted={live.auxiliaryCommitted} />
              ) : null}
              <button
                onClick={() => void logout()}
                disabled={busy}
                type="button"
                className="flex min-h-[48px] items-center gap-2 rounded-xl px-3 text-sm text-muted-foreground hover:bg-accent/40"
              >
                <LogOut size={16} /> Выйти
              </button>
            </div>
          ) : (
            <Truck className="text-amber-800" size={28} />
          )}
        </header>
      )}
      {live.loading || (!live.data && !live.needsLogin && !live.error) ? (
        <div role="status" className="flex justify-center py-20">
          <Loader2 aria-hidden={PTC_BOARD_V2 || undefined} className={PTC_BOARD_V2 ? "animate-spin motion-reduce:animate-none" : "animate-spin"} />
          <span className="sr-only">Загрузка кабинета</span>
        </div>
      ) : live.needsLogin ? (
          <div role="status" className="flex items-center justify-center gap-3 py-20 text-muted-foreground">
            <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
            <span>Открываем общую страницу входа…</span>
          </div>
        ) : live.data ? (
          <TrafficBoard
            key={live.scopeKey}
            snapshot={live.data}
            stale={live.stale}
            error={live.error}
            refresh={live.refresh}
            onCommitted={live.applyCommitted}
            onAuxiliaryCommitted={live.auxiliaryCommitted}
          />
        ) : (
          <div role="alert" className="py-10 text-amber-800">
            {live.error}
            <button
              type="button"
              onClick={() => void logout()}
              disabled={busy}
              className="mt-3 block min-h-[48px] text-sm text-foreground underline"
            >
              Выйти и сменить аккаунт
            </button>
            <button
              className="mt-3 block min-h-[48px] underline"
              onClick={() => void live.refresh(true)}
            >
              Повторить
            </button>
          </div>
        )}
        {error && live.data ? (
          <p role="alert" className="mt-4 text-rose-800">
            {error}
          </p>
        ) : null}
    </TrafficPwaShell>
  );
}
