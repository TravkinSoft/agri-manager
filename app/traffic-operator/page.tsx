"use client";
import { useState, type FormEvent } from "react";
import { Truck, LogOut, Loader2 } from "lucide-react";
import { ROLE_LABEL } from "@/lib/traffic/model";
import { TrafficBoard } from "@/components/traffic/traffic-board";
import { useTraffic } from "@/components/traffic/use-traffic";
import { TrafficPwa } from "@/components/traffic/install-traffic-app";
import { supabase } from "@/lib/supabase/client";
export default function TrafficOperatorPage() {
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
      await live.refresh(true);
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
            <button
              onClick={() => void logout()}
              disabled={busy}
              type="button"
              className="flex min-h-[48px] items-center gap-2 rounded-xl px-3 text-sm text-slate-400 hover:bg-white/5"
            >
              <LogOut size={16} /> Выйти
            </button>
          ) : (
            <Truck className="text-amber-300" size={28} />
          )}
        </header>
        {live.loading ? (
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
            snapshot={live.data}
            stale={live.stale}
            error={live.error}
            refresh={live.refresh}
            onCommitted={live.applyCommitted}
          />
        ) : (
          <div role="alert" className="py-10 text-amber-200">
            {live.error || "Не удалось открыть кабинет"}
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
