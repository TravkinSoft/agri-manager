"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createWarehouseTransfer } from "@/lib/services/warehouses";
import type { InventoryBalance, Warehouse, WarehouseTransferResult } from "@/lib/types/warehouse";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  sourceWarehouse: Warehouse | null;
  warehouses: Warehouse[];
  balances: InventoryBalance[];
  onCreated: (result: WarehouseTransferResult) => Promise<void> | void;
};

function formatQuantity(value: number): string {
  return Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

export function WarehouseTransferDialog({
  open,
  onOpenChange,
  companyId,
  sourceWarehouse,
  warehouses,
  balances,
  onCreated,
}: Props) {
  const [destinationId, setDestinationId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDestinationId("");
    setProductId("");
    setQuantity("");
    setNotes("");
    setIdempotencyKey(crypto.randomUUID());
    setError(null);
  }, [open, sourceWarehouse?.id]);

  const materials = useMemo(
    () => balances
      .filter((row) => row.warehouse_id === sourceWarehouse?.id && Number(row.available_quantity ?? row.quantity) > 0.000001)
      .sort((a, b) => a.product_name.localeCompare(b.product_name, "ru")),
    [balances, sourceWarehouse?.id]
  );
  const selected = materials.find((row) => row.product_id === productId) || null;
  const available = Number(selected?.available_quantity ?? selected?.quantity ?? 0);
  const destinations = warehouses.filter((row) => row.id !== sourceWarehouse?.id && !row.archived && !row.is_archived);

  const submit = async () => {
    setError(null);
    const amount = Number(quantity);
    if (!sourceWarehouse || !destinationId || !selected) {
      setError("Выберите склад назначения и материал.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Количество должно быть больше нуля.");
      return;
    }
    if (amount > available + 0.000001) {
      setError(`Недостаточно доступного остатка. Доступно: ${formatQuantity(available)} ${selected.unit}`);
      return;
    }
    setSubmitting(true);
    try {
      const result = await createWarehouseTransfer(
        companyId,
        sourceWarehouse.id,
        {
          destination_warehouse_id: destinationId,
          product_id: selected.product_id,
          quantity: amount,
          notes: notes.trim() || null,
        },
        idempotencyKey
      );
      await onCreated(result);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось провести перемещение");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-yellow-400" />
            Переместить материалы
          </DialogTitle>
          <DialogDescription>Перемещение сразу проводится двумя связанными ledger-записями.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error ? <div className="rounded-md border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</div> : null}

          <div className="space-y-2">
            <Label>Из склада</Label>
            <div className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium">
              {sourceWarehouse?.name || "Склад не выбран"}
            </div>
          </div>

          <div className="space-y-2">
            <Label>В склад *</Label>
            <Select value={destinationId} onValueChange={setDestinationId}>
              <SelectTrigger><SelectValue placeholder="Выберите склад назначения" /></SelectTrigger>
              <SelectContent>
                {destinations.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Материал *</Label>
            <Select value={productId} onValueChange={(value) => { setProductId(value); setQuantity(""); }} disabled={!destinationId}>
              <SelectTrigger><SelectValue placeholder={destinationId ? "Выберите материал" : "Сначала выберите склад назначения"} /></SelectTrigger>
              <SelectContent>
                {materials.map((row) => (
                  <SelectItem key={`${row.product_id}-${row.unit}`} value={row.product_id}>
                    {row.product_name} — доступно {formatQuantity(Number(row.available_quantity ?? row.quantity))} {row.unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {destinationId && materials.length === 0 ? <p className="text-sm text-slate-400">На складе нет доступных материалов для перемещения.</p> : null}
          </div>

          <div className="space-y-2">
            <Label>Доступно</Label>
            <div className="text-sm text-slate-300">{selected ? `${formatQuantity(available)} ${selected.unit}` : "Выберите материал"}</div>
          </div>

          <div className="space-y-2">
            <Label>Количество *</Label>
            <div className="flex items-center gap-2">
              <Input value={quantity} onChange={(event) => setQuantity(event.target.value)} type="number" min="0" step="0.001" disabled={!selected} />
              <span className="w-12 text-sm font-medium">{selected?.unit || "—"}</span>
            </div>
            {selected ? <p className="text-xs text-slate-500">Доступно: {formatQuantity(available)} {selected.unit}</p> : null}
          </div>

          <div className="space-y-2">
            <Label>Комментарий</Label>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Необязательно" />
          </div>

          <div className="space-y-2">
            <Label>Дата и время проведения</Label>
            <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-400">
              <Clock3 className="h-4 w-4" /> Определятся сервером при проведении
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Отмена</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? "Проведение..." : "Переместить"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
