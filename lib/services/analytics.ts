import { supabase } from "@/lib/supabase/client";

export interface SeasonSummary {
  totalFields: number;
  totalPlantedArea: number;
  totalExpectedYield: number;
  totalOperations: number;
}

export interface CropStructureReport {
  cropName: string;
  varietyName: string | null;
  reproductionName: string | null;
  fieldsCount: number;
  totalArea: number;
  expectedYield: number;
}

export interface OperationsSummary {
  operationType: string;
  totalRecords: number;
  lastDate: string | null;
}

export interface InventorySummary {
  productName: string;
  productType: string;
  totalQuantity: number;
  warehousesCount: number;
}

export async function getSeasonSummary(seasonId: string): Promise<SeasonSummary> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      totalFields: 0,
      totalPlantedArea: 0,
      totalExpectedYield: 0,
      totalOperations: 0,
    };
  }

  const { data: cropStructures } = await supabase
    .from("crop_structure")
    .select("id, field_id, area, expected_yield")
    .eq("season_id", seasonId)
    .eq("user_id", user.id)
    .eq("archived", false);

  const uniqueFields = new Set(cropStructures?.map((cs) => cs.field_id) || []);
  const totalPlantedArea = cropStructures?.reduce((sum, cs) => sum + Number(cs.area), 0) || 0;
  const totalExpectedYield =
    cropStructures?.reduce((sum, cs) => sum + Number(cs.expected_yield || 0), 0) || 0;

  const { data: operations } = await supabase
    .from("operations")
    .select("id, crop_structure_id")
    .eq("user_id", user.id)
    .eq("archived", false);

  const cropStructureIds = new Set(cropStructures?.map((cs) => cs.id) || []);
  const seasonOperations = operations?.filter(
    (op) => op.crop_structure_id && cropStructureIds.has(op.crop_structure_id)
  ) || [];

  return {
    totalFields: uniqueFields.size,
    totalPlantedArea,
    totalExpectedYield,
    totalOperations: seasonOperations.length,
  };
}

export async function getCropStructureReport(
  seasonId: string
): Promise<CropStructureReport[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("crop_structure")
    .select(`
      crop_id,
      variety_id,
      reproduction_id,
      area,
      expected_yield,
      crops:crop_id (name),
      varieties:variety_id (name),
      seed_reproductions:reproduction_id (name)
    `)
    .eq("season_id", seasonId)
    .eq("user_id", user.id)
    .eq("archived", false);

  if (error) {
    console.error("Error fetching crop structure report:", error);
    return [];
  }

  const reportMap = new Map<string, CropStructureReport>();

  data?.forEach((record: any) => {
    const cropName = record.crops?.name || "—";
    const varietyName = record.varieties?.name || null;
    const reproductionName = record.seed_reproductions?.name || null;
    const key = `${cropName}-${varietyName}-${reproductionName}`;

    if (reportMap.has(key)) {
      const existing = reportMap.get(key)!;
      existing.fieldsCount += 1;
      existing.totalArea += Number(record.area);
      existing.expectedYield += Number(record.expected_yield || 0);
    } else {
      reportMap.set(key, {
        cropName,
        varietyName,
        reproductionName,
        fieldsCount: 1,
        totalArea: Number(record.area),
        expectedYield: Number(record.expected_yield || 0),
      });
    }
  });

  return Array.from(reportMap.values()).sort((a, b) => b.totalArea - a.totalArea);
}

export async function getOperationsSummary(): Promise<OperationsSummary[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("operations")
    .select("operation_type, date")
    .eq("user_id", user.id)
    .eq("archived", false)
    .order("date", { ascending: false });

  if (error) {
    console.error("Error fetching operations summary:", error);
    return [];
  }

  const summaryMap = new Map<string, { count: number; lastDate: string | null }>();

  data?.forEach((record: any) => {
    const opType = record.operation_type || "Unknown";

    if (summaryMap.has(opType)) {
      const existing = summaryMap.get(opType)!;
      existing.count += 1;
      if (
        record.date &&
        (!existing.lastDate || new Date(record.date) > new Date(existing.lastDate))
      ) {
        existing.lastDate = record.date;
      }
    } else {
      summaryMap.set(opType, {
        count: 1,
        lastDate: record.date || null,
      });
    }
  });

  return Array.from(summaryMap.entries())
    .map(([operationType, { count, lastDate }]) => ({
      operationType,
      totalRecords: count,
      lastDate,
    }))
    .sort((a, b) => b.totalRecords - a.totalRecords);
}

export async function getInventorySummary(): Promise<InventorySummary[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: transactions, error } = await supabase
    .from("inventory_transactions")
    .select(`
      product_id,
      warehouse_id,
      quantity,
      transaction_type,
      products (
        name,
        type
      )
    `)
    .eq("user_id", user.id);

  if (error) {
    console.error("Error fetching inventory summary:", error);
    return [];
  }

  const inventoryMap = new Map<
    string,
    {
      productName: string;
      productType: string;
      totalQuantity: number;
      warehouses: Set<string>;
    }
  >();

  transactions?.forEach((record: any) => {
    const productId = record.product_id;
    const productName = record.products?.name || "Unknown";
    const productType = record.products?.type || "unknown";
    const warehouseId = record.warehouse_id;
    const quantity =
      record.transaction_type === "in" ? Number(record.quantity) : -Number(record.quantity);

    if (inventoryMap.has(productId)) {
      const existing = inventoryMap.get(productId)!;
      existing.totalQuantity += quantity;
      existing.warehouses.add(warehouseId);
    } else {
      inventoryMap.set(productId, {
        productName,
        productType,
        totalQuantity: quantity,
        warehouses: new Set([warehouseId]),
      });
    }
  });

  return Array.from(inventoryMap.values())
    .map((item) => ({
      productName: item.productName,
      productType: item.productType,
      totalQuantity: item.totalQuantity,
      warehousesCount: item.warehouses.size,
    }))
    .filter((item) => item.totalQuantity !== 0)
    .sort((a, b) => b.totalQuantity - a.totalQuantity);
}
