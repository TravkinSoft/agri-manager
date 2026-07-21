"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { localizeUnit } from "@/lib/i18n/helpers";
import { getInventoryTransactions, getWarehouses } from "@/lib/services/warehouses";
import type { InventoryTransactionWithDetails, Warehouse } from "@/lib/types/warehouse";

function movementLabel(row: InventoryTransactionWithDetails): string {
  const reason = String(row.reason_type || "").toLowerCase();
  if (reason.includes("return")) return "Возврат";
  if (reason.includes("adjust")) return "Ревизия / корректировка";
  if (reason.includes("transfer")) return "Перемещение";
  if (reason.includes("writeoff") || reason.includes("loss")) return "Списание";
  if (row.transaction_type === "in") return "Приход";
  return "Выдача";
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ru-RU");
}

export default function InventoryTransactionsPage() {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movements, setMovements] = useState<InventoryTransactionWithDetails[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [search, setSearch] = useState("");
  const [warehouse, setWarehouse] = useState("all");
  const [type, setType] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!profile?.company_id) return;
      setLoading(true);
      setError(null);
      try {
        const [movementRows, warehouseRows] = await Promise.all([
          getInventoryTransactions(profile.company_id, language),
          getWarehouses(profile.company_id, false, language),
        ]);
        setMovements(movementRows);
        setWarehouses(warehouseRows);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить движения запасов");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [profile?.company_id, language]);

  const filtered = useMemo(() => movements.filter((row) => {
    const text = `${row.product_name || ""} ${row.warehouse_name || ""} ${row.created_by_email || ""} ${row.document_ref || ""} ${row.reason_type || ""}`.toLowerCase();
    const occurred = String(row.operation_datetime || row.created_at || "").slice(0, 10);
    return (!search.trim() || text.includes(search.trim().toLowerCase())) &&
      (warehouse === "all" || row.warehouse_id === warehouse || row.source_warehouse_id === warehouse || row.destination_warehouse_id === warehouse) &&
      (type === "all" || movementLabel(row) === type) &&
      (!dateFrom || occurred >= dateFrom) &&
      (!dateTo || occurred <= dateTo);
  }), [movements, search, warehouse, type, dateFrom, dateTo]);
  const selected = movements.find((row) => row.id === selectedId) || null;

  return (
    <div className="space-y-5">
      <PageHeader title="Движение запасов" description="Единая история движений из складского ledger" />
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_200px_200px_160px_160px]">
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Материал, пользователь, документ" /></div>
        <Select value={warehouse} onValueChange={setWarehouse}><SelectTrigger><SelectValue placeholder="Склад" /></SelectTrigger><SelectContent><SelectItem value="all">Все склады</SelectItem>{warehouses.map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent></Select>
        <Select value={type} onValueChange={setType}><SelectTrigger><SelectValue placeholder="Тип движения" /></SelectTrigger><SelectContent><SelectItem value="all">Все движения</SelectItem>{["Приход", "Выдача", "Возврат", "Перемещение", "Ревизия / корректировка", "Списание"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
        <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Дата от" />
        <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Дата до" />
      </div>

      <div className="overflow-x-auto border-y border-slate-800">
        <Table><TableHeader><TableRow><TableHead>Дата и время</TableHead><TableHead>Материал</TableHead><TableHead>Направление</TableHead><TableHead className="text-right">Количество</TableHead><TableHead>Склад</TableHead><TableHead>Основание</TableHead><TableHead>Пользователь</TableHead></TableRow></TableHeader>
          <TableBody>{loading ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-slate-500">Загрузка...</TableCell></TableRow> : filtered.length === 0 ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-slate-500">Движения не найдены</TableCell></TableRow> : filtered.map((row) => {
            const delta = Number(row.quantity_delta ?? (row.transaction_type === "in" ? row.quantity : -row.quantity));
            return <TableRow key={row.id} className="cursor-pointer hover:bg-slate-900/70" onClick={() => setSelectedId(row.id)}><TableCell>{formatDate(row.operation_datetime || row.created_at)}</TableCell><TableCell className="font-medium">{row.product_name}</TableCell><TableCell><Badge variant="outline">{delta >= 0 ? "IN" : "OUT"}</Badge></TableCell><TableCell className={`text-right font-medium ${delta >= 0 ? "text-emerald-300" : "text-red-300"}`}>{delta >= 0 ? "+" : ""}{delta.toLocaleString("ru-RU")} {localizeUnit(row.product_unit || "", language)}</TableCell><TableCell>{row.warehouse_name}</TableCell><TableCell>{row.document_ref || row.reason_type || "-"}</TableCell><TableCell>{row.created_by_email || "-"}</TableCell></TableRow>;
          })}</TableBody>
        </Table>
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="sm:max-w-2xl">{selected ? <><DialogHeader><DialogTitle className="flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-yellow-400" />{movementLabel(selected)}</DialogTitle><DialogDescription>{formatDate(selected.operation_datetime || selected.created_at)}</DialogDescription></DialogHeader><div className="grid gap-4 text-sm sm:grid-cols-2"><div><div className="text-slate-500">Материал</div><div className="mt-1 font-medium">{selected.product_name}</div></div><div><div className="text-slate-500">Количество</div><div className="mt-1 font-medium">{Number(selected.quantity_delta || selected.quantity).toLocaleString("ru-RU")} {localizeUnit(selected.product_unit || "", language)}</div></div><div><div className="text-slate-500">Склад</div><div className="mt-1">{selected.warehouse_name}</div></div><div><div className="text-slate-500">Пользователь</div><div className="mt-1">{selected.created_by_email || "-"}</div></div><div><div className="text-slate-500">Документ / заявка</div><div className="mt-1">{selected.document_ref || selected.reason_ref_id || "-"}</div></div><div><div className="text-slate-500">Источник</div><div className="mt-1">{selected.reason_type || selected.source_system || "-"}</div></div></div></> : null}</DialogContent>
      </Dialog>
    </div>
  );
}
