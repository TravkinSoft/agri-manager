"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  Boxes,
  ClipboardList,
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
import { PageHeader } from "@/components/layout/page-header";
import { HarvestBatchDialog } from "@/components/warehouses/harvest-batch-dialog";
import { WarehouseReceiptDialog } from "@/components/warehouses/warehouse-receipt-dialog";
import { WarehouseStockDetailsDialog } from "@/components/warehouses/warehouse-stock-details-dialog";
import { WarehouseTransferDialog } from "@/components/warehouses/warehouse-transfer-dialog";
import { useToast } from "@/hooks/use-toast";
import { LIVE_REFRESH_TABLES, useLiveRefresh } from "@/hooks/use-live-refresh";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { localizeUnit } from "@/lib/i18n/helpers";
import { listHarvestBatchSummaries } from "@/lib/services/weighbridge";
import {
  getInventoryBalances,
  getProducts,
  getWarehouseSummaries,
} from "@/lib/services/warehouses";
import type { HarvestBatchSummary } from "@/lib/types/weighbridge";
import type {
  InventoryBalance,
  Product,
  Warehouse,
  WarehouseSummary,
} from "@/lib/types/warehouse";
import {
  isAgrochemicalWarehouseType,
  isReceiptWarehouseType,
  warehouseTypeLabel,
} from "@/lib/warehouse/warehouse-scope";

function formatDate(value?: string | null): string {
  if (!value) return "Движений пока нет";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Движений пока нет" : date.toLocaleString("ru-RU");
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
  positionCount: number;
  lastMovementAt: string | null;
  summaryLoaded: boolean;
  detailsLoaded: boolean;
};

const warehousePageCache = new Map<string, {
  summaries: WarehouseSummary[];
  balances?: InventoryBalance[];
  harvestBatches?: HarvestBatchSummary[];
  loadedWarehouseIds?: string[];
}>();

