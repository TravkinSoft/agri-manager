"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { localizeUnit } from "@/lib/i18n/helpers";
import { getInventoryBalances } from "@/lib/services/warehouses";
import { listHarvestBatchSummaries } from "@/lib/services/weighbridge";
import type { HarvestBatchSummary } from "@/lib/types/weighbridge";
import type { InventoryBalance, Warehouse } from "@/lib/types/warehouse";
import { buildStockAvailability } from "@/lib/warehouse/stock-availability";
import { readErrorMessage, ScopedReadResource } from "@/lib/utils/scoped-read-resource";

type Props = {
  companyId: string;
  userId: string;
  actorScope: string;
  active: boolean;
  placesLoading: boolean;
  refreshTick: number;
  language: "ru" | "en" | "kz";
  warehouses: Warehouse[];
  revision: number;
  onOpenBatch: (batch: HarvestBatchSummary) => void;
  onOpenMaterial: (balance: InventoryBalance) => void;
};
type Payload = { scope: string; batches: HarvestBatchSummary[]; balances: InventoryBalance[] };

export function StockAvailability({ companyId, userId, actorScope, active, placesLoading, refreshTick, language, warehouses, revision, onOpenBatch, onOpenMaterial }: Props) {
  const scope = `${userId}:${actorScope}:${companyId}:${language}`;
  // This component stays mounted while changing views. A changed actor/tenant
  // gets a different resource immediately, before any effect can render old data.
  const { resource } = useMemo(() => ({ scope, resource: new ScopedReadResource<Payload>() }), [scope]);
  const { data: payload, error, loading } = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  const [retry, setRetry] = useState(0);
  const lastLoad = useRef({ resource, revision, retry });
  useEffect(() => () => resource.cancel(), [resource]);
  useEffect(() => {
    if (!active) return;
    const previous = lastLoad.current;
    const force = previous.resource === resource && (previous.revision !== revision || previous.retry !== retry);
    lastLoad.current = { resource, revision, retry };
    // Existing read contracts only: no trips, ledger details or catalog enumeration in the UI.
    void resource.request(async (signal) => {
      const [batches, balances] = await Promise.all([
        listHarvestBatchSummaries(companyId, { aggregateLots: true, summaryOnly: true, signal }),
        getInventoryBalances(companyId, language, { signal }),
      ]);
      return { scope, batches, balances };
    }, force);
    // View/focus/poll changes join in-flight work; only actor change/unmount cancels it.
  }, [active, companyId, language, resource, scope, revision, retry, refreshTick]);
  const current = payload?.scope === scope ? payload : null;
  const result = useMemo(() => buildStockAvailability(companyId, warehouses, current?.batches || [], current?.balances || []), [companyId, warehouses, current]);
  const errorNotice = error ? <Alert variant="destructive"><AlertDescription>Наличие не подтверждено: {readErrorMessage(error, "Остатки")}{current ? " Ниже — последние загруженные данные." : ""}<Button variant="outline" size="sm" className="ml-3" onClick={() => setRetry((v) => v + 1)}>Повторить</Button></AlertDescription></Alert> : null;
  if (placesLoading) return <div role="status" className="py-8 text-sm text-slate-400">Загрузка объектов...</div>;
  if (!current) return errorNotice || <div role="status" className="flex items-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Загрузка текущего наличия...</div>;
  return (
    <section aria-label="Текущее наличие компании" className="space-y-4">
      {errorNotice}
      {loading ? <div role="status" className="text-xs text-slate-400">Обновляем наличие...</div> : null}
      {result.anomalies.length ? <Alert variant="destructive"><AlertDescription><div className="font-medium">Есть расхождения — положительные остатки ниже не являются полным итогом.</div><ul className="mt-2 space-y-1">{result.anomalies.map((item, index) => <li key={`${item.key}:${index}`}>{item.message}</li>)}</ul></AlertDescription></Alert> : null}
      {!result.crops.length && !result.anomalies.length ? <p className="py-8 text-sm text-slate-400">Продукции в наличии нет.</p> : null}
      {result.crops.map((crop) => (
        <section key={crop.key} className="border-b border-slate-800/70 pb-3 last:border-0" aria-label={crop.name}>
          <h2 className="mb-1 text-base font-semibold text-slate-100">{crop.name}</h2>
          {crop.identities.map((identity) => (
            <details key={identity.key} className="group/identity">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-slate-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 marker:hidden">
                <span className="flex min-w-0 items-center gap-2 text-slate-300"><ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open/identity:rotate-180" /><span>{identity.label}</span></span>
                <strong className="shrink-0 tabular-nums text-emerald-300">{identity.quantity.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} {localizeUnit(identity.unit, language)}</strong>
              </summary>
              <div className="ml-3 border-l border-slate-700/70 py-1 pl-3 sm:ml-5">
                {identity.positions.map((position) => <button key={position.key} type="button" className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-slate-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400" onClick={() => position.batch ? onOpenBatch(position.batch) : position.material && onOpenMaterial(position.material)}>
                  <span className="text-slate-300">{position.warehouseName}</span><span className="shrink-0 tabular-nums text-slate-100">{position.quantity.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} {localizeUnit(identity.unit, language)}</span>
                </button>)}
              </div>
            </details>
          ))}
        </section>
      ))}
    </section>
  );
}
