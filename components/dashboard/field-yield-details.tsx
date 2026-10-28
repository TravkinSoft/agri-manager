"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getHarvestSummary } from "@/lib/services/harvest-dashboard";
import type { HarvestOverview } from "@/lib/dashboard/harvest-summary";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { summaryKg } from "@/lib/dashboard/operational-summary";

const TABLES = ["tickets", "stock_ledger_entries", "weighbridge_active_harvests"];
/** Preserve the existing verified yield view, but load it only when requested. */
export function FieldYieldDetails({ companyId, enabled }: { companyId: string; enabled: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<HarvestOverview | null>(null);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!enabled || !expanded || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const result = await getHarvestSummary<HarvestOverview>({ period: "current_day", start: null, end: null, filters: {}, includeDriverStats: false }, { signal: controller.signal });
      if (!controller.signal.aborted) { setData(result); setError(false); }
    } catch (reason) { if (request.current === controller) {
      if ([401, 403].includes(Number((reason as { status?: number }).status))) setData(null);
      setError(true);
    } }
    finally { window.clearTimeout(timer); if (request.current === controller) request.current = null; }
  }, [enabled, expanded]);
  useEffect(() => { void load(); return () => { request.current?.abort(); request.current = null; }; }, [load]);
  useLiveRefresh({ enabled: enabled && expanded, companyId, tables: TABLES, intervalMs: 30_000, onRefresh: load });
  return <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className="rounded-lg border border-border p-3">
    <summary className="cursor-pointer text-sm font-medium">Урожайность по полям</summary>
    {expanded ? <div className="mt-3 space-y-3">
      {error ? <p role="status" className="text-xs text-amber-700 dark:text-amber-300">Не удалось обновить урожайность. {data ? "Показаны последние полученные данные." : "Повторим автоматически."}</p> : null}
      {!data && !error ? <p className="text-xs text-muted-foreground">Загружаем подтверждённые данные…</p> : null}
      {data?.harvestPlots.map(plot => <article key={plot.cropStructureAllocationId} className="border-t border-border pt-3 text-xs">
        <h3 className="font-semibold">{plot.fieldName} · {plot.areaHa} га · {plot.varietyName} · {plot.reproductionName}</h3>
        <div className="mt-2 flex flex-wrap justify-between gap-2"><span>Чистый картофель с поля: {summaryKg(plot.totalAcceptedKg)}</span>
          <strong>{plot.areaPending || plot.areaIssue || plot.yieldTPerHa == null ? "Урожайность пока не определена" : `${plot.yieldTPerHa.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} т/га`}</strong></div>
        <p className="mt-1 text-muted-foreground">{plot.areaIssue || (plot.areaPending || plot.harvestedAreaHa == null ? "Ожидаем закрытия смены и подтверждения убранных гектаров." : `Подтверждено ${plot.harvestedAreaHa.toLocaleString("ru-RU")} га. Чистая масса с поля ÷ подтверждённые гектары.`)}</p>
      </article>)}
    </div> : null}
  </details>;
}
