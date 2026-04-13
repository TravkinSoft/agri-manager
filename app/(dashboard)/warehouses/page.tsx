"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
  CircleAlert,
  CircleCheck,
  CircleX,
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

export default function WarehousesPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { language } = useLanguage();

  const t = (ru: string, kz: string, en: string) =>
    language === "ru" ? ru : language === "kz" ? kz : en;

  const [loading, setLoading] = useState(true);
  const [isMovementDialogOpen, setIsMovementDialogOpen] = useState(false);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransactionWithDetails[]>([]);

  const canManageMovements =
    profile?.role === "admin" ||
    profile?.role === "company_admin" ||
    profile?.role === "global_admin" ||
    profile?.role === "warehouse";
  const observerMode = profile?.role === "agronomist";

  const reloadData = async () => {
    if (!profile?.company_id) return;
    setLoading(true);

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

  const overviewData = useMemo<WarehouseOverview[]>(() => {
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

      const fullText = [item.warehouse.name, ...item.allItems.map((x) => x.product_name)].join(" ").toLowerCase();
      return matchesType && fullText.includes(normalizedSearch);
    });
  }, [overviewData, searchValue, typeFilter]);

  const selectedOverview = useMemo(() => {
    if (!selectedWarehouseId) return null;
    return overviewData.find((item) => item.warehouse.id === selectedWarehouseId) || null;
  }, [selectedWarehouseId, overviewData]);

  const totalWarehouses = overviewData.length;
  const totalVolumeKg = overviewData.reduce((sum, item) => sum + item.currentKg, 0);
  const uniqueProductsCount = new Set(balances.map((row) => row.product_id)).size;
  const riskWarehousesCount = overviewData.filter((item) => item.status === "warning" || item.status === "critical").length;

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

  if (
    profile?.role !== "admin" &&
    profile?.role !== "company_admin" &&
    profile?.role !== "global_admin" &&
    profile?.role !== "warehouse" &&
    profile?.role !== "agronomist"
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
    <div className="space-y-6">
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <div className="text-sm text-slate-500">{t("Всего складов", "Қоймалар саны", "Warehouses")}</div>
            <div className="mt-1 text-2xl font-bold">{totalWarehouses}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-sm text-slate-500">{t("Общий объем хранения", "Жалпы сақтау көлемі", "Total stored volume")}</div>
            <div className="mt-1 text-2xl font-bold">{formatStorageAmount(totalVolumeKg, "kg", language as Lang)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-sm text-slate-500">{t("Культур в хранении", "Сақтаудағы дақылдар", "Stored crops")}</div>
            <div className="mt-1 text-2xl font-bold">{uniqueProductsCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-sm text-slate-500">{t("Почти заполнены / переполнены", "Толуға жақын / толған", "Near full / overfilled")}</div>
            <div className="mt-1 text-2xl font-bold">{riskWarehousesCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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

            const statusMeta =
              item.status === "critical"
                ? {
                    icon: CircleX,
                    badgeClass: "bg-red-100 text-red-700",
                    text: t("Заполнен / переполнен", "Толған / артық толған", "Full / overfilled"),
                    progressClass: "bg-red-500",
                  }
                : item.status === "warning"
                  ? {
                      icon: CircleAlert,
                      badgeClass: "bg-amber-100 text-amber-700",
                      text: t("Почти заполнен", "Толуға жақын", "Nearly full"),
                      progressClass: "bg-amber-500",
                    }
                  : {
                      icon: CircleCheck,
                      badgeClass: "bg-emerald-100 text-emerald-700",
                      text: t("Норм", "Қалыпты", "Normal"),
                      progressClass: "bg-emerald-500",
                    };

            const StatusIcon = statusMeta.icon;
            const fillPercent = item.fillPercent == null ? null : Math.max(0, item.fillPercent);

            return (
              <button
                key={item.warehouse.id}
                type="button"
                onClick={() => setSelectedWarehouseId(item.warehouse.id)}
                className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <div className="border-b bg-gradient-to-r from-slate-900 to-slate-700 px-4 py-3 text-white">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase tracking-wider text-slate-300">{typeLabel}</div>
                      <div className="mt-1 truncate text-lg font-semibold">{item.warehouse.name}</div>
                    </div>
                    <WarehouseIcon className="h-4 w-4 shrink-0 text-emerald-300/90" />
                  </div>
                </div>

                <div className="space-y-3 p-4">
                  <div>
                    <div className="text-xs text-slate-500">{t("Объем хранения", "Сақтау көлемі", "Stored volume")}</div>
                    <div className="mt-1 text-2xl font-bold text-slate-900">{formatStorageAmount(item.currentKg, "kg", language as Lang)}</div>
                  </div>

                  {fillPercent != null ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span>{t("Заполненность", "Толуы", "Fill level")}</span>
                        <span>{fillPercent.toFixed(1)}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-200">
                        <div className={`h-full rounded-full ${statusMeta.progressClass}`} style={{ width: `${Math.min(fillPercent, 100)}%` }} />
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">{t("Вместимость не задана", "Сыйымдылығы көрсетілмеген", "Capacity is not set")}</div>
                  )}

                  <div className="space-y-1">
                    <div className="text-xs text-slate-500">{t("Топ-3 культуры", "Топ-3 дақыл", "Top-3 crops")}</div>
                    {item.topItems.length === 0 ? (
                      <div className="text-sm text-slate-400">{t("Нет остатков", "Қалдық жоқ", "No stock")}</div>
                    ) : (
                      item.topItems.map((stockItem) => (
                        <div key={`${item.warehouse.id}-${stockItem.product_id}`} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate text-slate-700">{stockItem.product_name}</span>
                          <span className="shrink-0 font-medium text-slate-900">{formatStorageAmount(stockItem.quantity, stockItem.unit || "kg", language as Lang)}</span>
                        </div>
                      ))
                    )}
                  </div>

                  <Badge className={`inline-flex items-center gap-1 ${statusMeta.badgeClass}`}>
                    <StatusIcon className="h-3.5 w-3.5" />
                    {statusMeta.text}
                  </Badge>
                </div>
              </button>
            );
          })
        )}
      </div>

      <Sheet open={Boolean(selectedOverview)} onOpenChange={(open) => !open && setSelectedWarehouseId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          {selectedOverview && (
            <div className="space-y-5">
              <SheetHeader>
                <SheetTitle className="text-2xl">{selectedOverview.warehouse.name}</SheetTitle>
                <SheetDescription>
                  {TYPE_LABELS[selectedOverview.warehouseType]
                    ? t(
                        TYPE_LABELS[selectedOverview.warehouseType].ru,
                        TYPE_LABELS[selectedOverview.warehouseType].kz,
                        TYPE_LABELS[selectedOverview.warehouseType].en
                      )
                    : selectedOverview.warehouseType}
                </SheetDescription>
              </SheetHeader>

              <div className="grid gap-3 sm:grid-cols-3">
                <Card>
                  <CardContent className="pt-5">
                    <div className="text-xs text-slate-500">{t("Текущий объем", "Ағымдағы көлем", "Current volume")}</div>
                    <div className="text-lg font-semibold">{formatStorageAmount(selectedOverview.currentKg, "kg", language as Lang)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5">
                    <div className="text-xs text-slate-500">{t("Вместимость", "Сыйымдылық", "Capacity")}</div>
                    <div className="text-lg font-semibold">
                      {selectedOverview.capacityKg > 0
                        ? formatStorageAmount(selectedOverview.capacityKg, "kg", language as Lang)
                        : t("Не задана", "Көрсетілмеген", "Not set")}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5">
                    <div className="text-xs text-slate-500">{t("Заполненность", "Толуы", "Fill level")}</div>
                    <div className="text-lg font-semibold">
                      {selectedOverview.fillPercent == null ? "-" : `${Math.max(0, selectedOverview.fillPercent).toFixed(1)}%`}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    {t("Все культуры в наличии", "Қоймадағы барлық дақыл", "All stored crops")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectedOverview.allItems.length === 0 ? (
                    <div className="py-5 text-center text-slate-500">{t("На этом складе нет остатков", "Бұл қоймада қалдық жоқ", "No stock in this warehouse")}</div>
                  ) : (
                    selectedOverview.allItems.map((stockItem) => {
                      const maxQty = Number(selectedOverview.allItems[0]?.quantity || 1);
                      const width = Math.max(4, Math.min(100, (Number(stockItem.quantity || 0) / maxQty) * 100));
                      return (
                        <div key={stockItem.product_id} className="rounded-lg border border-slate-200 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium text-slate-800">{stockItem.product_name}</div>
                            <div className="text-sm font-semibold text-slate-900">
                              {formatStorageAmount(stockItem.quantity, stockItem.unit || "kg", language as Lang)}
                            </div>
                          </div>
                          <div className="mt-2 h-2 rounded-full bg-slate-200">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${width}%` }} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <History className="h-4 w-4" />
                    {t("Последние движения", "Соңғы қозғалыстар", "Recent movements")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {selectedOverview.latestMovements.length === 0 ? (
                    <div className="py-5 text-center text-slate-500">{t("Движения пока отсутствуют", "Әзірге қозғалыс жоқ", "No movements yet")}</div>
                  ) : (
                    selectedOverview.latestMovements.map((movement) => {
                      const movementStatus = String(movement.status || "confirmed");
                      const statusLabel =
                        movementStatus === "confirmed"
                          ? t("Подтверждено", "Расталды", "Confirmed")
                          : movementStatus === "cancelled"
                            ? t("Отменено", "Болдырылмады", "Cancelled")
                            : t("Черновик", "Черновик", "Draft");

                      return (
                        <div key={movement.id} className="rounded-lg border border-slate-200 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium text-slate-800">{movementTypeLabel(String(movement.movement_type || ""), t)}</div>
                            <Badge
                              className={
                                movementStatus === "confirmed"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : movementStatus === "cancelled"
                                    ? "bg-slate-200 text-slate-700"
                                    : "bg-amber-100 text-amber-700"
                              }
                            >
                              {statusLabel}
                            </Badge>
                          </div>

                          <div className="mt-1 text-sm text-slate-700">{movement.product_name || "-"}</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">
                            {formatStorageAmount(Number(movement.quantity || 0), movement.product_unit || "kg", language as Lang)}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {formatDateTime(movement.operation_datetime || movement.date, language as Lang)} •{" "}
                            {(movement.source_warehouse_name || "-") + " → " + (movement.destination_warehouse_name || "-")}
                          </div>
                          {movement.notes ? <div className="mt-1 text-xs text-slate-500">{movement.notes}</div> : null}

                          {canManageMovements && movementStatus !== "cancelled" ? (
                            <div className="mt-2">
                              <Button variant="outline" size="sm" onClick={() => void handleCancelMovement(movement.id)}>
                                {t("Отменить", "Болдырмау", "Cancel")}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </SheetContent>
      </Sheet>

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
