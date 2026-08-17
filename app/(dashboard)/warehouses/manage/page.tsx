"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, ArchiveRestore, Archive, Warehouse as WarehouseIcon, Package, Trash2 } from "lucide-react";
import {
  getWarehouses,
  getProducts,
  getInventoryBalances,
  createWarehouse,
  createProduct,
  updateWarehouse,
  updateProduct,
  archiveProduct,
  getWarehouseDeleteCheck,
  deleteWarehouseHard,
} from "@/lib/services/warehouses";
import {
  Warehouse,
  Product,
  InventoryBalance,
  WarehouseFormData,
  ProductFormData,
  WarehouseDeleteCheck,
  warehouseSchema,
  productSchema,
} from "@/lib/types/warehouse";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";

const WAREHOUSE_TYPES = [
  { value: "agrochemical", label: "Агрохимический" },
  { value: "grain", label: "Зерновой" },
  { value: "vegetable", label: "Овощной" },
  { value: "seed", label: "Семенной" },
  { value: "fertilizer", label: "Удобрения" },
  { value: "pesticide", label: "СЗР" },
  { value: "universal", label: "Универсальный" },
  { value: "potato_storage", label: "Картофелехранилище" },
  { value: "fuel", label: "ГСМ" },
  { value: "temporary", label: "Временный" },
] as const;

const CAPACITY_UNITS = [
  { value: "kg", label: "кг" },
  { value: "t", label: "т" },
  { value: "m3", label: "м³" },
  { value: "l", label: "л" },
] as const;

type WarehouseManageCacheEntry = {
  warehouses: Warehouse[];
  products: Product[];
  balances: InventoryBalance[];
  deleteChecks: Record<string, WarehouseDeleteCheck>;
  confirmedAt: number;
  productsLoaded: boolean;
  balancesLoaded: boolean;
};

const warehouseManageCache = new Map<string, WarehouseManageCacheEntry>();

const REQUEST_TIMEOUT_MS = 12_000;
const CONFIRMED_CACHE_TTL_MS = 5 * 60_000;
const SESSION_CACHE_PREFIX = "travkinflow:warehouses-manage:v1:";

