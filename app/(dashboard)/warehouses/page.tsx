"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  Boxes,
  ClipboardList,
  PackageOpen,
  PackagePlus,
  Search,
  Settings2,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { HarvestBatchDialog } from "@/components/warehouses/harvest-batch-dialog";
import { WarehouseReceiptDialog } from "@/components/warehouses/warehouse-receipt-dialog";
import { WarehouseStockDetailsDialog } from "@/components/warehouses/warehouse-stock-details-dialog";
import { WarehouseTransferDialog } from "@/components/warehouses/warehouse-transfer-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { localizeUnit } from "@/lib/i18n/helpers";
import { getWarehouseIssueRequests } from "@/lib/services/warehouse-requests";
import { listHarvestBatchSummaries } from "@/lib/services/weighbridge";
import {
  getInventoryBalances,
  getInventoryTransactions,
  getProducts,
  getWarehouseReceipts,
  getWarehouses,
} from "@/lib/services/warehouses";
import type { WarehouseIssueRequest } from "@/lib/types/warehouse-request";
import type { HarvestBatchSummary } from "@/lib/types/weighbridge";
import type {
  InventoryBalance,
  InventoryTransactionWithDetails,
  Product,
  Warehouse,
  WarehouseReceipt,
} from "@/lib/types/warehouse";
import {
  isAgrochemicalWarehouseType,
  warehouseProductTypeLabel,
  warehouseTypeLabel,
} from "@/lib/warehouse/warehouse-scope";

function formatDate(value?: string | null): string {
  if (!value) return "Движений пока нет";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Движений пока нет" : date.toLocaleString("ru-RU");
}

function movementLabel(row: InventoryTransactionWithDetails): string {
  if (row.reason_type === "warehouse_inventory_adjustment") return "Инвентаризация";
  if (row.reason_type?.includes("return")) return "Возврат";
  if (row.reason_type?.includes("transfer")) return row.transaction_type === "in" ? "Перемещение IN" : "Перемещение OUT";
  if (row.reason_type?.includes("harvest")) return "Поступление урожая";
  if (row.reason_type?.includes("impurit")) return "Вывоз примесей";
  if (row.movement_type === "receipt") return "Приход";
  if (row.movement_type === "writeoff") return "Списание";
  return "Выдача";
}

function isRequestOpen(row: WarehouseIssueRequest): boolean {
  return !["issued", "issued_by_warehouse", "cancelled"].includes(String(row.status || "")) &&
    !["closed", "return_received", "cancelled"].includes(String(row.warehouse_request_status || ""));
}

