"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InventoryTransactionFormDialog } from "@/components/warehouses/inventory-transaction-form-dialog";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { useToast } from "@/hooks/use-toast";
import {
  cancelInventoryTransaction,
  createInventoryTransaction,
  getInventoryBalances,
  getInventoryTransactions,
  getProducts,
  getWarehouses,
} from "@/lib/services/warehouses";
import type {
  InventoryBalance,
  InventoryTransactionFormData,
  InventoryTransactionWithDetails,
  Product,
  Warehouse,
} from "@/lib/types/warehouse";
import { localizeUnit } from "@/lib/i18n/helpers";
import {
  Filter,
  History,
  Package,
  Plus,
  Search,
  Warehouse as WarehouseIcon,
} from "lucide-react";

type Lang = "ru" | "kz" | "en";
type WarehouseStatus = "normal" | "warning" | "critical";

interface WarehouseOverview {
  warehouse: Warehouse;
  warehouseType: string;
  capacityKg: number;
  currentKg: number;
  fillPercent: number | null;
  topItems: InventoryBalance[];
  allItems: InventoryBalance[];
  latestMovements: InventoryTransactionWithDetails[];
  status: WarehouseStatus;
  todayDeltaKg: number;
  mainCrop: InventoryBalance | null;
}

const FALLBACK_TYPE_BY_NAME: Array<{ test: RegExp; type: string }> = [
  { test: /сем|тұқым|seed/i, type: "seed" },
  { test: /зерн|астық|grain/i, type: "grain" },
  { test: /овощ|карт|көкөніс|vegetable/i, type: "vegetable" },
  { test: /универс|әмбебап|universal/i, type: "universal" },
];

const TYPE_LABELS: Record<string, { ru: string; kz: string; en: string }> = {
  seed: { ru: "Семенной", kz: "Тұқым", en: "Seed" },
  grain: { ru: "Зерновой", kz: "Астық", en: "Grain" },
  vegetable: { ru: "Овощной", kz: "Көкөніс", en: "Vegetable" },
  universal: { ru: "Универсальный", kz: "Әмбебап", en: "Universal" },
};

function formatDateTime(value: string | null | undefined, language: Lang): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat(language === "kz" ? "kk-KZ" : language === "ru" ? "ru-RU" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function resolveWarehouseType(warehouse: Warehouse): string {
  const direct = String((warehouse as any).warehouse_type || "").trim().toLowerCase();
  if (direct) return direct;

  const byName = FALLBACK_TYPE_BY_NAME.find((entry) => entry.test.test(String(warehouse.name || "")));
  return byName?.type || "universal";
}

function resolveWarehouseCapacityKg(warehouse: Warehouse): number {
  const value = Number((warehouse as any).storage_capacity_kg ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function movementTypeLabel(type: string, t: (ru: string, kz: string, en: string) => string): string {
  if (type === "receipt") return t("Приход", "Кіріс", "Incoming");
  if (type === "issue") return t("Расход", "Шығыс", "Issue");
  if (type === "transfer") return t("Перемещение", "Ауыстыру", "Transfer");
  if (type === "writeoff") return t("Списание", "Есептен шығару", "Write-off");
  if (type === "adjustment") return t("Корректировка", "Түзету", "Adjustment");
  return type || "-";
}

function formatStorageAmount(value: number, unit: string, language: Lang): string {
  const safeValue = Number(value || 0);
  const normalizedUnit = String(unit || "kg").trim().toLowerCase();
  const locale = language === "kz" ? "kk-KZ" : language === "ru" ? "ru-RU" : "en-US";

  if (normalizedUnit === "kg" && Math.abs(safeValue) >= 1000) {
    const tons = safeValue / 1000;
    const number = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: Math.abs(tons) >= 100 ? 0 : 1,
    }).format(tons);
    const tonUnit = language === "en" ? "t" : "т";
    return `${number} ${tonUnit}`;
  }

  const digits = Math.abs(safeValue) < 10 ? 2 : 1;
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(safeValue);
  return `${number} ${localizeUnit(normalizedUnit, language)}`;
}

function formatBatchLabel(batchId?: string | null): string {
  const value = String(batchId || "").trim();
  if (!value) return "—";
  return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) ? `#${value.slice(0, 8)}` : value;
}

