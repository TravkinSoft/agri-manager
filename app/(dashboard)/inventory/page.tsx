"use client";

import { useEffect, useMemo, useState } from "react";
import { Package, Search } from "lucide-react";
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
import { getWarehouseIssueRequests } from "@/lib/services/warehouse-requests";
import { getInventoryBalances, getInventoryTransactions, getWarehouseReceipts } from "@/lib/services/warehouses";
import type { WarehouseIssueRequest } from "@/lib/types/warehouse-request";
import type { InventoryBalance, InventoryTransactionWithDetails, WarehouseReceipt } from "@/lib/types/warehouse";

const CATEGORY_LABELS: Record<string, string> = {
  pesticide: "Пестицид",
  fertilizer: "Удобрение",
  additive: "Добавка",
};

interface StockSummary {
  key: string;
  product_id: string;
  product_name: string;
  category: string;
  unit: string;
  total: number;
  reserved: number;
  available: number;
  warehouses: Set<string>;
  rows: InventoryBalance[];
}

function requestIsActive(row: WarehouseIssueRequest): boolean {
  return !["issued", "issued_by_warehouse", "cancelled"].includes(String(row.status || "")) &&
    !["closed", "return_received", "cancelled"].includes(String(row.warehouse_request_status || ""));
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ru-RU");
}

