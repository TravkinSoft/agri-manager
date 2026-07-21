"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, ClipboardList, Package, PackagePlus, Search, Warehouse as WarehouseIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { InventoryTransactionFormDialog } from "@/components/warehouses/inventory-transaction-form-dialog";
import { WarehouseReceiptDialog } from "@/components/warehouses/warehouse-receipt-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { localizeUnit } from "@/lib/i18n/helpers";
import { getWarehouseIssueRequests } from "@/lib/services/warehouse-requests";
import {
  createInventoryTransaction,
  getInventoryBalances,
  getInventoryTransactions,
  getProducts,
  getWarehouseReceipts,
  getWarehouses,
} from "@/lib/services/warehouses";
import type { WarehouseIssueRequest } from "@/lib/types/warehouse-request";
import type {
  InventoryBalance,
  InventoryTransactionFormData,
  InventoryTransactionWithDetails,
  Product,
  Warehouse,
  WarehouseReceipt,
} from "@/lib/types/warehouse";
import { warehouseProductTypeLabel, warehouseTypeLabel } from "@/lib/warehouse/warehouse-scope";

function formatDate(value?: string | null): string {
  if (!value) return "Нет движений";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Нет движений" : date.toLocaleString("ru-RU");
}

function movementLabel(row: InventoryTransactionWithDetails): string {
  if (row.reason_type?.includes("return")) return "Возврат";
  if (row.movement_type === "receipt") return "Приход";
  if (row.movement_type === "transfer") return "Перемещение";
  if (row.movement_type === "adjustment") return "Ревизия / корректировка";
  if (row.movement_type === "writeoff") return "Списание";
  return "Выдача";
}

function isRequestOpen(row: WarehouseIssueRequest): boolean {
  return !["issued", "issued_by_warehouse", "cancelled"].includes(String(row.status || "")) &&
    !["closed", "return_received", "cancelled"].includes(String(row.warehouse_request_status || ""));
}

