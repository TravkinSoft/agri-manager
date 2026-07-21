"use client";

import { useEffect, useMemo, useState } from "react";
import { PackageOpen, Search, Warehouse } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { listHarvestBatchSummaries } from "@/lib/services/weighbridge";
import type { HarvestBatchSummary } from "@/lib/types/weighbridge";

const kg = (value: number) => `${Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг`;
const rate = (value: number | null) => value == null ? "—" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т/га`;

export function HarvestWarehousesReadonly({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<HarvestBatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listHarvestBatchSummaries(companyId)
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Не удалось загрузить партии урожая"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  const filtered = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return rows;
    return rows.filter((row) => `${row.warehouseName} ${row.batchCode} ${row.productName} ${row.cropName} ${row.varietyName} ${row.fieldName}`.toLowerCase().includes(value));
  }, [rows, search]);

  const groups = useMemo(() => {
    const map = new Map<string, { warehouseName: string; batches: HarvestBatchSummary[] }>();
    for (const row of filtered) {
      const current = map.get(row.warehouseId) || { warehouseName: row.warehouseName, batches: [] };
      current.batches.push(row);
      map.set(row.warehouseId, current);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="space-y-5">
      <PageHeader title="Склады" description="Партии урожая и чистая масса">
        <Badge variant="outline">Только просмотр</Badge>
      </PageHeader>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
        <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти склад, партию или культуру" />
      </div>
      {loading ? <div className="py-12 text-center text-sm text-slate-400">Загрузка партий урожая...</div> : null}
      {!loading && !error && groups.length === 0 ? (
        <div className="border-y border-slate-800 py-12 text-center text-sm text-slate-400">Принятые партии урожая не найдены.</div>
      ) : null}
      <div className="space-y-4">
        {groups.map(([warehouseId, group]) => (
          <section key={warehouseId} className="space-y-3">
            <div className="flex items-center gap-2">
              <Warehouse className="h-5 w-5 text-yellow-400" />
              <h2 className="text-lg font-semibold">{group.warehouseName}</h2>
              <Badge className="bg-slate-800 text-slate-200">{group.batches.length}</Badge>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {group.batches.map((batch) => (
                <Card key={batch.id} className="rounded-md border-slate-800 bg-slate-900/60">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-start justify-between gap-3 text-base">
                      <span className="flex min-w-0 items-center gap-2"><PackageOpen className="h-4 w-4 shrink-0 text-emerald-400" /><span className="truncate">{batch.cropName} / {batch.varietyName}</span></span>
                      <Badge variant="outline" className="shrink-0">{batch.batchCode}</Badge>
                    </CardTitle>
                    <div className="text-sm text-slate-400">{batch.fieldName} · {batch.reproductionName}</div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div><div className="text-slate-500">Принято</div><div className="mt-1 font-semibold">{kg(batch.receivedKg)}</div></div>
                      <div><div className="text-slate-500">Вывезено примесей</div><div className="mt-1 font-semibold text-amber-300">{kg(batch.removedKg)}</div></div>
                      <div><div className="text-slate-500">Чистая масса</div><div className="mt-1 font-semibold text-emerald-300">{kg(batch.cleanMassKg)}</div></div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 border-t border-slate-800 pt-3 text-xs">
                      <div><span className="text-slate-500">Примеси</span><div className="mt-1 font-medium">{batch.impurityPercent.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}%</div></div>
                      <div><span className="text-slate-500">Валовая урожайность</span><div className="mt-1 font-medium">{rate(batch.grossYieldTPerHa)}</div></div>
                      <div><span className="text-slate-500">Чистая урожайность</span><div className="mt-1 font-medium">{rate(batch.cleanYieldTPerHa)}</div></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