export default function WarehousesPage() {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseSummaryRows, setWarehouseSummaryRows] = useState<WarehouseSummary[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [harvestBatches, setHarvestBatches] = useState<HarvestBatchSummary[]>([]);
  const [loadedWarehouseIds, setLoadedWarehouseIds] = useState<string[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [searchDataLoaded, setSearchDataLoaded] = useState(false);
  const [searchDataLoading, setSearchDataLoading] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  const [receiptWarehouseId, setReceiptWarehouseId] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [detailBalance, setDetailBalance] = useState<InventoryBalance | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<HarvestBatchSummary | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);

  const role = String(profile?.role || "");
  const canStockOperate = ["warehouse", "warehouse_operator", "global_admin"].includes(role);
  const canManageWarehouses = ["company_admin", "global_admin"].includes(role);
  const canView = canStockOperate || canManageWarehouses || ["agronomist", "director", "weighman"].includes(role);
  const isReadOnlyRole = ["weighman", "agronomist", "director"].includes(role);

  const loadWarehouseList = async ({ foreground = true }: { foreground?: boolean } = {}) => {
    if (!profile?.company_id) return;
    if (foreground) {
      setLoading(true);
      setError(null);
    }
    try {
      const summaryRows = await getWarehouseSummaries(profile.company_id, canManageWarehouses, language);
      setWarehouseSummaryRows(summaryRows);
      setWarehouses(summaryRows.map((row) => row.warehouse));
      const cacheKey = `${profile.company_id}:${language}:${canManageWarehouses}`;
      warehousePageCache.set(cacheKey, { ...warehousePageCache.get(cacheKey), summaries: summaryRows });
      setError(null);
    } catch (cause) {
      if (foreground) {
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить склады");
      } else {
        console.error("Background warehouse refresh failed", cause);
      }
    } finally {
      if (foreground) setLoading(false);
    }
  };

  const loadWarehouseDetails = async (
    warehouseId: string,
    { foreground = true }: { foreground?: boolean } = {}
  ) => {
    if (!profile?.company_id) return;
    if (foreground) {
      setDetailsLoading(true);
      setDetailsError(null);
    }
    try {
      const [balanceRows, batchRows] = await Promise.all([
        getInventoryBalances(profile.company_id, language, { warehouseId }),
        listHarvestBatchSummaries(profile.company_id, { warehouseId, aggregateLots: true }),
      ]);
      setBalances((current) => [
        ...current.filter((row) => row.warehouse_id !== warehouseId),
        ...balanceRows,
      ]);
      setHarvestBatches((current) => [
        ...current.filter((row) => row.warehouseId !== warehouseId),
        ...batchRows,
      ]);
      setLoadedWarehouseIds((current) => current.includes(warehouseId) ? current : [...current, warehouseId]);
      const cacheKey = `${profile.company_id}:${language}:${canManageWarehouses}`;
      const cached = warehousePageCache.get(cacheKey) || { summaries: warehouseSummaryRows };
      warehousePageCache.set(cacheKey, {
        ...cached,
        balances: [...(cached.balances || []).filter((row) => row.warehouse_id !== warehouseId), ...balanceRows],
        harvestBatches: [...(cached.harvestBatches || []).filter((row) => row.warehouseId !== warehouseId), ...batchRows],
        loadedWarehouseIds: Array.from(new Set([...(cached.loadedWarehouseIds || []), warehouseId])),
      });
      setDetailsError(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Не удалось загрузить данные склада";
      if (foreground) setDetailsError(message);
      else console.error("Background warehouse details refresh failed", cause);
    } finally {
      if (foreground) setDetailsLoading(false);
    }
  };

  const loadSearchData = async () => {
    if (!profile?.company_id || searchDataLoading) return;
    setSearchDataLoading(true);
    try {
      const [balanceRows, batchRows] = await Promise.all([
        getInventoryBalances(profile.company_id, language),
        listHarvestBatchSummaries(profile.company_id, { aggregateLots: true }),
      ]);
      setBalances(balanceRows);
      setHarvestBatches(batchRows);
      setSearchDataLoaded(true);
    } catch (cause) {
      console.error("Warehouse content search preload failed", cause);
    } finally {
      setSearchDataLoading(false);
    }
  };

  const openWarehouse = (warehouseId: string) => {
    setSelectedWarehouseId(warehouseId);
    void loadWarehouseDetails(warehouseId, { foreground: !loadedWarehouseIds.includes(warehouseId) });
  };

  const openReceiptDialog = async (warehouseId: string) => {
    if (!profile?.company_id) return;
    if (products.length === 0) {
      setProductsLoading(true);
      try {
        setProducts(await getProducts(profile.company_id, false, language, "agrochemical"));
      } catch (cause) {
        toast({
          title: "Не удалось загрузить каталог",
          description: cause instanceof Error ? cause.message : "Повторите попытку",
          variant: "destructive",
        });
        return;
      } finally {
        setProductsLoading(false);
      }
    }
    setReceiptWarehouseId(warehouseId);
  };

  useEffect(() => {
    const cacheKey = `${profile?.company_id || ""}:${language}:${canManageWarehouses}`;
    const cached = warehousePageCache.get(cacheKey);
    setWarehouses(cached?.summaries.map((row) => row.warehouse) || []);
    setWarehouseSummaryRows(cached?.summaries || []);
    setProducts([]);
    setBalances(cached?.balances || []);
    setHarvestBatches(cached?.harvestBatches || []);
    setLoadedWarehouseIds(cached?.loadedWarehouseIds || []);
    setSelectedWarehouseId(null);
    setSearchDataLoaded(false);
    void loadWarehouseList({ foreground: !cached });
    // Loading is intentionally tied to the selected company and role contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.company_id, profile?.role, language]);

  useLiveRefresh({
    enabled: Boolean(profile?.company_id && canView),
    onRefresh: async () => {
      const tasks: Promise<unknown>[] = [loadWarehouseList({ foreground: false })];
      if (selectedWarehouseId) {
        tasks.push(loadWarehouseDetails(selectedWarehouseId, { foreground: false }));
      }
      await Promise.all(tasks);
      setDetailRevision((current) => current + 1);
    },
    companyId: profile?.company_id,
    tables: LIVE_REFRESH_TABLES.warehouses,
    intervalMs: 60_000,
  });

  useEffect(() => {
    if (!selectedBatch) return;
    const current = harvestBatches.find((batch) => batch.id === selectedBatch.id);
    if (current && current !== selectedBatch) setSelectedBatch(current);
  }, [harvestBatches, selectedBatch]);

  const summaries = useMemo<Summary[]>(() => warehouses.map((warehouse) => {
    const stock = balances.filter((row) => row.warehouse_id === warehouse.id);
    const batches = harvestBatches.filter((row) => row.warehouseId === warehouse.id);
    const serverSummary = warehouseSummaryRows.find((row) => row.warehouse.id === warehouse.id);
    const detailsLoaded = loadedWarehouseIds.includes(warehouse.id);
    return {
      warehouse,
      stock,
      batches,
      positionCount: serverSummary?.position_count || 0,
      lastMovementAt: serverSummary?.last_movement_at || null,
      summaryLoaded: Boolean(serverSummary),
      detailsLoaded,
    };
  }), [warehouses, balances, harvestBatches, warehouseSummaryRows, loadedWarehouseIds]);

  const query = search.trim().toLowerCase();
  useEffect(() => {
    if (!query || searchDataLoaded || searchDataLoading) return;
    const timer = window.setTimeout(() => void loadSearchData(), 300);
    return () => window.clearTimeout(timer);
    // Search data is intentionally loaded only after the user searches warehouse contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, profile?.company_id, language, searchDataLoaded]);

  const filteredSummaries = useMemo(() => summaries.filter(({ warehouse, stock, batches }) => {
    if (!query || searchDataLoading) return true;
    const haystack = [
      warehouse.name,
      warehouseTypeLabel(warehouse.warehouse_type),
      ...stock.map((row) => `${row.product_name} ${row.identity_name || ""}`),
      ...batches.map(searchableBatch),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  }), [summaries, query, searchDataLoading]);

  const activeSummaries = filteredSummaries.filter((row) => !isArchived(row.warehouse));
  const archivedSummaries = filteredSummaries.filter((row) => isArchived(row.warehouse));
  const selectedSummary = summaries.find((row) => row.warehouse.id === selectedWarehouseId) || null;
  const selectedCanReceive = Boolean(
    selectedSummary &&
    canStockOperate &&
    isReceiptWarehouseType(selectedSummary.warehouse.warehouse_type) &&
    !isArchived(selectedSummary.warehouse)
  );
  const selectedCanTransfer = Boolean(
    selectedSummary &&
    canStockOperate &&
    isAgrochemicalWarehouseType(selectedSummary.warehouse.warehouse_type) &&
    !isArchived(selectedSummary.warehouse)
  );
  const selectedHarvestProductIds = new Set(
    (selectedSummary?.batches || []).flatMap((batch) => batch.productIds || [batch.productId]).filter(Boolean)
  );
  const selectedMaterialStock = (selectedSummary?.stock || []).filter((row) => {
    const productIds = row.product_ids?.length ? row.product_ids : [row.product_id];
    return !productIds.some((productId) => selectedHarvestProductIds.has(productId));
  });

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || !query || filteredSummaries.length === 0) return;
    openWarehouse(filteredSummaries[0].warehouse.id);
  };

  if (!canView) {
    return <Alert variant="destructive"><AlertDescription>Доступ к складам запрещён для текущей роли.</AlertDescription></Alert>;
  }

  const renderWarehouseCard = ({ warehouse, positionCount, lastMovementAt, summaryLoaded }: Summary) => {
    const empty = summaryLoaded && positionCount === 0;
    return (
      <Card
        key={warehouse.id}
        role="button"
        tabIndex={0}
        aria-label={`Открыть склад ${warehouse.name}`}
        onClick={() => openWarehouse(warehouse.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openWarehouse(warehouse.id);
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
          <div className="text-sm">
            <div className="text-slate-500">Позиций</div>
            {summaryLoaded ? <div className="mt-1 text-lg font-semibold">{positionCount}</div> : <div className="mt-2 h-6 w-12 animate-pulse rounded bg-slate-800" />}
          </div>
          <div className="text-sm">
            <div className="text-slate-500">Последнее движение</div>
            {summaryLoaded ? <div className="mt-1 text-slate-200">{formatDate(lastMovementAt)}</div> : <div className="mt-2 h-5 w-32 animate-pulse rounded bg-slate-800" />}
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
      {searchDataLoading ? (
        <div className="text-xs text-slate-500" role="status">Ищем по остаткам и партиям...</div>
      ) : null}

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
                      {warehouseTypeLabel(selectedSummary.warehouse.warehouse_type)} · {selectedSummary.positionCount} поз. · последнее движение {formatDate(selectedSummary.lastMovementAt)}
                    </DialogDescription>
                  </div>
                  {selectedCanReceive ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={productsLoading}
                        onClick={() => void openReceiptDialog(selectedSummary.warehouse.id)}
                      >
                        <PackagePlus className="mr-2 h-4 w-4" />{productsLoading ? "Загрузка каталога..." : "Создать приход"}
                      </Button>
                      {selectedCanTransfer ? <Button variant="outline" disabled={!selectedSummary.detailsLoaded || detailsLoading} onClick={() => setTransferOpen(true)}>
                        <ArrowRightLeft className="mr-2 h-4 w-4" />Переместить
                      </Button> : null}
                      <Button asChild variant="outline">
                        <Link href="/warehouses/requests"><ClipboardList className="mr-2 h-4 w-4" />Заявки</Link>
                      </Button>
                    </div>
                  ) : (
                    <Badge variant="outline">Только просмотр</Badge>
                  )}
                </div>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {detailsLoading ? (
                  <div className="rounded-md border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-400" role="status">
                    Обновляем остатки...
                  </div>
                ) : null}
                {detailsError ? (
                  <Alert variant="destructive"><AlertDescription>{detailsError}</AlertDescription></Alert>
                ) : null}
                <section className="mt-4">
                  <h3 className="mb-3 flex items-center gap-2 text-base font-semibold"><Boxes className="h-4 w-4 text-yellow-400" />Остатки</h3>
                  <div className="divide-y divide-slate-800 overflow-hidden rounded-md border border-slate-800 bg-slate-950/35">
                    {selectedSummary.batches.map((batch) => {
                      const identity = batch.reviewState === "requires_review"
                        ? "Требуется уточнение"
                        : [batch.varietyName, batch.reproductionName].filter(Boolean).join(" · ");
                      return (
                        <button
                          key={`harvest-${batch.id}`}
                          type="button"
                          onClick={() => setSelectedBatch(batch)}
                          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-yellow-400"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-slate-100">{batch.cropName}</div>
                            <div className={`mt-0.5 truncate text-sm ${batch.reviewState === "requires_review" ? "text-amber-300" : "text-slate-400"}`}>{identity}</div>
                          </div>
                          <div className="shrink-0 font-semibold text-emerald-300">{quantity(batch.cleanMassKg)} кг</div>
                        </button>
                      );
                    })}
                    {selectedMaterialStock.map((row) => (
                      <button
                        key={`material-${row.product_id}-${row.unit}`}
                        type="button"
                        onClick={() => setDetailBalance(row)}
                        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-yellow-400"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-slate-100">{row.product_name}</div>
                          {row.identity_name ? <div className="mt-0.5 truncate text-sm text-slate-400">{row.identity_name}</div> : null}
                        </div>
                        <div className="shrink-0 font-semibold text-slate-100">{quantity(row.quantity)} {localizeUnit(row.unit, language)}</div>
                      </button>
                    ))}
                    {!detailsLoading && selectedSummary.batches.length === 0 && selectedMaterialStock.length === 0 ? (
                      <div className="px-4 py-10 text-center text-sm text-slate-500">Склад пуст</div>
                    ) : null}
                  </div>
                </section>
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
          warehouses={warehouses.filter((warehouse) => !isArchived(warehouse) && isReceiptWarehouseType(warehouse.warehouse_type))}
          products={products}
          defaultWarehouseId={receiptWarehouseId}
          onCreated={async (receipt) => {
            toast({ title: "Приход проведён", description: `Документ ${receipt.receipt_no} создан, ledger IN записан.` });
            await Promise.all([
              loadWarehouseList({ foreground: false }),
              receiptWarehouseId ? loadWarehouseDetails(receiptWarehouseId, { foreground: false }) : Promise.resolve(),
            ]);
            setDetailRevision((current) => current + 1);
          }}
        />
      ) : null}
      {profile?.company_id && selectedCanTransfer ? (
        <WarehouseTransferDialog
          open={transferOpen}
          onOpenChange={setTransferOpen}
          companyId={profile.company_id}
          sourceWarehouse={selectedSummary?.warehouse || null}
          warehouses={warehouses.filter((warehouse) => !isArchived(warehouse) && isAgrochemicalWarehouseType(warehouse.warehouse_type))}
          balances={balances.filter((row) => ["pesticide", "fertilizer", "additive"].includes(String(row.product_type || "").toLowerCase()))}
          onCreated={async (result) => {
            toast({ title: "Перемещение проведено", description: `${result.transfer_no}: OUT и IN записаны атомарно.` });
            await Promise.all([
              loadWarehouseList({ foreground: false }),
              selectedWarehouseId ? loadWarehouseDetails(selectedWarehouseId, { foreground: false }) : Promise.resolve(),
            ]);
            setDetailRevision((current) => current + 1);
          }}
        />
      ) : null}
      {profile?.company_id ? (
        <WarehouseStockDetailsDialog
          key={`${detailBalance?.warehouse_id || "none"}:${detailBalance?.product_id || "none"}:${detailRevision}`}
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
