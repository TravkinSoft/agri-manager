"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronsUpDown, ClipboardCheck, Plus, Save, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { getProducts, getWarehouseInventories, getWarehouses, startWarehouseInventory, updateWarehouseInventory } from "@/lib/services/warehouses";
import type { Product, Warehouse, WarehouseInventoryDocument } from "@/lib/types/warehouse";
import { isAgrochemicalWarehouseType } from "@/lib/warehouse/warehouse-scope";
import { cn } from "@/lib/utils";

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ru-RU");
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantity(value: unknown): string {
  return number(value).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function statusLabel(status: string): string {
  if (status === "in_progress") return "В работе";
  if (status === "completed") return "Завершена";
  return "Отменена";
}

export default function WarehouseInventoryPage() {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventories, setInventories] = useState<WarehouseInventoryDocument[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [selectedInventoryId, setSelectedInventoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [actual, setActual] = useState<Record<string, string>>({});
  const [discoveredOpen, setDiscoveredOpen] = useState(false);
  const [discoveredProduct, setDiscoveredProduct] = useState<Product | null>(null);
  const [discoveredActual, setDiscoveredActual] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canOperate = ["warehouse", "warehouse_operator", "company_admin", "global_admin"].includes(String(profile?.role || ""));

  const load = async (preferInventoryId?: string) => {
    if (!profile?.company_id) return;
    setLoading(true); setError(null);
    try {
      const [warehouseRows, productRows, inventoryRows] = await Promise.all([
        getWarehouses(profile.company_id, false, language),
        getProducts(profile.company_id, false, language, "agrochemical"),
        getWarehouseInventories(profile.company_id),
      ]);
      const allowedWarehouses = warehouseRows.filter((row) => isAgrochemicalWarehouseType(row.warehouse_type));
      setWarehouses(allowedWarehouses); setProducts(productRows); setInventories(inventoryRows);
      setSelectedWarehouseId((current) => current || allowedWarehouses[0]?.id || "");
      const preferred = inventoryRows.find((row) => row.id === preferInventoryId)
        || inventoryRows.find((row) => row.id === selectedInventoryId)
        || inventoryRows.find((row) => row.status === "in_progress")
        || inventoryRows[0]
        || null;
      setSelectedInventoryId(preferred?.id || null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить инвентаризации"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [profile?.company_id, profile?.role, language]);
  const selected = inventories.find((row) => row.id === selectedInventoryId) || null;
  useEffect(() => {
    const values: Record<string, string> = {};
    for (const item of selected?.items || []) values[item.id] = item.actual_quantity == null ? "" : String(item.actual_quantity);
    setActual(values);
  }, [selectedInventoryId, selected?.updated_at]);

  const usedProductIds = useMemo(() => new Set((selected?.items || []).map((item) => item.product_id)), [selected]);
  const discoveredCandidates = products.filter((product) => !usedProductIds.has(product.id));

  const start = async () => {
    if (!profile?.company_id || !selectedWarehouseId) return;
    const inventoryId = crypto.randomUUID();
    setSubmitting(true); setError(null);
    try {
      await startWarehouseInventory({ companyId: profile.company_id, warehouseId: selectedWarehouseId, notes: notes.trim() || null, inventoryId });
      toast({ title: "Инвентаризация начата", description: "Учётные остатки зафиксированы. Новые движения по складу заблокированы." });
      setNotes(""); await load(inventoryId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось начать инвентаризацию"); }
    finally { setSubmitting(false); }
  };

  const save = async (complete = false) => {
    if (!profile?.company_id || !selected) return;
    const items = (selected.items || []).filter((item) => actual[item.id] !== "").map((item) => ({ item_id: item.id, actual_quantity: number(actual[item.id]) }));
    if (complete && items.length !== (selected.items || []).length) { setError("Укажите фактическое количество для всех материалов."); return; }
    setSubmitting(true); setError(null);
    try {
      await updateWarehouseInventory({ companyId: profile.company_id, inventoryId: selected.id, action: "save", items });
      if (complete) {
        await updateWarehouseInventory({ companyId: profile.company_id, inventoryId: selected.id, action: "complete" });
        toast({ title: "Инвентаризация завершена", description: "Расхождения проведены ledger IN/OUT автоматически." });
      } else toast({ title: "Сохранено", description: "Промежуточный результат сохранён." });
      await load(selected.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить инвентаризацию"); }
    finally { setSubmitting(false); }
  };

  const cancel = async () => {
    if (!profile?.company_id || !selected) return;
    setSubmitting(true); setError(null);
    try {
      await updateWarehouseInventory({ companyId: profile.company_id, inventoryId: selected.id, action: "cancel" });
      toast({ title: "Инвентаризация отменена", description: "Блокировка складских движений снята." });
      await load(selected.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось отменить инвентаризацию"); }
    finally { setSubmitting(false); }
  };

  const addDiscovered = async () => {
    if (!profile?.company_id || !selected || !discoveredProduct) return;
    const value = Number(discoveredActual);
    if (!Number.isFinite(value) || value < 0) { setError("Фактическое количество должно быть нулём или положительным числом."); return; }
    setSubmitting(true); setError(null);
    try {
      await updateWarehouseInventory({ companyId: profile.company_id, inventoryId: selected.id, action: "save", items: [{ product_id: discoveredProduct.id, actual_quantity: value }] });
      setDiscoveredProduct(null); setDiscoveredActual(""); await load(selected.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось добавить материал"); }
    finally { setSubmitting(false); }
  };

  if (!canOperate) return <Alert variant="destructive"><AlertDescription>Инвентаризация доступна складовщику и администратору компании.</AlertDescription></Alert>;

  return <div className="space-y-5">
    <PageHeader title="Инвентаризация" description="Сравнение учётных и фактических остатков склада">
      <Button asChild variant="outline"><Link href="/warehouses"><ArrowLeft className="mr-2 h-4 w-4" />К складам</Link></Button>
    </PageHeader>
    {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

    <Card className="rounded-md"><CardContent className="grid gap-4 p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
      <div className="space-y-2"><Label>Склад</Label><Select value={selectedWarehouseId} onValueChange={setSelectedWarehouseId}><SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger><SelectContent>{warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label>Комментарий</Label><Textarea className="min-h-10" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Необязательно" /></div>
      <Button onClick={start} disabled={submitting || !selectedWarehouseId || inventories.some((row) => row.warehouse_id === selectedWarehouseId && row.status === "in_progress")}><ClipboardCheck className="mr-2 h-4 w-4" />Начать инвентаризацию</Button>
    </CardContent></Card>

    {loading ? <div className="py-10 text-center text-sm text-slate-400">Загрузка...</div> : selected ? <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-800 py-3">
        <div><h2 className="font-semibold">{selected.inventory_no} · {selected.warehouse_name}</h2><div className="text-sm text-slate-400">Начата {formatDate(selected.started_at)} · {selected.started_by_name || "Пользователь"}</div></div>
        <Badge variant="outline">{statusLabel(selected.status)}</Badge>
      </div>

      <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Материал</TableHead><TableHead className="text-right">По учёту</TableHead><TableHead className="text-right">Фактически</TableHead><TableHead className="text-right">Разница</TableHead></TableRow></TableHeader><TableBody>{(selected.items || []).map((item) => {
        const actualValue = actual[item.id];
        const difference = actualValue === "" ? item.difference_quantity : number(actualValue) - number(item.book_quantity);
        return <TableRow key={item.id}><TableCell><span className="font-medium">{item.product_name_snapshot}</span>{item.discovered ? <Badge className="ml-2" variant="outline">Обнаружен</Badge> : null}</TableCell><TableCell className="text-right">{quantity(item.book_quantity)} {item.uom}</TableCell><TableCell className="text-right">{selected.status === "in_progress" ? <div className="ml-auto flex w-40 items-center gap-2"><Input className="text-right" type="number" min="0" step="0.001" value={actualValue ?? ""} onChange={(event) => setActual((current) => ({ ...current, [item.id]: event.target.value }))} /><span>{item.uom}</span></div> : `${quantity(item.actual_quantity)} ${item.uom}`}</TableCell><TableCell className={cn("text-right font-medium", number(difference) > 0 ? "text-emerald-300" : number(difference) < 0 ? "text-red-300" : "text-slate-400")}>{actualValue === "" && difference == null ? "—" : `${number(difference) > 0 ? "+" : ""}${quantity(difference)} ${item.uom}`}</TableCell></TableRow>;
      })}</TableBody></Table></div>

      {selected.status === "in_progress" ? <>
        <div className="border-y border-slate-800 py-4"><h3 className="mb-3 font-semibold">Добавить обнаруженный материал</h3><div className="grid gap-3 md:grid-cols-[1fr_180px_auto] md:items-end"><div className="space-y-2"><Label>Материал</Label><Popover open={discoveredOpen} onOpenChange={setDiscoveredOpen}><PopoverTrigger asChild><Button variant="outline" role="combobox" className="w-full justify-between font-normal"><span className={cn("truncate", !discoveredProduct && "text-muted-foreground")}>{discoveredProduct?.name || "Найти материал"}</span><ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" /></Button></PopoverTrigger><PopoverContent className="w-[min(620px,calc(100vw-40px))] p-0"><Command><CommandInput placeholder="Название или alias" /><CommandList><CommandEmpty>Материал не найден</CommandEmpty><CommandGroup>{discoveredCandidates.map((product) => <CommandItem key={product.id} value={[product.name, ...(product.aliases || [])].join(" ")} onSelect={() => { setDiscoveredProduct(product); setDiscoveredOpen(false); }}><Check className={cn("mr-2 h-4 w-4", discoveredProduct?.id === product.id ? "opacity-100" : "opacity-0")} />{product.name}</CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover></div><div className="space-y-2"><Label>Фактически</Label><Input type="number" min="0" step="0.001" value={discoveredActual} onChange={(event) => setDiscoveredActual(event.target.value)} /></div><Button variant="outline" onClick={addDiscovered} disabled={!discoveredProduct || discoveredActual === "" || submitting}><Plus className="mr-2 h-4 w-4" />Добавить</Button></div></div>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={cancel} disabled={submitting}><X className="mr-2 h-4 w-4" />Отменить</Button><Button variant="outline" onClick={() => save(false)} disabled={submitting}><Save className="mr-2 h-4 w-4" />Сохранить</Button><Button onClick={() => save(true)} disabled={submitting}><ClipboardCheck className="mr-2 h-4 w-4" />Завершить</Button></div>
      </> : <div className="text-sm text-slate-400">Завершена {formatDate(selected.completed_at)} · проверено {selected.item_count} позиций · расхождений {selected.difference_count}. Документ доступен только для чтения.</div>}
    </section> : <div className="py-10 text-center text-sm text-slate-400">Инвентаризаций пока нет.</div>}

    <section><h2 className="mb-3 text-lg font-semibold">История</h2><div className="space-y-2">{inventories.map((row) => <button key={row.id} type="button" onClick={() => setSelectedInventoryId(row.id)} className={cn("grid w-full gap-1 border-y border-slate-800 px-2 py-3 text-left text-sm hover:bg-slate-900 sm:grid-cols-[180px_1fr_170px_140px]", row.id === selectedInventoryId && "bg-slate-900")}><span className="font-medium">{row.inventory_no}</span><span>{row.warehouse_name}</span><span>{formatDate(row.started_at)}</span><span>{statusLabel(row.status)} · {row.difference_count} расх.</span></button>)}</div></section>
  </div>;
}