export default function WarehousesPage() {
  const { profile, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const { language } = useLanguage();
  const searchParams = useSearchParams();

  const t = (ru: string, kz: string, en: string) =>
    language === "ru" ? ru : language === "kz" ? kz : en;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isMovementDialogOpen, setIsMovementDialogOpen] = useState(false);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [movementDateFrom, setMovementDateFrom] = useState("");
  const [movementDateTo, setMovementDateTo] = useState("");
  const [lastAppliedQuerySignature, setLastAppliedQuerySignature] = useState<string | null>(null);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransactionWithDetails[]>([]);

  const querySignature = searchParams.toString();
  const querySearchValue = (searchParams.get("search") || "").trim();
  const queryEntityType = (searchParams.get("entityType") || "").trim().toLowerCase();
  const queryWarehouseId = (() => {
    const direct = (searchParams.get("warehouseId") || "").trim();
    if (direct) return direct;
    const entityId = (searchParams.get("entityId") || "").trim();
    if (queryEntityType === "warehouse" && entityId) return entityId;
    return "";
  })();

  const canManageMovements =
    profile?.role === "company_admin" ||
    profile?.role === "global_admin" ||
    profile?.role === "warehouse" ||
    profile?.role === "warehouse_operator";
  const observerMode = profile?.role === "agronomist" || profile?.role === "weighman";

  const reloadData = async () => {
    if (!profile?.company_id) return;
    setLoading(true);
    setLoadError(null);

    try {
      const [warehouseRows, productRows, balanceRows, txRows] = await Promise.all([
        getWarehouses(profile.company_id, false, language),
        getProducts(profile.company_id, false, language),
        getInventoryBalances(profile.company_id, language),
        getInventoryTransactions(profile.company_id, language),
      ]);

      setWarehouses(warehouseRows);
      setProducts(productRows);
      setBalances(balanceRows);
      setTransactions(txRows);
    } catch (error: any) {
      setLoadError(error?.message || t("Не удалось загрузить склады", "Қойма деректерін жүктеу мүмкін болмады", "Failed to load warehouses"));
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: error?.message || t("Не удалось загрузить склады", "Қойма деректерін жүктеу мүмкін болмады", "Failed to load warehouses"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.company_id) {
      void reloadData();
    }
  }, [profile?.company_id, language]);

  useEffect(() => {
    if (!querySignature) return;
    if (lastAppliedQuerySignature === querySignature) return;

    if (querySearchValue) {
      setSearchValue(querySearchValue);
    }

    if (queryWarehouseId) {
      setSelectedWarehouseId(queryWarehouseId);
    }

    setLastAppliedQuerySignature(querySignature);
  }, [querySignature, querySearchValue, queryWarehouseId, lastAppliedQuerySignature]);

  const overviewData = useMemo<WarehouseOverview[]>(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startMs = startOfToday.getTime();

    return warehouses.map((warehouse) => {
      const allItems = balances
        .filter((row) => row.warehouse_id === warehouse.id)
        .sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0));

      const currentKg = allItems.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
      const capacityKg = resolveWarehouseCapacityKg(warehouse);
      const fillPercent = capacityKg > 0 ? (currentKg / capacityKg) * 100 : null;
      const status: WarehouseStatus =
        fillPercent == null ? "normal" : fillPercent >= 100 ? "critical" : fillPercent >= 85 ? "warning" : "normal";

      const latestMovements = transactions
        .filter((row) => {
          return row.warehouse_id === warehouse.id || row.source_warehouse_id === warehouse.id || row.destination_warehouse_id === warehouse.id;
        })
        .slice(0, 12);

      const todayDeltaKg = transactions.reduce((sum, row) => {
        const rawDate = row.operation_datetime || row.date;
        if (!rawDate) return sum;
        const dt = new Date(rawDate);
        if (Number.isNaN(dt.getTime()) || dt.getTime() < startMs) return sum;
        if (String(row.status || "confirmed") !== "confirmed") return sum;

        if (typeof row.quantity_delta === "number" && row.warehouse_id === warehouse.id) {
          return sum + row.quantity_delta;
        }

        const qty = Number(row.quantity || 0);
        const movementType = String(row.movement_type || "");
        if (movementType === "transfer") {
          if (row.source_warehouse_id === warehouse.id) return sum - qty;
          if (row.destination_warehouse_id === warehouse.id) return sum + qty;
          return sum;
        }
        if (movementType === "receipt") {
          const destination = row.destination_warehouse_id || row.warehouse_id;
          return destination === warehouse.id ? sum + qty : sum;
        }
        if (movementType === "issue" || movementType === "writeoff") {
          const source = row.source_warehouse_id || row.warehouse_id;
          return source === warehouse.id ? sum - qty : sum;
        }

        const direction = String(row.transaction_type || "out");
        const target =
          direction === "in"
            ? row.destination_warehouse_id || row.warehouse_id
            : row.source_warehouse_id || row.warehouse_id;
        if (target !== warehouse.id) return sum;
        return sum + (direction === "in" ? qty : -qty);
      }, 0);

      const mainCrop = allItems[0] || null;

      return {
        warehouse,
        warehouseType: resolveWarehouseType(warehouse),
        capacityKg,
        currentKg,
        fillPercent,
        topItems: allItems.slice(0, 3),
        allItems,
        latestMovements,
        status,
        todayDeltaKg,
        mainCrop,
      };
    });
  }, [warehouses, balances, transactions]);

  const typeOptions = useMemo(() => {
    return Array.from(new Set(overviewData.map((item) => item.warehouseType)));
  }, [overviewData]);

  const filteredOverview = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase();

    return overviewData.filter((item) => {
      const matchesType = typeFilter === "all" || item.warehouseType === typeFilter;

      if (!normalizedSearch) return matchesType;

      const fullText = [item.warehouse.name, ...item.allItems.map((x) => x.identity_name || x.product_name)]
        .join(" ")
        .toLowerCase();
      return matchesType && fullText.includes(normalizedSearch);
    });
  }, [overviewData, searchValue, typeFilter]);

  const selectedOverview = useMemo(() => {
    if (!selectedWarehouseId) return null;
    return overviewData.find((item) => item.warehouse.id === selectedWarehouseId) || null;
  }, [selectedWarehouseId, overviewData]);

  const filteredSelectedMovements = useMemo(() => {
    if (!selectedOverview) return [];
    const fromDate = movementDateFrom ? new Date(`${movementDateFrom}T00:00:00`) : null;
    const toDate = movementDateTo ? new Date(`${movementDateTo}T23:59:59`) : null;

    return selectedOverview.latestMovements.filter((movement) => {
      const rawDate = movement.operation_datetime || movement.date;
      if (!rawDate) return true;
      const dt = new Date(rawDate);
      if (Number.isNaN(dt.getTime())) return true;
      if (fromDate && dt < fromDate) return false;
      if (toDate && dt > toDate) return false;
      return true;
    });
  }, [selectedOverview, movementDateFrom, movementDateTo]);

  const totalWarehouses = overviewData.length;
  const totalVolumeKg = overviewData.reduce((sum, item) => sum + item.currentKg, 0);
  const uniqueProductsCount = new Set(balances.map((row) => row.product_id)).size;
  const activeStockRowsCount = balances.filter((row) => Number(row.quantity || 0) > 0).length;
  const statValue = (value: ReactNode) =>
    loading ? <Skeleton className="mt-2 h-7 w-24 bg-slate-200" /> : value;

  const handleCreateMovement = async (payload: InventoryTransactionFormData) => {
    if (!profile?.company_id || !canManageMovements) return;

    try {
      await createInventoryTransaction(profile.company_id, payload, profile.id);
      setIsMovementDialogOpen(false);
      await reloadData();
      toast({
        title: t("Сохранено", "Сақталды", "Saved"),
        description: t("Складская операция добавлена", "Қойма операциясы қосылды", "Warehouse operation created"),
      });
    } catch (error: any) {
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: error?.message || t("Не удалось создать движение", "Қозғалысты құру мүмкін болмады", "Failed to create movement"),
        variant: "destructive",
      });
    }
  };

  const handleCancelMovement = async (movementId: string) => {
    if (!profile?.company_id || !canManageMovements) return;

    try {
      await cancelInventoryTransaction(movementId, profile.company_id);
      await reloadData();
      toast({
        title: t("Отменено", "Болдырылмады", "Cancelled"),
        description: t("Движение отменено", "Қозғалыс болдырылмады", "Movement cancelled"),
      });
    } catch (error: any) {
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: error?.message || t("Не удалось отменить движение", "Қозғалысты болдырмау мүмкін болмады", "Failed to cancel movement"),
        variant: "destructive",
      });
    }
  };

  if (authLoading) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={t("Склады", "Қоймалар", "Warehouses")}
          description={t("Загрузка доступа...", "Рұқсат жүктелуде...", "Checking access...")}
        />
      </div>
    );
  }

  if (
    profile?.role !== "company_admin" &&
    profile?.role !== "global_admin" &&
    profile?.role !== "warehouse" &&
    profile?.role !== "warehouse_operator" &&
    profile?.role !== "agronomist" &&
    profile?.role !== "weighman"
  ) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={t("Склады", "Қоймалар", "Warehouses")}
          description={t("У вас нет доступа к этой странице", "Бұл бетке рұқсат жоқ", "No access to this page")}
        />
        <Alert variant="destructive">
          <AlertDescription>{t("Доступ запрещен для текущей роли", "Ағымдағы рөлге рұқсат берілмеген", "Access denied for current role")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title={t("Склады", "Қоймалар", "Warehouses")}
        description={
          observerMode
            ? t(
                "Режим наблюдения: только просмотр остатков и последних движений",
                "Бақылау режимі: тек қалдықтар мен соңғы қозғалыстарды көру",
                "Observer mode: stock and movement read-only overview"
              )
            : t(
                "Краткая сводка по складам с детальной расшифровкой по клику",
                "Қоймалар бойынша қысқа шолу, карточканы ашып толық көруге болады",
                "Warehouse overview with click-to-open detailed breakdown"
              )
        }
        action={
          canManageMovements
            ? {
                label: t("Новая складская операция", "Жаңа қойма операциясы", "New warehouse operation"),
                icon: Plus,
                onClick: () => setIsMovementDialogOpen(true),
              }
            : undefined
        }
      />

      {loadError ? (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {canManageMovements ? (
          <Button asChild variant="outline">
            <Link href="/warehouses/manage">
              {t("Управление складами", "Қоймаларды басқару", "Manage warehouses")}
            </Link>
          </Button>
        ) : (
          <Badge variant="secondary">{t("Режим только чтения", "Тек оқу режимі", "Read-only mode")}</Badge>
        )}
      </div>

      <div className="grid gap-2 sm:gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-slate-800 bg-slate-900/70">
          <CardContent className="p-3 sm:p-4">
            <div className="text-xs font-medium text-slate-400">{t("Всего складов", "Қоймалар саны", "Warehouses")}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-50">{statValue(totalWarehouses)}</div>
          </CardContent>
        </Card>
        <Card className="border-slate-800 bg-slate-900/70">
          <CardContent className="p-3 sm:p-4">
            <div className="text-xs font-medium text-slate-400">{t("Общий остаток", "Жалпы қалдық", "Total stock")}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-50">{statValue(formatStorageAmount(totalVolumeKg, "kg", language as Lang))}</div>
          </CardContent>
        </Card>
        <Card className="border-slate-800 bg-slate-900/70">
          <CardContent className="p-3 sm:p-4">
            <div className="text-xs font-medium text-slate-400">{t("Товаров в наличии", "Қоймадағы тауарлар", "Products in stock")}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-50">{statValue(uniqueProductsCount)}</div>
          </CardContent>
        </Card>
        <Card className="border-slate-800 bg-slate-900/70">
          <CardContent className="p-3 sm:p-4">
            <div className="text-xs font-medium text-slate-400">{t("Партии / строки", "Партия / жолдар", "Stock rows")}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-50">{statValue(activeStockRowsCount)}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-800 bg-slate-900/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-slate-100">
            <Filter className="h-4 w-4" />
            {t("Фильтры", "Сүзгілер", "Filters")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <Input
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              className="pl-9"
              placeholder={t("Поиск по складу или культуре...", "Қойма не дақыл бойынша іздеу...", "Search by warehouse or crop...")}
            />
          </div>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger>
              <SelectValue placeholder={t("Тип склада", "Қойма түрі", "Warehouse type")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Все типы", "Барлық түрлер", "All types")}</SelectItem>
              {typeOptions.map((itemType) => (
                <SelectItem key={itemType} value={itemType}>
                  {TYPE_LABELS[itemType]
                    ? t(TYPE_LABELS[itemType].ru, TYPE_LABELS[itemType].kz, TYPE_LABELS[itemType].en)
                    : itemType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-3">
        {loading ? (
          <Card className="sm:col-span-2 xl:col-span-3">
            <CardContent className="py-12 text-center text-slate-500">{t("Загрузка складов...", "Қоймалар жүктелуде...", "Loading warehouses...")}</CardContent>
          </Card>
        ) : filteredOverview.length === 0 ? (
          <Card className="sm:col-span-2 xl:col-span-3">
            <CardContent className="py-12 text-center text-slate-500">{t("По заданным фильтрам склады не найдены", "Сүзгі бойынша қоймалар табылмады", "No warehouses found for selected filters")}</CardContent>
          </Card>
        ) : (
          filteredOverview.map((item) => {
            const typeLabel = TYPE_LABELS[item.warehouseType]
              ? t(TYPE_LABELS[item.warehouseType].ru, TYPE_LABELS[item.warehouseType].kz, TYPE_LABELS[item.warehouseType].en)
              : item.warehouseType;

            const deltaPrefix = item.todayDeltaKg > 0 ? "+" : item.todayDeltaKg < 0 ? "-" : "±";
            const deltaValue = formatStorageAmount(Math.abs(item.todayDeltaKg), "kg", language as Lang);
            const latestMovement = item.latestMovements[0];

            return (
              <button
                key={item.warehouse.id}
                type="button"
                onClick={() => setSelectedWarehouseId(item.warehouse.id)}
                className="group min-h-[168px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 text-left shadow-sm transition hover:border-emerald-500/40 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <div className="flex h-full flex-col p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <Badge className="h-5 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 text-[10px] uppercase tracking-wide text-emerald-200">
                        {typeLabel}
                      </Badge>
                      <div className="truncate text-lg font-semibold leading-tight text-slate-50">{item.warehouse.name}</div>
                    </div>
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-slate-950 text-emerald-300 ring-1 ring-slate-700">
                      <WarehouseIcon className="h-4 w-4" />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[11px] text-slate-500">{t("Остаток", "Қалдық", "Stock")}</div>
                      <div className="mt-0.5 text-xl font-semibold text-slate-100">{formatStorageAmount(item.currentKg, "kg", language as Lang)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">{t("Позиций", "Позициялар", "Items")}</div>
                      <div className="mt-0.5 text-xl font-semibold text-slate-100">{item.allItems.length}</div>
                    </div>
                  </div>

                  <div className="mt-3 min-h-[38px]">
                    <div className="text-[11px] text-slate-500">{t("Основной товар", "Негізгі тауар", "Main item")}</div>
                    <div className="mt-0.5 truncate text-sm font-medium text-slate-200">
                      {item.mainCrop?.identity_name || item.mainCrop?.product_name || t("Нет остатков", "Қалдық жоқ", "No stock")}
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-[11px] text-slate-400">
                    <span className={item.todayDeltaKg > 0 ? "text-emerald-300" : item.todayDeltaKg < 0 ? "text-red-300" : "text-slate-400"}>
                      {deltaPrefix} {deltaValue}
                    </span>
                    <span className="truncate">
                      {latestMovement ? movementTypeLabel(String(latestMovement.movement_type || ""), t) : t("Движений нет", "Қозғалыс жоқ", "No movement")}
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      <Dialog
        open={Boolean(selectedOverview)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedWarehouseId(null);
            setMovementDateFrom("");
            setMovementDateTo("");
          }
        }}
      >
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-5xl overflow-hidden border-slate-800 bg-slate-950 p-0 text-slate-100 sm:max-h-[88vh]">
          {selectedOverview && (
            <div className="flex max-h-[92dvh] flex-col sm:max-h-[88vh]">
              <div className="border-b border-slate-800 px-4 py-3 sm:px-5 sm:py-4">
                <DialogHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
                    <div>
                      <DialogTitle className="text-2xl text-slate-50">{selectedOverview.warehouse.name}</DialogTitle>
                      <DialogDescription className="mt-1 text-slate-400">
                        {TYPE_LABELS[selectedOverview.warehouseType]
                          ? t(
                              TYPE_LABELS[selectedOverview.warehouseType].ru,
                              TYPE_LABELS[selectedOverview.warehouseType].kz,
                              TYPE_LABELS[selectedOverview.warehouseType].en
                            )
                          : selectedOverview.warehouseType}
                      </DialogDescription>
                    </div>
                    <div className="grid w-full grid-cols-3 gap-2 text-left text-sm sm:w-auto sm:text-right">
                      <div>
                        <div className="text-[11px] text-slate-500">{t("Остаток", "Қалдық", "Stock")}</div>
                        <div className="font-semibold text-slate-100">{formatStorageAmount(selectedOverview.currentKg, "kg", language as Lang)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500">{t("Позиций", "Позициялар", "Items")}</div>
                        <div className="font-semibold text-slate-100">{selectedOverview.allItems.length}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500">{t("Сегодня", "Бүгін", "Today")}</div>
                        <div className={selectedOverview.todayDeltaKg > 0 ? "font-semibold text-emerald-300" : selectedOverview.todayDeltaKg < 0 ? "font-semibold text-red-300" : "font-semibold text-slate-300"}>
                          {selectedOverview.todayDeltaKg > 0 ? "+" : selectedOverview.todayDeltaKg < 0 ? "-" : "±"} {formatStorageAmount(Math.abs(selectedOverview.todayDeltaKg), "kg", language as Lang)}
                        </div>
                      </div>
                    </div>
                  </div>
                </DialogHeader>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                <section className="space-y-3">
                  <div className="flex items-center gap-2 text-base font-semibold text-slate-100">
                    <Package className="h-4 w-4 text-emerald-300" />
                    {t("Остатки и партии", "Қалдықтар мен партиялар", "Stock and batches")}
                  </div>
                  {selectedOverview.allItems.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-800 py-10 text-center text-sm text-slate-500">
                      {t("На этом складе нет остатков", "Бұл қоймада қалдық жоқ", "No stock in this warehouse")}
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-slate-800">
                      <Table>
                        <TableHeader className="bg-slate-900">
                          <TableRow className="border-slate-800 hover:bg-slate-900">
                            <TableHead className="text-slate-400">{t("Товар", "Тауар", "Product")}</TableHead>
                            <TableHead className="text-slate-400">{t("Партия", "Партия", "Batch")}</TableHead>
                            <TableHead className="text-slate-400">{t("Класс", "Класс", "Class")}</TableHead>
                            <TableHead className="text-right text-slate-400">{t("Остаток", "Қалдық", "Stock")}</TableHead>
                            <TableHead className="text-slate-400">{t("Обновлено", "Жаңартылды", "Updated")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedOverview.allItems.map((stockItem) => (
                            <TableRow
                              key={`${stockItem.product_id}-${stockItem.variety_id || "no-variety"}-${stockItem.reproduction_id || "no-repro"}-${stockItem.batch_id || "no-batch"}`}
                              className="border-slate-800 hover:bg-slate-900/70"
                            >
                              <TableCell>
                                <div className="font-medium text-slate-100">{stockItem.identity_name || stockItem.product_name}</div>
                                <div className="text-xs text-slate-500">{stockItem.product_type || "-"}</div>
                              </TableCell>
                              <TableCell className="font-mono text-xs text-slate-400">{formatBatchLabel(stockItem.batch_id)}</TableCell>
                              <TableCell className="text-slate-300">{stockItem.batch_class || "-"}</TableCell>
                              <TableCell className="text-right font-semibold text-slate-100">
                                {formatStorageAmount(stockItem.quantity, stockItem.unit || "kg", language as Lang)}
                              </TableCell>
                              <TableCell className="text-slate-400">{formatDateTime(stockItem.last_updated, language as Lang)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </section>

                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-base font-semibold text-slate-100">
                      <History className="h-4 w-4 text-emerald-300" />
                      {t("Последние движения", "Соңғы қозғалыстар", "Recent movements")}
                    </div>
                    <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
                      <Input className="h-8 border-slate-700 bg-slate-950 text-slate-100" type="date" value={movementDateFrom} onChange={(e) => setMovementDateFrom(e.target.value)} />
                      <Input className="h-8 border-slate-700 bg-slate-950 text-slate-100" type="date" value={movementDateTo} onChange={(e) => setMovementDateTo(e.target.value)} />
                    </div>
                  </div>
                  {filteredSelectedMovements.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-800 py-8 text-center text-sm text-slate-500">
                      {t("Движения пока отсутствуют", "Әзірге қозғалыс жоқ", "No movements yet")}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredSelectedMovements.map((movement) => {
                        const movementStatus = String(movement.status || "confirmed");
                        const label =
                          movementStatus === "confirmed"
                            ? t("Подтверждено", "Расталды", "Confirmed")
                            : movementStatus === "cancelled"
                              ? t("Отменено", "Болдырылмады", "Cancelled")
                              : t("Черновик", "Черновик", "Draft");

                        return (
                          <div key={movement.id} className="rounded-lg bg-slate-900/70 px-3 py-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-slate-100">{movementTypeLabel(String(movement.movement_type || ""), t)}</span>
                                  <span className="text-sm font-semibold text-slate-200">
                                    {typeof movement.quantity_delta === "number" && movement.quantity_delta < 0 ? "-" : ""}
                                    {formatStorageAmount(Number(movement.quantity || 0), movement.product_unit || "kg", language as Lang)}
                                  </span>
                                </div>
                                <div className="mt-0.5 truncate text-sm text-slate-300">{movement.product_name || "-"}</div>
                                <div className="mt-0.5 text-xs text-slate-500">
                                  {formatDateTime(movement.operation_datetime || movement.date, language as Lang)} · {(movement.source_warehouse_name || "-") + " → " + (movement.destination_warehouse_name || "-")}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Badge className={movementStatus === "confirmed" ? "bg-emerald-500/10 text-emerald-200" : movementStatus === "cancelled" ? "bg-slate-700 text-slate-200" : "bg-amber-500/10 text-amber-200"}>
                                  {label}
                                </Badge>
                                {canManageMovements && movementStatus !== "cancelled" && movement.source_system === "inventory_transactions" ? (
                                  <Button variant="outline" size="sm" onClick={() => void handleCancelMovement(movement.id)}>
                                    {t("Отменить", "Болдырмау", "Cancel")}
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                            {movement.notes ? <div className="mt-1 text-xs text-slate-500">{movement.notes}</div> : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {canManageMovements ? (
        <InventoryTransactionFormDialog
          open={isMovementDialogOpen}
          onOpenChange={setIsMovementDialogOpen}
          onSubmit={handleCreateMovement}
          warehouses={warehouses}
          products={products}
        />
      ) : null}
    </div>
  );
}
