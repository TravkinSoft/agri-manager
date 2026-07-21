"use client";

import { useEffect, useState } from "react";
import { Boxes } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getWarehouseStockDetails } from "@/lib/services/warehouses";
import type { InventoryBalance, WarehouseStockDetails } from "@/lib/types/warehouse";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  balance: InventoryBalance | null;
};

function formatDate(value?: string | null): string {
  if (!value) return "Не указано";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Не указано" : date.toLocaleString("ru-RU");
}

function quantity(value: number, unit: string): string {
  return `${Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} ${unit}`;
}

const movementLabels: Record<string, string> = {
  supplier_receipt_in: "Приход",
  warehouse_inventory_adjustment: "Инвентаризация",
  warehouse_transfer: "Перемещение",
  material_issue: "Выдача",
  material_return: "Возврат",
  material_loss: "Потери",
};

function movementLabel(reasonType?: string | null, movementType?: string | null): string {
  const value = reasonType || movementType || "Движение";
  return movementLabels[value] || value.replaceAll("_", " ");
}

export function WarehouseStockDetailsDialog({ open, onOpenChange, companyId, balance }: Props) {
  const [details, setDetails] = useState<WarehouseStockDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !balance) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetails(null);
    void getWarehouseStockDetails({
      companyId,
      warehouseId: balance.warehouse_id,
      productId: balance.product_id,
      unit: balance.unit,
    }).then((value) => {
      if (!cancelled) setDetails(value);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Не удалось загрузить детали");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, companyId, balance]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Boxes className="h-5 w-5 text-yellow-400" />{balance?.product_name || "Материал"}</DialogTitle>
          <DialogDescription>Фактический остаток, резерв, партии и последние ledger-движения.</DialogDescription>
        </DialogHeader>
        {loading ? <div className="py-10 text-center text-sm text-slate-400">Загрузка деталей...</div> : null}
        {error ? <div className="rounded-md border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        {details ? (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3 border-y border-slate-800 py-4 text-sm">
              <div><div className="text-slate-500">Всего</div><div className="mt-1 font-semibold">{quantity(details.quantity, details.unit)}</div></div>
              <div><div className="text-slate-500">Доступно</div><div className="mt-1 font-semibold text-emerald-300">{quantity(details.available_quantity, details.unit)}</div></div>
              <div><div className="text-slate-500">Зарезервировано</div><div className="mt-1 font-semibold text-amber-300">{quantity(details.reserved_quantity, details.unit)}</div></div>
            </div>

            <section>
              <h3 className="mb-2 font-semibold">Партии</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-slate-500"><tr><th className="py-2">Партия / серия</th><th>Остаток</th><th>Производство</th><th>Годен до</th><th>Поставщик / приход</th></tr></thead>
                  <tbody>
                    {details.lots.length ? details.lots.map((lot) => (
                      <tr key={lot.key} className="border-t border-slate-800">
                        <td className="py-2 font-medium">{lot.batch_label}</td>
                        <td>{quantity(lot.quantity, details.unit)}</td>
                        <td>{formatDate(lot.manufactured_at).split(",")[0]}</td>
                        <td>{formatDate(lot.expires_at).split(",")[0]}</td>
                        <td>{lot.supplier || "Не указан"}{lot.receipt_no ? ` · ${lot.receipt_no}` : ""}<div className="text-xs text-slate-500">{formatDate(lot.received_at)}</div></td>
                      </tr>
                    )) : <tr><td colSpan={5} className="border-t border-slate-800 py-5 text-center text-slate-500">Партии не найдены</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 className="mb-2 font-semibold">Последние движения</h3>
              <div className="space-y-2">
                {details.movements.length ? details.movements.map((movement) => (
                  <div key={movement.id} className="grid gap-1 border-t border-slate-800 py-2 text-sm sm:grid-cols-[170px_1fr_120px]">
                    <span className="text-slate-500">{formatDate(movement.operation_datetime || movement.created_at)}</span>
                    <span>{movementLabel(movement.reason_type, movement.movement_type)}</span>
                    <span className={Number(movement.quantity_delta || 0) >= 0 ? "text-emerald-300" : "text-red-300"}>
                      {Number(movement.quantity_delta || 0) > 0 ? "+" : ""}{quantity(Number(movement.quantity_delta || 0), details.unit)}
                    </span>
                  </div>
                )) : <div className="text-sm text-slate-500">Движений нет</div>}
              </div>
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
