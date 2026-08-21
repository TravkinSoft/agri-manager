import { NextRequest, NextResponse } from "next/server";
import { WEIGHBRIDGE_WRITE_ROLES, asSessionErrorResponse, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";
import { brandName, localizedName } from "@/lib/i18n/helpers";

const batchClassLabel = (value: string | null | undefined) => {
  const key = String(value || "").toLowerCase();
  if (!key) return "Legacy: тип партии не установлен";
  if (key === "seed") return "Семенная партия";
  if (key === "material") return "Материал";
  if (key === "feed") return "Кормовое";
  if (key === "waste") return "Отход";
  if (key === "processing") return "Переработка";
  if (key === "rejected") return "Брак";
  return "Товарное";
};

const formatStockQuantity = (value: number, uom: string) => {
  if (uom === "kg" && Math.abs(value) >= 1000) {
    return `${(value / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т`;
  }
  const label = uom === "kg" ? "кг" : uom === "l" ? "л" : uom === "pcs" ? "шт" : "ед. неизвестна";
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} ${label}`;
};

const systemNameOf = (row: any, fallback = "") => localizedName(row, "ru", ["name", "full_name", "title", "code", "slug"]) || fallback;
const brandNameOf = (row: any, fallback = "") => brandName(row, ["trade_name", "original_name", "name", "full_name", "title", "normalized_name"]) || fallback;

const firstSnapshot = (rows: any[], idKey: string, nameKey: string) => {
  const map = new Map<string, string>();
  for (const row of rows || []) {
    const id = String(row?.[idKey] || "");
    const name = String(row?.[nameKey] || "").trim();
    if (id && name && !map.has(id)) map.set(id, name);
  }
  return map;
};

export async function GET(request: NextRequest) {
  try {
    const warehouseId = String(request.nextUrl.searchParams.get("warehouseId") || "").trim();
    if (!warehouseId) return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });

    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
    });
    const [{ data: rawRows, error: stockError }, { data: lotStockRows, error: lotStockError }] = await Promise.all([
      supabase
        .from("v_stock_balance_identity")
        .select("company_id,warehouse_id,product_id,variety_id,reproduction_id,batch_id,batch_class,quantity,uom")
        .eq("company_id", companyId)
        .eq("warehouse_id", warehouseId)
        .gt("quantity", 0)
        .order("product_id", { ascending: true }),
      supabase
        .from("v_harvest_lot_stock_v1")
        .select("company_id,harvest_lot_id,warehouse_id,trip_count,current_weight_kg,batch_class,physical_state")
        .eq("company_id", companyId)
        .eq("warehouse_id", warehouseId)
        .gt("current_weight_kg", 0),
    ]);
    if (stockError) return NextResponse.json({ error: stockError.message }, { status: 400 });
    if (lotStockError) return NextResponse.json({ error: lotStockError.message }, { status: 400 });

    const lotIds = Array.from(new Set((lotStockRows || []).map((row: any) => String(row.harvest_lot_id || "")).filter(Boolean)));
    const [{ data: lots, error: lotsError }, { data: lotLinks, error: linksError }] = await Promise.all([
      lotIds.length
        ? supabase
            .from("harvest_lots")
            .select("id,company_id,season_id,crop_id,variety_id,reproduction_id,composition_hash,identity_kind,review_state,status")
            .eq("company_id", companyId)
            .eq("status", "active")
            .in("id", lotIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      lotIds.length
        ? supabase
            .from("harvest_lot_batches")
            .select("harvest_lot_id,inventory_batch_id")
            .eq("company_id", companyId)
            .in("harvest_lot_id", lotIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    if (lotsError) return NextResponse.json({ error: lotsError.message }, { status: 400 });
    if (linksError) return NextResponse.json({ error: linksError.message }, { status: 400 });

    const activeLotIds = new Set((lots || []).map((lot: any) => String(lot.id)));
    const activeLinks = (lotLinks || []).filter((link: any) => activeLotIds.has(String(link.harvest_lot_id)));
    const linkedBatchIds = Array.from(new Set(activeLinks.map((link: any) => String(link.inventory_batch_id || "")).filter(Boolean)));
    const { data: linkedBatches, error: batchesError } = linkedBatchIds.length
      ? await supabase
          .from("inventory_batches")
          .select("id,product_id,crop_id,variety_id,reproduction_id,batch_class,physical_state,warehouse_id,received_at,created_at,composition_snapshot,composition_hash,is_mixed_harvest")
          .eq("company_id", companyId)
          .in("id", linkedBatchIds)
      : { data: [] as any[], error: null };
    if (batchesError) return NextResponse.json({ error: batchesError.message }, { status: 400 });

    const lotById = new Map((lots || []).map((lot: any) => [String(lot.id), lot]));
    const lotIdByBatchId = new Map(activeLinks.map((link: any) => [String(link.inventory_batch_id), String(link.harvest_lot_id)]));
    const batchById = new Map((linkedBatches || []).map((batch: any) => [String(batch.id), batch]));
    const exactRows = (rawRows || []).filter((row: any) => !lotIdByBatchId.has(String(row.batch_id || "")));

    // One lot/class/state bucket is one user row; product IDs remain internal to FIFO allocations.
    const aggregateGroups = new Map<string, any>();
    for (const stock of lotStockRows || []) {
      const lotId = String((stock as any).harvest_lot_id || "");
      if (!activeLotIds.has(lotId)) continue;
      const batchClass = String((stock as any).batch_class || "commodity");
      const physicalState = String((stock as any).physical_state || "SOURCE");
      const linkedForBucket = activeLinks
        .filter((link: any) => String(link.harvest_lot_id) === lotId)
        .map((link: any) => batchById.get(String(link.inventory_batch_id)))
        .filter((batch: any) => batch
          && String(batch.warehouse_id || "") === warehouseId
          && String(batch.batch_class || "commodity") === batchClass
          && String(batch.physical_state || "SOURCE") === physicalState)
        .sort((a: any, b: any) => String(a.received_at || a.created_at || "").localeCompare(String(b.received_at || b.created_at || "")) || String(a.id).localeCompare(String(b.id)));
      const batch = linkedForBucket[0];
      const lot = lotById.get(lotId);
      if (!lot || !batch) continue;
      const productId = String(batch.product_id || lot.crop_id || "");
      aggregateGroups.set([lotId, batchClass, physicalState].join("|"), {
        harvest_lot_id: lotId,
        warehouse_id: warehouseId,
        product_id: productId,
        crop_id: lot.crop_id || batch.crop_id || null,
        variety_id: lot.variety_id || null,
        reproduction_id: lot.reproduction_id || null,
        composition_snapshot: batch.composition_snapshot || [],
        composition_hash: lot.composition_hash || batch.composition_hash || null,
        is_mixed_harvest: Boolean(batch.is_mixed_harvest),
        batch_class: batchClass,
        physical_state: physicalState,
        quantity: Number((stock as any).current_weight_kg || 0),
        trip_count: Number((stock as any).trip_count || 0),
      });
    }

    const aggregateRows = Array.from(aggregateGroups.values()).filter((row: any) => row.quantity > 0.0001);
    const productIds = Array.from(new Set([...exactRows, ...aggregateRows].map((row: any) => String(row.product_id || "")).filter(Boolean)));
    const cropIds = Array.from(new Set(aggregateRows.map((row: any) => String(row.crop_id || "")).filter(Boolean)));
    const varietyIds = Array.from(new Set([...exactRows, ...aggregateRows].map((row: any) => String(row.variety_id || "")).filter(Boolean)));
    const reproductionIds = Array.from(new Set([...exactRows, ...aggregateRows].map((row: any) => String(row.reproduction_id || "")).filter(Boolean)));
    const cropLookupIds = Array.from(new Set([...productIds, ...cropIds]));

    const [{ data: products }, { data: crops }, { data: varieties }, { data: reproductions }, { data: lineSnapshots }] = await Promise.all([
      productIds.length
        ? supabase.from("products").select("id,name,trade_name,normalized_name,full_name,type,product_type,stock_unit,base_uom,unit,physical_state,is_seed_material").in("id", productIds)
        : Promise.resolve({ data: [] as any[] }),
      cropLookupIds.length
        ? supabase.from("crops").select("id,name,name_ru,name_kz,name_en,slug,full_name").in("id", cropLookupIds)
        : Promise.resolve({ data: [] as any[] }),
      varietyIds.length ? supabase.from("varieties").select("id,name,full_name").in("id", varietyIds) : Promise.resolve({ data: [] as any[] }),
      reproductionIds.length
        ? supabase.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en,code,full_name").in("id", reproductionIds)
        : Promise.resolve({ data: [] as any[] }),
      productIds.length || varietyIds.length || reproductionIds.length
        ? supabase
            .from("ticket_lines")
            .select("product_id,product_name_snapshot,variety_id,variety_name_snapshot,reproduction_id,reproduction_name_snapshot")
            .eq("company_id", companyId)
            .not("ticket_id", "is", null)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const productMap = new Map((products || []).map((row: any) => [String(row.id), brandNameOf(row, "")]));
    const productTypeMap = new Map((products || []).map((row: any) => [String(row.id), String(row.product_type || row.type || "").toLowerCase()]));
    const productMetaMap = new Map((products || []).map((row: any) => [String(row.id), {
      stock_unit: String(row.stock_unit || row.base_uom || row.unit || "").toLowerCase(),
      physical_state: String(row.physical_state || "").toLowerCase(),
      is_seed_material: row.is_seed_material === true,
    }]));
    const cropMap = new Map((crops || []).map((row: any) => [String(row.id), systemNameOf(row, "")]));
    for (const crop of crops || []) {
      const id = String((crop as any).id || "");
      if (id && !productMap.get(id)) productMap.set(id, systemNameOf(crop, ""));
    }
    const varietyMap = new Map((varieties || []).map((row: any) => [String(row.id), brandNameOf(row, "")]));
    const reproductionMap = new Map((reproductions || []).map((row: any) => [String(row.id), systemNameOf(row, "")]));
    const productSnapshotMap = firstSnapshot(lineSnapshots || [], "product_id", "product_name_snapshot");
    const varietySnapshotMap = firstSnapshot(lineSnapshots || [], "variety_id", "variety_name_snapshot");
    const reproductionSnapshotMap = firstSnapshot(lineSnapshots || [], "reproduction_id", "reproduction_name_snapshot");

    const mapRow = (row: any, sourceKind: "aggregate_harvest_lot" | "exact_stock_identity") => {
      const quantity = Number(row.quantity || 0);
      const productId = String(row.product_id || "");
      const varietyId = row.variety_id ? String(row.variety_id) : null;
      const reproductionId = row.reproduction_id ? String(row.reproduction_id) : null;
      const batchId = sourceKind === "exact_stock_identity" && row.batch_id ? String(row.batch_id) : null;
      const harvestLotId = sourceKind === "aggregate_harvest_lot" ? String(row.harvest_lot_id || "") : null;
      const batchClass = String(row.batch_class || "");
      const uom = sourceKind === "aggregate_harvest_lot" ? "kg" : String(row.uom || "legacy/unknown");
      const productName = cropMap.get(String(row.crop_id || "")) || productMap.get(productId) || productSnapshotMap.get(productId) || "Номенклатура";
      const varietyName = varietyId ? (varietyMap.get(varietyId) || varietySnapshotMap.get(varietyId) || "") : "";
      const reproductionName = reproductionId ? (reproductionMap.get(reproductionId) || reproductionSnapshotMap.get(reproductionId) || "") : "";
      const classLabel = batchClassLabel(batchClass);
      const productMeta = productMetaMap.get(productId);
      const key = sourceKind === "aggregate_harvest_lot"
        ? ["harvest-lot", harvestLotId, batchClass, row.physical_state || "SOURCE"].join(":")
        : [productId, varietyId || "", reproductionId || "", batchId || "", batchClass, uom].join("|");
      const identityParts = [productName, varietyName, reproductionName].filter(Boolean);
      return {
        key,
        source_kind: sourceKind,
        harvest_lot_id: harvestLotId,
        crop_id: sourceKind === "aggregate_harvest_lot" ? row.crop_id || null : null,
        composition_snapshot: sourceKind === "aggregate_harvest_lot" ? row.composition_snapshot || [] : [],
        composition_hash: sourceKind === "aggregate_harvest_lot" ? row.composition_hash || null : null,
        is_mixed_harvest: sourceKind === "aggregate_harvest_lot" ? Boolean(row.is_mixed_harvest) : false,
        source_physical_state: sourceKind === "aggregate_harvest_lot" ? String(row.physical_state || "SOURCE") : null,
        trip_count: sourceKind === "aggregate_harvest_lot" ? Number(row.trip_count || 0) : null,
        warehouse_id: String(row.warehouse_id || warehouseId),
        product_id: productId,
        product_name: productName,
        product_type: productTypeMap.get(productId) || "",
        stock_unit: productMeta?.stock_unit || uom,
        physical_state: sourceKind === "aggregate_harvest_lot" ? String(row.physical_state || "SOURCE") : productMeta?.physical_state || "",
        is_seed_material: sourceKind === "exact_stock_identity" && productMeta?.is_seed_material === true,
        variety_id: varietyId,
        variety_name: varietyName,
        reproduction_id: reproductionId,
        reproduction_name: reproductionName,
        batch_id: batchId,
        batch_class: batchClass,
        batch_class_label: classLabel,
        uom,
        is_legacy_invalid: !batchClass || !["kg", "l", "pcs"].includes(uom),
        quantity,
        label: `${identityParts.join(" • ")} — ${formatStockQuantity(quantity, uom)}`,
      };
    };

    const items = [
      ...aggregateRows.map((row: any) => mapRow(row, "aggregate_harvest_lot")),
      ...exactRows.map((row: any) => mapRow(row, "exact_stock_identity")),
    ].sort((a: any, b: any) => String(a.label).localeCompare(String(b.label), "ru"));
    return NextResponse.json({ items, source: "aggregate_harvest_lots_plus_exact_non_harvest" });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
