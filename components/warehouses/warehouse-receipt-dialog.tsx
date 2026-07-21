"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, PackagePlus, Plus, Trash2 } from "lucide-react";
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
import { createWarehouseReceipt } from "@/lib/services/warehouses";
import type { Product, Warehouse, WarehouseReceiptLineInput } from "@/lib/types/warehouse";

interface ReceiptLineDraft extends WarehouseReceiptLineInput {
  key: string;
}

interface WarehouseReceiptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  warehouses: Warehouse[];
  products: Product[];
  defaultWarehouseId?: string | null;
  onCreated: (receipt: { receipt_id: string; receipt_no: string }) => Promise<void> | void;
}

function newLine(): ReceiptLineDraft {
  return {
    key: crypto.randomUUID(),
    product_id: "",
    quantity: 0,
    uom: "kg",
    lot_number: "",
    manufactured_at: "",
    expires_at: "",
    package_count: null,
    package_size: null,
    notes: "",
  };
}

export function WarehouseReceiptDialog({
  open,
  onOpenChange,
  companyId,
  warehouses,
  products,
  defaultWarehouseId,
  onCreated,
}: WarehouseReceiptDialogProps) {
  const [warehouseId, setWarehouseId] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [supplier, setSupplier] = useState("");
  const [documentNo, setDocumentNo] = useState("");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<ReceiptLineDraft[]>([newLine()]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    setWarehouseId(defaultWarehouseId || warehouses[0]?.id || "");
    setReceivedAt(local);
    setSupplier("");
    setDocumentNo("");
    setNotes("");
    setSearch("");
    setLines([newLine()]);
    setIdempotencyKey(crypto.randomUUID());
    setError(null);
  }, [open, defaultWarehouseId, warehouses]);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) =>
      [product.name, ...(product.aliases || [])].join(" ").toLowerCase().includes(query)
    );
  }, [products, search]);

  const updateLine = (key: string, patch: Partial<ReceiptLineDraft>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const selectProduct = (key: string, productId: string) => {
    const product = products.find((row) => row.id === productId);
    updateLine(key, {
      product_id: productId,
      uom: String(product?.base_uom || product?.unit || "kg").toLowerCase(),
    });
  };

  const submit = async () => {
    setError(null);
    if (!warehouseId || !receivedAt || !supplier.trim()) {
      setError("Укажите склад, дату прихода и поставщика.");
      return;
    }
    if (lines.some((line) => !line.product_id || Number(line.quantity) <= 0)) {
      setError("В каждой строке выберите материал и укажите количество больше нуля.");
      return;
    }

    setSubmitting(true);
    try {
      const receipt = await createWarehouseReceipt(
        companyId,
        {
          warehouse_id: warehouseId,
          received_at: new Date(receivedAt).toISOString(),
          supplier: supplier.trim(),
          document_no: documentNo.trim() || null,
          notes: notes.trim() || null,
          lines: lines.map(({ key: _key, ...line }) => ({
            ...line,
            quantity: Number(line.quantity),
            package_count: line.package_count == null ? null : Number(line.package_count),
            package_size: line.package_size == null ? null : Number(line.package_size),
          })),
        },
        idempotencyKey
      );
      await onCreated(receipt);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось провести приход");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[92vh] sm:max-h-[92vh] sm:w-[min(1040px,calc(100vw-32px))] sm:max-w-[1040px] sm:rounded-lg">
        <DialogHeader className="shrink-0 border-b border-slate-800 px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <PackagePlus className="h-5 w-5 text-yellow-400" />
            Создать приход
          </DialogTitle>
          <DialogDescription>
            Поступление агрохимии. Все строки и движения ledger проводятся одной транзакцией.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {error ? (
            <div className="rounded-md border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <section className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Склад назначения *</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Дата прихода *</Label>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
                <Input className="pl-9" type="datetime-local" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Поставщик / от кого получено *</Label>
              <Input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Название поставщика" />
            </div>
            <div className="space-y-2">
              <Label>Номер накладной</Label>
              <Input value={documentNo} onChange={(event) => setDocumentNo(event.target.value)} placeholder="Необязательно" />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Материалы</h3>
                <p className="text-sm text-slate-400">Пестициды, удобрения и добавки из глобального и каталога компании.</p>
              </div>
              <Input className="w-full sm:w-72" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по названию или alias" />
            </div>

            <div className="space-y-3">
              {lines.map((line, index) => (
                <div key={line.key} className="border-b border-slate-800 pb-4 last:border-b-0">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-300">Строка {index + 1}</span>
                    <Button type="button" variant="ghost" size="icon" aria-label="Удалить строку" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-12">
                    <div className="space-y-2 md:col-span-5">
                      <Label>Материал *</Label>
                      <Select value={line.product_id} onValueChange={(value) => selectProduct(line.key, value)}>
                        <SelectTrigger><SelectValue placeholder="Выберите материал" /></SelectTrigger>
                        <SelectContent>
                          {visibleProducts.map((product) => (
                            <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 md:col-span-3">
                      <Label>Принятое количество *</Label>
                      <Input type="number" min="0" step="0.001" value={line.quantity || ""} onChange={(event) => updateLine(line.key, { quantity: Number(event.target.value) })} />
                    </div>
                    <div className="space-y-2 md:col-span-1">
                      <Label>Ед.</Label>
                      <Input value={line.uom} readOnly />
                    </div>
                    <div className="space-y-2 md:col-span-3">
                      <Label>Номер партии</Label>
                      <Input value={line.lot_number || ""} onChange={(event) => updateLine(line.key, { lot_number: event.target.value })} />
                    </div>
                    <div className="space-y-2 md:col-span-3">
                      <Label>Дата производства</Label>
                      <Input type="date" value={line.manufactured_at || ""} onChange={(event) => updateLine(line.key, { manufactured_at: event.target.value })} />
                    </div>
                    <div className="space-y-2 md:col-span-3">
                      <Label>Срок годности</Label>
                      <Input type="date" value={line.expires_at || ""} onChange={(event) => updateLine(line.key, { expires_at: event.target.value })} />
                    </div>
                    <div className="space-y-2 md:col-span-3">
                      <Label>Количество упаковок</Label>
                      <Input type="number" min="0" step="1" value={line.package_count ?? ""} onChange={(event) => updateLine(line.key, { package_count: event.target.value ? Number(event.target.value) : null })} />
                    </div>
                    <div className="space-y-2 md:col-span-3">
                      <Label>Размер упаковки</Label>
                      <Input type="number" min="0" step="0.001" value={line.package_size ?? ""} onChange={(event) => updateLine(line.key, { package_size: event.target.value ? Number(event.target.value) : null })} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, newLine()])}>
              <Plus className="mr-2 h-4 w-4" /> Добавить строку
            </Button>
          </section>

          <div className="space-y-2">
            <Label>Комментарий</Label>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Необязательно" />
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-slate-800 bg-slate-950 px-5 py-3 sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Отмена</Button>
          <Button type="button" onClick={submit} disabled={submitting}>
            {submitting ? "Проведение..." : "Провести приход"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
