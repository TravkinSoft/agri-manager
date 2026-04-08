import { supabase } from "@/lib/supabase/client";

export interface DashboardMetrics {
  totalFields: number;
  totalArea: number;
  activeCrops: number;
  totalWarehouses: number;
}

export interface CropDistribution {
  crop: string;
  totalArea: number;
  fieldsCount: number;
}

export interface RecentOperation {
  id: string;
  date: string;
  fieldName: string;
  cropName: string | null;
  operationType: string;
  notes: string | null;
}

export interface InventorySnapshot {
  productName: string;
  productType: string;
  quantity: number;
  warehouseName: string;
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const { data: fields } = await supabase
    .from("fields")
    .select("area")
    .eq("archived", false);

  const totalFields = fields?.length || 0;
  const totalArea = fields?.reduce((sum, field) => sum + Number(field.area), 0) || 0;

  const { data: crops } = await supabase
    .from("crop_structure")
    .select("id")
    .eq("archived", false)
    .neq("status", "harvested");

  const activeCrops = crops?.length || 0;

  const { data: warehouses } = await supabase
    .from("warehouses")
    .select("id")
    .eq("archived", false);

  const totalWarehouses = warehouses?.length || 0;

  return {
    totalFields,
    totalArea: Math.round(totalArea * 100) / 100,
    activeCrops,
    totalWarehouses,
  };
}

export async function getCropDistribution(season?: number): Promise<CropDistribution[]> {
  let query = supabase
    .from("crop_structure")
    .select(`
      area,
      field_id,
      crops!inner(name)
    `)
    .eq("archived", false);

  if (season) {
    query = query.eq("seasons.year", season);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching crop distribution:", error);
    return [];
  }

  const distribution = data?.reduce((acc, item: any) => {
    const cropName = item.crops?.name || "Unknown";
    const existing = acc.find((d) => d.crop === cropName);
    if (existing) {
      existing.totalArea += Number(item.area);
      existing.fieldsCount += 1;
    } else {
      acc.push({
        crop: cropName,
        totalArea: Number(item.area),
        fieldsCount: 1,
      });
    }
    return acc;
  }, [] as CropDistribution[]) || [];

  return distribution
    .map((d) => ({
      ...d,
      totalArea: Math.round(d.totalArea * 100) / 100,
    }))
    .sort((a, b) => b.totalArea - a.totalArea);
}

export async function getRecentOperations(limit: number = 5): Promise<RecentOperation[]> {
  const { data, error } = await supabase
    .from("operations")
    .select(`
      id,
      date,
      operation_type,
      notes,
      fields!operations_field_id_fkey (
        name
      ),
      crop_structure!operations_crop_structure_id_fkey (
        crops!inner(name)
      )
    `)
    .eq("archived", false)
    .order("date", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Error fetching recent operations:", error);
    return [];
  }

  return data?.map((op: any) => ({
    id: op.id,
    date: op.date,
    fieldName: op.fields?.name || "Unknown",
    cropName: op.crop_structure?.crops?.name || null,
    operationType: op.operation_type,
    notes: op.notes,
  })) || [];
}

export async function getInventorySnapshot(): Promise<InventorySnapshot[]> {
  const { data: transactions, error } = await supabase
    .from("inventory_transactions")
    .select(`
      warehouse_id,
      product_id,
      quantity,
      transaction_type,
      warehouses!inventory_transactions_warehouse_id_fkey (
        name
      ),
      products!inventory_transactions_product_id_fkey (
        name,
        type
      )
    `);

  if (error) {
    console.error("Error fetching inventory transactions:", error);
    return [];
  }

  const inventory = transactions?.reduce((acc, txn: any) => {
    const key = `${txn.product_id}-${txn.warehouse_id}`;
    if (!acc[key]) {
      acc[key] = {
        productName: txn.products?.name || "Unknown",
        productType: txn.products?.type || "unknown",
        quantity: 0,
        warehouseName: txn.warehouses?.name || "Unknown",
      };
    }
    const qty = Number(txn.quantity);
    if (txn.transaction_type === "in") {
      acc[key].quantity += qty;
    } else if (txn.transaction_type === "out") {
      acc[key].quantity -= qty;
    }
    return acc;
  }, {} as Record<string, InventorySnapshot>) || {};

  return Object.values(inventory)
    .filter((item) => item.quantity > 0)
    .sort((a, b) => a.productName.localeCompare(b.productName));
}
