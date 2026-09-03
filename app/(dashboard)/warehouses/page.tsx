"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft,
  Boxes,
  ClipboardList,
  PackagePlus,
  Search,
  Settings2,
} from "lucide-react";
import { EmptyState, ObjectVisual, StatusBadge } from "@/components/operations/operational-ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { PageHeader } from "@/components/layout/page-header";
import { HarvestBatchDialog } from "@/components/warehouses/harvest-batch-dialog";
import { StockAvailability } from "@/components/warehouses/stock-availability";
import { compareStoragePlaces, parseWarehouseView, warehouseViewKey, type WarehouseView } from "@/lib/warehouse/stock-availability";
import { WarehouseReceiptDialog } from "@/components/warehouses/warehouse-receipt-dialog";
import { WarehouseOpeningBalanceDialog } from "@/components/warehouses/warehouse-opening-balance-dialog";
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
  getWarehouses,
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
  countVisibleWarehousePositions,
  findWarehouseScopedHarvestBatch,
  warehousePositionCountLabel,
} from "@/lib/warehouse/harvest-batch-selection";
import { warehouseCapacityPercent } from "@/lib/warehouse/warehouse-summary-math";
import {
  isAgrochemicalWarehouseType,
  isReceiptWarehouseType,
  normalizeStoragePlaceType,
  storagePlaceTypeLabel,
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
  harvestLotCount: number;
  harvestWeightKg: number;
  totalWeightKg: number;
  seedWeightKg: number;
  otherMaterialWeightKg: number;
  lastMovementAt: string | null;
  summaryLoaded: boolean;
  detailsLoaded: boolean;
};

function capacityKg(warehouse: Warehouse): number | null {
  if (normalizeStoragePlaceType(warehouse.place_type) !== "WAREHOUSE") return null;
  if (warehouse.storage_capacity_kg != null && Number(warehouse.storage_capacity_kg) > 0) {
    return Number(warehouse.storage_capacity_kg);
  }
  if (warehouse.capacity_value == null || Number(warehouse.capacity_value) <= 0) return null;
  if (warehouse.capacity_unit === "t") return Number(warehouse.capacity_value) * 1000;
  if (warehouse.capacity_unit === "kg") return Number(warehouse.capacity_value);
  return null;
}

function formatMass(valueKg: number): string {
  if (valueKg >= 1000) return `${(valueKg / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} т`;
  return `${valueKg.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} кг`;
}

const warehousePageCache = new Map<string, {
  summaries: WarehouseSummary[];
  warehouses?: Warehouse[];
  balances?: InventoryBalance[];
  harvestBatches?: HarvestBatchSummary[];
  loadedWarehouseIds?: string[];
}>();
type WarehouseDetailsPayload = { balanceRows: InventoryBalance[]; batchRows: HarvestBatchSummary[] };
const warehouseSummaryRequestCache = new Map<string, Promise<WarehouseSummary[]>>();
const warehouseListRequestCache = new Map<string, Promise<Warehouse[]>>();
const warehouseDetailsRequestCache = new Map<string, Promise<WarehouseDetailsPayload>>();
const warehouseDetailsLoadedAt = new Map<string, number>();
const warehouseSummariesLoadedAt = new Map<string, number>();

