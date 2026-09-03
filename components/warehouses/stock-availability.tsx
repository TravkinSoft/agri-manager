"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { localizeUnit } from "@/lib/i18n/helpers";
import { getInventoryBalances } from "@/lib/services/warehouses";
import { listHarvestBatchSummaries } from "@/lib/services/weighbridge";
import type { HarvestBatchSummary } from "@/lib/types/weighbridge";
import type { InventoryBalance, Warehouse } from "@/lib/types/warehouse";
import { buildStockAvailability } from "@/lib/warehouse/stock-availability";

type Props = {
  companyId: string;
  userId: string;
  language: "ru" | "en" | "kz";
  warehouses: Warehouse[];
  revision: number;
  onOpenBatch: (batch: HarvestBatchSummary) => void;
  onOpenMaterial: (balance: InventoryBalance) => void;
};
type Payload = { scope: string; batches: HarvestBatchSummary[]; balances: InventoryBalance[] };

export function StockAvailability({ companyId, userId, language, warehouses, revision, onOpenBatch, onOpenMaterial }: Props) {
  const scope = `${userId}:${companyId}:${language}`;
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<{ scope: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    // Existing read contracts only: no trips, ledger details or catalog enumeration in the UI.
    Promise.all([
      listHarvestBatchSummaries(companyId, { aggregateLots: true, summaryOnly: true, signal: controller.signal }),
      getInventoryBalances(companyId, language, { signal: controller.signal }),
    ]).then(([batches, balances]) => {
      if (controller.signal.aborted) return;
      setPayload({ scope, batches, balances });
      setError(null);
    }).catch((cause) => {
      if (!controller.signal.aborted) setError({ scope, message: cause instanceof Error ? cause.message : "Не удалось загрузить наличие" });
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [companyId, language, scope, revision, retry]);
  const current = payload?.scope === scope ? payload : null;
  const result = useMemo(() => buildStockAvailability(companyId, warehouses, current?.batches || [], current?.balances || []), [companyId, warehouses, current]);
  if (error?.scope === scope) return <Alert variant="destructive"><AlertDescription>Наличие не подтверждено: {error.message}<Button variant="outline" size="sm" className="ml-3" onClick={() => setRetry((v) => v + 1)}>Повторить</Button></AlertDescription></Alert>;
  if (!current) return <div role="status" className="flex items-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Загрузка текущего наличия...</div>;
  return (
    <section aria-label="Текущее наличие компании" className="space-y-4">
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
