"use client";

import { useEffect, useState } from "react";
import { WEIGHBRIDGE_SERVICE, serviceElapsed } from "@/lib/weighbridge/service-status";

export default function WeighbridgeServicePage() {
  const [elapsed, setElapsed] = useState("—");
  const [connectionLost, setConnectionLost] = useState(false);

  useEffect(() => {
    let stopped = false;
    let serverOffset = 0;
    let startedAt: string = WEIGHBRIDGE_SERVICE.startedAt;
    let pending = false;
    let controller: AbortController | null = null;
    const tick = () => setElapsed(serviceElapsed(Date.now() + serverOffset, startedAt));
    const check = async () => {
      if (pending) return;
      pending = true;
      const requestController = new AbortController();
      controller = requestController;
      const timeout = setTimeout(() => requestController.abort(), 12000);
      try {
        const response = await fetch("/api/weighbridge/service-status", { cache: "no-store", signal: requestController.signal });
        if (!response.ok) throw new Error("service-status");
        const status = await response.json();
        if (stopped) return;
        if (typeof status.active !== "boolean" || !Number.isFinite(status.serverNow)) throw new Error("invalid-status");
        serverOffset = status.serverNow - Date.now();
        if (typeof status.startedAt === "string" && Number.isFinite(Date.parse(status.startedAt))) startedAt = status.startedAt;
        setConnectionLost(false);
        tick();
        if (!status.active) window.location.replace("/weighbridge");
      } catch {
        if (!stopped) setConnectionLost(true);
      } finally {
        clearTimeout(timeout);
        pending = false;
      }
    };
    void check();
    const clock = setInterval(tick, 1000);
    const poll = setInterval(() => void check(), 10000);
    return () => { stopped = true; controller?.abort(); clearInterval(clock); clearInterval(poll); };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section role="alert" aria-labelledby="service-title" className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-xl">
        <p className="mb-3 text-sm text-muted-foreground">TravkinFlow · Весовая</p>
        <h1 id="service-title" className="text-3xl font-semibold">Сервисные работы</h1>
        <p className="mt-5 text-muted-foreground">Проверяем и исправляем работу весовой. Открытие и изменение талонов временно приостановлено.</p>
        <p className="mt-6 text-sm text-muted-foreground">С начала работ прошло</p>
        <p role="timer" className="mt-2 font-mono text-4xl tabular-nums">{elapsed}</p>
        <p className="mt-5 text-sm text-muted-foreground">Это время с начала работ, не обратный отсчёт. Страница откроется автоматически после завершения.</p>
        {connectionLost && <p className="mt-4 text-amber-400">Не удалось проверить окончание работ. Проверяем связь повторно.</p>}
        <a href="/warehouses" className="mt-7 inline-block rounded-lg border border-border px-5 py-3">Перейти к складам</a>
        <p className="mt-4 text-xs text-muted-foreground">Остальные разделы работают. Реальные данные при проверке не изменяются.</p>
      </section>
    </main>
  );
}
