"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { CropDistributionTable } from "@/components/dashboard/crop-distribution-table";
import { RecentOperationsTable } from "@/components/dashboard/recent-operations-table";
import { InventorySnapshotTable } from "@/components/dashboard/inventory-snapshot-table";
import { MapPin, Sprout, Maximize2, Warehouse } from "lucide-react";
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

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalFields: 0,
    totalArea: 0,
    activeCrops: 0,
    totalWarehouses: 0,
  });
  const [cropDistribution, setCropDistribution] = useState<CropDistribution[]>([]);
  const [recentOperations, setRecentOperations] = useState<RecentOperation[]>([]);
  const [inventory, setInventory] = useState<InventorySnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  const currentYear = new Date().getFullYear();

  useEffect(() => {
    async function loadDashboardData() {
      setLoading(true);
      try {
        const [metricsData, cropData, operationsData, inventoryData] = await Promise.all([
          getDashboardMetrics(),
          getCropDistribution(currentYear),
          getRecentOperations(5),
          getInventorySnapshot(),
        ]);

        setMetrics(metricsData);
        setCropDistribution(cropData);
        setRecentOperations(operationsData);
        setInventory(inventoryData);
      } catch (error) {
        console.error("Error loading dashboard data:", error);
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();
  }, [currentYear]);

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Dashboard"
          description="Overview of your agricultural operations"
        />
        <div className="text-center py-12">
          <p className="text-slate-500">Loading dashboard data...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Overview of your agricultural operations"
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <MetricCard
          title="Total Fields"
          value={metrics.totalFields}
          icon={MapPin}
        />
        <MetricCard
          title="Total Area (ha)"
          value={metrics.totalArea}
          icon={Maximize2}
        />
        <MetricCard
          title="Active Crops"
          value={metrics.activeCrops}
          icon={Sprout}
        />
        <MetricCard
          title="Warehouses"
          value={metrics.totalWarehouses}
          icon={Warehouse}
        />
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
