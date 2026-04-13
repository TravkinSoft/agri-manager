"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { CropDistributionTable } from "@/components/dashboard/crop-distribution-table";
import { RecentOperationsTable } from "@/components/dashboard/recent-operations-table";
import { InventorySnapshotTable } from "@/components/dashboard/inventory-snapshot-table";
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
  const { profile } = useAuth();
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
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    async function loadDashboardData() {
      setLoading(true);
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
          if (!profile?.company_id) {
            setMetrics({
              totalFields: 0,
              totalArea: 0,
              activeCrops: 0,
              totalWarehouses: 0,
            });
            setCropDistribution([]);
            setRecentOperations([]);
            setInventory([]);
            return;
          }

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
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();
  }, [currentYear, profile?.role, profile?.company_id, language]);

  if (loading) {
    return (
      <div>
        <PageHeader title={t("dashboard_title")} description={t("dashboard_desc")} />
        <div className="text-center py-12">
          <p className="text-slate-500">{t("dashboard_loading")}</p>
        </div>
      </div>
    );
  }

  if (profile?.role === "warehouse") {
    return (
      <div>
        <PageHeader
          title={t("warehouse_dashboard_title")}
          description={t("warehouse_dashboard_desc")}
        />
        <div className="grid gap-6 md:grid-cols-3 mb-6">
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

  return (
    <div>
      <PageHeader
        title={t("dashboard_title")}
        description={t("dashboard_desc")}
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <MetricCard title={t("total_fields_metric")} value={metrics.totalFields} icon={MapPin} />
        <MetricCard title={t("total_area_metric")} value={metrics.totalArea} icon={Maximize2} />
        <MetricCard title={t("active_crops_metric")} value={metrics.activeCrops} icon={Sprout} />
        <MetricCard title={t("warehouses_metric")} value={metrics.totalWarehouses} icon={Warehouse} />
      </div>

      <div className="grid gap-6 mb-6">
        <CropDistributionTable data={cropDistribution} />
      </div>

      <div className="grid gap-6 mb-6">
        <RecentOperationsTable data={recentOperations} />
      </div>

      <div className="grid gap-6">
        <InventorySnapshotTable data={inventory} />
      </div>
    </div>
  );
}