export default function WarehousesPage() {
  const { profile, user } = useAuth();
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
  const selectedWarehouseIdRef = useRef<string | null>(null);
  const [receiptWarehouseId, setReceiptWarehouseId] = useState<string | null>(null);
  const [openingBalanceOpen, setOpeningBalanceOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [detailBalance, setDetailBalance] = useState<InventoryBalance | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<HarvestBatchSummary | null>(null);
  const [selectedBatchLoading, setSelectedBatchLoading] = useState(false);
  const selectedBatchRequestGeneration = useRef(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const preferenceKey = user?.id && profile?.company_id ? warehouseViewKey(user.id, profile.company_id) : null;
  const [viewPreference, setViewPreference] = useState<{ key: string; view: WarehouseView } | null>(null);
  const selectedView = viewPreference?.key === preferenceKey ? viewPreference.view : "availability";
  const isAgronomist = profile?.role === "agronomist";
  useEffect(() => {
    if (!preferenceKey) return;
    let view: WarehouseView = "availability";
    try { view = parseWarehouseView(window.localStorage.getItem(preferenceKey)); } catch { /* Local preferences are optional. */ }
    setViewPreference({ key: preferenceKey, view });
  }, [preferenceKey]);
  const selectView = (view: WarehouseView) => {
    if (!preferenceKey) return;
    setViewPreference({ key: preferenceKey, view });
    try { window.localStorage.setItem(preferenceKey, view); } catch { /* Keep the selected tab usable when storage is blocked. */ }
  };
  const currentScope = `${profile?.id}:${profile?.company_id}:${language}`;
  const scopeRef = useRef(currentScope);
  scopeRef.current = currentScope;

  const role = String(profile?.role || "");
  const canStockOperate = ["warehouse", "warehouse_operator", "global_admin"].includes(role);
  const canManageWarehouses = ["company_admin", "global_admin"].includes(role);
  const canView = canStockOperate || canManageWarehouses || ["agronomist", "director", "weighman"].includes(role);
  const isReadOnlyRole = ["weighman", "agronomist", "director"].includes(role);

  const loadWarehouseList = async ({
    foreground = true,
    force = false,
    summariesOnly = false,
  }: {
    foreground?: boolean;
    force?: boolean;
    summariesOnly?: boolean;
  } = {}) => {
    if (!profile?.company_id) return;
    const requestScope = scopeRef.current;
    if (foreground) {
      setLoading(true);
      setError(null);
    }
    let warehouseListLoaded = false;
    try {
      const cacheKey = `${profile.company_id}:${language}:${canManageWarehouses}`;
      let warehouseRows = warehouses;
      if (!summariesOnly) {
        let warehouseRequest = warehouseListRequestCache.get(cacheKey);
        if (!warehouseRequest) {
          warehouseRequest = getWarehouses(profile.company_id, canManageWarehouses, language)
            .finally(() => warehouseListRequestCache.delete(cacheKey));
          warehouseListRequestCache.set(cacheKey, warehouseRequest);
        }
        warehouseRows = await warehouseRequest;
        if (scopeRef.current !== requestScope) return;
        warehouseListLoaded = true;
        setWarehouses(warehouseRows);
        const cached = warehousePageCache.get(cacheKey) || { summaries: [] };
        warehousePageCache.set(cacheKey, { ...cached, warehouses: warehouseRows });
        setError(null);
        if (foreground) setLoading(false);
      }

      if (!force && Date.now() - (warehouseSummariesLoadedAt.get(cacheKey) || 0) < 15_000) return;
      let request = warehouseSummaryRequestCache.get(cacheKey);
      if (!request) {
        request = getWarehouseSummaries(profile.company_id, canManageWarehouses, language)
          .finally(() => warehouseSummaryRequestCache.delete(cacheKey));
        warehouseSummaryRequestCache.set(cacheKey, request);
      }
      const summaryRows = await request;
      if (scopeRef.current !== requestScope) return;
      setWarehouseSummaryRows(summaryRows);
      setWarehouses(summaryRows.map((row) => row.warehouse));
      warehousePageCache.set(cacheKey, { ...warehousePageCache.get(cacheKey), warehouses: warehouseRows, summaries: summaryRows });
      warehouseSummariesLoadedAt.set(cacheKey, Date.now());
      setError(null);
    } catch (cause) {
      if (scopeRef.current !== requestScope) return;
      if (foreground && !warehouseListLoaded) {
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить склады");
      } else {
        setError(cause instanceof Error ? `Данные остатков не обновлены: ${cause.message}` : "Данные остатков не обновлены");
      }
    } finally {
      if (foreground && scopeRef.current === requestScope) setLoading(false);
    }
  };

  const loadWarehouseDetails = async (
    warehouseId: string,
    { foreground = true, force = false }: { foreground?: boolean; force?: boolean } = {}
  ) => {
    if (!profile?.company_id) return;
    const requestScope = scopeRef.current;
    if (foreground) {
      setDetailsLoading(true);
      setDetailsError(null);
    }
    try {
      const requestKey = `${profile.company_id}:${language}:${warehouseId}`;
      if (!force && !foreground && Date.now() - (warehouseDetailsLoadedAt.get(requestKey) || 0) < 15_000) return;
      let request = warehouseDetailsRequestCache.get(requestKey);
      if (!request) {
        request = Promise.all([
          getInventoryBalances(profile.company_id, language, { warehouseId }),
          listHarvestBatchSummaries(profile.company_id, { warehouseId, aggregateLots: true, summaryOnly: true }),
        ]).then(([balanceRows, batchRows]) => ({ balanceRows, batchRows }))
          .finally(() => warehouseDetailsRequestCache.delete(requestKey));
        warehouseDetailsRequestCache.set(requestKey, request);
      }
      const { balanceRows, batchRows } = await request;
      if (scopeRef.current !== requestScope) return;
      setBalances((current) => [
        ...current.filter((row) => row.warehouse_id !== warehouseId),
        ...balanceRows,
      ]);
      setHarvestBatches((current) => [
        ...current.filter((row) => row.warehouseId !== warehouseId),
        ...batchRows,
      ]);
      setLoadedWarehouseIds((current) => current.includes(warehouseId) ? current : [...current, warehouseId]);
      warehouseDetailsLoadedAt.set(requestKey, Date.now());
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
      if (scopeRef.current !== requestScope) return;
      const message = cause instanceof Error ? cause.message : "Не удалось загрузить данные склада";
      if (foreground) setDetailsError(message);
      else console.error("Background warehouse details refresh failed", cause);
    } finally {
      if (foreground && scopeRef.current === requestScope) setDetailsLoading(false);
    }
  };

  const loadSearchData = async () => {
    if (!profile?.company_id || searchDataLoading) return;
    const requestScope = scopeRef.current;
    setSearchDataLoading(true);
    try {
      const [balanceRows, batchRows] = await Promise.all([
        getInventoryBalances(profile.company_id, language),
        listHarvestBatchSummaries(profile.company_id, { aggregateLots: true, summaryOnly: true }),
      ]);
      if (scopeRef.current !== requestScope) return;
      setBalances(balanceRows);
      setHarvestBatches(batchRows);
      setSearchDataLoaded(true);
    } catch (cause) {
      console.error("Warehouse content search preload failed", cause);
    } finally {
      if (scopeRef.current === requestScope) setSearchDataLoading(false);
    }
  };

  const openWarehouse = (warehouseId: string) => {
    selectedWarehouseIdRef.current = warehouseId;
    setSelectedWarehouseId(warehouseId);
    void loadWarehouseDetails(warehouseId, { foreground: !loadedWarehouseIds.includes(warehouseId) });
  };

  const closeWarehouse = () => {
    selectedWarehouseIdRef.current = null;
    setSelectedWarehouseId(null);
    selectedBatchRequestGeneration.current += 1;
    setSelectedBatch(null);
    setSelectedBatchLoading(false);
    setDetailBalance(null);
    setDetailsLoading(false);
    setDetailsError(null);
  };

  const openHarvestBatch = async (batch: HarvestBatchSummary) => {
    if (!profile?.company_id) return;
    const generation = ++selectedBatchRequestGeneration.current;
    setSelectedBatch(batch);
    if (batch.detailLevel === "full") {
      setSelectedBatchLoading(false);
      return;
    }
    setSelectedBatchLoading(true);
    try {
      const rows = await listHarvestBatchSummaries(profile.company_id, {
        warehouseId: batch.warehouseId,
        aggregateLots: true,
        lotId: batch.aggregateLotId || batch.id,
      });
      const full = rows.find((row) => row.id === batch.id && row.warehouseId === batch.warehouseId);
      if (!full) throw new Error("Партия больше не находится на этом складе");
      if (selectedBatchRequestGeneration.current === generation) {
        setSelectedBatch((current) => current?.id === batch.id && current.warehouseId === batch.warehouseId ? full : current);
      }
    } catch (cause) {
      if (selectedBatchRequestGeneration.current === generation) {
        toast({
          title: "Не удалось загрузить историю партии",
          description: cause instanceof Error ? cause.message : "Повторите попытку",
          variant: "destructive",
        });
      }
    } finally {
      if (selectedBatchRequestGeneration.current === generation) setSelectedBatchLoading(false);
    }
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
    setWarehouses(cached?.warehouses || cached?.summaries.map((row) => row.warehouse) || []);
    setWarehouseSummaryRows(cached?.summaries || []);
    setProducts([]);
    setBalances(cached?.balances || []);
    setHarvestBatches(cached?.harvestBatches || []);
    setLoadedWarehouseIds(cached?.loadedWarehouseIds || []);
    selectedWarehouseIdRef.current = null;
    setSelectedWarehouseId(null);
    selectedBatchRequestGeneration.current += 1;
    setSelectedBatch(null);
    setSelectedBatchLoading(false);
    setDetailBalance(null);
    setReceiptWarehouseId(null);
    setDetailsLoading(false);
    setDetailsError(null);
    setSearchDataLoading(false);
    setSearch("");
    setSearchDataLoaded(false);
    setLoading(!cached);
    void loadWarehouseList({ foreground: !cached });
    // Loading is intentionally tied to the selected company and role contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.company_id, profile?.role, user?.id, language]);

  useLiveRefresh({
    enabled: Boolean(profile?.company_id && canView),
    onRefresh: async (event) => {
      const globalAdminConsistencyPoll = profile?.role === "global_admin" && event?.source === "interval";
      const force = event?.source === "realtime" || event?.source === "online" || globalAdminConsistencyPoll;
      await loadWarehouseList({
        foreground: false,
        force,
        summariesOnly: globalAdminConsistencyPoll,
      });
      // Read the current open warehouse after the summary refresh. Realtime may
      // fire while React is still publishing a newly selected dialog state;
      // the ref prevents that event from leaving the visible stock detail stale.
      const openWarehouseId = selectedWarehouseIdRef.current;
      if (openWarehouseId) {
        await loadWarehouseDetails(openWarehouseId, { foreground: false, force });
      }
      setDetailRevision((current) => current + 1);
    },
    companyId: profile?.company_id,
    tables: LIVE_REFRESH_TABLES.warehouses,
    // A global admin can work in a selected company different from the company
    // encoded in get_user_company_id(). RLS correctly hides that company's raw
    // Realtime rows, so a bounded summaries-only poll is the consistency fallback.
    intervalMs: profile?.role === "global_admin" ? 8_000 : 60_000,
    minRefreshIntervalMs: 5_000,
  });

  useEffect(() => {
    if (!selectedBatch) return;
    const current = findWarehouseScopedHarvestBatch(harvestBatches, selectedBatch);
    if (current && current !== selectedBatch && selectedBatch.detailLevel !== "full") setSelectedBatch(current);
  }, [harvestBatches, selectedBatch]);

  const summaries = useMemo<Summary[]>(() => warehouses.filter((warehouse) => warehouse.company_id === profile?.company_id).map((warehouse) => {
    const stock = balances.filter((row) => row.warehouse_id === warehouse.id);
    const batches = harvestBatches.filter((row) => row.warehouseId === warehouse.id);
    const serverSummary = warehouseSummaryRows.find((row) => row.warehouse.id === warehouse.id);
    const detailsLoaded = loadedWarehouseIds.includes(warehouse.id);
    return {
      warehouse,
      stock,
      batches,
      positionCount: detailsLoaded
        ? countVisibleWarehousePositions(batches, stock)
        : serverSummary?.position_count || 0,
      harvestLotCount: serverSummary?.harvest_lot_count || 0,
      harvestWeightKg: serverSummary?.harvest_weight_kg || 0,
      totalWeightKg: serverSummary?.total_weight_kg ?? 0,
      seedWeightKg: serverSummary?.seed_weight_kg || 0,
      otherMaterialWeightKg: serverSummary?.other_material_weight_kg || 0,
      lastMovementAt: serverSummary?.last_movement_at || null,
      summaryLoaded: Boolean(serverSummary),
      detailsLoaded,
    };
  }).sort((a, b) => compareStoragePlaces(a.warehouse, b.warehouse)), [warehouses, balances, harvestBatches, warehouseSummaryRows, loadedWarehouseIds, profile?.company_id]);

  const query = search.trim().toLowerCase();
  useEffect(() => {
    if (isAgronomist && selectedView === "availability") return;
    if (!query || searchDataLoaded || searchDataLoading) return;
    const timer = window.setTimeout(() => void loadSearchData(), 300);
    return () => window.clearTimeout(timer);
    // Search data is intentionally loaded only after the user searches warehouse contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, profile?.company_id, language, searchDataLoaded, isAgronomist, selectedView]);

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
  const selectedHarvestPositionKeys = new Set(
    (selectedSummary?.batches || []).flatMap((batch) => {
      const productIds = (batch.productIds?.length ? batch.productIds : [batch.productId]).filter(Boolean);
      const batchClasses = Array.from(new Set(
        (batch.stockComponents || []).map((component) => String(component.batchClass || "commodity").toLowerCase())
      ));
      return productIds.flatMap((productId) => (batchClasses.length ? batchClasses : ["commodity"])
        .map((batchClass) => `${productId}|${batchClass}`));
    })
  );
  const selectedMaterialStock = (selectedSummary?.stock || []).flatMap((row) => {
    if (Number.isFinite(Number(row.material_quantity))) {
      const materialQuantity = Number(row.material_quantity || 0);
      return materialQuantity > 0.000001 ? [{ ...row, quantity: materialQuantity }] : [];
    }
    const batchClass = String(row.batch_class || "commodity").toLowerCase();
    if (batchClass === "seed") return [row];
    const productIds = row.product_ids?.length ? row.product_ids : [row.product_id];
    return productIds.some((productId) => selectedHarvestPositionKeys.has(`${productId}|${batchClass}`))
      ? []
      : [row];
  });

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || !query || filteredSummaries.length === 0) return;
    openWarehouse(filteredSummaries[0].warehouse.id);
  };

  if (!canView) {
    return <Alert variant="destructive"><AlertDescription>Доступ к складам запрещён для текущей роли.</AlertDescription></Alert>;
  }

  const renderWarehouseCard = ({ warehouse, positionCount, totalWeightKg, lastMovementAt, summaryLoaded }: Summary) => {
    const invalidStock = summaryLoaded && (!Number.isFinite(totalWeightKg) || totalWeightKg < -0.000001);
    const empty = summaryLoaded && !invalidStock && Math.abs(totalWeightKg) <= 0.000001 && positionCount === 0;
    const placeType = normalizeStoragePlaceType(warehouse.place_type);
    const capacity = capacityKg(warehouse);
    const fillPercent = warehouseCapacityPercent(totalWeightKg, capacity);
    const fillBarPercent = fillPercent == null ? 0 : Math.min(100, fillPercent);
    const capacityExceeded = fillPercent != null && fillPercent > 100;
    return (
      <article
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
        className="group relative min-h-[124px] min-w-0 cursor-pointer rounded-lg border border-slate-700/55 bg-gradient-to-br from-[#172131] to-[#101722] p-3 shadow-[0_3px_10px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.035)] transition-colors hover:border-yellow-500/45 hover:from-[#1b293b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 2xl:min-h-[164px]"
      >
        <div className="flex items-start gap-2.5">
          <ObjectVisual placeType={placeType} className="h-9 w-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="break-words text-sm font-semibold leading-5 text-slate-50">{warehouse.name}</h2>
                <div className="mt-0.5 truncate text-xs text-slate-400">
                  {placeType === "WAREHOUSE" ? warehouseTypeLabel(warehouse.warehouse_type) : storagePlaceTypeLabel(placeType)}
                </div>
              </div>
              {isArchived(warehouse) ? <StatusBadge status="empty">Архив</StatusBadge> : null}
            </div>
          </div>
        </div>
        {!summaryLoaded ? (
          <div className="mt-3 h-16 animate-pulse rounded-md bg-slate-900" aria-label="Загрузка остатка" />
        ) : (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <strong className={`text-xl font-semibold tabular-nums ${invalidStock ? "text-rose-300" : empty ? "text-slate-400" : "text-emerald-300"}`}>
                {invalidStock ? "Проверить остаток" : empty ? "Свободно" : totalWeightKg === 0 ? "Есть материалы" : formatMass(totalWeightKg)}
              </strong>
              {!empty ? <span className="text-xs text-slate-400">{warehousePositionCountLabel(positionCount)}</span> : null}
            </div>
            {invalidStock ? <div role="alert" className="text-xs text-rose-300">Отрицательный или некорректный остаток: {String(totalWeightKg)} кг</div> : null}
            <div className="truncate text-xs text-slate-500" title={formatDate(lastMovementAt)}>{lastMovementAt ? `Движение: ${formatDate(lastMovementAt)}` : "Движений пока нет"}</div>
            {fillPercent != null && !invalidStock && !empty ? (
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Вместимость {formatMass(capacity || 0)}</span><span className={capacityExceeded ? "font-semibold text-rose-300" : undefined}>{fillPercent}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-800"><div className={`h-full rounded-full ${capacityExceeded ? "bg-rose-400/80" : "bg-yellow-400/75"}`} style={{ width: `${fillBarPercent}%` }} /></div>
                {capacityExceeded ? <div className="mt-1 text-[11px] font-medium text-rose-300">Остаток превышает указанную вместимость. Проверьте вместимость объекта.</div> : null}
              </div>
            ) : null}
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Склады" description="Все склады компании, текущие остатки, партии и движения">
        <div className="flex flex-wrap gap-2">
          {isReadOnlyRole ? <Badge variant="outline">Только просмотр</Badge> : null}
          {canManageWarehouses ? (
            <>
              <Button variant="outline" onClick={() => setOpeningBalanceOpen(true)}>
                <PackagePlus className="mr-2 h-4 w-4" />Начальный остаток
              </Button>
              <Button asChild variant="outline">
                <Link href="/warehouses/manage"><Settings2 className="mr-2 h-4 w-4" />Управление складами</Link>
              </Button>
            </>
          ) : null}
          {canStockOperate ? (
            <Button asChild variant="outline">
              <Link href="/warehouses/inventory"><ClipboardList className="mr-2 h-4 w-4" />Инвентаризация</Link>
            </Button>
          ) : null}
        </div>
      </PageHeader>

      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {isAgronomist ? (
        <div role="tablist" aria-label="Представление складов" className="flex gap-1 border-b border-slate-800">
          {([{ value: "availability", label: "В наличии" }, { value: "warehouses", label: "По складам" }] as const).map((tab) => (
            <button key={tab.value} id={`warehouse-tab-${tab.value}`} type="button" role="tab" tabIndex={selectedView === tab.value ? 0 : -1} aria-selected={selectedView === tab.value} aria-controls="warehouse-view" onClick={() => selectView(tab.value)} onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next: WarehouseView = event.key === "Home" ? "availability" : event.key === "End" ? "warehouses" : selectedView === "availability" ? "warehouses" : "availability";
              selectView(next);
              document.getElementById(`warehouse-tab-${next}`)?.focus();
            }} className={`min-h-[44px] border-b-2 px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 ${selectedView === tab.value ? "border-yellow-400 text-yellow-300" : "border-transparent text-slate-400 hover:text-slate-100"}`}>{tab.label}</button>
          ))}
        </div>
      ) : null}
      {isAgronomist && selectedView === "availability" && profile?.company_id && user?.id ? (
        <div id="warehouse-view" role="tabpanel" aria-labelledby="warehouse-tab-availability">
          {loading ? <div role="status" className="py-8 text-sm text-slate-400">Загрузка объектов...</div> : <StockAvailability companyId={profile.company_id} userId={user.id} language={language} warehouses={warehouses} revision={detailRevision} onOpenBatch={(batch) => void openHarvestBatch(batch)} onOpenMaterial={setDetailBalance} />}
        </div>
      ) : <div id="warehouse-view" role={isAgronomist ? "tabpanel" : undefined} aria-labelledby={isAgronomist ? "warehouse-tab-warehouses" : undefined} className="space-y-3">
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {activeSummaries.map(renderWarehouseCard)}
        </div>
      )}

      {canManageWarehouses && archivedSummaries.length > 0 ? (
        <section className="space-y-3 border-t border-slate-800 pt-5">
          <h2 className="text-base font-semibold text-slate-300">Архивные склады</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {archivedSummaries.map(renderWarehouseCard)}
          </div>
        </section>
      ) : null}
      </div>}

      <Dialog open={Boolean(selectedSummary)} onOpenChange={(open) => !open && closeWarehouse()}>
        <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[92vh] sm:max-h-[92vh] sm:w-[min(1100px,calc(100vw-32px))] sm:max-w-[1100px] sm:rounded-lg">
          {selectedSummary ? (
            <>
              <DialogHeader className="shrink-0 border-b border-slate-800 px-5 py-4 text-left">
                <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
                  <div className="flex min-w-0 items-center gap-3">
                    <ObjectVisual placeType={selectedSummary.warehouse.place_type} className="h-11 w-12" />
                    <div className="min-w-0">
                    <DialogTitle className="truncate text-xl">{selectedSummary.warehouse.name}</DialogTitle>
                    <DialogDescription className="mt-1">
                      {normalizeStoragePlaceType(selectedSummary.warehouse.place_type) === "WAREHOUSE"
                        ? warehouseTypeLabel(selectedSummary.warehouse.warehouse_type)
                        : storagePlaceTypeLabel(selectedSummary.warehouse.place_type)} · {warehousePositionCountLabel(selectedSummary.positionCount)} · последнее движение {formatDate(selectedSummary.lastMovementAt)}
                    </DialogDescription>
                    </div>
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
                          onClick={() => void openHarvestBatch(batch)}
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
                        key={`material-${row.product_id}-${row.unit}-${row.batch_class || "commodity"}`}
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
                    {selectedSummary.detailsLoaded && selectedSummary.batches.length === 0 && selectedMaterialStock.length === 0 ? (
                      <div className="px-4"><EmptyState /></div>
                    ) : null}
                    {!detailsLoading && selectedSummary.batches.length === 0 && selectedMaterialStock.length === 0 ? (
                      <div className="px-4 py-10 text-center text-sm text-slate-500">Склад пуст</div>
                    ) : null}
                  </div>
                </section>
              </div>

              <DialogFooter className="shrink-0 border-t border-slate-800 px-5 py-3">
                <Button variant="outline" onClick={closeWarehouse}>Закрыть</Button>
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
              loadWarehouseList({ foreground: false, force: true }),
              receiptWarehouseId ? loadWarehouseDetails(receiptWarehouseId, { foreground: false, force: true }) : Promise.resolve(),
            ]);
            setDetailRevision((current) => current + 1);
          }}
        />
      ) : null}
      {profile?.company_id && canManageWarehouses ? (
        <WarehouseOpeningBalanceDialog
          open={openingBalanceOpen}
          onOpenChange={setOpeningBalanceOpen}
          companyId={profile.company_id}
          warehouses={warehouses.filter((warehouse) => !isArchived(warehouse))}
          defaultWarehouseId={selectedWarehouseId}
          onCreated={async (result) => {
            toast({
              title: "Начальный остаток проведён",
              description: `${result.document_no}: ${result.line_count} строк, без фиктивных талонов.`,
            });
            await loadWarehouseList({ foreground: false, force: true });
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
              loadWarehouseList({ foreground: false, force: true }),
              selectedWarehouseId ? loadWarehouseDetails(selectedWarehouseId, { foreground: false, force: true }) : Promise.resolve(),
            ]);
            setDetailRevision((current) => current + 1);
          }}
        />
      ) : null}
      {profile?.company_id ? (
        <WarehouseStockDetailsDialog
          key={`${detailBalance?.warehouse_id || "none"}:${detailBalance?.product_id || "none"}:${detailBalance?.batch_class || "commodity"}:${detailRevision}`}
          open={detailBalance !== null}
          onOpenChange={(open) => !open && setDetailBalance(null)}
          companyId={profile.company_id}
          balance={detailBalance}
        />
      ) : null}
      <HarvestBatchDialog
        open={selectedBatch !== null}
        onOpenChange={(open) => {
          if (!open) {
            selectedBatchRequestGeneration.current += 1;
            setSelectedBatch(null);
            setSelectedBatchLoading(false);
          }
        }}
        batch={selectedBatch}
        loading={selectedBatchLoading}
      />
    </div>
  );
}
