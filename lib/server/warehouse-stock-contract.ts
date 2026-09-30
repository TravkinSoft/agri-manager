import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveStockUnitContract,
  type StockBusinessEvent,
  type StockUnitContract,
} from "@/lib/warehouse/stock-unit-contract";

const PRODUCT_STOCK_SELECT =
  "id,company_id,base_uom,unit,product_type,type,category,subcategory,pesticide_category,pesticide_subcategories,is_seed_material,density_kg_per_l,density_unit,density_source,density_verification_status,density_verified_at,archived";
const LEGACY_PRODUCT_STOCK_SELECT =
  "id,company_id,base_uom,unit,product_type,type,category,subcategory,pesticide_category,pesticide_subcategories,is_seed_material,archived";
const PRODUCT_DENSITY_COLUMNS = [
  "density_kg_per_l",
  "density_unit",
  "density_source",
  "density_verification_status",
  "density_verified_at",
] as const;

export type WarehouseStockContract = StockUnitContract & {
  persistenceSchema: "v2" | "legacy";
};

function isMissingProductDensityColumn(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown } | null;
  const message = [value?.message, value?.details, value?.hint]
    .map((item) => String(item || "").toLowerCase())
    .join(" ");
  const namesKnownDensityColumn = PRODUCT_DENSITY_COLUMNS.some((column) => message.includes(column));
  const isMissingColumnError =
    String(value?.code || "") === "42703" ||
    String(value?.code || "") === "PGRST204" ||
    message.includes("does not exist") ||
    message.includes("schema cache");

  return namesKnownDensityColumn && isMissingColumnError;
}

export async function resolveWarehouseStockContract(
  supabase: SupabaseClient | any,
  params: {
    companyId: string;
    productId: string;
    quantity: unknown;
    inputUom?: unknown;
    requestedBatchClass?: unknown;
    event: StockBusinessEvent;
    fieldMaterialCategory?: unknown;
    unitSourceOverride?: string | null;
  }
): Promise<WarehouseStockContract> {
  let persistenceSchema: WarehouseStockContract["persistenceSchema"] = "v2";
  let { data: product, error } = await supabase
    .from("products")
    .select(PRODUCT_STOCK_SELECT)
    .eq("id", params.productId)
    .maybeSingle();

  if (error && isMissingProductDensityColumn(error)) {
    persistenceSchema = "legacy";
    const legacyResult = await supabase
      .from("products")
      .select(LEGACY_PRODUCT_STOCK_SELECT)
      .eq("id", params.productId)
      .maybeSingle();
    product = legacyResult.data;
    error = legacyResult.error;
  }

  if (error || !product?.id) {
    throw new Error(error?.message || "Складской товар не найден.");
  }
  if (product.archived === true) {
    throw new Error("Архивный товар нельзя использовать в новом складском движении.");
  }
  if (product.company_id && String(product.company_id) !== params.companyId) {
    throw new Error("Товар не принадлежит выбранной компании.");
  }

  const contract = resolveStockUnitContract({
    product,
    quantity: params.quantity,
    inputUom: params.inputUom,
    requestedBatchClass: params.requestedBatchClass,
    event: params.event,
    fieldMaterialCategory: params.fieldMaterialCategory,
    unitSourceOverride: params.unitSourceOverride,
  });

  return Object.freeze({
    ...contract,
    persistenceSchema,
  });
}
