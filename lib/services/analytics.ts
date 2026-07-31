import { supabase } from "@/lib/supabase/client";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import { summarizeLandUseAreas } from "@/lib/crop-structure/analytics";

export interface SeasonSummary {
  totalFields: number;
  totalPlantedArea: number;
  totalFallowArea: number;
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

async function requireAnalyticsCompanyId(): Promise<string> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user?.id) throw new Error("Сессия пользователя недоступна");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile?.company_id) throw new Error("Компания пользователя не определена");
  return String(profile.company_id);
}

async function loadSeasonScope(seasonId: string, companyId: string) {
  const { data, error } = await supabase
    .from("crop_structure")
    .select("id,field_id,land_use_type,area,expected_yield")
    .eq("company_id", companyId)
    .eq("season_id", seasonId)
    .eq("archived", false);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getSeasonSummary(seasonId: string): Promise<SeasonSummary> {
  const companyId = await requireAnalyticsCompanyId();
  const cropStructures = await loadSeasonScope(seasonId, companyId);
  const cropStructureIds = cropStructures.map((row: any) => String(row.id));
  const fieldIds = Array.from(
    new Set(cropStructures.map((row: any) => String(row.field_id || "")).filter(Boolean))
  );

  const { data: operations, error: operationError } = await supabase
    .from("operations")
    .select("id,crop_structure_id,field_id")
    .eq("company_id", companyId)
    .eq("archived", false);
  if (operationError) throw new Error(operationError.message);

  const structureSet = new Set(cropStructureIds);
  const fieldSet = new Set(fieldIds);
  const seasonOperations = (operations || []).filter(
    (operation: any) =>
      (operation.crop_structure_id && structureSet.has(String(operation.crop_structure_id))) ||
      (operation.field_id && fieldSet.has(String(operation.field_id)))
  );
  const landUseAreas = summarizeLandUseAreas(cropStructures);

  return {
    totalFields: fieldIds.length,
    totalPlantedArea: landUseAreas.cropArea,
    totalFallowArea: landUseAreas.fallowArea,
    totalExpectedYield: cropStructures.reduce(
      (sum: number, row: any) => sum + (row.land_use_type === "fallow" ? 0 : Number(row.expected_yield || 0)),
      0
    ),
    totalOperations: seasonOperations.length,
  };
}

export async function getCropStructureReport(
  seasonId: string
): Promise<CropStructureReport[]> {
  const companyId = await requireAnalyticsCompanyId();
  const { data, error } = await supabase
    .from("crop_structure")
    .select(`
      field_id,
      land_use_type,
      crop_id,
      variety_id,
      reproduction_id,
      area,
      expected_yield,
      crops:crop_id (name,name_ru,name_kz,name_en,slug),
      varieties:variety_id (name),
      seed_reproductions:reproduction_id (name,name_ru,name_kz,name_en,code)
    `)
    .eq("company_id", companyId)
    .eq("season_id", seasonId)
    .eq("archived", false);
  if (error) throw new Error(error.message);

  const reportMap = new Map<string, CropStructureReport & { fields: Set<string> }>();
  for (const record of data || []) {
    const row = record as any;
    if (row.land_use_type === "fallow") continue;
    const cropName = localizedName(row.crops, "ru") || "Требуется уточнение";
    const varietyName = brandName(row.varieties) || null;
    const reproductionName = localizedName(row.seed_reproductions, "ru") || null;
    const key = `${row.crop_id || ""}:${row.variety_id || ""}:${row.reproduction_id || ""}`;
    const existing = reportMap.get(key);
    if (existing) {
      existing.fields.add(String(row.field_id || ""));
      existing.fieldsCount = existing.fields.size;
      existing.totalArea += Number(row.area || 0);
      existing.expectedYield += Number(row.expected_yield || 0);
    } else {
      const fields = new Set([String(row.field_id || "")]);
      reportMap.set(key, {
        cropName,
        varietyName,
        reproductionName,
        fields,
        fieldsCount: fields.size,
        totalArea: Number(row.area || 0),
        expectedYield: Number(row.expected_yield || 0),
      });
    }
  }

  return Array.from(reportMap.values())
    .map(({ fields: _fields, ...row }) => row)
    .sort((left, right) => right.totalArea - left.totalArea);
}

export async function getOperationsSummary(seasonId: string): Promise<OperationsSummary[]> {
  const companyId = await requireAnalyticsCompanyId();
  const cropStructures = await loadSeasonScope(seasonId, companyId);
  const structureSet = new Set(cropStructures.map((row: any) => String(row.id)));
  const fieldSet = new Set(cropStructures.map((row: any) => String(row.field_id || "")));

  const { data, error } = await supabase
    .from("operations")
    .select("operation_type,date,crop_structure_id,field_id")
    .eq("company_id", companyId)
    .eq("archived", false)
    .order("date", { ascending: false });
  if (error) throw new Error(error.message);

  const summaryMap = new Map<string, { count: number; lastDate: string | null }>();
  for (const record of data || []) {
    const row = record as any;
    if (
      !structureSet.has(String(row.crop_structure_id || "")) &&
      !fieldSet.has(String(row.field_id || ""))
    ) {
      continue;
    }
    const operationType = String(row.operation_type || "Без типа");
    const current = summaryMap.get(operationType) || { count: 0, lastDate: null };
    current.count += 1;
    if (row.date && (!current.lastDate || String(row.date) > current.lastDate)) {
      current.lastDate = String(row.date);
    }
    summaryMap.set(operationType, current);
  }

  return Array.from(summaryMap.entries())
    .map(([operationType, value]) => ({
      operationType,
      totalRecords: value.count,
      lastDate: value.lastDate,
    }))
    .sort((left, right) => right.totalRecords - left.totalRecords);
}

export async function getInventorySummary(): Promise<InventorySummary[]> {
  const companyId = await requireAnalyticsCompanyId();
  const { data: balances, error } = await supabase
    .from("v_stock_balance_canonical")
    .select("product_id,warehouse_id,quantity")
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);

  const productIds = Array.from(
    new Set((balances || []).map((row: any) => String(row.product_id || "")).filter(Boolean))
  );
  const { data: products, error: productError } = productIds.length
    ? await supabase
        .from("products")
        .select("id,name,trade_name,normalized_name,type,product_type")
        .in("id", productIds)
    : { data: [] as any[], error: null };
  if (productError) throw new Error(productError.message);
  const productById = new Map((products || []).map((row: any) => [String(row.id), row]));

  const inventoryMap = new Map<
    string,
    { productName: string; productType: string; totalQuantity: number; warehouses: Set<string> }
  >();
  for (const record of balances || []) {
    const row = record as any;
    const productId = String(row.product_id || "");
    const product = productById.get(productId);
    const current = inventoryMap.get(productId) || {
      productName: brandName(product) || "Без названия",
      productType: product?.product_type || product?.type || "material",
      totalQuantity: 0,
      warehouses: new Set<string>(),
    };
    current.totalQuantity += Number(row.quantity || 0);
    current.warehouses.add(String(row.warehouse_id || ""));
    inventoryMap.set(productId, current);
  }

  return Array.from(inventoryMap.values())
    .map((item) => ({
      productName: item.productName,
      productType: item.productType,
      totalQuantity: item.totalQuantity,
      warehousesCount: item.warehouses.size,
    }))
    .filter((item) => item.totalQuantity !== 0)
    .sort((left, right) => right.totalQuantity - left.totalQuantity);
}
