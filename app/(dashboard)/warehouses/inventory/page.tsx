"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ClipboardCheck, RotateCcw, Save, Send, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { getWarehouseInventories, getWarehouseInventoryAssignees, getWarehouses, startWarehouseInventory, updateWarehouseInventory } from "@/lib/services/warehouses";
import type { Warehouse, WarehouseInventoryDocument } from "@/lib/types/warehouse";
import { isHarvestWarehouseType } from "@/lib/warehouse/warehouse-scope";
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
  if (status === "awaiting_approval") return "Ожидает подтверждения";
  if (status === "approved") return "Подтверждена";
  if (status === "rejected") return "Возвращена на пересчёт";
  return "Отменена";
}

export default function WarehouseInventoryPage() {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [inventories, setInventories] = useState<WarehouseInventoryDocument[]>([]);
  const [assignees, setAssignees] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [selectedInventoryId, setSelectedInventoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [actual, setActual] = useState<Record<string, string>>({});
  const [rejectionComment, setRejectionComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAdmin = ["company_admin", "global_admin"].includes(String(profile?.role || ""));
  const canCount = ["warehouse", "warehouse_operator", "weighman"].includes(String(profile?.role || ""));
  const canOperate = canAdmin || canCount;

  const load = async (preferInventoryId?: string) => {
    if (!profile?.company_id) return;
    setLoading(true); setError(null);
    try {
      const [warehouseRows, inventoryRows, assigneeRows] = await Promise.all([
        getWarehouses(profile.company_id, false, language),
        getWarehouseInventories(profile.company_id),
        canAdmin ? getWarehouseInventoryAssignees(profile.company_id) : Promise.resolve([]),
      ]);
      const allowedWarehouses = warehouseRows;
      setWarehouses(allowedWarehouses); setInventories(inventoryRows); setAssignees(assigneeRows);
      setSelectedWarehouseId((current) => current || allowedWarehouses[0]?.id || "");
      const preferred = inventoryRows.find((row) => row.id === preferInventoryId)
        || inventoryRows.find((row) => row.id === selectedInventoryId)
        || inventoryRows.find((row) => ["in_progress", "rejected", "awaiting_approval"].includes(row.status))
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

  const selectedWarehouse = warehouses.find((row) => row.id === selectedWarehouseId) || null;
  const eligibleAssignees = useMemo(() => {
    const grain = isHarvestWarehouseType(selectedWarehouse?.warehouse_type);
    return assignees.filter((row) => grain ? row.role === "weighman" : ["warehouse", "warehouse_operator"].includes(row.role));
  }, [assignees, selectedWarehouse?.warehouse_type]);
  useEffect(() => { setAssignedTo((current) => eligibleAssignees.some((row) => row.id === current) ? current : eligibleAssignees[0]?.id || ""); }, [eligibleAssignees]);

  const start = async () => {
    if (!profile?.company_id || !selectedWarehouseId || !assignedTo) return;
    const inventoryId = crypto.randomUUID();
    setSubmitting(true); setError(null);
    try {
      await startWarehouseInventory({ companyId: profile.company_id, warehouseId: selectedWarehouseId, assignedTo, notes: notes.trim() || null, inventoryId });
      toast({ title: "Инвентаризация начата", description: "Учётные остатки зафиксированы. Новые движения по складу заблокированы." });
      setNotes(""); await load(inventoryId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось начать инвентаризацию"); }
    finally { setSubmitting(false); }
  };

  const save = async (submit = false) => {
    if (!profile?.company_id || !selected) return;
    const items = (selected.items || []).filter((item) => actual[item.id] !== "").map((item) => ({ item_id: item.id, actual_quantity: number(actual[item.id]) }));
    if (submit && items.length !== (selected.items || []).length) { setError("Укажите фактическое количество для всех материалов."); return; }
    setSubmitting(true); setError(null);
    try {
      await updateWarehouseInventory({ companyId: profile.company_id, inventoryId: selected.id, action: "save", items });
      if (submit) {
        await updateWarehouseInventory({ companyId: profile.company_id, inventoryId: selected.id, action: "submit" });
        toast({ title: "Отправлено администратору", description: "Остатки не изменятся до подтверждения." });
      } else toast({ title: "Сохранено", description: "Промежуточный результат сохранён." });
      await load(selected.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить инвентаризацию"); }
    finally { setSubmitting(false); }
  };

  const adminAction = async (action: "approve" | "reject" | "cancel") => {
    if (!profile?.company_id || !selected) return;
    if (action === "reject" && !rejectionComment.trim()) { setError("Укажите причину возврата на пересчёт."); return; }
    setSubmitting(true); setError(null);
    try {
      await updateWarehouseInventory({ companyId: profile.company_id, inventoryId: selected.id, action, comment: rejectionComment.trim() });
      toast({
        title: action === "approve" ? "Инвентаризация подтверждена" : action === "reject" ? "Возвращено на пересчёт" : "Инвентаризация отменена",
        description: action === "approve" ? "Ledger IN/OUT создан только для подтверждённых расхождений." : "Ledger не изменён.",
      });
      setRejectionComment(""); await load(selected.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось выполнить действие"); }
    finally { setSubmitting(false); }
  };

  if (!canOperate) return <Alert variant="destructive"><AlertDescription>Инвентаризация недоступна вашей роли.</AlertDescription></Alert>;

  return <div className="space-y-5">
    <PageHeader title="Инвентаризация" description="Сравнение учётных и фактических остатков склада">
      <Button asChild variant="outline"><Link href="/warehouses"><ArrowLeft className="mr-2 h-4 w-4" />К складам</Link></Button>
    </PageHeader>
    {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

    {canAdmin ? <Card className="rounded-md"><CardContent className="grid gap-4 p-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
      <div className="space-y-2"><Label>Склад</Label><Select value={selectedWarehouseId} onValueChange={setSelectedWarehouseId}><SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger><SelectContent>{warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label>Ответственный за подсчёт</Label><Select value={assignedTo} onValueChange={setAssignedTo}><SelectTrigger><SelectValue placeholder="Выберите ответственного" /></SelectTrigger><SelectContent>{eligibleAssignees.length === 0 ? <SelectItem value="__empty" disabled>Подходящий сотрудник не найден</SelectItem> : null}{eligibleAssignees.map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label>Комментарий</Label><Textarea className="min-h-10" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Необязательно" /></div>
      <Button onClick={start} disabled={submitting || !selectedWarehouseId || !assignedTo || inventories.some((row) => row.warehouse_id === selectedWarehouseId && ["in_progress","awaiting_approval","rejected"].includes(row.status))}><ClipboardCheck className="mr-2 h-4 w-4" />Начать инвентаризацию</Button>
    </CardContent></Card> : null}

    {loading ? <div className="py-10 text-center text-sm text-slate-400">Загрузка...</div> : selected ? <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-800 py-3">
        <div><h2 className="font-semibold">{selected.inventory_no} · {selected.warehouse_name}</h2><div className="text-sm text-slate-400">Начата {formatDate(selected.started_at)} · ответственный: {selected.assigned_to_name || "Не назначен"}</div></div>
        <Badge variant="outline">{statusLabel(selected.status)}</Badge>
      </div>

      <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Материал</TableHead><TableHead className="text-right">По учёту</TableHead><TableHead className="text-right">Фактически</TableHead><TableHead className="text-right">Разница</TableHead></TableRow></TableHeader><TableBody>{(selected.items || []).map((item) => {
        const actualValue = actual[item.id];
        const difference = actualValue === "" ? item.difference_quantity : number(actualValue) - number(item.book_quantity);
        const editable = canCount && ["in_progress", "rejected"].includes(selected.status);
        return <TableRow key={item.id}><TableCell><span className="font-medium">{item.product_name_snapshot}</span>{item.batch_id_text ? <div className="text-xs text-slate-500">Партия: {item.batch_id_text}</div> : null}</TableCell><TableCell className="text-right">{quantity(item.book_quantity)} {item.uom}</TableCell><TableCell className="text-right">{editable ? <div className="ml-auto flex w-40 items-center gap-2"><Input className="text-right" type="number" min="0" step="0.001" value={actualValue ?? ""} onChange={(event) => setActual((current) => ({ ...current, [item.id]: event.target.value }))} /><span>{item.uom}</span></div> : `${quantity(item.actual_quantity)} ${item.uom}`}</TableCell><TableCell className={cn("text-right font-medium", number(difference) > 0 ? "text-emerald-300" : number(difference) < 0 ? "text-red-300" : "text-slate-400")}>{actualValue === "" && difference == null ? "—" : `${number(difference) > 0 ? "+" : ""}${quantity(difference)} ${item.uom}`}{number(difference) !== 0 ? <div className="text-xs font-normal text-slate-500">Предполагаемый ledger {number(difference) > 0 ? "IN" : "OUT"}</div> : null}</TableCell></TableRow>;
      })}</TableBody></Table></div>

      {canCount && ["in_progress", "rejected"].includes(selected.status) ? <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => save(false)} disabled={submitting}><Save className="mr-2 h-4 w-4" />Сохранить</Button><Button onClick={() => save(true)} disabled={submitting}><Send className="mr-2 h-4 w-4" />Отправить администратору</Button></div> : null}
      {selected.status === "rejected" ? <Alert><RotateCcw className="h-4 w-4" /><AlertDescription>Возвращено на пересчёт: {selected.rejection_comment || "Причина не указана"}</AlertDescription></Alert> : null}
      {canAdmin && selected.status === "awaiting_approval" ? <div className="space-y-3 border-y border-slate-800 py-4"><Textarea value={rejectionComment} onChange={(event) => setRejectionComment(event.target.value)} placeholder="Комментарий обязателен только при возврате на пересчёт" /><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => adminAction("cancel")} disabled={submitting}><X className="mr-2 h-4 w-4" />Отменить</Button><Button variant="outline" onClick={() => adminAction("reject")} disabled={submitting}><RotateCcw className="mr-2 h-4 w-4" />Вернуть на пересчёт</Button><Button onClick={() => adminAction("approve")} disabled={submitting}><CheckCircle2 className="mr-2 h-4 w-4" />Подтвердить</Button></div></div> : null}
      {canAdmin && ["in_progress", "rejected"].includes(selected.status) ? <div className="flex justify-end"><Button variant="outline" onClick={() => adminAction("cancel")} disabled={submitting}><X className="mr-2 h-4 w-4" />Отменить</Button></div> : null}
      {["approved","cancelled"].includes(selected.status) ? <div className="text-sm text-slate-400">{selected.status === "approved" ? `Подтверждена ${formatDate(selected.approved_at)}` : "Отменена"} · проверено {selected.item_count} позиций · расхождений {selected.difference_count}.</div> : null}
    </section> : <div className="py-10 text-center text-sm text-slate-400">Инвентаризаций пока нет.</div>}

    <section><h2 className="mb-3 text-lg font-semibold">История</h2><div className="space-y-2">{inventories.map((row) => <button key={row.id} type="button" onClick={() => setSelectedInventoryId(row.id)} className={cn("grid w-full gap-1 border-y border-slate-800 px-2 py-3 text-left text-sm hover:bg-slate-900 sm:grid-cols-[180px_1fr_170px_140px]", row.id === selectedInventoryId && "bg-slate-900")}><span className="font-medium">{row.inventory_no}</span><span>{row.warehouse_name}</span><span>{formatDate(row.started_at)}</span><span>{statusLabel(row.status)} · {row.difference_count} расх.</span></button>)}</div></section>
  </div>;
}
