"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { CropDistributionTable } from "@/components/dashboard/crop-distribution-table";
import { RecentOperationsTable } from "@/components/dashboard/recent-operations-table";
import { InventorySnapshotTable } from "@/components/dashboard/inventory-snapshot-table";
import { Card, CardContent } from "@/components/ui/card";
import { MapPin, Sprout, Maximize2, Warehouse, Package, ArrowRightLeft } from "lucide-react";
import {
  getDashboardMetrics,
  getCropDistribution,
  getRecentOperations,
  getInventorySnapshot,
  type DashboardMetrics,
  type CropDistribution,
  type RecentOperation,
  type InventorySnapshot,
} from "@/lib/services/dashboard";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { getInventoryBalances, getInventoryTransactions, getWarehouses } from "@/lib/services/warehouses";

export default function DashboardPage() {
  const { profile, loading: authLoading } = useAuth();
  const { t, language } = useLanguage();
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalFields: 0,
    totalArea: 0,
    activeCrops: 0,
    totalWarehouses: 0,
  });
  const [cropDistribution, setCropDistribution] = useState<CropDistribution[]>([]);
  const [recentOperations, setRecentOperations] = useState<RecentOperation[]>([]);
  const [inventory, setInventory] = useState<InventorySnapshot[]>([]);

  const [warehouseCount, setWarehouseCount] = useState(0);
  const [stockRows, setStockRows] = useState(0);
  const [recentMovements, setRecentMovements] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    async function loadDashboardData() {
      if (authLoading) return;
      if (!profile?.company_id) {
        setErrorMessage("Не выбран контекст компании.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorMessage(null);
      try {
        if (profile?.role === "warehouse" && profile.company_id) {
          const [warehouses, balances, movements] = await Promise.all([
            getWarehouses(profile.company_id, false, language),
            getInventoryBalances(profile.company_id, language),
            getInventoryTransactions(profile.company_id, language),
          ]);
          setWarehouseCount(warehouses.length);
          setStockRows(balances.length);
          setRecentMovements(
            movements.filter((m) => String(m.status || "confirmed") === "confirmed").slice(0, 20).length
          );
          setInventory(
            balances.map((row) => ({
              productName: row.product_name,
              productType: String(row.product_type),
              quantity: row.quantity,
              warehouseName: row.warehouse_name,
            }))
          );
        } else {
          const [metricsData, cropData, operationsData, inventoryData] = await Promise.all([
            getDashboardMetrics(profile.company_id),
            getCropDistribution(profile.company_id, currentYear, language),
            getRecentOperations(profile.company_id, 5, language),
            getInventorySnapshot(profile.company_id, language),
          ]);
          setMetrics(metricsData);
          setCropDistribution(cropData);
          setRecentOperations(operationsData);
          setInventory(inventoryData);
        }
      } catch (error) {
        console.error("Error loading dashboard data:", error);
        setErrorMessage("Не удалось загрузить данные панели.");
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();
  }, [authLoading, currentYear, profile?.role, profile?.company_id, language]);

  if (authLoading || loading) {
    return (
      <div>
        <PageHeader title={t("dashboard_title")} description={t("dashboard_desc")} />
        <div className="text-center py-12">
          <p className="text-slate-500">{t("dashboard_loading")}</p>
        </div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div>
        <PageHeader title={t("dashboard_title")} description={t("dashboard_desc")} />
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      </div>
    );
  }

  if (profile?.role === "warehouse") {
    const topStock = inventory[0];
    return (
      <div className="space-y-4">
        <PageHeader
          title={t("warehouse_dashboard_title")}
          description={t("warehouse_dashboard_desc")}
        />

        <div className="grid gap-3 md:hidden">
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-slate-500">{t("warehouses_metric")}</div>
              <div className="mt-1 text-2xl font-semibold">{warehouseCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-slate-500">{t("stock_positions_metric")}</div>
              <div className="mt-1 text-2xl font-semibold">{stockRows}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-slate-500">{t("recent_confirmed_movements_metric")}</div>
              <div className="mt-1 text-2xl font-semibold">{recentMovements}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-slate-500">Ключевой остаток</div>
              <div className="mt-1 text-base font-semibold">{topStock ? topStock.productName : "Нет данных"}</div>
              {topStock ? <div className="text-sm text-slate-500">{topStock.quantity.toFixed(2)}</div> : null}
            </CardContent>
          </Card>
        </div>

        <div className="hidden gap-6 md:grid md:grid-cols-3 md:mb-6">
          <MetricCard title={t("warehouses_metric")} value={warehouseCount} icon={Warehouse} />
          <MetricCard title={t("stock_positions_metric")} value={stockRows} icon={Package} />
          <MetricCard title={t("recent_confirmed_movements_metric")} value={recentMovements} icon={ArrowRightLeft} />
        </div>

        <div className="grid gap-6">
          <InventorySnapshotTable data={inventory} />
        </div>
      </div>
    );
  }

  const dominantCrop = cropDistribution[0];
  const lastOperation = recentOperations[0];
  const inventoryPreview = inventory.slice(0, 3);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("dashboard_title")}
        description={t("dashboard_desc")}
      />

      <div className="grid gap-3 md:hidden">
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-slate-500">Активные операции</div>
            <div className="mt-1 text-2xl font-semibold">{recentOperations.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-slate-500">{t("total_area_metric")}</div>
            <div className="mt-1 text-2xl font-semibold">{metrics.totalArea}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-slate-500">Проблемные поля</div>
            <div className="mt-1 text-2xl font-semibold">{Math.max(metrics.totalFields - metrics.activeCrops, 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-slate-500">Доминирующая культура</div>
            <div className="mt-1 text-base font-semibold">{dominantCrop ? dominantCrop.crop : "Нет данных"}</div>
            {dominantCrop ? <div className="text-sm text-slate-500">{dominantCrop.totalArea} га</div> : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-slate-500">Последние события</div>
            <div className="mt-1 text-base font-semibold">
              {lastOperation ? `${lastOperation.operationType} — ${lastOperation.fieldName}` : "Событий пока нет"}
            </div>
            {lastOperation?.cropName ? <div className="text-sm text-slate-500">{lastOperation.cropName}</div> : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-slate-500">Остатки материалов</div>
            <div className="mt-1 text-base font-semibold">
              {inventoryPreview.length ? inventoryPreview.map((item) => item.productName).join(", ") : "Нет данных"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="hidden gap-6 md:grid md:grid-cols-2 lg:grid-cols-4 md:mb-6">
        <MetricCard title={t("total_fields_metric")} value={metrics.totalFields} icon={MapPin} />
        <MetricCard title={t("total_area_metric")} value={metrics.totalArea} icon={Maximize2} />
        <MetricCard title={t("active_crops_metric")} value={metrics.activeCrops} icon={Sprout} />
        <MetricCard title={t("warehouses_metric")} value={metrics.totalWarehouses} icon={Warehouse} />
      </div>

      <div className="hidden gap-6 md:grid md:mb-6">
        <CropDistributionTable data={cropDistribution} />
      </div>

      <div className="hidden gap-6 md:grid md:mb-6">
        <RecentOperationsTable data={recentOperations} />
      </div>

      <div className="hidden gap-6 md:grid">
        <InventorySnapshotTable data={inventory} />
      </div>
    </div>
  );
}
