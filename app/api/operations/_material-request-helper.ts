import type { SupabaseClient } from "@supabase/supabase-js";

type ParsedMaterialLine = {
  productName: string | null;
  productId: string | null;
  ratePerHa: number | null;
};

function extractDraftValueFromNotes(notes: string | null | undefined, label: string): string | null {
  const text = String(notes || "");
  if (!text) return null;
  const pattern = new RegExp(`(?:^|\\n)-\\s*${label}:\\s*(.+)`, "i");
  const matched = text.match(pattern);
  const value = matched?.[1]?.trim();
  return value ? value : null;
}

function parseRate(raw: string | null | undefined): number | null {
  const value = String(raw || "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  const rate = Number(value?.[0] || NaN);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function splitAdditionalProducts(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value !== "-" && value.toLowerCase() !== "none");
}

function parseAdditionalMaterialLine(rawItem: string): ParsedMaterialLine | null {
  const item = String(rawItem || "").trim();
  if (!item) return null;
  const rate = parseRate(item);
  const name = item
    .replace(/-?\d+([.,]\d+)?/g, " ")
    .replace(/\b(л\/га|кг\/га|г\/га|l\/ha|kg\/ha|l|kg|г|кг|л)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return null;
  return { productName: name, productId: null, ratePerHa: rate };
}

function parseProductIds(raw: string | null | undefined): string[] {
  const source = String(raw || "").trim();
  if (!source) return [];
  return source
    .split(/[,;\s]+/)
    .map((token) => token.trim())
    .filter((token) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token));
}

async function resolveProductById(
  supabase: SupabaseClient,
  companyId: string,
  productId: string
): Promise<{ id: string; name: string; type: string | null; unit: string | null } | null> {
  const normalizedId = String(productId || "").trim();
  if (!normalizedId) return null;

  const { data } = await supabase
    .from("products")
    .select("id,name,type,unit")
    .eq("company_id", companyId)
    .eq("archived", false)
    .eq("id", normalizedId)
    .maybeSingle();

  return data ? (data as any) : null;
}

async function resolveProductByName(
  supabase: SupabaseClient,
  companyId: string,
  productName: string
): Promise<{ id: string; name: string; type: string | null; unit: string | null } | null> {
  const normalizedName = String(productName || "").trim();
  if (!normalizedName) return null;

  const { data: exactRows } = await supabase
    .from("products")
    .select("id,name,type,unit")
    .eq("company_id", companyId)
    .eq("archived", false)
    .ilike("name", normalizedName)
    .limit(1);
  if (exactRows && exactRows.length > 0) return exactRows[0] as any;

  const { data: tradeExactRows } = await supabase
    .from("products")
    .select("id,name,type,unit,trade_name")
    .eq("company_id", companyId)
    .eq("archived", false)
    .ilike("trade_name", normalizedName)
    .limit(1);
  if (tradeExactRows && tradeExactRows.length > 0) return tradeExactRows[0] as any;

  const { data: fuzzyRows } = await supabase
    .from("products")
    .select("id,name,type,unit,trade_name")
    .eq("company_id", companyId)
    .eq("archived", false)
    .or(`name.ilike.%${normalizedName}%,trade_name.ilike.%${normalizedName}%`)
    .limit(1);
  if (fuzzyRows && fuzzyRows.length > 0) return fuzzyRows[0] as any;

  return null;
}

export async function ensureMaterialRequestForOperation(params: {
  supabase: SupabaseClient;
  companyId: string;
  operationId: string;
  fieldId: string;
  operationDate: string;
  notes: string | null;
  responsibleUserId: string | null;
  plannedAreaHa: number | null;
  cropId: string | null;
  varietyId: string | null;
  reproductionId: string | null;
}) {
  const {
    supabase,
    companyId,
    operationId,
    fieldId,
    operationDate,
    notes,
    responsibleUserId,
    plannedAreaHa,
    cropId,
    varietyId,
    reproductionId,
  } = params;

  if (!responsibleUserId) {
    return { created: false, skipped_reason: "missing_responsible_user" as const };
  }

  const materialHints: ParsedMaterialLine[] = [];
  const { data: structuredMaterials } = await supabase
    .from("operation_materials")
    .select("product_id,planned_rate")
    .eq("company_id", companyId)
    .eq("operation_id", operationId)
    .order("created_at", { ascending: true });

  if (Array.isArray(structuredMaterials) && structuredMaterials.length > 0) {
    structuredMaterials.forEach((item: any) => {
      const productId = String(item?.product_id || "").trim();
      if (!productId) return;
      materialHints.push({
        productName: null,
        productId,
        ratePerHa: parseRate(String(item?.planned_rate || "")),
      });
    });
  }

  if (materialHints.length === 0) {
    const mainProductName = extractDraftValueFromNotes(notes, "Product");
    const mainProductId = parseProductIds(extractDraftValueFromNotes(notes, "Product id"))[0] || null;
    const mainRatePerHa = parseRate(extractDraftValueFromNotes(notes, "Rate per ha"));
    const additional = splitAdditionalProducts(extractDraftValueFromNotes(notes, "Additional products"));
    const additionalProductIds = parseProductIds(
      extractDraftValueFromNotes(notes, "Additional product ids") ||
        extractDraftValueFromNotes(notes, "Additional product id")
    );

    if ((mainProductName && mainProductName !== "-") || mainProductId) {
      materialHints.push({
        productName: mainProductName && mainProductName !== "-" ? mainProductName : null,
        productId: mainProductId,
        ratePerHa: mainRatePerHa,
      });
    }
    additional.forEach((entry) => {
      const parsed = parseAdditionalMaterialLine(entry);
      if (parsed) materialHints.push(parsed);
    });
    additionalProductIds.forEach((productId) => {
      materialHints.push({
        productName: null,
        productId,
        ratePerHa: null,
      });
    });
  }

  if (materialHints.length === 0) {
    return { created: false, skipped_reason: "no_material_hints" as const };
  }

  let effectiveArea = plannedAreaHa && plannedAreaHa > 0 ? plannedAreaHa : null;
  if (!effectiveArea) {
    const { data: fieldRow } = await supabase
      .from("fields")
      .select("area")
      .eq("id", fieldId)
      .eq("company_id", companyId)
      .maybeSingle();
    const fieldArea = Number(fieldRow?.area || 0);
    effectiveArea = Number.isFinite(fieldArea) && fieldArea > 0 ? fieldArea : null;
  }

  if (!effectiveArea) {
    return { created: false, skipped_reason: "missing_effective_area" as const };
  }

  const { data: existingRequests, error: existingRequestError } = await supabase
    .from("warehouse_issue_requests")
    .select("id,request_number,status")
    .eq("company_id", companyId)
    .eq("operation_id", operationId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingRequestError) {
    return {
      created: false,
      skipped_reason: "request_lookup_failed" as const,
      error: existingRequestError.message || "Failed to check existing request",
    };
  }

  const existingRequest = Array.isArray(existingRequests) ? existingRequests[0] : null;

  if (existingRequest?.id) {
    return {
      created: false,
      skipped_reason: "already_exists" as const,
      request_id: String(existingRequest.id),
      request_number: String(existingRequest.request_number || ""),
      request_status: String(existingRequest.status || ""),
    };
  }

  const resolvedMaterials: Array<{
    product_id: string;
    product_name: string;
    product_category: string | null;
    unit: string;
    planned_rate_per_ha: number | null;
    planned_quantity: number;
  }> = [];
  let defaultedRateItems = 0;

  for (const materialHint of materialHints) {
    const product =
      (materialHint.productId
        ? await resolveProductById(supabase, companyId, materialHint.productId)
        : null) ||
      (materialHint.productName
        ? await resolveProductByName(supabase, companyId, materialHint.productName)
        : null);
    if (!product?.id) continue;

    const rate = materialHint.ratePerHa && materialHint.ratePerHa > 0 ? materialHint.ratePerHa : null;
    if (rate == null) defaultedRateItems += 1;
    const plannedQuantity = Number((effectiveArea * (rate ?? 1)).toFixed(4));
    if (!(plannedQuantity > 0)) continue;
    resolvedMaterials.push({
      product_id: String(product.id),
      product_name: String(product.name || materialHint.productName || materialHint.productId || "material"),
      product_category: product.type || null,
      unit: String(product.unit || "kg"),
      planned_rate_per_ha: rate,
      planned_quantity: plannedQuantity,
    });
  }

  if (resolvedMaterials.length === 0) {
    return { created: false, skipped_reason: "products_not_resolved" as const };
  }

  const { data: requestRow, error: requestError } = await supabase
    .from("warehouse_issue_requests")
    .insert({
      company_id: companyId,
      operation_id: operationId,
      field_id: fieldId,
      operation_line_id: null,
      crop_id: cropId,
      variety_id: varietyId,
      reproduction_id: reproductionId,
      recipient_user_id: responsibleUserId,
      assigned_specialist_id: responsibleUserId,
      planned_datetime: `${operationDate}T08:00:00.000Z`,
      comment: "Auto-created from operation",
      status: "active",
    })
    .select("id,request_number,status")
    .single();

  if (requestError || !requestRow?.id) {
    return {
      created: false,
      skipped_reason: "request_insert_failed" as const,
      error: requestError?.message || "Failed to create request",
    };
  }

  const itemsPayload = resolvedMaterials.map((item) => ({
    request_id: requestRow.id,
    company_id: companyId,
    product_id: item.product_id,
    product_category: item.product_category,
    required_quantity: item.planned_quantity,
    planned_quantity: item.planned_quantity,
    issued_quantity: 0,
    unit: item.unit,
    planned_rate_per_ha: item.planned_rate_per_ha,
  }));

  const { error: itemsError } = await supabase.from("warehouse_issue_request_items").insert(itemsPayload);
  if (itemsError) {
    await supabase.from("warehouse_issue_requests").delete().eq("id", requestRow.id).eq("company_id", companyId);
    return {
      created: false,
      skipped_reason: "request_items_insert_failed" as const,
      error: itemsError.message || "Failed to create request items",
    };
  }

  return {
    created: true,
    request_id: String(requestRow.id),
    request_number: String(requestRow.request_number || ""),
    request_status: String(requestRow.status || "active"),
    item_count: itemsPayload.length,
    effective_area_ha: effectiveArea,
    defaulted_rate_items: defaultedRateItems,
  };
}
