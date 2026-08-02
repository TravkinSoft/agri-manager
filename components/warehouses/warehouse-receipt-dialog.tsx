"use client";

import { useEffect, useState } from "react";
import { Building2, Check, ChevronsUpDown, Clock3, PackagePlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { createWarehouseReceipt } from "@/lib/services/warehouses";
import { searchSupplierCounterparties } from "@/lib/services/counterparties";
import { normalizeStockUom } from "@/lib/warehouse/stock-unit-contract";
import type { CounterpartySearchResult } from "@/lib/types/counterparty";
import type { Product, Warehouse, WarehouseReceiptLineInput } from "@/lib/types/warehouse";
import { cn } from "@/lib/utils";

interface ReceiptLineDraft extends WarehouseReceiptLineInput { key: string; }
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  warehouses: Warehouse[];
  products: Product[];
  defaultWarehouseId?: string | null;
  onCreated: (receipt: { receipt_id: string; receipt_no: string }) => Promise<void> | void;
}

function newLine(): ReceiptLineDraft {
  return { key: crypto.randomUUID(), product_id: "", quantity: 0, uom: "", lot_number: "", manufactured_at: "", expires_at: "", notes: "" };
}

function stockUnit(product?: Product): string | null {
  if (!product) return null;
  try {
    return normalizeStockUom(product.stock_unit || product.base_uom || product.unit).baseUom;
  } catch {
    return null;
  }
}

function productSearchValue(product: Product): string {
  return [product.name, product.trade_name, product.normalized_name, product.name_ru, product.name_en, ...(product.aliases || [])]
    .filter(Boolean)
    .join(" ");
}