export default function WarehousesPage() {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [movements, setMovements] = useState<InventoryTransactionWithDetails[]>([]);
  const [receipts, setReceipts] = useState<WarehouseReceipt[]>([]);
  const [requests, setRequests] = useState<WarehouseIssueRequest[]>([]);
  const [search, setSearch] = useState("");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  const [receiptWarehouseId, setReceiptWarehouseId] = useState<string | null>(null);
  const [movementMode, setMovementMode] = useState<"transfer" | "adjustment" | null>(null);

  const canOperate = ["warehouse", "warehouse_operator", "company_admin", "global_admin"].includes(String(profile?.role || ""));
  const canView = canOperate || ["agronomist", "director", "weighman"].includes(String(profile?.role || ""));

  const loadData = async () => {
    if (!profile?.company_id) return;
    setLoading(true);
    setError(null);
    try {
      const [warehouseRows, productRows, balanceRows, movementRows, receiptRows, requestRows] = await Promise.all([
        getWarehouses(profile.company_id, false, language),
        getProducts(profile.company_id, false, language, "agrochemical"),
        getInventoryBalances(profile.company_id, language),
        getInventoryTransactions(profile.company_id, language),
        canOperate ? getWarehouseReceipts(profile.company_id) : Promise.resolve([]),
        canOperate ? getWarehouseIssueRequests(profile.company_id) : Promise.resolve([]),
      ]);
      setWarehouses(warehouseRows);
      setProducts(productRows);
      setBalances(balanceRows.filter((row) => ["pesticide", "fertilizer", "additive"].includes(String(row.product_type || "").toLowerCase())));
      setMovements(movementRows);
      setReceipts(receiptRows);
      setRequests(requestRows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить склады");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [profile?.company_id, profile?.role, language]);

  const summaries = useMemo(() => warehouses.map((warehouse) => {
    const stock = balances.filter((row) => row.warehouse_id === warehouse.id);
    const latest = movements.find((row) => row.warehouse_id === warehouse.id || row.source_warehouse_id === warehouse.id || row.destination_warehouse_id === warehouse.id);
    const openRequests = requests.filter((row) => isRequestOpen(row) && (!row.source_warehouse_id || row.source_warehouse_id === warehouse.id));
    return { warehouse, stock, latest, openRequests };
  }), [warehouses, balances, movements, requests]);

  const filteredSummaries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return summaries.filter(({ warehouse, stock }) => !query || `${warehouse.name} ${warehouseTypeLabel(warehouse.warehouse_type)} ${stock.map((row) => row.product_name).join(" ")}`.toLowerCase().includes(query));
  }, [summaries, search]);

  const selectedSummary = summaries.find((row) => row.warehouse.id === selectedWarehouseId) || null;
  const selectedReceipts = selectedWarehouseId ? receipts.filter((row) => row.warehouse_to_id === selectedWarehouseId).slice(0, 10) : [];
  const selectedMovements = selectedWarehouseId ? movements.filter((row) => row.warehouse_id === selectedWarehouseId || row.source_warehouse_id === selectedWarehouseId || row.destination_warehouse_id === selectedWarehouseId).slice(0, 20) : [];

  const submitMovement = async (data: InventoryTransactionFormData) => {
    if (!profile?.company_id) return;
    try {
      await createInventoryTransaction(profile.company_id, data, profile.id);
      toast({ title: "Сохранено", description: movementMode === "transfer" ? "Перемещение проведено" : "Ревизия проведена" });
      setMovementMode(null);
      await loadData();
    } catch (cause) {
      toast({ title: "Ошибка", description: cause instanceof Error ? cause.message : "Не удалось провести движение", variant: "destructive" });
      throw cause;
    }
  };

  if (!canView) {
    return <Alert variant="destructive"><AlertDescription>Доступ к складам запрещён для текущей роли.</AlertDescription></Alert>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Склады"
        description="Остатки, движения и рабочие действия по доступным складам"
      >
        {canOperate ? (
          <Button onClick={() => setReceiptWarehouseId(warehouses[0]?.id || "")} disabled={warehouses.length === 0}>
            <PackagePlus className="mr-2 h-4 w-4" /> Создать приход
          </Button>
        ) : null}
      </PageHeader>

      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
        <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти склад или материал" />
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Загрузка складов...</div>
      ) : filteredSummaries.length === 0 ? (
        <div className="border-y border-slate-800 py-12 text-center text-sm text-slate-400">Доступные склады не найдены. Администратор должен указать назначение склада.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredSummaries.map(({ warehouse, stock, latest, openRequests }) => (
            <Card key={warehouse.id} className="rounded-md border-slate-800 bg-slate-900/60">
              <CardHeader className="space-y-2 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-lg">{warehouse.name}</CardTitle>
                    <div className="mt-1 text-sm text-slate-400">{warehouseTypeLabel(warehouse.warehouse_type)}</div>
                  </div>
                  <Badge className={stock.length > 0 ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-500/15 text-amber-200"}>
                    {stock.length > 0 ? "Рабочий" : "Пустой"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><div className="text-slate-500">Позиций</div><div className="mt-1 text-lg font-semibold">{stock.length}</div></div>
                  <div><div className="text-slate-500">Открытых заявок</div><div className="mt-1 text-lg font-semibold">{openRequests.length}</div></div>
                </div>
                <div className="text-sm"><div className="text-slate-500">Последнее движение</div><div className="mt-1 text-slate-200">{formatDate(latest?.operation_datetime || latest?.created_at)}</div></div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setSelectedWarehouseId(warehouse.id)}>Открыть</Button>
                  {canOperate ? <Button className="flex-1" onClick={() => setReceiptWarehouseId(warehouse.id)}>Создать приход</Button> : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={Boolean(selectedSummary)} onOpenChange={(open) => !open && setSelectedWarehouseId(null)}>
        <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[92vh] sm:max-h-[92vh] sm:w-[min(1100px,calc(100vw-32px))] sm:max-w-[1100px] sm:rounded-lg">
          {selectedSummary ? (
            <>
              <DialogHeader className="shrink-0 border-b border-slate-800 px-5 py-4 text-left">
                <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
                  <div>
                    <DialogTitle className="flex items-center gap-2 text-xl"><WarehouseIcon className="h-5 w-5 text-yellow-400" />{selectedSummary.warehouse.name}</DialogTitle>
                    <DialogDescription className="mt-1">{warehouseTypeLabel(selectedSummary.warehouse.warehouse_type)} · {selectedSummary.stock.length > 0 ? "Рабочий" : "Пустой"} · последнее движение {formatDate(selectedSummary.latest?.operation_datetime || selectedSummary.latest?.created_at)}</DialogDescription>
                  </div>
                  {canOperate ? (
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => setReceiptWarehouseId(selectedSummary.warehouse.id)}><PackagePlus className="mr-2 h-4 w-4" />Приход</Button>
                      <Button variant="outline" onClick={() => setMovementMode("transfer")}><ArrowRightLeft className="mr-2 h-4 w-4" />Переместить</Button>
                      <Button variant="outline" onClick={() => setMovementMode("adjustment")}><ClipboardList className="mr-2 h-4 w-4" />Ревизия</Button>
                    </div>
                  ) : null}
                </div>
              </DialogHeader>

              <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-4">
                <section>
                  <h3 className="mb-3 text-base font-semibold">Текущие остатки</h3>
                  <div className="overflow-x-auto">
                    <Table><TableHeader><TableRow><TableHead>Материал</TableHead><TableHead>Категория</TableHead><TableHead className="text-right">Количество</TableHead><TableHead>Обновлено</TableHead></TableRow></TableHeader>
                      <TableBody>{selectedSummary.stock.length ? selectedSummary.stock.map((row) => <TableRow key={`${row.product_id}-${row.batch_id || ""}`}><TableCell className="font-medium">{row.product_name}</TableCell><TableCell>{warehouseProductTypeLabel(row.product_type)}</TableCell><TableCell className="text-right">{Number(row.quantity).toLocaleString("ru-RU")} {localizeUnit(row.unit, language)}</TableCell><TableCell>{formatDate(row.last_updated)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={4} className="text-center text-slate-500">Остатков нет</TableCell></TableRow>}</TableBody>
                    </Table>
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 text-base font-semibold">Последние движения</h3>
                  <div className="space-y-2">{selectedMovements.length ? selectedMovements.map((row) => <button key={row.id} className="grid w-full gap-1 border-b border-slate-800 py-2 text-left text-sm sm:grid-cols-[150px_1fr_140px_160px]" type="button"><span className="text-slate-400">{formatDate(row.operation_datetime || row.created_at)}</span><span className="font-medium">{row.product_name}</span><span>{movementLabel(row)}</span><span className={Number(row.quantity_delta || 0) >= 0 ? "text-emerald-300" : "text-red-300"}>{Number(row.quantity_delta || 0) >= 0 ? "+" : ""}{Number(row.quantity_delta || row.quantity).toLocaleString("ru-RU")} {localizeUnit(row.product_unit || "", language)}</span></button>) : <div className="text-sm text-slate-500">Движений нет</div>}</div>
                </section>

                <section>
                  <h3 className="mb-3 text-base font-semibold">Открытые заявки</h3>
                  <div className="space-y-2">{selectedSummary.openRequests.length ? selectedSummary.openRequests.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 border-b border-slate-800 py-2 text-sm"><span>{row.request_number} · {row.field_name || "Поле не указано"}</span><Badge variant="outline">{row.status}</Badge></div>) : <div className="text-sm text-slate-500">Открытых заявок нет</div>}</div>
                </section>

                <section>
                  <h3 className="mb-3 text-base font-semibold">Последние приходы</h3>
                  <div className="space-y-2">{selectedReceipts.length ? selectedReceipts.map((row) => <div key={row.id} className="grid gap-1 border-b border-slate-800 py-2 text-sm sm:grid-cols-[180px_1fr_130px]"><span className="font-medium">{row.ticket_no}</span><span>{row.supplier || "Поставщик не указан"} · {row.lines.length} поз.</span><span className="text-slate-400">{formatDate(row.finalized_at || row.created_at)}</span></div>) : <div className="text-sm text-slate-500">Приходов пока нет</div>}</div>
                </section>
              </div>
              <DialogFooter className="shrink-0 border-t border-slate-800 px-5 py-3"><Button variant="outline" onClick={() => setSelectedWarehouseId(null)}>Закрыть</Button></DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {profile?.company_id ? (
        <WarehouseReceiptDialog
          open={receiptWarehouseId !== null}
          onOpenChange={(open) => !open && setReceiptWarehouseId(null)}
          companyId={profile.company_id}
          warehouses={warehouses}
          products={products}
          defaultWarehouseId={receiptWarehouseId}
          onCreated={async (receipt) => {
            toast({ title: "Приход проведён", description: `Документ ${receipt.receipt_no} создан, ledger IN записан.` });
            await loadData();
          }}
        />
      ) : null}

      <InventoryTransactionFormDialog
        open={movementMode !== null}
        onOpenChange={(open) => !open && setMovementMode(null)}
        onSubmit={submitMovement}
        warehouses={warehouses}
        products={products}
        allowedMovementTypes={movementMode ? [movementMode] : ["transfer", "adjustment"]}
        defaultValues={movementMode && selectedSummary ? {
          movement_type: movementMode,
          status: "confirmed",
          source_warehouse_id: selectedSummary.warehouse.id,
          destination_warehouse_id: movementMode === "adjustment" ? selectedSummary.warehouse.id : "",
          operation_datetime: new Date().toISOString().slice(0, 16),
          transaction_type: movementMode === "adjustment" ? "in" : "out",
        } : undefined}
      />
    </div>
  );
}
