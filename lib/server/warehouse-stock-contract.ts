import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveStockUnitContract,
  type StockBusinessEvent,
  type StockUnitContract,
} from "@/lib/warehouse/stock-unit-contract";

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
): Promise<StockUnitContract> {
  const { data: product, error } = await supabase
    .from("products")
    .select(
      "id,company_id,base_uom,unit,product_type,type,category,subcategory,pesticide_category,pesticide_subcategories,is_seed_material,density_kg_per_l,density_unit,density_source,density_verification_status,density_verified_at,archived"
    )
    .eq("id", params.productId)
    .maybeSingle();

  if (error || !product?.id) {
    throw new Error(error?.message || "Складской товар не найден.");
  }
  if (product.archived === true) {
    throw new Error("Архивный товар нельзя использовать в новом складском движении.");
  }
  if (product.company_id && String(product.company_id) !== params.companyId) {
    throw new Error("Товар не принадлежит выбранной компании.");
  }

  return resolveStockUnitContract({
    product,
    quantity: params.quantity,
    inputUom: params.inputUom,
    requestedBatchClass: params.requestedBatchClass,
    event: params.event,
    fieldMaterialCategory: params.fieldMaterialCategory,
    unitSourceOverride: params.unitSourceOverride,
  });
}