function readConfirmedWarehouseCache(cacheKey: string): WarehouseManageCacheEntry | null {
  const memoryEntry = warehouseManageCache.get(cacheKey);
  if (memoryEntry) return memoryEntry;
  try {
    const raw = window.sessionStorage.getItem(`${SESSION_CACHE_PREFIX}${cacheKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WarehouseManageCacheEntry>;
    if (!Array.isArray(parsed.warehouses) || typeof parsed.confirmedAt !== "number") return null;
    const entry: WarehouseManageCacheEntry = {
      warehouses: parsed.warehouses,
      products: [],
      balances: [],
      deleteChecks: {},
      confirmedAt: parsed.confirmedAt,
      productsLoaded: false,
      balancesLoaded: false,
    };
    warehouseManageCache.set(cacheKey, entry);
    return entry;
  } catch {
    return null;
  }
}

function writeConfirmedWarehouseCache(cacheKey: string, entry: WarehouseManageCacheEntry) {
  warehouseManageCache.set(cacheKey, entry);
  try {
    // Persist only the lightweight primary list. Product and balance catalogs remain memory-only.
    window.sessionStorage.setItem(
      `${SESSION_CACHE_PREFIX}${cacheKey}`,
      JSON.stringify({ warehouses: entry.warehouses, confirmedAt: entry.confirmedAt })
    );
  } catch {
    // A full sessionStorage quota must never block the management page.
  }
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(
      () => reject(new Error(`${label}: превышено время ожидания`)),
      REQUEST_TIMEOUT_MS
    );
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

function formatCapacity(row: Warehouse): string {
  if (row.capacity_value == null || row.capacity_unit == null) return "—";
  return `${row.capacity_value} ${row.capacity_unit}`;
}

export default function ManageWarehousesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [deleteChecks, setDeleteChecks] = useState<Record<string, WarehouseDeleteCheck>>({});
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(false);
  const [warehouseDialogOpen, setWarehouseDialogOpen] = useState(false);
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [productsLoadError, setProductsLoadError] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const deleteChecksAbortRef = useRef<AbortController | null>(null);
  const confirmedDataRef = useRef(false);
  const activeCacheKeyRef = useRef("");
  const { toast } = useToast();
  const { profile } = useAuth();
  const { language } = useLanguage();
  const t = (ru: string, kz: string, en: string) =>
    language === "ru" ? ru : language === "kz" ? kz : en;

  const canManageWarehouses =
    profile?.role === "company_admin" || profile?.role === "global_admin";
  const canManageProducts = profile?.role === "global_admin";

  const warehouseForm = useForm<WarehouseFormData>({
    resolver: zodResolver(warehouseSchema),
    defaultValues: {
      name: "",
      warehouse_type: "agrochemical",
      capacity_value: null,
      capacity_unit: null,
      responsible_user_id: null,
      location: null,
      description: null,
      is_archived: false,
    },
  });

  const productForm = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: { name: "", type: "seed", unit: "kg", description: "" },
  });

  const visibleWarehouses = useMemo(() => {
    if (showArchived) return warehouses;
    return warehouses.filter((row) => !row.archived && !row.is_archived);
  }, [warehouses, showArchived]);

  const loadDeleteChecks = async (
    warehouseRows: Warehouse[],
    companyId: string,
    generation: number
  ) => {
    deleteChecksAbortRef.current?.abort();
    const controller = new AbortController();
    deleteChecksAbortRef.current = controller;
    const checks = await Promise.allSettled(
      warehouseRows.map(async (warehouse) => ({
        warehouseId: warehouse.id,
        check: await getWarehouseDeleteCheck(warehouse.id, companyId, { signal: controller.signal }),
      }))
    );
    if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
    const nextMap: Record<string, WarehouseDeleteCheck> = {};
    checks.forEach((result) => {
      if (result.status === "fulfilled") nextMap[result.value.warehouseId] = result.value.check;
    });
    setDeleteChecks(nextMap);
    const cached = warehouseManageCache.get(activeCacheKeyRef.current);
    if (cached) {
      writeConfirmedWarehouseCache(activeCacheKeyRef.current, { ...cached, deleteChecks: nextMap });
    }
  };

  const loadData = async ({ foreground = true }: { foreground?: boolean } = {}) => {
    if (!profile?.company_id) return;
    const companyId = profile.company_id;
    const cacheKey = `${companyId}:${language}:${canManageProducts ? "global" : "company"}`;
    const generation = ++loadGenerationRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const showLoading = foreground && !confirmedDataRef.current;
    try {
      if (showLoading) setLoading(true);
      setLoadError(null);
      setProductsLoadError(null);
      const productsPromise = canManageProducts
        ? withTimeout(
            getProducts(companyId, false, language, undefined, { signal: controller.signal }),
            t("Продукты", "Өнімдер", "Products")
          )
        : Promise.resolve([] as Product[]);
      const balancesPromise = withTimeout(
        getInventoryBalances(companyId, language, { signal: controller.signal }),
        t("Остатки", "Қалдықтар", "Balances")
      );
      if (canManageProducts) setProductsLoading(true);

      const warehousesData = await withTimeout(
        getWarehouses(companyId, true, language, { signal: controller.signal }),
        t("Склады", "Қоймалар", "Warehouses")
      );
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
      setWarehouses(warehousesData);
      confirmedDataRef.current = true;
      setLoading(false);
      const previous = warehouseManageCache.get(cacheKey);
      writeConfirmedWarehouseCache(cacheKey, {
        warehouses: warehousesData,
        products: previous?.products || products,
        balances: previous?.balances || balances,
        deleteChecks: previous?.deleteChecks || {},
        confirmedAt: Date.now(),
        productsLoaded: previous?.productsLoaded || !canManageProducts,
        balancesLoaded: previous?.balancesLoaded || false,
      });
      if (canManageWarehouses && warehousesData.length > 0) {
        void loadDeleteChecks(warehousesData, companyId, generation);
      } else {
        setDeleteChecks({});
      }

      const [productsResult, balancesResult] = await Promise.allSettled([productsPromise, balancesPromise]);
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
      const nextProducts = productsResult.status === "fulfilled" ? productsResult.value : (previous?.products || products);
      const nextBalances = balancesResult.status === "fulfilled" ? balancesResult.value : (previous?.balances || balances);
      if (productsResult.status === "fulfilled") {
        setProducts(productsResult.value);
      } else if (canManageProducts) {
        setProductsLoadError(
          productsResult.reason?.message || t("Не удалось загрузить продукты", "Өнімдер жүктелмеді", "Failed to load products")
        );
      }
      if (balancesResult.status === "fulfilled") setBalances(balancesResult.value);
      writeConfirmedWarehouseCache(cacheKey, {
        warehouses: warehousesData,
        products: nextProducts,
        balances: nextBalances,
        deleteChecks: warehouseManageCache.get(cacheKey)?.deleteChecks || {},
        confirmedAt: Date.now(),
        productsLoaded: productsResult.status === "fulfilled" || !canManageProducts,
        balancesLoaded: balancesResult.status === "fulfilled",
      });
    } catch (error: any) {
      if (controller.signal.aborted || generation !== loadGenerationRef.current || error?.name === "AbortError") return;
      const message = error?.message || t("Не удалось загрузить данные", "Деректерді жүктеу мүмкін болмады", "Failed to load data");
      setLoadError(message);
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: message,
        variant: "destructive",
      });
    } finally {
      if (generation === loadGenerationRef.current) {
        setLoading(false);
        setProductsLoading(false);
        if (loadAbortRef.current === controller) loadAbortRef.current = null;
      }
    }
  };

  useEffect(() => {
    const companyId = profile?.company_id;
    if (!companyId) return;
    const cacheKey = `${companyId}:${language}:${canManageProducts ? "global" : "company"}`;
    const cached = readConfirmedWarehouseCache(cacheKey);
    if (activeCacheKeyRef.current !== cacheKey) {
      activeCacheKeyRef.current = cacheKey;
      deleteChecksAbortRef.current?.abort();
      setDeleteChecks({});
      setLoadError(null);
      setProductsLoadError(null);
      if (cached) {
        setWarehouses(cached.warehouses);
        setProducts(cached.products);
        setBalances(cached.balances);
        setDeleteChecks(cached.deleteChecks);
        confirmedDataRef.current = true;
        setLoading(false);
      } else {
        setWarehouses([]);
        setProducts([]);
        setBalances([]);
        confirmedDataRef.current = false;
        setLoading(true);
      }
    }
    const cacheIsFresh =
      cached &&
      Date.now() - cached.confirmedAt < CONFIRMED_CACHE_TTL_MS &&
      cached.balancesLoaded &&
      (!canManageProducts || cached.productsLoaded);
    if (!cacheIsFresh) void loadData({ foreground: !cached });
    return () => {
      loadAbortRef.current?.abort();
      deleteChecksAbortRef.current?.abort();
      loadGenerationRef.current += 1;
    };
    // Requests are generation-guarded and aborted when company/language access changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, profile?.company_id, canManageProducts, canManageWarehouses]);

  const resetWarehouseForm = () => {
    warehouseForm.reset({
      name: "",
      warehouse_type: "agrochemical",
      capacity_value: null,
      capacity_unit: null,
      responsible_user_id: null,
      location: null,
      description: null,
      is_archived: false,
    });
  };

  const handleWarehouseSubmit = async (data: WarehouseFormData) => {
    if (!profile?.company_id) return;

    try {
      const normalized: WarehouseFormData = {
        ...data,
        responsible_user_id: data.responsible_user_id || null,
        location: data.location || null,
        description: data.description || null,
      };
      if (editingWarehouse) {
        await updateWarehouse(editingWarehouse.id, normalized, profile.company_id);
        toast({ title: t("Успешно", "Сәтті", "Success"), description: t("Склад обновлён", "Қойма жаңартылды", "Warehouse updated successfully") });
      } else {
        await createWarehouse(profile.company_id, normalized);
        toast({ title: t("Успешно", "Сәтті", "Success"), description: t("Склад создан", "Қойма құрылды", "Warehouse created successfully") });
      }
      setWarehouseDialogOpen(false);
      setEditingWarehouse(null);
      resetWarehouseForm();
      await loadData();
    } catch (error: any) {
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: error.message || t("Не удалось сохранить склад", "Қойманы сақтау мүмкін болмады", "Failed to save warehouse"),
        variant: "destructive",
      });
    }
  };

  const handleProductSubmit = async (data: ProductFormData) => {
    if (!profile?.company_id) return;
    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, data);
      } else {
        await createProduct(profile.company_id, data);
      }
      setProductDialogOpen(false);
      setEditingProduct(null);
      productForm.reset({ name: "", type: "seed", unit: "kg", description: "" });
      await loadData();
      toast({ title: t("Успешно", "Сәтті", "Success"), description: t("Изменения сохранены", "Өзгерістер сақталды", "Changes saved") });
    } catch (error: any) {
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: error.message || t("Не удалось сохранить продукт", "Өнімді сақтау мүмкін болмады", "Failed to save product"),
        variant: "destructive",
      });
    }
  };

  const openWarehouseEdit = (warehouse: Warehouse) => {
    setEditingWarehouse(warehouse);
    warehouseForm.reset({
      name: warehouse.name,
      warehouse_type: (warehouse.warehouse_type as any) || "universal",
      capacity_value: warehouse.capacity_value ?? null,
      capacity_unit: (warehouse.capacity_unit as any) || null,
      responsible_user_id: warehouse.responsible_user_id || null,
      location: warehouse.location || null,
      description: warehouse.description || null,
      is_archived: Boolean(warehouse.is_archived || warehouse.archived),
    });
    setWarehouseDialogOpen(true);
  };

  const toggleArchiveWarehouse = async (warehouse: Warehouse) => {
    if (!profile?.company_id) return;
    try {
      await updateWarehouse(
        warehouse.id,
        { is_archived: !(warehouse.is_archived || warehouse.archived) },
        profile.company_id
      );
      await loadData();
      toast({
        title: t("Успешно", "Сәтті", "Success"),
        description:
          warehouse.is_archived || warehouse.archived
            ? t("Склад восстановлен", "Қойма қалпына келтірілді", "Warehouse restored")
            : t("Склад архивирован", "Қойма мұрағатталды", "Warehouse archived"),
      });
    } catch (error: any) {
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: error.message || t("Не удалось обновить склад", "Қойманы жаңарту мүмкін болмады", "Failed to update warehouse"),
        variant: "destructive",
      });
    }
  };

  const handleHardDelete = async (warehouse: Warehouse) => {
    if (!profile?.company_id) return;
    const check = deleteChecks[warehouse.id];
    if (!check?.can_delete) {
      toast({
        title: t("Удаление запрещено", "Жоюға тыйым салынды", "Delete blocked"),
        description: t(
          "Склад содержит остатки или историю. Используйте архив.",
          "Қоймада қалдықтар немесе тарих бар. Мұрағаттауды қолданыңыз.",
          "Warehouse has stock/history. Use archive instead."
        ),
        variant: "destructive",
      });
      return;
    }

    const ok = window.confirm(
      t(
        `Удалить склад "${warehouse.name}" безвозвратно?`,
        `"${warehouse.name}" қоймасын қайтарымсыз жою керек пе?`,
        `Permanently delete warehouse "${warehouse.name}"?`
      )
    );
    if (!ok) return;

    try {
      await deleteWarehouseHard(warehouse.id, profile.company_id);
      await loadData();
      toast({
        title: t("Удалено", "Жойылды", "Deleted"),
        description: t("Склад удалён", "Қойма жойылды", "Warehouse deleted"),
      });
    } catch (error: any) {
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: error.message || t("Не удалось удалить склад", "Қойманы жою мүмкін болмады", "Failed to delete warehouse"),
        variant: "destructive",
      });
    }
  };

  const handleArchiveProduct = async (productId: string) => {
    try {
      await archiveProduct(productId);
      await loadData();
      toast({ title: t("Успешно", "Сәтті", "Success"), description: t("Продукт архивирован", "Өнім мұрағатталды", "Product archived") });
    } catch (error: any) {
      toast({
        title: t("Ошибка", "Қате", "Error"),
        description: error.message || t("Не удалось архивировать продукт", "Өнімді мұрағаттау мүмкін болмады", "Failed to archive product"),
        variant: "destructive",
      });
    }
  };

  if (!canManageWarehouses) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t("Управление складами", "Қоймаларды басқару", "Warehouse management")}
          description={t(
            "Доступ только для company_admin / global_admin",
            "Қолжетімділік тек company_admin / global_admin үшін",
            "Access only for company_admin / global_admin"
          )}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={canManageProducts
          ? t("Управление складами и номенклатурой", "Қойма мен номенклатураны басқару", "Warehouses and products")
          : t("Управление складами", "Қоймаларды басқару", "Warehouse management")}
        description={t(
          "Админ-управление складами: типы, вместимость, архив и безопасное удаление.",
          "Қоймаларды әкімшілеу: түрлері, сыйымдылығы, мұрағат және қауіпсіз жою.",
          "Admin management for warehouses: types, capacity, archive and safe delete."
        )}
      />

      {loadError ? (
        <div role="alert" className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {loadError}
        </div>
      ) : null}

      <Tabs defaultValue="warehouses" className="space-y-4">
        <TabsList>
          <TabsTrigger value="warehouses">{t("Склады", "Қоймалар", "Warehouses")}</TabsTrigger>
          {canManageProducts ? (
            <TabsTrigger value="products">{t("Продукты", "Өнімдер", "Products")}</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="warehouses">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <WarehouseIcon className="h-5 w-5" />
                {t("Склады", "Қоймалар", "Warehouses")}
              </CardTitle>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
                  <span className="text-sm">{t("Показать архивные", "Мұрағатталғандарды көрсету", "Show archived")}</span>
                  <Switch checked={showArchived} onCheckedChange={setShowArchived} />
                </div>
                <Button onClick={() => { setEditingWarehouse(null); resetWarehouseForm(); setWarehouseDialogOpen(true); }}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t("Новый склад", "Жаңа қойма", "New warehouse")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Название", "Атауы", "Name")}</TableHead>
                    <TableHead>{t("Тип", "Түрі", "Type")}</TableHead>
                    <TableHead>{t("Вместимость", "Сыйымдылық", "Capacity")}</TableHead>
                    <TableHead>{t("Статус", "Күйі", "Status")}</TableHead>
                    <TableHead>{t("Остатки", "Қалдықтар", "Stock")}</TableHead>
                    <TableHead className="text-right">{t("Действия", "Әрекеттер", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                        {t("Загрузка...", "Жүктелуде...", "Loading...")}
                      </TableCell>
                    </TableRow>
                  ) : visibleWarehouses.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                        {t("Склады не найдены", "Қоймалар табылмады", "No warehouses found")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleWarehouses.map((warehouse) => {
                      const check = deleteChecks[warehouse.id];
                      const stockRows = balances.filter((row) => row.warehouse_id === warehouse.id).length;
                      const archived = Boolean(warehouse.is_archived || warehouse.archived);
                      return (
                        <TableRow key={warehouse.id}>
                          <TableCell className="font-medium">{warehouse.name}</TableCell>
                          <TableCell>
                            {WAREHOUSE_TYPES.find((x) => x.value === warehouse.warehouse_type)?.label || warehouse.warehouse_type || "—"}
                          </TableCell>
                          <TableCell>{formatCapacity(warehouse)}</TableCell>
                          <TableCell>
                            {archived ? (
                              <Badge variant="secondary">{t("Архив", "Мұрағат", "Archived")}</Badge>
                            ) : (
                              <Badge>{t("Активный", "Белсенді", "Active")}</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{stockRows}</div>
                            {check && !check.can_delete ? (
                              <div className="text-xs text-amber-700">{t("Есть история", "Тарих бар", "Has history")}</div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={() => openWarehouseEdit(warehouse)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleArchiveWarehouse(warehouse)}
                                title={archived ? t("Восстановить", "Қалпына келтіру", "Restore") : t("Архивировать", "Мұрағаттау", "Archive")}
                              >
                                {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!check?.can_delete}
                                title={
                                  check?.can_delete
                                    ? t("Удалить склад", "Қойманы жою", "Delete warehouse")
                                    : t("Удаление запрещено: есть история/остатки", "Жоюға болмайды: тарих/қалдық бар", "Delete blocked: has history/stock")
                                }
                                onClick={() => handleHardDelete(warehouse)}
                              >
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {canManageProducts ? (
          <TabsContent value="products">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  {t("Номенклатура", "Номенклатура", "Products")}
                </CardTitle>
                <Button onClick={() => { setEditingProduct(null); productForm.reset({ name: "", type: "seed", unit: "kg", description: "" }); setProductDialogOpen(true); }}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t("Новый продукт", "Жаңа өнім", "New product")}
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {productsLoadError ? (
                  <div role="alert" className="border-b border-amber-700/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
                    {productsLoadError}
                  </div>
                ) : null}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Название", "Атауы", "Name")}</TableHead>
                      <TableHead>{t("Тип", "Түрі", "Type")}</TableHead>
                      <TableHead>{t("Создан", "Құрылған", "Created")}</TableHead>
                      <TableHead className="text-right">{t("Действия", "Әрекеттер", "Actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productsLoading && products.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-slate-500 py-8">
                          {t("Загрузка...", "Жүктелуде...", "Loading...")}
                        </TableCell>
                      </TableRow>
                    ) : products.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-slate-500 py-8">
                          {t("Продукты не найдены", "Өнімдер табылмады", "No products found")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      products.map((product) => (
                        <TableRow key={product.id}>
                          <TableCell className="font-medium">{product.name}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{product.type}</Badge>
                          </TableCell>
                          <TableCell>{new Date(product.created_at).toLocaleDateString()}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingProduct(product);
                                  productForm.reset({
                                    name: product.name,
                                    type: product.type,
                                    unit: product.unit || "kg",
                                    description: product.description || "",
                                  });
                                  setProductDialogOpen(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleArchiveProduct(product.id)}
                              >
                                <Archive className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>

      <Dialog open={warehouseDialogOpen} onOpenChange={setWarehouseDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingWarehouse
                ? t("Редактировать склад", "Қойманы өңдеу", "Edit warehouse")
                : t("Новый склад", "Жаңа қойма", "New warehouse")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "Production-параметры склада для корректной логистики и контроля.",
                "Дұрыс логистика мен бақылау үшін қойма параметрлері.",
                "Production warehouse parameters for logistics and control."
              )}
            </DialogDescription>
          </DialogHeader>
          <Form {...warehouseForm}>
            <form onSubmit={warehouseForm.handleSubmit(handleWarehouseSubmit)} className="space-y-4">
              <FormField
                control={warehouseForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Название склада *", "Қойма атауы *", "Warehouse name *")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("Например: Овощной склад", "Мысалы: Көкөніс қоймасы", "Example: Vegetable warehouse")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={warehouseForm.control}
                  name="warehouse_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("Тип склада *", "Қойма түрі *", "Warehouse type *")}</FormLabel>
                      <Select value={field.value || "universal"} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("Выберите тип", "Түрін таңдаңыз", "Select type")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {WAREHOUSE_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={warehouseForm.control}
                  name="capacity_unit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("Единица вместимости", "Сыйымдылық бірлігі", "Capacity unit")}</FormLabel>
                      <Select value={field.value || "none"} onValueChange={(value) => field.onChange(value === "none" ? null : value)}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("Выберите единицу", "Бірлікті таңдаңыз", "Select unit")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">{t("Не указано", "Көрсетілмеген", "Not set")}</SelectItem>
                          {CAPACITY_UNITS.map((unit) => (
                            <SelectItem key={unit.value} value={unit.value}>{unit.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={warehouseForm.control}
                name="capacity_value"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Вместимость", "Сыйымдылық", "Capacity value")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        value={field.value == null ? "" : String(field.value)}
                        onChange={(event) => {
                          const raw = event.target.value;
                          field.onChange(raw === "" ? null : Number(raw));
                        }}
                        placeholder={t("Например: 2000", "Мысалы: 2000", "Example: 2000")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={warehouseForm.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Локация", "Орналасуы", "Location")}</FormLabel>
                    <FormControl>
                      <Input
                        value={field.value || ""}
                        onChange={(event) => field.onChange(event.target.value || null)}
                        placeholder={t("Адрес/участок", "Мекенжай/учаске", "Address/zone")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={warehouseForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Описание", "Сипаттама", "Description")}</FormLabel>
                    <FormControl>
                      <Textarea
                        value={field.value || ""}
                        onChange={(event) => field.onChange(event.target.value || null)}
                        rows={3}
                        placeholder={t("Комментарий по складу", "Қойма бойынша түсініктеме", "Warehouse notes")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={warehouseForm.control}
                name="is_archived"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <div className="space-y-1">
                      <FormLabel>{t("Архивный статус", "Мұрағат статусы", "Archived status")}</FormLabel>
                      <div className="text-xs text-slate-500">
                        {t("Архив скрывает склад из операционных списков", "Мұрағат қойманы операциялық тізімнен жасырады", "Archive hides warehouse from operational lists")}
                      </div>
                    </div>
                    <FormControl>
                      <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setWarehouseDialogOpen(false);
                    setEditingWarehouse(null);
                    resetWarehouseForm();
                  }}
                >
                  {t("Отмена", "Болдырмау", "Cancel")}
                </Button>
                <Button type="submit" disabled={warehouseForm.formState.isSubmitting}>
                  {warehouseForm.formState.isSubmitting
                    ? t("Сохранение...", "Сақталуда...", "Saving...")
                    : editingWarehouse
                    ? t("Обновить", "Жаңарту", "Update")
                    : t("Создать", "Құру", "Create")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? t("Редактировать продукт", "Өнімді өңдеу", "Edit product") : t("Новый продукт", "Жаңа өнім", "New product")}
            </DialogTitle>
            <DialogDescription>
              {t("Номенклатурный справочник, не складской остаток.", "Номенклатура анықтамалығы, қойма қалдығы емес.", "Catalog item, not a stock balance row.")}
            </DialogDescription>
          </DialogHeader>
          <Form {...productForm}>
            <form onSubmit={productForm.handleSubmit(handleProductSubmit)} className="space-y-4">
              <FormField
                control={productForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Название продукта *", "Өнім атауы *", "Product name *")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={productForm.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Тип *", "Түрі *", "Type *")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="crop">crop</SelectItem>
                        <SelectItem value="seed">seed</SelectItem>
                        <SelectItem value="fertilizer">fertilizer</SelectItem>
                        <SelectItem value="pesticide">pesticide</SelectItem>
                        <SelectItem value="organic">organic</SelectItem>
                        <SelectItem value="fuel">fuel</SelectItem>
                        <SelectItem value="material">material</SelectItem>
                        <SelectItem value="produce">produce</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={productForm.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Ед. изм. *", "Өлшем бірлігі *", "Unit *")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={productForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Описание", "Сипаттама", "Description")}</FormLabel>
                    <FormControl>
                      <Textarea rows={3} value={field.value || ""} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setProductDialogOpen(false)}>
                  {t("Отмена", "Болдырмау", "Cancel")}
                </Button>
                <Button type="submit" disabled={productForm.formState.isSubmitting}>
                  {productForm.formState.isSubmitting ? t("Сохранение...", "Сақталуда...", "Saving...") : t("Сохранить", "Сақтау", "Save")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
