"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Boxes,
  Check,
  ClipboardList,
  GripVertical,
  PackagePlus,
  Search,
  Settings2,
  X,
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
  reorderWarehouses,
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
  compareWarehouseDisplayOrder,
  moveWarehouseId,
  moveWarehouseIdByOffset,
  reconcileWarehouseOrder,
  withWarehouseDisplayOrder,
} from "@/lib/warehouse/warehouse-order";
import {
  isAgrochemicalWarehouseType,
  isReceiptWarehouseType,
  normalizeStoragePlaceType,
  storagePlaceTypeLabel,
  warehouseTypeLabel,
} from "@/lib/warehouse/warehouse-scope";

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ru-RU");
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
  harvestLotCount: number | null;
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

const WAREHOUSE_ORDER_UI_ENABLED = process.env.NEXT_PUBLIC_UI_WAREHOUSE_V2 === "1";
const WAREHOUSE_REORDER_HOLD_MS = 180;

type ReorderPointerSession = {
  active: boolean;
  lastTargetWarehouseId: string | null;
  pointerId: number;
  warehouseId: string;
  timer: ReturnType<typeof setTimeout> | null;
};

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
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [reorderDraftIds, setReorderDraftIds] = useState<string[]>([]);
  const [reorderSaving, setReorderSaving] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [draggingWarehouseId, setDraggingWarehouseId] = useState<string | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const reorderDraftIdsRef = useRef<string[]>([]);
  const reorderInitialIdsRef = useRef<string[]>([]);
  const reorderSaveGeneration = useRef(0);
  const reorderSavingRef = useRef(false);
  const reorderPointerRef = useRef<ReorderPointerSession | null>(null);
  const reorderGridRef = useRef<HTMLDivElement | null>(null);
  const reorderLayoutBeforeRef = useRef<Map<string, DOMRect> | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [availabilityRefreshTick, setAvailabilityRefreshTick] = useState(0);
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
        if (reorderSavingRef.current) {
          warehouseRows = withWarehouseDisplayOrder(warehouseRows, reorderDraftIdsRef.current);
        }
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
      let summaryRows = await request;
      if (scopeRef.current !== requestScope) return;
      if (reorderSavingRef.current) {
        const orderedSummaryWarehouses = withWarehouseDisplayOrder(
          summaryRows.map((summary) => summary.warehouse),
          reorderDraftIdsRef.current,
        );
        summaryRows = summaryRows.map((summary, index) => ({
          ...summary,
          warehouse: orderedSummaryWarehouses[index],
        }));
      }
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
    if (reorderPointerRef.current?.timer) clearTimeout(reorderPointerRef.current.timer);
    reorderPointerRef.current = null;
    reorderSaveGeneration.current += 1;
    reorderSavingRef.current = false;
    reorderDraftIdsRef.current = [];
    reorderInitialIdsRef.current = [];
    setReorderDraftIds([]);
    setIsReorderMode(false);
    setReorderSaving(false);
    setReorderError(null);
    setDraggingWarehouseId(null);
    setReorderAnnouncement("");
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
      // A generic focus/poll is not a stock mutation. Allow TTL revalidation
      // without canceling pending reads; actual invalidation gets one follow-up.
      if (event?.source === "realtime" || event?.source === "online") setDetailRevision((current) => current + 1);
      setAvailabilityRefreshTick((current) => current + 1);
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
      harvestLotCount: detailsLoaded
        ? batches.length
        : serverSummary?.harvest_lot_count == null
          ? null
          : Number(serverSummary.harvest_lot_count),
      harvestWeightKg: serverSummary?.harvest_weight_kg || 0,
      totalWeightKg: serverSummary?.total_weight_kg ?? 0,
      seedWeightKg: serverSummary?.seed_weight_kg || 0,
      otherMaterialWeightKg: serverSummary?.other_material_weight_kg || 0,
      lastMovementAt: serverSummary?.last_movement_at || null,
      summaryLoaded: Boolean(serverSummary),
      detailsLoaded,
    };
  }).sort((a, b) => compareWarehouseDisplayOrder(
    a.warehouse,
    b.warehouse,
    compareStoragePlaces,
  )), [warehouses, balances, harvestBatches, warehouseSummaryRows, loadedWarehouseIds, profile?.company_id]);

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

  const persistedActiveWarehouseIds = useMemo(
    () => summaries.filter((row) => !isArchived(row.warehouse)).map((row) => row.warehouse.id),
    [summaries],
  );

  useEffect(() => {
    if (!isReorderMode) return;
    const reconciled = reconcileWarehouseOrder(reorderDraftIdsRef.current, persistedActiveWarehouseIds);
    if (reconciled.join("|") === reorderDraftIdsRef.current.join("|")) return;
    reorderDraftIdsRef.current = reconciled;
    setReorderDraftIds(reconciled);
    setReorderAnnouncement("Список складов изменился. Новый склад добавлен в конец порядка.");
  }, [isReorderMode, persistedActiveWarehouseIds]);

  useEffect(() => () => {
    const session = reorderPointerRef.current;
    if (session?.timer) clearTimeout(session.timer);
  }, []);

  useLayoutEffect(() => {
    const previousRects = reorderLayoutBeforeRef.current;
    reorderLayoutBeforeRef.current = null;
    if (!previousRects || !isReorderMode) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    reorderGridRef.current
      ?.querySelectorAll<HTMLElement>("[data-warehouse-reorder-id]")
      .forEach((card) => {
        const warehouseId = card.dataset.warehouseReorderId;
        const previous = warehouseId ? previousRects.get(warehouseId) : null;
        if (!previous || typeof card.animate !== "function") return;
        const current = card.getBoundingClientRect();
        const deltaX = previous.left - current.left;
        const deltaY = previous.top - current.top;
        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;
        card.animate(
          [
            { transform: `translate(${deltaX}px, ${deltaY}px)` },
            { transform: "translate(0, 0)" },
          ],
          { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
      });
  }, [isReorderMode, reorderDraftIds]);

  const activeSummaries = useMemo(() => {
    const active = filteredSummaries.filter((row) => !isArchived(row.warehouse));
    if (!isReorderMode) return active;
    const orderById = new Map(reorderDraftIds.map((warehouseId, index) => [warehouseId, index]));
    return [...active].sort((left, right) => (
      (orderById.get(left.warehouse.id) ?? Number.MAX_SAFE_INTEGER)
      - (orderById.get(right.warehouse.id) ?? Number.MAX_SAFE_INTEGER)
    ));
  }, [filteredSummaries, isReorderMode, reorderDraftIds]);
  const archivedSummaries = filteredSummaries.filter((row) => isArchived(row.warehouse));

  const captureReorderLayout = () => {
    const positions = new Map<string, DOMRect>();
    reorderGridRef.current
      ?.querySelectorAll<HTMLElement>("[data-warehouse-reorder-id]")
      .forEach((card) => {
        const warehouseId = card.dataset.warehouseReorderId;
        if (warehouseId) positions.set(warehouseId, card.getBoundingClientRect());
      });
    reorderLayoutBeforeRef.current = positions;
  };

  const setReorderOrder = (nextIds: string[], movedWarehouseId: string) => {
    if (nextIds.join("|") === reorderDraftIdsRef.current.join("|")) return;
    captureReorderLayout();
    reorderDraftIdsRef.current = nextIds;
    setReorderDraftIds(nextIds);
    const warehouseName = summaries.find((row) => row.warehouse.id === movedWarehouseId)?.warehouse.name || "Склад";
    setReorderAnnouncement(`${warehouseName}: позиция ${nextIds.indexOf(movedWarehouseId) + 1} из ${nextIds.length}`);
  };

  const moveReorderItem = (warehouseId: string, targetWarehouseId: string) => {
    setReorderOrder(
      moveWarehouseId(reorderDraftIdsRef.current, warehouseId, targetWarehouseId),
      warehouseId,
    );
  };

  const moveReorderItemByOffset = (warehouseId: string, offset: -1 | 1) => {
    setReorderOrder(
      moveWarehouseIdByOffset(reorderDraftIdsRef.current, warehouseId, offset),
      warehouseId,
    );
  };

  const beginReorderMode = () => {
    const initialIds = [...persistedActiveWarehouseIds];
    reorderInitialIdsRef.current = initialIds;
    reorderDraftIdsRef.current = initialIds;
    setReorderDraftIds(initialIds);
    setSearch("");
    setReorderError(null);
    setReorderAnnouncement("Режим изменения порядка включён.");
    setIsReorderMode(true);
  };

  const cancelReorderMode = () => {
    const session = reorderPointerRef.current;
    if (session?.timer) clearTimeout(session.timer);
    reorderPointerRef.current = null;
    reorderDraftIdsRef.current = [];
    setReorderDraftIds([]);
    setDraggingWarehouseId(null);
    setReorderAnnouncement("Изменение порядка отменено.");
    setIsReorderMode(false);
  };

  const saveReorder = async () => {
    if (!profile?.company_id || reorderSavingRef.current) return;
    const orderedIds = [...reorderDraftIdsRef.current];
    if (orderedIds.join("|") === reorderInitialIdsRef.current.join("|")) {
      cancelReorderMode();
      return;
    }

    const cacheKey = `${profile.company_id}:${language}:${canManageWarehouses}`;
    const previousCache = warehousePageCache.get(cacheKey);
    const nextWarehouses = withWarehouseDisplayOrder(warehouses, orderedIds);
    const nextSummaryWarehouses = withWarehouseDisplayOrder(
      warehouseSummaryRows.map((summary) => summary.warehouse),
      orderedIds,
    );
    const nextSummaryRows = warehouseSummaryRows.map((summary, index) => ({
      ...summary,
      warehouse: nextSummaryWarehouses[index],
    }));
    const saveGeneration = ++reorderSaveGeneration.current;

    reorderSavingRef.current = true;
    setReorderSaving(true);
    setReorderError(null);
    setDraggingWarehouseId(null);
    setIsReorderMode(false);
    setWarehouses(nextWarehouses);
    setWarehouseSummaryRows(nextSummaryRows);
    if (previousCache) {
      const cachedSummaryWarehouses = withWarehouseDisplayOrder(
        previousCache.summaries.map((summary) => summary.warehouse),
        orderedIds,
      );
      warehousePageCache.set(cacheKey, {
        ...previousCache,
        warehouses: previousCache.warehouses
          ? withWarehouseDisplayOrder(previousCache.warehouses, orderedIds)
          : undefined,
        summaries: previousCache.summaries.map((summary, index) => ({
          ...summary,
          warehouse: cachedSummaryWarehouses[index],
        })),
      });
    }

    try {
      await reorderWarehouses(profile.company_id, orderedIds);
      if (reorderSaveGeneration.current !== saveGeneration) return;
      reorderSavingRef.current = false;
      reorderInitialIdsRef.current = orderedIds;
      reorderDraftIdsRef.current = [];
      setReorderDraftIds([]);
      setReorderAnnouncement("Порядок складов сохранён.");
      toast({ title: "Порядок сохранён", description: "Склады отображаются в новом порядке." });
    } catch (cause) {
      if (reorderSaveGeneration.current !== saveGeneration) return;
      reorderSavingRef.current = false;
      const message = cause instanceof Error ? cause.message : "Не удалось сохранить порядок складов";
      const rollbackIds = [...reorderInitialIdsRef.current];
      setWarehouses((current) => withWarehouseDisplayOrder(current, rollbackIds));
      setWarehouseSummaryRows((current) => {
        const rollbackWarehouses = withWarehouseDisplayOrder(
          current.map((summary) => summary.warehouse),
          rollbackIds,
        );
        return current.map((summary, index) => ({
          ...summary,
          warehouse: rollbackWarehouses[index],
        }));
      });
      const currentCache = warehousePageCache.get(cacheKey);
      if (currentCache) {
        const rollbackSummaryWarehouses = withWarehouseDisplayOrder(
          currentCache.summaries.map((summary) => summary.warehouse),
          rollbackIds,
        );
        warehousePageCache.set(cacheKey, {
          ...currentCache,
          warehouses: currentCache.warehouses
            ? withWarehouseDisplayOrder(currentCache.warehouses, rollbackIds)
            : undefined,
          summaries: currentCache.summaries.map((summary, index) => ({
            ...summary,
            warehouse: rollbackSummaryWarehouses[index],
          })),
        });
      }
      reorderDraftIdsRef.current = [];
      setReorderDraftIds([]);
      setReorderError(message);
      setReorderAnnouncement("Сохранение не удалось. Исходный порядок восстановлен.");
      toast({
        title: "Порядок не сохранён",
        description: `${message}. Исходный порядок восстановлен.`,
        variant: "destructive",
      });
    } finally {
      if (reorderSaveGeneration.current === saveGeneration) setReorderSaving(false);
    }
  };

  const beginPointerReorder = (event: React.PointerEvent<HTMLButtonElement>, warehouseId: string) => {
    if (!isReorderMode || reorderSaving || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const previousSession = reorderPointerRef.current;
    if (previousSession?.timer) clearTimeout(previousSession.timer);

    const session: ReorderPointerSession = {
      active: false,
      lastTargetWarehouseId: null,
      pointerId: event.pointerId,
      warehouseId,
      timer: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    session.timer = setTimeout(() => {
      if (reorderPointerRef.current !== session) return;
      session.active = true;
      session.timer = null;
      setDraggingWarehouseId(warehouseId);
      setReorderAnnouncement("Перетаскивание начато.");
    }, WAREHOUSE_REORDER_HOLD_MS);
    reorderPointerRef.current = session;
  };

  const continuePointerReorder = (event: React.PointerEvent<HTMLButtonElement>) => {
    const session = reorderPointerRef.current;
    if (!session || session.pointerId !== event.pointerId || !session.active) return;
    event.preventDefault();
    event.stopPropagation();
    const targetCard = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-warehouse-reorder-id]");
    const targetWarehouseId = targetCard?.dataset.warehouseReorderId;
    if (!targetWarehouseId) {
      session.lastTargetWarehouseId = null;
    } else if (
      targetWarehouseId !== session.warehouseId
      && targetWarehouseId !== session.lastTargetWarehouseId
    ) {
      session.lastTargetWarehouseId = targetWarehouseId;
      moveReorderItem(session.warehouseId, targetWarehouseId);
    }
  };

  const finishPointerReorder = (event: React.PointerEvent<HTMLButtonElement>) => {
    const session = reorderPointerRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (session.timer) clearTimeout(session.timer);
    reorderPointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const finalIndex = reorderDraftIdsRef.current.indexOf(session.warehouseId);
    if (session.active && finalIndex >= 0) {
      setReorderAnnouncement(`Перетаскивание завершено. Позиция ${finalIndex + 1} из ${reorderDraftIdsRef.current.length}.`);
    }
    setDraggingWarehouseId(null);
  };

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

  const renderWarehouseCard = ({ warehouse, positionCount, harvestLotCount, totalWeightKg, summaryLoaded }: Summary) => {
    const invalidStock = summaryLoaded && (!Number.isFinite(totalWeightKg) || totalWeightKg < -0.000001);
    const empty = summaryLoaded && !invalidStock && Math.abs(totalWeightKg) <= 0.000001 && positionCount === 0;
    const placeType = normalizeStoragePlaceType(warehouse.place_type);
    const capacity = capacityKg(warehouse);
    const fillPercent = warehouseCapacityPercent(totalWeightKg, capacity);
    const fillBarPercent = fillPercent == null ? 0 : Math.min(100, fillPercent);
    const capacityExceeded = fillPercent != null && fillPercent > 100;
    const positionLabel = warehousePositionCountLabel(positionCount, harvestLotCount);
    const reorderable = isReorderMode && !isArchived(warehouse);
    const reorderPosition = reorderable ? reorderDraftIds.indexOf(warehouse.id) : -1;
    return (
      <article
        key={warehouse.id}
        role={reorderable ? "listitem" : "button"}
        tabIndex={reorderable ? undefined : 0}
        aria-label={reorderable ? `${warehouse.name}, позиция ${reorderPosition + 1} из ${reorderDraftIds.length}` : `Открыть склад ${warehouse.name}`}
        data-warehouse-reorder-id={reorderable ? warehouse.id : undefined}
        onClick={() => {
          if (!reorderable) openWarehouse(warehouse.id);
        }}
        onKeyDown={(event) => {
          if (!reorderable && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            openWarehouse(warehouse.id);
          }
        }}
        className={`group relative flex h-full min-h-[148px] min-w-0 flex-col rounded-xl border bg-card p-4 transition-[border-color,background-color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${reorderable ? "cursor-default select-none" : "cursor-pointer hover:border-border hover:bg-accent/60"} ${draggingWarehouseId === warehouse.id ? "z-10 border-yellow-400/80 bg-accent/60 shadow-lg will-change-transform" : "border-border"}`}
      >
        <div className="flex items-start gap-2.5">
          <ObjectVisual placeType={placeType} className="h-9 w-9 shrink-0 border-0 bg-transparent" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="break-words text-sm font-semibold leading-5 text-foreground">{warehouse.name}</h2>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {placeType === "WAREHOUSE" ? warehouseTypeLabel(warehouse.warehouse_type) : storagePlaceTypeLabel(placeType)}
                </div>
              </div>
              {reorderable ? (
                <div className="flex shrink-0 items-center gap-1" aria-label={`Порядок склада ${warehouse.name}`}>
                  <button
                    type="button"
                    disabled={reorderSaving || reorderPosition <= 0}
                    aria-label={`Переместить ${warehouse.name} вверх`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      moveReorderItemByOffset(warehouse.id, -1);
                    }}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={reorderSaving || reorderPosition >= reorderDraftIds.length - 1}
                    aria-label={`Переместить ${warehouse.name} вниз`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      moveReorderItemByOffset(warehouse.id, 1);
                    }}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={reorderSaving}
                    aria-label={`Удерживайте и перетащите ${warehouse.name}. Стрелки вверх и вниз меняют позицию с клавиатуры.`}
                    aria-describedby="warehouse-reorder-instructions"
                    title="Удерживайте и перетащите"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                      event.preventDefault();
                      moveReorderItemByOffset(warehouse.id, event.key === "ArrowUp" ? -1 : 1);
                    }}
                    onPointerDown={(event) => beginPointerReorder(event, warehouse.id)}
                    onPointerMove={continuePointerReorder}
                    onPointerUp={finishPointerReorder}
                    onPointerCancel={finishPointerReorder}
                    onLostPointerCapture={finishPointerReorder}
                    className="inline-flex h-11 w-11 touch-none cursor-grab items-center justify-center rounded-md text-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                </div>
              ) : isArchived(warehouse) ? <StatusBadge status="empty">Архив</StatusBadge> : null}
            </div>
          </div>
        </div>
        {!summaryLoaded ? (
          <div className="mt-4 h-14 rounded-md bg-background motion-safe:animate-pulse" aria-label="Загрузка остатка" />
        ) : (
          <div className="mt-4 flex flex-1 flex-col justify-end gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <strong className={`text-xl font-semibold tabular-nums ${invalidStock ? "text-rose-800" : empty ? "text-foreground" : "text-emerald-800"}`}>
                {invalidStock ? "Проверить остаток" : empty ? "0 кг" : totalWeightKg === 0 ? "Есть материалы" : formatMass(totalWeightKg)}
              </strong>
              <span className="max-w-[60%] text-right text-xs leading-4 text-muted-foreground">{positionLabel}</span>
            </div>
            {invalidStock ? <div role="alert" className="text-xs text-rose-800">Отрицательный или некорректный остаток: {String(totalWeightKg)} кг</div> : null}
            {fillPercent != null && !invalidStock && !empty ? (
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Вместимость {formatMass(capacity || 0)}</span><span className={capacityExceeded ? "font-semibold text-rose-800" : undefined}>{fillPercent}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${capacityExceeded ? "bg-rose-400/80" : "bg-yellow-400/75"}`} style={{ width: `${fillBarPercent}%` }} /></div>
                {capacityExceeded ? <div className="mt-1 text-[11px] font-medium text-rose-800">Остаток превышает указанную вместимость. Проверьте вместимость объекта.</div> : null}
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
              {WAREHOUSE_ORDER_UI_ENABLED && !isReorderMode ? (
                <Button
                  variant="outline"
                  disabled={loading || reorderSaving || persistedActiveWarehouseIds.length < 2}
                  onClick={beginReorderMode}
                >
                  <GripVertical className="mr-2 h-4 w-4" />
                  {reorderSaving ? "Сохраняем порядок..." : "Изменить порядок"}
                </Button>
              ) : null}
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
      {reorderError ? <Alert variant="destructive"><AlertDescription>{reorderError}. Исходный порядок восстановлен.</AlertDescription></Alert> : null}
      <div className="sr-only" role="status" aria-live="polite">{reorderAnnouncement}</div>
      {isAgronomist ? (
        <div role="tablist" aria-label="Представление складов" className="flex gap-1 border-b border-border">
          {([{ value: "availability", label: "В наличии" }, { value: "warehouses", label: "По складам" }] as const).map((tab) => (
            <button key={tab.value} id={`warehouse-tab-${tab.value}`} type="button" role="tab" tabIndex={selectedView === tab.value ? 0 : -1} aria-selected={selectedView === tab.value} aria-controls={tab.value === "availability" ? "warehouse-availability-view" : "warehouse-view"} onClick={() => selectView(tab.value)} onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next: WarehouseView = event.key === "Home" ? "availability" : event.key === "End" ? "warehouses" : selectedView === "availability" ? "warehouses" : "availability";
              selectView(next);
              document.getElementById(`warehouse-tab-${next}`)?.focus();
            }} className={`min-h-[44px] border-b-2 px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedView === tab.value ? "border-yellow-400 text-amber-800" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{tab.label}</button>
          ))}
        </div>
      ) : null}
      {isAgronomist && profile?.company_id && user?.id ? (
        <div id="warehouse-availability-view" role="tabpanel" hidden={selectedView !== "availability"} aria-labelledby="warehouse-tab-availability">
          <StockAvailability companyId={profile.company_id} userId={user.id} actorScope={`${profile.id}:${profile.role}`} active={selectedView === "availability"} placesLoading={loading} refreshTick={availabilityRefreshTick} language={language} warehouses={warehouses} revision={detailRevision} onOpenBatch={(batch) => void openHarvestBatch(batch)} onOpenMaterial={setDetailBalance} />
        </div>
      ) : null}
      <div id="warehouse-view" hidden={isAgronomist && selectedView !== "warehouses"} role={isAgronomist ? "tabpanel" : undefined} aria-labelledby={isAgronomist ? "warehouse-tab-warehouses" : undefined} className="space-y-3">
      {isReorderMode ? (
        <section className="flex flex-col gap-3 rounded-xl border border-yellow-400/25 bg-yellow-400/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Изменение порядка складов">
          <div>
            <div className="text-sm font-semibold text-foreground">Изменение порядка</div>
            <p id="warehouse-reorder-instructions" className="mt-1 text-xs leading-5 text-muted-foreground">
              Удерживайте рукоятку и перетащите карточку. С клавиатуры используйте кнопки вверх и вниз. Архивные склады не меняются.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" disabled={reorderSaving} onClick={cancelReorderMode}>
              <X className="mr-2 h-4 w-4" />Отмена
            </Button>
            <Button disabled={reorderSaving} onClick={() => void saveReorder()}>
              <Check className="mr-2 h-4 w-4" />{reorderSaving ? "Сохраняем..." : "Сохранить порядок"}
            </Button>
          </div>
        </section>
      ) : null}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          disabled={isReorderMode || reorderSaving}
          placeholder="Найти склад, материал, культуру, поле или партию"
        />
      </div>
      {searchDataLoading ? (
        <div className="text-xs text-muted-foreground" role="status">Ищем по остаткам и партиям...</div>
      ) : null}

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Загрузка складов...</div>
      ) : activeSummaries.length === 0 ? (
        <div className="border-y border-border py-12 text-center text-sm text-muted-foreground">Активные склады не найдены.</div>
      ) : (
        <div
          ref={reorderGridRef}
          role={isReorderMode ? "list" : undefined}
          aria-label={isReorderMode ? "Активные склады в изменяемом порядке" : undefined}
          className="grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
        >
          {activeSummaries.map(renderWarehouseCard)}
        </div>
      )}

      {canManageWarehouses && archivedSummaries.length > 0 ? (
        <section className="space-y-3 border-t border-border pt-5">
          <h2 className="text-base font-semibold text-foreground">Архивные склады</h2>
          <div className="grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {archivedSummaries.map(renderWarehouseCard)}
          </div>
        </section>
      ) : null}
      </div>

      <Dialog open={Boolean(selectedSummary)} onOpenChange={(open) => !open && closeWarehouse()}>
        <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[92vh] sm:max-h-[92vh] sm:w-[min(1100px,calc(100vw-32px))] sm:max-w-[1100px] sm:rounded-lg">
          {selectedSummary ? (
            <>
              <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left">
                <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
                  <div className="flex min-w-0 items-center gap-3">
                    <ObjectVisual placeType={selectedSummary.warehouse.place_type} className="h-11 w-12" />
                    <div className="min-w-0">
                    <DialogTitle className="truncate text-xl">{selectedSummary.warehouse.name}</DialogTitle>
                    <DialogDescription className="mt-1">
                      {normalizeStoragePlaceType(selectedSummary.warehouse.place_type) === "WAREHOUSE"
                        ? warehouseTypeLabel(selectedSummary.warehouse.warehouse_type)
                        : storagePlaceTypeLabel(selectedSummary.warehouse.place_type)} · {warehousePositionCountLabel(selectedSummary.positionCount, selectedSummary.harvestLotCount)} · последнее движение {formatDate(selectedSummary.lastMovementAt)}
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
                  <div className="rounded-md border border-border bg-background px-4 py-3 text-sm text-muted-foreground" role="status">
                    Обновляем остатки...
                  </div>
                ) : null}
                {detailsError ? (
                  <Alert variant="destructive"><AlertDescription>{detailsError}</AlertDescription></Alert>
                ) : null}
                <section className="mt-4">
                  <h3 className="mb-3 flex items-center gap-2 text-base font-semibold"><Boxes className="h-4 w-4 text-amber-800" />Остатки</h3>
                  <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-background">
                    {selectedSummary.batches.map((batch) => {
                      const identity = batch.reviewState === "requires_review"
                        ? "Требуется уточнение"
                        : [batch.varietyName, batch.reproductionName].filter(Boolean).join(" · ");
                      return (
                        <button
                          key={`harvest-${batch.id}`}
                          type="button"
                          onClick={() => void openHarvestBatch(batch)}
                          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-foreground">{batch.cropName}</div>
                            <div className={`mt-0.5 truncate text-sm ${batch.reviewState === "requires_review" ? "text-amber-800" : "text-muted-foreground"}`}>{identity}</div>
                          </div>
                          <div className="shrink-0 font-semibold text-emerald-800">{quantity(batch.cleanMassKg)} кг</div>
                        </button>
                      );
                    })}
                    {selectedMaterialStock.map((row) => (
                      <button
                        key={`material-${row.product_id}-${row.unit}-${row.batch_class || "commodity"}`}
                        type="button"
                        onClick={() => setDetailBalance(row)}
                        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-foreground">{row.product_name}</div>
                          {row.identity_name ? <div className="mt-0.5 truncate text-sm text-muted-foreground">{row.identity_name}</div> : null}
                        </div>
                        <div className="shrink-0 font-semibold text-foreground">{quantity(row.quantity)} {localizeUnit(row.unit, language)}</div>
                      </button>
                    ))}
                    {selectedSummary.detailsLoaded && selectedSummary.batches.length === 0 && selectedMaterialStock.length === 0 ? (
                      <div className="px-4"><EmptyState /></div>
                    ) : null}
                    {!detailsLoading && selectedSummary.batches.length === 0 && selectedMaterialStock.length === 0 ? (
                      <div className="px-4 py-10 text-center text-sm text-muted-foreground">Склад пуст</div>
                    ) : null}
                  </div>
                </section>
              </div>

              <DialogFooter className="shrink-0 border-t border-border px-5 py-3">
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
