"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronUp, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { localizeUnit } from "@/lib/i18n/helpers";
import { getInventoryBalances } from "@/lib/services/warehouses";
import { listHarvestBatchSummaries } from "@/lib/services/weighbridge";
import type { HarvestBatchSummary } from "@/lib/types/weighbridge";
import type { InventoryBalance, Warehouse } from "@/lib/types/warehouse";
import { buildStockAvailability } from "@/lib/warehouse/stock-availability";
import { readErrorMessage, ScopedReadResource } from "@/lib/utils/scoped-read-resource";
import { compactReproductionLabel } from "@/lib/agronomy/reproduction-display";

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
  if (placesLoading) return <div role="status" className="py-8 text-sm text-muted-foreground">Загрузка объектов...</div>;
  if (!current) return errorNotice || <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загрузка текущего наличия...</div>;
  return (
    <section aria-label="Текущее наличие компании" className="space-y-4">
      {errorNotice}
      {loading ? <div role="status" className="text-xs text-muted-foreground">Обновляем наличие...</div> : null}
      {result.anomalies.length ? <Alert variant="destructive"><AlertDescription><div className="font-medium">Есть расхождения — положительные остатки ниже не являются полным итогом.</div><ul className="mt-2 space-y-1">{result.anomalies.map((item, index) => <li key={`${item.key}:${index}`}>{item.message}</li>)}</ul></AlertDescription></Alert> : null}
      {!result.crops.length && !result.anomalies.length ? <p className="py-8 text-sm text-muted-foreground">Продукции в наличии нет.</p> : null}
      {result.crops.map((crop) => (
        <details key={crop.key} open className="group/crop border-b border-border last:border-0" aria-label={crop.name}>
          <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 py-2 marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <h2 className="text-base font-semibold text-foreground">{crop.name}</h2>
            <span className="flex items-center gap-3"><strong className="tabular-nums text-emerald-800">{crop.identities.reduce((total, identity) => total + identity.quantity, 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} {localizeUnit(crop.identities[0]?.unit || "kg", language)}</strong><ChevronUp className="h-4 w-4 text-muted-foreground transition-transform duration-150 group-open/crop:rotate-180" /></span>
          </summary>
          <div className="pb-3">
            <div className="hidden grid-cols-[minmax(180px,1fr)_90px_130px] gap-3 border-b border-border pb-2 text-[10px] uppercase tracking-[0.1em] text-muted-foreground sm:grid"><span>Сорт</span><span>Репр.</span><span className="text-right">В наличии</span></div>
            {crop.identities.map((identity) => {
              const [variety = "Сорт не указан", reproduction = "—"] = identity.label.split(" · ");
              const normalizedReproduction = compactReproductionLabel(reproduction);
              return (
                <details key={identity.key} className="group/identity border-b border-border/70 last:border-0">
                  <summary className="grid min-h-[48px] cursor-pointer list-none grid-cols-[minmax(64px,1fr)_84px_112px] items-center gap-2 py-2 text-sm transition-colors hover:text-[color:var(--manor-brass-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring marker:hidden sm:grid-cols-[minmax(180px,1fr)_90px_130px] sm:gap-3">
                    <span className="flex min-w-0 items-center gap-2"><ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open/identity:rotate-180" /><span className="truncate">{variety}</span></span>
                    <span className="whitespace-nowrap text-xs text-muted-foreground sm:text-sm">{normalizedReproduction}</span>
                    <strong className="whitespace-nowrap text-right text-sm tabular-nums text-emerald-800">{identity.quantity.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} {localizeUnit(identity.unit, language)}</strong>
                  </summary>
                  <div className="pb-1 pl-6">
                    {identity.positions.map((position) => <button key={position.key} type="button" className="flex min-h-[42px] w-full items-center justify-between gap-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => position.batch ? onOpenBatch(position.batch) : position.material && onOpenMaterial(position.material)}>
                      <span>{position.warehouseName}</span><span className="shrink-0 tabular-nums">{position.quantity.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} {localizeUnit(identity.unit, language)}</span>
                    </button>)}
                  </div>
                </details>
              );
            })}
          </div>
        </details>
      ))}
    </section>
  );
}