export function WarehouseReceiptDialog({ open, onOpenChange, companyId, warehouses, products, defaultWarehouseId, onCreated }: Props) {
  const [warehouseId, setWarehouseId] = useState("");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierResults, setSupplierResults] = useState<CounterpartySearchResult[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<CounterpartySearchResult | null>(null);
  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [productOpenKey, setProductOpenKey] = useState<string | null>(null);
  const [documentNo, setDocumentNo] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ReceiptLineDraft[]>([newLine()]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setWarehouseId(defaultWarehouseId || warehouses[0]?.id || "");
    setSupplierOpen(false); setSupplierSearch(""); setSupplierResults([]); setSelectedSupplier(null);
    setProductOpenKey(null); setDocumentNo(""); setNotes(""); setLines([newLine()]);
    setIdempotencyKey(crypto.randomUUID()); setError(null);
  }, [open, defaultWarehouseId, warehouses]);

  useEffect(() => {
    if (!open || !companyId) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSuppliersLoading(true);
      try {
        const rows = await searchSupplierCounterparties(companyId, supplierSearch);
        if (!cancelled) setSupplierResults(rows);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Не удалось загрузить поставщиков");
      } finally { if (!cancelled) setSuppliersLoading(false); }
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, companyId, supplierSearch]);

  const updateLine = (key: string, patch: Partial<ReceiptLineDraft>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  const selectProduct = (key: string, product: Product) => {
    updateLine(key, { product_id: product.id, uom: stockUnit(product) || "" });
    setProductOpenKey(null);
  };

  const submit = async () => {
    setError(null);
    if (!warehouseId || !selectedSupplier) { setError("Укажите склад назначения и поставщика."); return; }
    if (lines.some((line) => !line.product_id || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0)) {
      setError("В каждой строке выберите материал и укажите количество больше нуля."); return;
    }
    if (lines.some((line) => !line.uom)) { setError("Для материала не задана единица хранения"); return; }
    setSubmitting(true);
    try {
      const receipt = await createWarehouseReceipt(companyId, {
        warehouse_id: warehouseId,
        supplier_company_counterparty_id: selectedSupplier.company_counterparty_id,
        supplier_global_counterparty_id: selectedSupplier.global_counterparty_id,
        document_no: documentNo.trim() || null,
        notes: notes.trim() || null,
        lines: lines.map(({ key: _key, ...line }) => ({ ...line, quantity: Number(line.quantity) })),
      }, idempotencyKey);
      await onCreated(receipt); onOpenChange(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось провести приход"); }
    finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[92vh] sm:max-h-[92vh] sm:w-[min(1040px,calc(100vw-32px))] sm:max-w-[1040px] sm:rounded-lg">
        <DialogHeader className="shrink-0 border-b border-slate-800 px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-lg"><PackagePlus className="h-5 w-5 text-yellow-400" />Создать приход</DialogTitle>
          <DialogDescription>Поступление агрохимии проводится одной атомарной транзакцией.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {error ? <div className="rounded-md border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</div> : null}
          <section className="space-y-4">
            <div className="space-y-2"><Label>Склад назначения *</Label><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger><SelectContent>{warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2">
              <Label>Поставщик *</Label>
              <Popover open={supplierOpen} onOpenChange={setSupplierOpen}>
                <PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-expanded={supplierOpen} className="h-auto min-h-10 w-full justify-between px-3 py-2 text-left font-normal"><span className={cn("min-w-0 truncate", !selectedSupplier && "text-muted-foreground")}>{selectedSupplier ? `${selectedSupplier.legal_name} — ${selectedSupplier.tax_id || "без БИН/ИНН"}` : "Найти по названию, БИН/ИНН или транслитерации"}</span><ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" /></Button></PopoverTrigger>
                <PopoverContent className="w-[min(620px,calc(100vw-40px))] p-0" align="start"><Command shouldFilter={false}><CommandInput value={supplierSearch} onValueChange={setSupplierSearch} placeholder="Syngenta, Сингента или БИН/ИНН" /><CommandList className="max-h-72"><CommandEmpty>{suppliersLoading ? "Поиск..." : "Контрагент не найден в ГЛБД"}</CommandEmpty><CommandGroup>{supplierResults.map((row) => <CommandItem key={row.key} value={row.key} onSelect={() => { setSelectedSupplier(row); setSupplierOpen(false); }} className="items-start gap-2 py-2"><Building2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{row.legal_name}</span><span className="block text-xs text-muted-foreground">{row.tax_id || "БИН/ИНН не указан"} — {row.country_name || "Страна не указана"}{row.source === "company" ? " — уже в компании" : ""}</span></span><Check className={cn("h-4 w-4", selectedSupplier?.key === row.key ? "opacity-100" : "opacity-0")} /></CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2"><Label>Номер накладной</Label><Input value={documentNo} onChange={(event) => setDocumentNo(event.target.value)} placeholder="Необязательно" /></div>
          </section>

          <section className="space-y-3">
            <div><h3 className="text-base font-semibold">Материалы</h3><p className="text-sm text-slate-400">Пестициды, удобрения и добавки из глобального каталога и каталога компании.</p></div>
            {lines.map((line, index) => {
              const selectedProduct = products.find((product) => product.id === line.product_id);
              return <div key={line.key} className="border-b border-slate-800 pb-4 last:border-b-0">
                <div className="mb-3 flex items-center justify-between"><span className="text-sm font-medium text-slate-300">Строка {index + 1}</span><Button type="button" variant="ghost" size="icon" aria-label="Удалить строку" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}><Trash2 className="h-4 w-4" /></Button></div>
                <div className="grid gap-3 md:grid-cols-12">
                  <div className="space-y-2 md:col-span-6"><Label>Материал *</Label><Popover open={productOpenKey === line.key} onOpenChange={(value) => setProductOpenKey(value ? line.key : null)}><PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal"><span className={cn("truncate", !selectedProduct && "text-muted-foreground")}>{selectedProduct?.name || "Найти материал по названию или alias"}</span><ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" /></Button></PopoverTrigger><PopoverContent className="w-[min(620px,calc(100vw-40px))] p-0" align="start"><Command><CommandInput placeholder="Найти материал по названию или alias" /><CommandList className="max-h-72"><CommandEmpty>Материал не найден</CommandEmpty><CommandGroup>{products.map((product) => <CommandItem key={product.id} value={productSearchValue(product)} onSelect={() => selectProduct(line.key, product)}><Check className={cn("mr-2 h-4 w-4", product.id === line.product_id ? "opacity-100" : "opacity-0")} /><span className="truncate">{product.name}</span></CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover></div>
                  <div className="space-y-2 md:col-span-3"><Label>Принятое количество *</Label><Input type="number" min="0" step="0.001" value={line.quantity || ""} onChange={(event) => updateLine(line.key, { quantity: Number(event.target.value) })} /></div>
                  <div className="space-y-2 md:col-span-3"><Label>Единица</Label><Input value={line.uom || "Не задана"} readOnly className={!line.uom && line.product_id ? "border-red-500 text-red-300" : ""} />{!line.uom && line.product_id ? <p className="text-xs text-red-300">Для материала не задана единица хранения</p> : null}</div>
                  <div className="space-y-2 md:col-span-4"><Label>Партия / серия</Label><Input value={line.lot_number || ""} onChange={(event) => updateLine(line.key, { lot_number: event.target.value })} placeholder="Необязательно" /><p className="text-xs text-slate-500">Номер с упаковки или накладной. Нужен для разделения поставок и сроков годности.</p></div>
                  <div className="space-y-2 md:col-span-4"><Label>Дата производства</Label><Input type="date" value={line.manufactured_at || ""} onChange={(event) => updateLine(line.key, { manufactured_at: event.target.value })} /></div>
                  <div className="space-y-2 md:col-span-4"><Label>Срок годности</Label><Input type="date" value={line.expires_at || ""} onChange={(event) => updateLine(line.key, { expires_at: event.target.value })} /></div>
                </div>
              </div>;
            })}
            <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, newLine()])}><Plus className="mr-2 h-4 w-4" />Добавить строку</Button>
          </section>
          <div className="space-y-2"><Label>Комментарий</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Необязательно" /></div>
          <div className="space-y-2"><Label>Дата и время проведения</Label><div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-400"><Clock3 className="h-4 w-4" />Определятся сервером при проведении</div></div>
        </div>
        <DialogFooter className="shrink-0 border-t border-slate-800 bg-slate-950 px-5 py-3 sm:justify-end"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Отмена</Button><Button type="button" onClick={submit} disabled={submitting}>{submitting ? "Проведение..." : "Провести приход"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