export default function InventoryPage() {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [requests, setRequests] = useState<WarehouseIssueRequest[]>([]);
  const [movements, setMovements] = useState<InventoryTransactionWithDetails[]>([]);
  const [receipts, setReceipts] = useState<WarehouseReceipt[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!profile?.company_id) return;
      setLoading(true);
      setError(null);
      try {
        const [balanceRows, requestRows, movementRows, receiptRows] = await Promise.all([
          getInventoryBalances(profile.company_id, language),
          getWarehouseIssueRequests(profile.company_id),
          getInventoryTransactions(profile.company_id, language),
          getWarehouseReceipts(profile.company_id),
        ]);
        setBalances(balanceRows.filter((row) => ["pesticide", "fertilizer", "additive"].includes(String(row.product_type || "").toLowerCase())));
        setRequests(requestRows);
        setMovements(movementRows);
        setReceipts(receiptRows);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить остатки");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [profile?.company_id, language]);

  const reservedByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const request of requests.filter(requestIsActive)) {
      for (const item of request.items || []) {
        const planned = Number(item.prepared_quantity ?? item.planned_quantity ?? item.required_quantity ?? 0);
        const issued = Number(item.issued_quantity || 0);
        map.set(String(item.product_id), (map.get(String(item.product_id)) || 0) + Math.max(planned - issued, 0));
      }
    }
    return map;
  }, [requests]);

  const summaries = useMemo<StockSummary[]>(() => {
    const map = new Map<string, StockSummary>();
    for (const row of balances) {
      const key = `${row.product_id}|${row.unit}`;
      const existing = map.get(key);
      if (existing) {
        existing.total += Number(row.quantity || 0);
        existing.warehouses.add(row.warehouse_id);
        existing.rows.push(row);
      } else {
        map.set(key, {
          key,
          product_id: row.product_id,
          product_name: row.product_name,
          category: String(row.product_type || ""),
          unit: row.unit,
          total: Number(row.quantity || 0),
          reserved: 0,
          available: 0,
          warehouses: new Set([row.warehouse_id]),
          rows: [row],
        });
      }
    }
    return Array.from(map.values()).map((row) => {
      const reserved = reservedByProduct.get(row.product_id) || 0;
      return { ...row, reserved, available: Math.max(row.total - reserved, 0) };
    }).sort((a, b) => a.product_name.localeCompare(b.product_name, "ru"));
  }, [balances, reservedByProduct]);

  const filtered = summaries.filter((row) => {
    const matchesSearch = !search.trim() || row.product_name.toLowerCase().includes(search.trim().toLowerCase());
    return matchesSearch && (category === "all" || row.category === category);
  });
  const selected = summaries.find((row) => row.key === selectedKey) || null;
  const selectedMovements = selected ? movements.filter((row) => row.product_id === selected.product_id).slice(0, 12) : [];
  const selectedLots = selected ? receipts.flatMap((receipt) => receipt.lines.filter((line) => line.product_id === selected.product_id).map((line) => ({ receipt, line }))).slice(0, 12) : [];

  return (
    <div className="space-y-5">
      <PageHeader title="Все запасы" description="Агрегированный остаток агрохимии по доступным складам" />
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

      <div className="grid gap-3 sm:grid-cols-[1fr_240px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
          <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти материал" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue placeholder="Категория" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все категории</SelectItem>
            <SelectItem value="pesticide">Пестициды</SelectItem>
            <SelectItem value="fertilizer">Удобрения</SelectItem>
            <SelectItem value="additive">Добавки</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto border-y border-slate-800">
        <Table>
          <TableHeader><TableRow><TableHead>Материал</TableHead><TableHead>Категория</TableHead><TableHead>Единица</TableHead><TableHead className="text-right">Всего в компании</TableHead><TableHead className="text-right">Зарезервировано</TableHead><TableHead className="text-right">Доступно</TableHead><TableHead className="text-right">Складов</TableHead></TableRow></TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-slate-500">Загрузка...</TableCell></TableRow> : filtered.length === 0 ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-slate-500">Агрохимические остатки не найдены</TableCell></TableRow> : filtered.map((row) => (
              <TableRow key={row.key} className="cursor-pointer hover:bg-slate-900/70" onClick={() => setSelectedKey(row.key)}>
                <TableCell className="font-medium">{row.product_name}</TableCell>
                <TableCell><Badge variant="outline">{CATEGORY_LABELS[row.category] || "Другое"}</Badge></TableCell>
                <TableCell>{localizeUnit(row.unit, language)}</TableCell>
                <TableCell className="text-right">{row.total.toLocaleString("ru-RU")}</TableCell>
                <TableCell className="text-right">{row.reserved.toLocaleString("ru-RU")}</TableCell>
                <TableCell className="text-right font-semibold text-emerald-300">{row.available.toLocaleString("ru-RU")}</TableCell>
                <TableCell className="text-right">{row.warehouses.size}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedKey(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          {selected ? <>
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Package className="h-5 w-5 text-yellow-400" />{selected.product_name}</DialogTitle><DialogDescription>{CATEGORY_LABELS[selected.category] || "Агрохимия"} · доступно {selected.available.toLocaleString("ru-RU")} {localizeUnit(selected.unit, language)}</DialogDescription></DialogHeader>
            <section className="space-y-2"><h3 className="font-semibold">Распределение по складам</h3>{selected.rows.map((row) => <div key={`${row.warehouse_id}-${row.batch_id || ""}`} className="flex items-center justify-between border-b border-slate-800 py-2 text-sm"><span>{row.warehouse_name}{row.batch_id ? ` · партия ${row.batch_id}` : ""}</span><span className="font-medium">{Number(row.quantity).toLocaleString("ru-RU")} {localizeUnit(row.unit, language)}</span></div>)}</section>
            <section className="space-y-2"><h3 className="font-semibold">Партии и сроки годности</h3>{selectedLots.length ? selectedLots.map(({ receipt, line }) => <div key={line.id} className="grid gap-1 border-b border-slate-800 py-2 text-sm sm:grid-cols-[1fr_180px_180px]"><span>{line.lot_id || "Партия не указана"}</span><span>{String(line.quality_json?.expires_at || "Срок не указан")}</span><span className="text-slate-400">{receipt.ticket_no}</span></div>) : <div className="text-sm text-slate-500">Партии не указаны</div>}</section>
            <section className="space-y-2"><h3 className="font-semibold">Последние движения</h3>{selectedMovements.length ? selectedMovements.map((row) => <div key={row.id} className="grid gap-1 border-b border-slate-800 py-2 text-sm sm:grid-cols-[170px_1fr_160px]"><span className="text-slate-400">{formatDate(row.operation_datetime || row.created_at)}</span><span>{row.warehouse_name}</span><span>{Number(row.quantity_delta || row.quantity).toLocaleString("ru-RU")} {localizeUnit(row.product_unit || selected.unit, language)}</span></div>) : <div className="text-sm text-slate-500">Движений нет</div>}</section>
          </> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
