"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Truck, LogOut, Loader2, Plus, Settings2 } from "lucide-react";
import { ROLE_LABEL } from "@/lib/traffic/model";
import type { TrafficVehicle } from "@/lib/traffic/model";
import { TrafficBoard } from "@/components/traffic/traffic-board";
import { trafficRequest, useTraffic } from "@/components/traffic/use-traffic";
import { TrafficPwa } from "@/components/traffic/install-traffic-app";
import { TrafficFleetControls } from "@/components/traffic/traffic-fleet-controls";
import { FleetEntityCreator } from "@/components/traffic/fleet-entity-creator";
import { TrafficShiftControls } from "@/components/traffic/traffic-shift-controls";
import { supabase } from "@/lib/supabase/client";

type CabinetMode = "checking" | "operator" | "manager" | "error";

export default function TrafficOperatorPage() {
  const [mode, setMode] = useState<CabinetMode>("checking");
  const [gateError, setGateError] = useState("");

  const detectCabinet = useCallback(async (): Promise<CabinetMode> => {
    setGateError("");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setMode("operator");
      return "operator";
    }
    try {
      await trafficRequest("/api/traffic?snapshot=1", "GET", undefined, true);
      setMode("manager");
      return "manager";
    } catch (caught) {
      const failure = caught as Error & { status?: number };
      if (failure.status === 401 || failure.status === 403) {
        setMode("operator");
        return "operator";
      }
      setGateError(failure.message || "Не удалось определить рабочий кабинет");
      setMode("error");
      return "error";
    }
  }, []);

  useEffect(() => {
    void detectCabinet();
  }, [detectCabinet]);

  if (mode === "manager") {
    return <TrafficManagerPwa onSignedOut={() => setMode("operator")} />;
  }
  if (mode === "checking") {
    return <TrafficPwaShell><div role="status" className="flex justify-center py-20"><Loader2 className="animate-spin" /><span className="sr-only">Определяем кабинет</span></div></TrafficPwaShell>;
  }
  if (mode === "error") {
    return <TrafficPwaShell><div role="alert" className="py-10 text-amber-200">{gateError}<button type="button" onClick={() => { setMode("checking"); void detectCabinet(); }} className="mt-3 block min-h-[48px] underline">Повторить</button></div></TrafficPwaShell>;
  }
  return <TrafficOperatorCabinet onAuthenticated={detectCabinet} />;
}

function TrafficPwaShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[100dvh] touch-pan-y bg-[#0c1118] px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-slate-100 sm:px-6">
      <TrafficPwa />
      <div className="mx-auto max-w-5xl">{children}</div>
    </main>
  );
}

