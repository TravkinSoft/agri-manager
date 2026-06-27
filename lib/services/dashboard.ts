import { supabase } from "@/lib/supabase/client";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import type { Language } from "@/lib/i18n/translations";
import { hasQaDataMarker, rowHasQaDataMarker } from "@/lib/utils/qa-data";

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

export async function getDashboardMetrics(companyId: string): Promise<DashboardMetrics> {
  const { data: fields } = await supabase
    .from("fields")
    .select("area")
    .eq("company_id", companyId)
    .eq("archived", false);

  const totalFields = fields?.length || 0;
  const totalArea = fields?.reduce((sum, field) => sum + Number(field.area), 0) || 0;

  const { data: crops } = await supabase
    .from("crop_structure")
    .select("id,notes")
    .eq("company_id", companyId)
    .eq("archived", false)
    .neq("status", "harvested");

  const activeCrops = (crops || []).filter((row: any) => !hasQaDataMarker(row.notes)).length;

  const { data: warehouses } = await supabase
    .from("warehouses")
    .select("id,name,description")
    .eq("company_id", companyId)
    .eq("archived", false);

  const totalWarehouses = (warehouses || []).filter((row: any) => !rowHasQaDataMarker(row, ["name", "description"])).length;

  return {
    totalFields,
    totalArea: Math.round(totalArea * 100) / 100,
    activeCrops,
    totalWarehouses,
  };
}

export async function getCropDistribution(
  companyId: string,
  season?: number,
  language: Language = "ru"
): Promise<CropDistribution[]> {
  let query = supabase
    .from("crop_structure")
    .select(`
      area,
      field_id,
      notes,
      seasons:season_id(year),
      crops!inner(name, name_ru, name_kz, name_en)
    `)
    .eq("company_id", companyId)
    .eq("archived", false);

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching crop distribution:", error);
    return [];
  }

  const scopedRows = (data || []).filter((item: any) => {
    if (!season) return true;
    const seasonRow = Array.isArray(item.seasons) ? item.seasons[0] : item.seasons;
    return Number(seasonRow?.year || 0) === season;
  });

  const distribution = scopedRows.reduce((acc, item: any) => {
    const cropName = localizedName(item.crops, language) || "Unknown";
    if (hasQaDataMarker(`${cropName} ${item.notes || ""}`)) return acc;
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
  }, [] as CropDistribution[]);

  return distribution
    .map((d) => ({
      ...d,
      totalArea: Math.round(d.totalArea * 100) / 100,
    }))
    .sort((a, b) => b.totalArea - a.totalArea);
}

export async function getRecentOperations(
  companyId: string,
  limit: number = 5,
  language: Language = "ru"
): Promise<RecentOperation[]> {
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
        crops!inner(name, name_ru, name_kz, name_en)
      )
    `)
    .eq("company_id", companyId)
    .eq("archived", false)
    .order("date", { ascending: false })
    .limit(Math.max(limit * 4, limit));

  if (error) {
    console.error("Error fetching recent operations:", error);
    return [];
  }

  return (
    data?.map((op: any) => ({
      id: op.id,
      date: op.date,
      fieldName: op.fields?.name || "Unknown",
      cropName: localizedName(op.crop_structure?.crops, language) || null,
      operationType: op.operation_type,
      notes: op.notes,
    })) || []
  )
    .filter((op) => !hasQaDataMarker(`${op.fieldName} ${op.cropName || ""} ${op.operationType} ${op.notes || ""}`))
    .slice(0, limit);
}

export async function getInventorySnapshot(
  companyId: string,
  language: Language = "ru"
): Promise<InventorySnapshot[]> {
  const { data: balances, error } = await supabase
    .from("v_stock_balance_canonical")
    .select("warehouse_id, product_id, quantity")
    .eq("company_id", companyId);

  if (error) {
    console.error("Error fetching inventory snapshot:", error);
    return [];
  }

  const warehouseIds = Array.from(new Set((balances || []).map((row: any) => String(row.warehouse_id || "")).filter(Boolean)));
  const productIds = Array.from(new Set((balances || []).map((row: any) => String(row.product_id || "")).filter(Boolean)));

  const [warehousesRes, productsRes] = await Promise.all([
    warehouseIds.length
      ? supabase.from("warehouses").select("id,name,name_ru,name_kz,name_en").in("id", warehouseIds)
      : Promise.resolve({ data: [], error: null } as any),
    productIds.length
      ? supabase.from("products").select("id,name,trade_name,normalized_name,type,product_type").in("id", productIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const warehouseById = new Map<string, any>();
  (warehousesRes.data || []).forEach((row: any) => warehouseById.set(String(row.id), row));
  const productById = new Map<string, any>();
  (productsRes.data || []).forEach((row: any) => productById.set(String(row.id), row));

  return (balances || [])
    .map((row: any) => ({
      productName: brandName(productById.get(String(row.product_id))) || "Unknown",
      productType: productById.get(String(row.product_id))?.product_type || productById.get(String(row.product_id))?.type || "unknown",
      quantity: Number(row.quantity || 0),
      warehouseName: localizedName(warehouseById.get(String(row.warehouse_id)), language) || "Unknown",
    }))
    .filter((item) => !hasQaDataMarker(`${item.productName} ${item.productType} ${item.warehouseName}`))
    .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0)
    .sort((a, b) => a.productName.localeCompare(b.productName));
}
