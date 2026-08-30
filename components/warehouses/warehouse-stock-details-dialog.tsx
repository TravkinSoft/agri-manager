"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getWarehouseStockDetails } from "@/lib/services/warehouses";
import type { InventoryBalance, WarehouseStockDetails, WarehouseStockLot } from "@/lib/types/warehouse";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  balance: InventoryBalance | null;
};

const detailCache = new Map<string, WarehouseStockDetails>();

function dateOnly(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("ru-RU");
}

function quantity(value: number, unit: string): string {
  return `${Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} ${unit}`;
}

function hasMeaningfulLot(lot: WarehouseStockLot): boolean {
  return Boolean(
    lot.supplier ||
    lot.receipt_no ||
    lot.manufactured_at ||
    lot.expires_at ||
    lot.received_at ||
    (lot.batch_label && !/^(без партии|не указано)$/i.test(lot.batch_label.trim()))
  );
}

export function WarehouseStockDetailsDialog({ open, onOpenChange, companyId, balance }: Props) {
  const [details, setDetails] = useState<WarehouseStockDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheKey = balance
    ? `${companyId}:${balance.warehouse_id}:${balance.product_id}:${balance.unit}:${balance.batch_class || "commodity"}:material`
    : "";

  useEffect(() => {
    if (!open || !balance) return;
    let cancelled = false;
    const cached = detailCache.get(cacheKey) || null;
    setDetails(cached);
    setLoading(!cached);
    setError(null);
    void getWarehouseStockDetails({
      companyId,
      warehouseId: balance.warehouse_id,
      productId: balance.product_id,
      unit: balance.unit,
      batchClass: balance.batch_class || "commodity",
      stockOrigin: "material",
    }).then((value) => {
      detailCache.set(cacheKey, value);
      if (!cancelled) setDetails(value);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Не удалось загрузить детали");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, companyId, balance, cacheKey]);

  const visibleLots = useMemo(
    () => (details?.lots || []).filter(hasMeaningfulLot),
    [details]
  );
  const showBatch = visibleLots.some((lot) => lot.batch_label && !/^(без партии|не указано)$/i.test(lot.batch_label.trim()));
  const showManufactured = visibleLots.some((lot) => lot.manufactured_at);
  const showExpires = visibleLots.some((lot) => lot.expires_at);
  const showSupplier = visibleLots.some((lot) => lot.supplier || lot.receipt_no);
  const showReceived = visibleLots.some((lot) => lot.received_at);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Boxes className="h-5 w-5 text-yellow-400" />{balance?.product_name || "Материал"}</DialogTitle>
          <DialogDescription>Фактический остаток и резерв.</DialogDescription>
        </DialogHeader>
        {loading && !details ? <div className="py-10 text-center text-sm text-slate-400">Загрузка деталей...</div> : null}
        {error ? <div className="rounded-md border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        {details ? (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3 border-y border-slate-800 py-4 text-sm">
              <div><div className="text-slate-500">Всего</div><div className="mt-1 font-semibold">{quantity(details.quantity, details.unit)}</div></div>
              <div><div className="text-slate-500">Доступно</div><div className={`mt-1 font-semibold ${details.available_quantity < 0 ? "text-red-300" : "text-emerald-300"}`}>{quantity(details.available_quantity, details.unit)}</div>{details.deficit_quantity > 0 ? <div className="text-xs text-red-300">Дефицит {quantity(details.deficit_quantity, details.unit)}</div> : null}</div>
              <div><div className="text-slate-500">Резерв</div><div className="mt-1 font-semibold text-amber-300">{quantity(details.reserved_quantity, details.unit)}</div></div>
            </div>

            {details.reservations.length ? (
              <section>
                <h3 className="mb-2 font-semibold">Резервы</h3>
                <div className="space-y-2">
                  {details.reservations.map((reservation) => (
                    <div key={`${reservation.request_id}-${reservation.quantity}`} className="grid gap-1 border-t border-slate-800 py-2 text-sm sm:grid-cols-[150px_1fr_120px]">
                      <span className="font-medium">{reservation.request_number}</span>
                      <span>{[reservation.operation, reservation.field].filter(Boolean).join(" · ")}</span>
                      <span className="text-right text-amber-300">{quantity(reservation.quantity, details.unit)}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {visibleLots.length ? (
              <section>
                <h3 className="mb-2 font-semibold">Поставочные партии</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-slate-500">
                      <tr>
                        {showBatch ? <th className="py-2">Партия / серия</th> : null}
                        <th className="py-2">Остаток</th>
                        {showManufactured ? <th>Производство</th> : null}
                        {showExpires ? <th>Годен до</th> : null}
                        {showSupplier ? <th>Поставщик / приход</th> : null}
                        {showReceived ? <th>Дата прихода</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleLots.map((lot) => (
                        <tr key={lot.key} className="border-t border-slate-800">
                          {showBatch ? <td className="py-2 font-medium">{lot.batch_label || "—"}</td> : null}
                          <td className="py-2">{quantity(lot.quantity, details.unit)}</td>
                          {showManufactured ? <td>{dateOnly(lot.manufactured_at) || "—"}</td> : null}
                          {showExpires ? <td>{dateOnly(lot.expires_at) || "—"}</td> : null}
                          {showSupplier ? <td>{[lot.supplier, lot.receipt_no].filter(Boolean).join(" · ") || "—"}</td> : null}
                          {showReceived ? <td>{dateOnly(lot.received_at) || "—"}</td> : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