function TrafficOperatorCabinet({ onAuthenticated }: { onAuthenticated: () => Promise<CabinetMode> }) {
  const live = useTraffic(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      });
      if (authError)
        throw new Error(
          "Не удалось войти. Проверьте приглашённую почту, пароль и подтверждение аккаунта.",
        );
      if ((await onAuthenticated()) === "operator") await live.refresh(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      const { error: authError } = await supabase.auth.signOut({
        scope: "local",
      });
      if (authError) throw authError;
      await live.refresh(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-[100dvh] touch-pan-y bg-[#0c1118] px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-slate-100 sm:px-6">
      <TrafficPwa />
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.2em] text-amber-300">
              TRAVKINFLOW
            </p>
            <h1 className="mt-2 text-2xl font-semibold">
              {live.data ? ROLE_LABEL[live.data.role] : "Оборот машин"}
            </h1>
            {live.data ? (
              <p className="mt-1 text-sm text-slate-500">
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
                className="flex min-h-[48px] items-center gap-2 rounded-xl px-3 text-sm text-slate-400 hover:bg-white/5"
              >
                <LogOut size={16} /> Выйти
              </button>
            </div>
          ) : (
            <Truck className="text-amber-300" size={28} />
          )}
        </header>
        {live.loading || (!live.data && !live.needsLogin && !live.error) ? (
          <div role="status" className="flex justify-center py-20">
            <Loader2 className="animate-spin" />
            <span className="sr-only">Загрузка кабинета</span>
          </div>
        ) : live.needsLogin ? (
          <form
            onSubmit={login}
            className="mx-auto mt-10 max-w-sm rounded-3xl border border-white/10 bg-gradient-to-b from-[#1c2633] to-[#111820] p-6 shadow-2xl"
          >
            <h2 className="text-xl font-semibold">Вход в рабочий кабинет</h2>
            <p className="mb-6 mt-2 text-sm leading-relaxed text-slate-400">
              Войдите с обычной почтой и паролем TravkinFlow. При первом входе
              откройте приглашение администратора на почте и задайте пароль.
            </p>
            <label className="block text-sm text-slate-300">
              Почта
              <input
                name="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                required
                maxLength={254}
                className="mt-2 mb-4 min-h-[48px] w-full rounded-xl border border-white/15 bg-black/20 px-3 text-base text-white outline-none focus:border-amber-400"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Пароль
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                className="mt-2 mb-5 min-h-[48px] w-full rounded-xl border border-white/15 bg-black/20 px-3 text-base text-white outline-none focus:border-amber-400"
              />
            </label>
            {error ? (
              <p role="alert" className="mb-4 text-sm text-rose-300">
                {error}
              </p>
            ) : null}
            <button
              disabled={busy}
              className="min-h-[48px] w-full rounded-xl bg-amber-300 font-semibold text-slate-950 hover:bg-amber-200 disabled:opacity-50"
            >
              {busy ? "Входим…" : "Войти"}
            </button>
            <a
              href="/auth/forgot-password"
              className="mt-2 flex min-h-[48px] items-center justify-center text-sm text-slate-400 underline"
            >
              Забыли пароль?
            </a>
          </form>
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
          <div role="alert" className="py-10 text-amber-200">
            {live.error}
            <button
              type="button"
              onClick={() => void logout()}
              disabled={busy}
              className="mt-3 block min-h-[48px] text-sm text-slate-300 underline"
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
          <p role="alert" className="mt-4 text-rose-300">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}

function TrafficManagerPwa({ onSignedOut }: { onSignedOut: () => void }) {
  const live = useTraffic(true);
  const [selected, setSelected] = useState<TrafficVehicle | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const managed = live.managerData;
  const companyId = live.data?.companyId;

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await supabase.auth.signOut({ scope: "local" });
      onSignedOut();
    } finally {
      setBusy(false);
    }
  }

  return (
    <TrafficPwaShell>
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-amber-300">TRAVKINFLOW</p>
          <h1 className="mt-2 text-2xl font-semibold">Оборот машин</h1>
        </div>
        <button type="button" onClick={() => void logout()} disabled={busy} className="flex min-h-[48px] items-center gap-2 rounded-xl px-3 text-sm text-slate-400 hover:bg-white/5 disabled:opacity-50">
          <LogOut size={16} /> Выйти
        </button>
      </header>
      {live.loading || (!live.data && !live.error) ? (
        <div role="status" className="flex justify-center py-20"><Loader2 className="animate-spin" /><span className="sr-only">Загрузка кабинета</span></div>
      ) : live.data ? (
        <TrafficBoard
          key={live.scopeKey}
          snapshot={live.data}
          stale={live.stale}
          error={live.error}
          refresh={live.refresh}
          onManageVehicle={managed?.canManageRepairs ? setSelected : undefined}
          mobileActions={managed?.canManageRepairs ? (
            <div className="flex items-center">
              {managed.canCreateFleetEntities ? (
                <button type="button" aria-label="Добавить машину или водителя" onClick={() => setCreateOpen(true)} className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-amber-300">
                  <Plus aria-hidden size={22} />
                </button>
              ) : null}
              <button type="button" aria-label="Машины не на линии" onClick={() => setDrawerOpen(true)} className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-slate-200">
                <Settings2 aria-hidden size={20} />
              </button>
            </div>
          ) : undefined}
        />
      ) : (
        <div role="alert" className="py-10 text-amber-200">{live.error}<button type="button" onClick={() => void live.refresh(true)} className="mt-3 block min-h-[48px] underline">Повторить</button></div>
      )}
      {managed && live.data ? (
        <TrafficFleetControls managed={managed} snapshot={live.data} selected={selected} onSelected={setSelected} drawerOpen={drawerOpen} onDrawerOpen={setDrawerOpen} stale={live.stale} refresh={live.refresh} />
      ) : null}
      {managed?.canCreateFleetEntities && companyId ? (
        <FleetEntityCreator open={createOpen} companyId={companyId} onOpenChange={setCreateOpen} onCreated={() => live.refresh(true)} />
      ) : null}
    </TrafficPwaShell>
  );
}