function quantity(value: number): string {
  return Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function isArchived(warehouse: Warehouse): boolean {
  return warehouse.archived === true || warehouse.is_archived === true;
}

function searchableBatch(batch: HarvestBatchSummary): string {
  return [
    batch.batchCode,
    batch.productName,
    batch.cropName,
    batch.varietyName,
    batch.reproductionName,
    batch.fieldName,
    batch.operationName,
  ].join(" ");
}

type Summary = {
  warehouse: Warehouse;
  stock: InventoryBalance[];
  batches: HarvestBatchSummary[];
  latest: InventoryTransactionWithDetails | null;
  openRequests: WarehouseIssueRequest[];
  receipts: WarehouseReceipt[];
};

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
  const [harvestBatches, setHarvestBatches] = useState<HarvestBatchSummary[]>([]);
  const [search, setSearch] = useState("");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  const [receiptWarehouseId, setReceiptWarehouseId] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [detailBalance, setDetailBalance] = useState<InventoryBalance | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<HarvestBatchSummary | null>(null);

  const role = String(profile?.role || "");
  const canStockOperate = ["warehouse", "warehouse_operator", "global_admin"].includes(role);
  const canManageWarehouses = ["company_admin", "global_admin"].includes(role);
  const canView = canStockOperate || canManageWarehouses || ["agronomist", "director", "weighman"].includes(role);
  const isReadOnlyRole = ["weighman", "agronomist", "director"].includes(role);

  const loadData = async () => {
    if (!profile?.company_id) return;
    setLoading(true);
    setError(null);
    try {
      const [warehouseRows, productRows, balanceRows, movementRows, receiptRows, requestRows, batchRows] = await Promise.all([
        getWarehouses(profile.company_id, canManageWarehouses, language),
        canStockOperate ? getProducts(profile.company_id, false, language, "agrochemical") : Promise.resolve([]),
        getInventoryBalances(profile.company_id, language),
        getInventoryTransactions(profile.company_id, language),
        canStockOperate ? getWarehouseReceipts(profile.company_id) : Promise.resolve([]),
        canStockOperate ? getWarehouseIssueRequests(profile.company_id) : Promise.resolve([]),
        listHarvestBatchSummaries(profile.company_id),
      ]);
      setWarehouses(warehouseRows);
      setProducts(productRows);
      setBalances(balanceRows);
      setMovements(movementRows);
      setReceipts(receiptRows);
      setRequests(requestRows);
      setHarvestBatches(batchRows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить склады");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // loadData is intentionally tied to the selected company and role contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.company_id, profile?.role, language]);

  const summaries = useMemo<Summary[]>(() => warehouses.map((warehouse) => {
    const stock = balances.filter((row) => row.warehouse_id === warehouse.id);
    const batches = harvestBatches.filter((row) => row.warehouseId === warehouse.id);
    const latest = movements.find(
      (row) =>
        row.warehouse_id === warehouse.id ||
        row.source_warehouse_id === warehouse.id ||
        row.destination_warehouse_id === warehouse.id
    ) || null;
    const openRequests = requests.filter(
      (row) => isRequestOpen(row) && (!row.source_warehouse_id || row.source_warehouse_id === warehouse.id)
    );
    const warehouseReceipts = receipts.filter((row) => row.warehouse_to_id === warehouse.id);
    return { warehouse, stock, batches, latest, openRequests, receipts: warehouseReceipts };
  }), [warehouses, balances, harvestBatches, movements, requests, receipts]);

  const query = search.trim().toLowerCase();
  const filteredSummaries = useMemo(() => summaries.filter(({ warehouse, stock, batches }) => {
    if (!query) return true;
    const haystack = [
      warehouse.name,
      warehouseTypeLabel(warehouse.warehouse_type),
      ...stock.map((row) => `${row.product_name} ${row.identity_name || ""}`),
      ...batches.map(searchableBatch),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  }), [summaries, query]);

  const activeSummaries = filteredSummaries.filter((row) => !isArchived(row.warehouse));
  const archivedSummaries = filteredSummaries.filter((row) => isArchived(row.warehouse));
  const selectedSummary = summaries.find((row) => row.warehouse.id === selectedWarehouseId) || null;
  const selectedMovements = selectedWarehouseId
    ? movements.filter(
        (row) =>
          row.warehouse_id === selectedWarehouseId ||
          row.source_warehouse_id === selectedWarehouseId ||
          row.destination_warehouse_id === selectedWarehouseId
      ).slice(0, 20)
    : [];
  const selectedCanOperate = Boolean(
    selectedSummary &&
    canStockOperate &&
    isAgrochemicalWarehouseType(selectedSummary.warehouse.warehouse_type) &&
    !isArchived(selectedSummary.warehouse)
  );

  const unitBreakdown = (rows: InventoryBalance[], key: "quantity" | "reserved_quantity" | "available_quantity") => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      const value = key === "quantity"
        ? Number(row.quantity || 0)
        : key === "reserved_quantity"
          ? Number(row.reserved_quantity || 0)
          : Number(row.available_quantity ?? row.quantity ?? 0);
      totals.set(row.unit, (totals.get(row.unit) || 0) + value);
    }
    if (!totals.size) return "0";
    return Array.from(totals.entries())
      .map(([unit, value]) => `${quantity(value)} ${localizeUnit(unit, language)}`)
      .join(" · ");
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || !query || filteredSummaries.length === 0) return;
    setSelectedWarehouseId(filteredSummaries[0].warehouse.id);
  };

  if (!canView) {
    return <Alert variant="destructive"><AlertDescription>Доступ к складам запрещён для текущей роли.</AlertDescription></Alert>;
  }

  const renderWarehouseCard = ({ warehouse, stock, batches, latest }: Summary) => {
    const cleanMass = batches.reduce((sum, batch) => sum + batch.cleanMassKg, 0);
    const empty = stock.length === 0 && batches.length === 0;
    return (
      <Card
        key={warehouse.id}
        role="button"
        tabIndex={0}
        aria-label={`Открыть склад ${warehouse.name}`}
        onClick={() => setSelectedWarehouseId(warehouse.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSelectedWarehouseId(warehouse.id);
          }
        }}
        className="cursor-pointer rounded-md border-slate-800 bg-slate-900/60 transition-colors hover:border-yellow-500/60 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
      >
        <CardHeader className="space-y-2 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate text-lg">{warehouse.name}</CardTitle>
              <div className="mt-1 text-sm text-slate-400">{warehouseTypeLabel(warehouse.warehouse_type)}</div>
            </div>
            <Badge className={isArchived(warehouse) ? "bg-slate-700 text-slate-200" : empty ? "bg-amber-500/15 text-amber-200" : "bg-emerald-500/15 text-emerald-200"}>
              {isArchived(warehouse) ? "Архив" : empty ? "Пустой" : "Активный"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-slate-500">Позиций</div><div className="mt-1 text-lg font-semibold">{stock.length}</div></div>
            <div><div className="text-slate-500">Партий</div><div className="mt-1 text-lg font-semibold">{batches.length}</div></div>
          </div>
          {cleanMass > 0 ? (
            <div className="text-sm"><div className="text-slate-500">Чистая масса урожая</div><div className="mt-1 font-semibold text-emerald-300">{quantity(cleanMass)} кг</div></div>
          ) : null}
          <div className="text-sm">
            <div className="text-slate-500">Последнее движение</div>
            <div className="mt-1 text-slate-200">{formatDate(latest?.operation_datetime || latest?.created_at)}</div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Склады" description="Все склады компании, текущие остатки, партии и движения">
        <div className="flex flex-wrap gap-2">
          {isReadOnlyRole ? <Badge variant="outline">Только просмотр</Badge> : null}
          {canManageWarehouses ? (
            <Button asChild variant="outline">
              <Link href="/warehouses/manage"><Settings2 className="mr-2 h-4 w-4" />Управление складами</Link>
            </Button>
          ) : null}
          {canStockOperate ? (
            <Button asChild variant="outline">
              <Link href="/warehouses/inventory"><ClipboardList className="mr-2 h-4 w-4" />Инвентаризация</Link>
            </Button>
          ) : null}
        </div>
      </PageHeader>

      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
        <Input
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Найти склад, материал, культуру, поле или партию"
        />
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Загрузка складов...</div>
      ) : activeSummaries.length === 0 ? (
        <div className="border-y border-slate-800 py-12 text-center text-sm text-slate-400">Активные склады не найдены.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {activeSummaries.map(renderWarehouseCard)}
        </div>
      )}

      {canManageWarehouses && archivedSummaries.length > 0 ? (
        <section className="space-y-3 border-t border-slate-800 pt-5">
          <h2 className="text-base font-semibold text-slate-300">Архивные склады</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {archivedSummaries.map(renderWarehouseCard)}
          </div>
        </section>
      ) : null}

      <Dialog open={Boolean(selectedSummary)} onOpenChange={(open) => !open && setSelectedWarehouseId(null)}>
        <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[92vh] sm:max-h-[92vh] sm:w-[min(1100px,calc(100vw-32px))] sm:max-w-[1100px] sm:rounded-lg">
          {selectedSummary ? (
            <>
              <DialogHeader className="shrink-0 border-b border-slate-800 px-5 py-4 text-left">
                <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
                  <div>
                    <DialogTitle className="flex items-center gap-2 text-xl">
                      <WarehouseIcon className="h-5 w-5 text-yellow-400" />
                      {selectedSummary.warehouse.name}
                    </DialogTitle>
                    <DialogDescription className="mt-1">
                      {warehouseTypeLabel(selectedSummary.warehouse.warehouse_type)} · последнее движение {formatDate(selectedSummary.latest?.operation_datetime || selectedSummary.latest?.created_at)}
                    </DialogDescription>
                  </div>
                  {selectedCanOperate ? (
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => setReceiptWarehouseId(selectedSummary.warehouse.id)}>
                        <PackagePlus className="mr-2 h-4 w-4" />Создать приход
                      </Button>
                      <Button variant="outline" onClick={() => setTransferOpen(true)}>
                        <ArrowRightLeft className="mr-2 h-4 w-4" />Переместить
                      </Button>
                      <Button asChild variant="outline">
                        <Link href="/warehouses/requests"><ClipboardList className="mr-2 h-4 w-4" />Заявки</Link>
                      </Button>
                    </div>
                  ) : (
                    <Badge variant="outline">Только просмотр</Badge>
                  )}
                </div>
              </DialogHeader>

              <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-4">
                <section>
                  <h3 className="mb-3 text-base font-semibold">Сводка</h3>
                  <div className="grid gap-3 border-y border-slate-800 py-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
                    <div><div className="text-slate-500">Позиций</div><div className="mt-1 font-semibold">{selectedSummary.stock.length}</div></div>
                    <div><div className="text-slate-500">Партий</div><div className="mt-1 font-semibold">{selectedSummary.batches.length}</div></div>
                    <div><div className="text-slate-500">Текущий остаток</div><div className="mt-1 font-semibold">{unitBreakdown(selectedSummary.stock, "quantity")}</div></div>
                    <div><div className="text-slate-500">Зарезервировано</div><div className="mt-1 font-semibold text-amber-300">{unitBreakdown(selectedSummary.stock, "reserved_quantity")}</div></div>
                    <div><div className="text-slate-500">Доступно</div><div className="mt-1 font-semibold text-emerald-300">{unitBreakdown(selectedSummary.stock, "available_quantity")}</div></div>
                    <div><div className="text-slate-500">Последнее движение</div><div className="mt-1 font-semibold">{formatDate(selectedSummary.latest?.operation_datetime || selectedSummary.latest?.created_at)}</div></div>
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 flex items-center gap-2 text-base font-semibold"><Boxes className="h-4 w-4 text-yellow-400" />Материалы / культуры</h3>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Материал / культура</TableHead>
                          <TableHead>Категория</TableHead>
                          <TableHead className="text-right">Всего</TableHead>
                          <TableHead className="text-right">Доступно</TableHead>
                          <TableHead className="text-right">Резерв</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedSummary.stock.length ? selectedSummary.stock.map((row) => {
                          const matched = Boolean(query && `${row.product_name} ${row.identity_name || ""}`.toLowerCase().includes(query));
                          return (
                            <TableRow
                              key={`${row.product_id}-${row.unit}`}
                              className={`cursor-pointer hover:bg-slate-900 ${matched ? "bg-yellow-500/10" : ""}`}
                              tabIndex={0}
                              onClick={() => setDetailBalance(row)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setDetailBalance(row);
                                }
                              }}
                            >
                              <TableCell className="font-medium">{row.product_name}</TableCell>
                              <TableCell>{warehouseProductTypeLabel(row.product_type)}</TableCell>
                              <TableCell className="text-right">{quantity(row.quantity)} {localizeUnit(row.unit, language)}</TableCell>
                              <TableCell className="text-right text-emerald-300">{quantity(Number(row.available_quantity ?? row.quantity))} {localizeUnit(row.unit, language)}</TableCell>
                              <TableCell className="text-right text-amber-300">{quantity(Number(row.reserved_quantity || 0))} {localizeUnit(row.unit, language)}</TableCell>
                            </TableRow>
                          );
                        }) : (
                          <TableRow><TableCell colSpan={5} className="text-center text-slate-500">Остатков нет</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  {selectedSummary.stock.length > 0 ? <div className="mt-2 text-xs text-slate-500">Нажмите позицию, чтобы увидеть её партии и движения.</div> : null}
                </section>

                <section>
                  <h3 className="mb-3 flex items-center gap-2 text-base font-semibold"><PackageOpen className="h-4 w-4 text-emerald-400" />Партии урожая</h3>
                  {selectedSummary.batches.length ? (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {selectedSummary.batches.map((batch) => {
                        const matched = Boolean(query && searchableBatch(batch).toLowerCase().includes(query));
                        return (
                          <button
                            key={batch.id}
                            type="button"
                            onClick={() => setSelectedBatch(batch)}
                            className={`min-h-[178px] rounded-md border p-4 text-left transition-colors hover:border-yellow-500/60 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 ${matched ? "border-yellow-500/70 bg-yellow-500/10" : "border-slate-800 bg-slate-900/50"}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate font-semibold">{batch.cropName} / {batch.varietyName}</div>
                                <div className="mt-1 text-sm text-slate-400">{batch.reproductionName} · {batch.fieldName}</div>
                              </div>
                              <Badge variant="outline" className="shrink-0">{batch.batchCode}</Badge>
                            </div>
                            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                              <div><div className="text-slate-500">Принято</div><div className="mt-1 font-semibold">{quantity(batch.receivedKg)} кг</div></div>
                              <div><div className="text-slate-500">Примеси</div><div className="mt-1 font-semibold text-amber-300">{quantity(batch.removedKg)} кг</div></div>
                              <div><div className="text-slate-500">Чистая масса</div><div className="mt-1 font-semibold text-emerald-300">{quantity(batch.cleanMassKg)} кг</div></div>
                            </div>
                            <div className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-400">
                              Примеси {batch.impurityPercent.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}% · валовая урожайность {batch.grossYieldTPerHa == null ? "—" : `${quantity(batch.grossYieldTPerHa)} т/га`} · чистая {batch.cleanYieldTPerHa == null ? "—" : `${quantity(batch.cleanYieldTPerHa)} т/га`}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : <div className="text-sm text-slate-500">Партий урожая нет</div>}
                </section>

                <section>
                  <h3 className="mb-3 text-base font-semibold">Последние движения</h3>
                  <div className="space-y-2">
                    {selectedMovements.length ? selectedMovements.map((row) => (
                      <div key={row.id} className="grid gap-1 border-b border-slate-800 py-2 text-sm sm:grid-cols-[170px_1fr_150px_140px]">
                        <span className="text-slate-400">{formatDate(row.operation_datetime || row.created_at)}</span>
                        <span className="font-medium">{row.product_name}</span>
                        <span>{movementLabel(row)}</span>
                        <span className={Number(row.quantity_delta || 0) >= 0 ? "text-emerald-300" : "text-red-300"}>
                          {Number(row.quantity_delta || 0) >= 0 ? "+" : ""}{quantity(Number(row.quantity_delta || row.quantity))} {localizeUnit(row.product_unit || "", language)}
                        </span>
                      </div>
                    )) : <div className="text-sm text-slate-500">Движений нет</div>}
                  </div>
                </section>

                {canStockOperate ? (
                  <>
                    <section>
                      <h3 className="mb-3 text-base font-semibold">Открытые заявки</h3>
                      <div className="space-y-2">
                        {selectedSummary.openRequests.length ? selectedSummary.openRequests.map((row) => (
                          <div key={row.id} className="flex items-center justify-between gap-3 border-b border-slate-800 py-2 text-sm">
                            <span>{row.request_number} · {row.field_name || "Поле не указано"}</span>
                            <Badge variant="outline">{row.status}</Badge>
                          </div>
                        )) : <div className="text-sm text-slate-500">Открытых заявок нет</div>}
                      </div>
                    </section>
                    <section>
                      <h3 className="mb-3 text-base font-semibold">Последние приходы агрохимии</h3>
                      <div className="space-y-2">
                        {selectedSummary.receipts.length ? selectedSummary.receipts.slice(0, 10).map((row) => (
                          <div key={row.id} className="grid gap-1 border-b border-slate-800 py-2 text-sm sm:grid-cols-[180px_1fr_130px]">
                            <span className="font-medium">{row.ticket_no}</span>
                            <span>{row.supplier || "Поставщик не указан"} · {row.lines.length} поз.</span>
                            <span className="text-slate-400">{formatDate(row.finalized_at || row.created_at)}</span>
                          </div>
                        )) : <div className="text-sm text-slate-500">Приходов пока нет</div>}
                      </div>
                    </section>
                  </>
                ) : null}
              </div>

              <DialogFooter className="shrink-0 border-t border-slate-800 px-5 py-3">
                <Button variant="outline" onClick={() => setSelectedWarehouseId(null)}>Закрыть</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {profile?.company_id && canStockOperate ? (
        <WarehouseReceiptDialog
          open={receiptWarehouseId !== null}
          onOpenChange={(open) => !open && setReceiptWarehouseId(null)}
          companyId={profile.company_id}
          warehouses={warehouses.filter((warehouse) => !isArchived(warehouse) && isAgrochemicalWarehouseType(warehouse.warehouse_type))}
          products={products}
          defaultWarehouseId={receiptWarehouseId}
          onCreated={async (receipt) => {
            toast({ title: "Приход проведён", description: `Документ ${receipt.receipt_no} создан, ledger IN записан.` });
            await loadData();
          }}
        />
      ) : null}
      {profile?.company_id && selectedCanOperate ? (
        <WarehouseTransferDialog
          open={transferOpen}
          onOpenChange={setTransferOpen}
          companyId={profile.company_id}
          sourceWarehouse={selectedSummary?.warehouse || null}
          warehouses={warehouses.filter((warehouse) => !isArchived(warehouse) && isAgrochemicalWarehouseType(warehouse.warehouse_type))}
          balances={balances.filter((row) => ["pesticide", "fertilizer", "additive"].includes(String(row.product_type || "").toLowerCase()))}
          onCreated={async (result) => {
            toast({ title: "Перемещение проведено", description: `${result.transfer_no}: OUT и IN записаны атомарно.` });
            await loadData();
          }}
        />
      ) : null}
      {profile?.company_id ? (
        <WarehouseStockDetailsDialog
          open={detailBalance !== null}
          onOpenChange={(open) => !open && setDetailBalance(null)}
          companyId={profile.company_id}
          balance={detailBalance}
        />
      ) : null}
      <HarvestBatchDialog
        open={selectedBatch !== null}
        onOpenChange={(open) => !open && setSelectedBatch(null)}
        batch={selectedBatch}
      />
    </div>
  );
}
