"use client";

import { memo, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { HarvestOverview } from "@/lib/dashboard/harvest-summary";
import { getHarvestSummary } from "@/lib/services/harvest-dashboard";

export const HarvestDaySummary = memo(function HarvestDaySummary({ companyId }: { companyId: string }) {
  const [dayOffset, setDayOffset] = useState(1);
  const [summary, setSummary] = useState<HarvestOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setSummary(null);
    setError("");
    void getHarvestSummary<HarvestOverview>({ period: "current_day", dayOffset, filters: {} }, { signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) setSummary(next); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось загрузить сводку дня"); });
    return () => controller.abort();
  }, [companyId, dayOffset]);

  const trips = summary?.potatoDrivers.reduce((total, driver) => total + driver.tripCount, 0);
  const movement = summary?.potatoPeriodMovement;
  const tonnes = movement?.netAfterRemovalsKg != null ? `${(movement.netAfterRemovalsKg / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т` : "—";
  return (
    <section aria-labelledby="harvest-day-summary-title" className="overflow-hidden rounded-xl border border-border bg-card/40">
      <header className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4">
        <div>
          <h2 id="harvest-day-summary-title" className="text-sm font-semibold">Сводка за рабочий день</h2>
          <p className="mt-1 min-h-5 text-xs text-muted-foreground">{error || summary?.period.label || "Загрузка…"}</p>
        </div>
        <div className="flex items-center overflow-hidden rounded-lg border border-border" aria-label="Выбор рабочего дня">
          <button type="button" onClick={() => setDayOffset((value) => Math.min(3650, value + 1))} className="flex h-8 w-8 items-center justify-center hover:bg-muted" aria-label="Показать предыдущий рабочий день"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[82px] border-x border-border px-2 text-center text-xs font-semibold">{dayOffset === 0 ? "Сегодня" : dayOffset === 1 ? "Вчера" : `${dayOffset} дн. назад`}</span>
          <button type="button" onClick={() => setDayOffset((value) => Math.max(0, value - 1))} disabled={dayOffset === 0} className="flex h-8 w-8 items-center justify-center hover:bg-muted disabled:opacity-35" aria-label="Показать следующий рабочий день"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </header>
      <div className="grid grid-cols-3 border-t border-border" aria-label="Итоги выбранного рабочего дня">
        {[['Итог по картофелю', tonnes], ['Рейсов', trips ?? '—'], ['Водителей', summary?.potatoDrivers.length ?? '—']].map(([label, value]) => (
          <div key={label} className="min-w-0 border-r border-border px-3 py-2.5 last:border-r-0 sm:px-4"><span className="block text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{label}</span><strong className="mt-1 block text-base tabular-nums">{value}</strong></div>
        ))}
      </div>
      {movement?.removedImpuritiesKg != null ? <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Приход {movement.receivedNetKg.toLocaleString("ru-RU")} кг − вывоз примесей {movement.removedImpuritiesKg.toLocaleString("ru-RU")} кг за выбранный рабочий день.</p> : summary ? <p className="px-3 py-2 text-xs text-muted-foreground">Не удалось определить культуру или источник примесей.</p> : null}
    </section>
  );
});
