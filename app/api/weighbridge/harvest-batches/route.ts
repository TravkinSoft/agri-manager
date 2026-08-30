import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_READ_ROLES,
  asSessionErrorResponse,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import { calculateHarvestBatchMetrics } from "@/lib/weighbridge/harvest-batch-math";
import { calculateHarvestLotAccounting } from "@/lib/weighbridge/harvest-lot-accounting";
import {
  hasCompleteHarvestTicketLineage,
  lineageTicketIds,
  resolveHarvestLotTicketLineage,
  resolveHarvestTicketIdsByBatch,
} from "@/lib/weighbridge/harvest-lot-lineage";
import { canUseGrainProcessing } from "@/lib/weighbridge/crop-processing";
import { resolveTransportIdentity } from "@/lib/weighbridge/transport";

const ids = (values: unknown[]) => Array.from(new Set(values.map((value) => String(value || "")).filter(Boolean)));
const LINEAGE_QUERY_CHUNK_SIZE = 200;
const LINEAGE_QUERY_CONCURRENCY = 4;
const LINEAGE_QUERY_PAGE_SIZE = 1000;

async function loadInChunks<T>(
  values: string[],
  query: (chunk: string[]) => any
): Promise<T[]> {
  const normalized = ids(values);
  if (!normalized.length) return [];
  const chunks: string[][] = [];
  for (let index = 0; index < normalized.length; index += LINEAGE_QUERY_CHUNK_SIZE) {
    chunks.push(normalized.slice(index, index + LINEAGE_QUERY_CHUNK_SIZE));
  }
  const rows: T[] = [];
  for (let index = 0; index < chunks.length; index += LINEAGE_QUERY_CONCURRENCY) {
    const resultPages = await Promise.all(
      chunks.slice(index, index + LINEAGE_QUERY_CONCURRENCY).map(async (chunk) => {
        const chunkRows: T[] = [];
        for (let from = 0; ; from += LINEAGE_QUERY_PAGE_SIZE) {
          const result = await query(chunk).range(from, from + LINEAGE_QUERY_PAGE_SIZE - 1);
          if (result.error) throw result.error;
          const page = (result.data || []) as T[];
          chunkRows.push(...page);
          if (page.length < LINEAGE_QUERY_PAGE_SIZE) break;
        }
        return chunkRows;
      })
    );
    rows.push(...resultPages.flat());
  }
  return rows;
}

function movementLabel(reasonType: unknown): string {
  const reason = String(reasonType || "").trim().toLowerCase();
  if (reason.includes("impurit")) return "Примеси";
  if (reason.includes("processing_input")) return "Передано в переработку";
  if (reason.includes("transfer")) return "Перемещение со склада";
  if (reason.includes("shipment")) return "Отгрузка";
  if (reason.includes("issue")) return "Выдача";
  if (["writeoff", "disposal", "spoilage", "shortage", "waste", "other_removal"].some((token) => reason.includes(token))) {
    return "Списание";
  }
  return "Выбытие";
}

function processingLabel(value: unknown): string {
  const type = String(value || "").trim().toLowerCase();
  if (type === "drying") return "Сушка";
  if (type === "cleaning") return "Очистка";
  if (type === "sorting") return "Сортировка";
  if (type === "calibration") return "Калибровка";
  return "Обработка";
}

async function loadAggregateHarvestLotSummaries(
  supabase: any,
  companyId: string,
  warehouseId: string | null,
  lotId: string | null
) {
  let stockQuery = supabase
    .from("v_harvest_lot_stock_v1")
    .select("harvest_lot_id,warehouse_id,trip_count,current_weight_kg,batch_class,physical_state")
    .eq("company_id", companyId)
    .gt("current_weight_kg", 0.0001);
  if (warehouseId) stockQuery = stockQuery.eq("warehouse_id", warehouseId);
  if (lotId) stockQuery = stockQuery.eq("harvest_lot_id", lotId);
  const stockResult = await stockQuery;
  if (stockResult.error) throw stockResult.error;
  const stockRows = (stockResult.data || []) as any[];
  if (!stockRows.length) return [];

  const lotIds = ids(stockRows.map((row) => row.harvest_lot_id));
  const [lotsResult, linksResult] = await Promise.all([
    supabase
      .from("harvest_lots")
      .select("id,lot_code,season_id,source_field_id,crop_id,variety_id,reproduction_id,identity_kind,review_state,review_reasons,status,created_at")
      .eq("company_id", companyId)
      .eq("status", "active")
      .in("id", lotIds),
    supabase
      .from("harvest_lot_batches")
      .select("harvest_lot_id,inventory_batch_id")
      .eq("company_id", companyId)
      .in("harvest_lot_id", lotIds),
  ]);
  if (lotsResult.error || linksResult.error) throw lotsResult.error || linksResult.error;
  const lots = (lotsResult.data || []) as any[];
  const links = (linksResult.data || []) as any[];
  const batchIds = ids(links.map((row) => row.inventory_batch_id));
  const cropIds = ids(lots.map((row) => row.crop_id));
  const varietyIds = ids(lots.map((row) => row.variety_id));
  const reproductionIds = ids(lots.map((row) => row.reproduction_id));
  const warehouseIds = ids(stockRows.map((row) => row.warehouse_id));
  const [batchesResult, cropsResult, varietiesResult, reproductionsResult, warehousesResult] = await Promise.all([
    batchIds.length
      ? supabase.from("inventory_batches").select("id,product_id,display_name").eq("company_id", companyId).in("id", batchIds)
      : Promise.resolve({ data: [], error: null }),
    cropIds.length
      ? supabase.from("crops").select("id,name,name_ru,name_kz,name_en,slug,category_id,category,crop_category,subcategory,crop_subcategory").in("id", cropIds)
      : Promise.resolve({ data: [], error: null }),
    varietyIds.length
      ? supabase.from("varieties").select("id,name").in("id", varietyIds)
      : Promise.resolve({ data: [], error: null }),
    reproductionIds.length
      ? supabase.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en,code").in("id", reproductionIds)
      : Promise.resolve({ data: [], error: null }),
    warehouseIds.length
      ? supabase.from("warehouses").select("id,name,name_ru,name_kz,name_en").eq("company_id", companyId).in("id", warehouseIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const firstError = [batchesResult, cropsResult, varietiesResult, reproductionsResult, warehousesResult]
    .map((result: any) => result.error).find(Boolean);
  if (firstError) throw firstError;
  const categoryIds = ids((cropsResult.data || []).map((crop: any) => crop.category_id));
  const categoriesResult = categoryIds.length
    ? await supabase.from("crop_categories").select("id,slug,name_ru").in("id", categoryIds)
    : { data: [], error: null };
  if (categoriesResult.error) throw categoriesResult.error;

  const byId = (rows: any[]) => new Map(rows.map((row) => [String(row.id), row]));
  const batchesById = byId(batchesResult.data || []);
  const cropsById = byId(cropsResult.data || []);
  const varietiesById = byId(varietiesResult.data || []);
  const reproductionsById = byId(reproductionsResult.data || []);
  const warehousesById = byId(warehousesResult.data || []);
  const categoriesById = byId(categoriesResult.data || []);

  return lots.flatMap((lot) => {
    const memberLinks = links.filter((link) => String(link.harvest_lot_id) === String(lot.id));
    const memberBatches = memberLinks.map((link) => batchesById.get(String(link.inventory_batch_id))).filter(Boolean);
    const crop = cropsById.get(String(lot.crop_id || ""));
    const category = categoriesById.get(String(crop?.category_id || ""));
    const variety = varietiesById.get(String(lot.variety_id || ""));
    const reproduction = reproductionsById.get(String(lot.reproduction_id || ""));
    const cropName = lot.identity_kind === "crop_mix"
      ? String(memberBatches[0]?.display_name || "Зерносмесь")
      : localizedName(crop, "ru") || "Культура не уточнена";
    const processingEligible = canUseGrainProcessing({
      cropSlug: crop?.slug,
      cropName,
      categorySlug: category?.slug || crop?.category,
      categoryName: category?.name_ru || crop?.crop_category,
      subcategory: crop?.subcategory || crop?.crop_subcategory,
    });
    const stockByWarehouse = new Map<string, { currentWeightKg: number; tripCount: number; components: any[] }>();
    for (const stock of stockRows.filter((row) => String(row.harvest_lot_id) === String(lot.id))) {
      const warehouseKey = String(stock.warehouse_id || "");
      const current = stockByWarehouse.get(warehouseKey) || { currentWeightKg: 0, tripCount: 0, components: [] };
      current.currentWeightKg += Number(stock.current_weight_kg || 0);
      current.tripCount += Number(stock.trip_count || 0);
      current.components.push({
        batchClass: String(stock.batch_class || "commodity"),
        physicalState: String(stock.physical_state || "SOURCE"),
        quantityKg: Number(stock.current_weight_kg || 0),
        tripCount: Number(stock.trip_count || 0),
      });
      stockByWarehouse.set(warehouseKey, current);
    }
    return Array.from(stockByWarehouse.entries())
      .map(([warehouseId, stock]) => {
        const warehouse = warehousesById.get(warehouseId);
        const productIds = ids(memberBatches.map((batch) => batch.product_id));
        return {
          id: String(lot.id),
          batchCode: String(lot.lot_code || "Партия"),
          warehouseId,
          warehouseName: localizedName(warehouse, "ru", ["name"]) || "Склад",
          productId: productIds[0] || "",
          productIds,
          productName: cropName,
          cropId: lot.crop_id ? String(lot.crop_id) : null,
          cropName,
          cropCategorySlug: String(category?.slug || crop?.category || ""),
          processingEligible,
          detailLevel: "summary" as const,
          varietyId: lot.variety_id ? String(lot.variety_id) : null,
          varietyName: brandName(variety) || "",
          reproductionId: lot.reproduction_id ? String(lot.reproduction_id) : null,
          reproductionName: localizedName(reproduction, "ru", ["name", "code"]) || "",
          fieldId: null,
          fieldName: "",
          operationLineId: null,
          cropStructureLabel: "",
          seasonLabel: "",
          operationName: "Приёмка урожая",
          firstReceivedAt: lot.created_at || null,
          lastReceivedAt: lot.created_at || null,
          receivedKg: 0,
          removedKg: 0,
          cleanMassKg: stock.currentWeightKg,
          impurityPercent: 0,
          harvestedAreaHa: null,
          grossYieldTPerHa: null,
          cleanYieldTPerHa: null,
          aggregateLot: true,
          aggregateLotId: String(lot.id),
          tripCount: stock.tripCount,
          stockComponents: stock.components.sort((left, right) => right.quantityKg - left.quantityKg),
          reviewState: lot.review_state,
          reviewReasons: Array.isArray(lot.review_reasons) ? lot.review_reasons : [],
          fieldSummaries: [],
          tripBatches: [],
          outgoingDocuments: [],
        };
      });
  });
}

async function loadAggregateHarvestLots(supabase: any, companyId: string, warehouseId: string | null, lotId: string | null) {
  let lotsQuery = supabase
    .from("harvest_lots")
    .select("id,lot_code,season_id,source_field_id,crop_id,variety_id,reproduction_id,composition_hash,identity_kind,review_state,review_reasons,status,created_at")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(500);
  if (lotId) lotsQuery = lotsQuery.eq("id", lotId);
  const { data: lots, error: lotsError } = await lotsQuery;
  if (lotsError) {
    const missing = String(lotsError.code || "") === "42P01" || /harvest_lots/i.test(String(lotsError.message || ""));
    if (missing) return null;
    throw lotsError;
  }
  if (!(lots || []).length) return [];

  const lotIds = ids((lots || []).map((row: any) => row.id));
  const [links, allStockRows] = await Promise.all([
    loadInChunks<any>(lotIds, (chunk) => supabase
      .from("harvest_lot_batches")
      .select("harvest_lot_id,inventory_batch_id,source_ticket_id,crop_structure_id,created_at")
      .eq("company_id", companyId)
      .in("harvest_lot_id", chunk)
      .order("inventory_batch_id", { ascending: true })),
    loadInChunks<any>(lotIds, (chunk) => {
      let query = supabase
        .from("v_harvest_lot_stock_v1")
        .select("harvest_lot_id,warehouse_id,trip_count,current_weight_kg,batch_class,physical_state")
        .eq("company_id", companyId)
        .in("harvest_lot_id", chunk)
        .order("harvest_lot_id", { ascending: true })
        .order("warehouse_id", { ascending: true })
        .order("batch_class", { ascending: true })
        .order("physical_state", { ascending: true });
      if (warehouseId) query = query.eq("warehouse_id", warehouseId);
      return query;
    }),
  ]);

  const batchIds = ids(links.map((row) => row.inventory_batch_id));
  const lotRows = (lots || []) as any[];
  const refIds = {
    crop: ids(lotRows.map((row) => row.crop_id)),
    variety: ids(lotRows.map((row) => row.variety_id)),
    reproduction: ids(lotRows.map((row) => row.reproduction_id)),
    season: ids(lotRows.map((row) => row.season_id)),
  };
  const [batchesResult, cropsResult, varietiesResult, reproductionsResult, fieldsResult, seasonsResult, warehousesResult] = await Promise.all([
    batchIds.length
      ? loadInChunks<any>(batchIds, (chunk) => supabase
          .from("inventory_batches")
          .select("id,batch_code,product_id,display_name,moisture_percent,created_at,source_ticket_id,parent_batch_id,warehouse_id,current_weight_kg")
          .eq("company_id", companyId)
          .in("id", chunk)
          .order("id", { ascending: true }))
          .then((data) => ({ data, error: null }))
      : Promise.resolve({ data: [], error: null }),
    refIds.crop.length ? supabase.from("crops").select("id,name,name_ru,name_kz,name_en,slug,category,subcategory,crop_category,crop_subcategory").in("id", refIds.crop) : Promise.resolve({ data: [], error: null }),
    refIds.variety.length ? supabase.from("varieties").select("id,name").in("id", refIds.variety) : Promise.resolve({ data: [], error: null }),
    refIds.reproduction.length ? supabase.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en,code").in("id", refIds.reproduction) : Promise.resolve({ data: [], error: null }),
    supabase.from("fields").select("id,name").eq("company_id", companyId),
    refIds.season.length ? supabase.from("seasons").select("id,name,year").eq("company_id", companyId).in("id", refIds.season) : Promise.resolve({ data: [], error: null }),
    supabase.from("warehouses").select("id,name,name_ru,name_kz,name_en").eq("company_id", companyId),
  ]);
  const firstError = [batchesResult, cropsResult, varietiesResult, reproductionsResult, fieldsResult, seasonsResult, warehousesResult]
    .map((result: any) => result.error).find(Boolean);
  if (firstError) throw firstError;

  const directBatchRows = (batchesResult.data || []) as any[];
  const ancestorBatchRows: any[] = [];
  const ancestorLinkRows: any[] = [];
  const seenBatchIds = new Set(ids(directBatchRows.map((batch) => batch.id)));
  let ancestorBatchIds = ids(directBatchRows.map((batch) => batch.parent_batch_id))
    .filter((batchId) => !seenBatchIds.has(batchId));
  while (ancestorBatchIds.length) {
    const [loadedBatches, loadedLinks] = await Promise.all([
      loadInChunks<any>(ancestorBatchIds, (chunk) => supabase
        .from("inventory_batches")
        .select("id,parent_batch_id,source_ticket_id")
        .eq("company_id", companyId)
        .in("id", chunk)
        .order("id", { ascending: true })),
      loadInChunks<any>(ancestorBatchIds, (chunk) => supabase
        .from("harvest_lot_batches")
        .select("harvest_lot_id,inventory_batch_id,source_ticket_id")
        .eq("company_id", companyId)
        .in("inventory_batch_id", chunk)
        .order("inventory_batch_id", { ascending: true })),
    ]);
    ancestorLinkRows.push(...loadedLinks);
    const freshBatches = loadedBatches.filter((batch) => {
      const batchId = String(batch.id || "");
      return batchId && !seenBatchIds.has(batchId);
    });
    ancestorBatchRows.push(...freshBatches);
    freshBatches.forEach((batch) => seenBatchIds.add(String(batch.id)));
    ancestorBatchIds = ids(freshBatches.map((batch) => batch.parent_batch_id))
      .filter((batchId) => !seenBatchIds.has(batchId));
  }
  const lineage = resolveHarvestLotTicketLineage(
    links,
    [...links, ...ancestorLinkRows],
    [...directBatchRows, ...ancestorBatchRows]
  );
  const ticketIds = lineageTicketIds(lineage);
  const ticketRows = await loadInChunks<any>(ticketIds, (chunk) => supabase
    .from("tickets")
    .select("id,ticket_no,op_type,field_id,vehicle_id,driver_id,warehouse_to_id,audit_json,net_weight_kg,status,is_finalized,is_voided,replacement_ticket_id,created_at,finalized_at")
    .eq("company_id", companyId)
    .in("id", chunk)
    .order("id", { ascending: true }));
  const vehicleIds = ids(ticketRows.map((row) => row.vehicle_id));
  const driverIds = ids(ticketRows.map((row) => row.driver_id));
  const [vehiclesResult, machinesResult, peopleResult, specialistsResult, profilesResult] = await Promise.all([
    vehicleIds.length ? supabase.from("reference_vehicles").select("id,name,custom_name,full_name,brand,model,series,plate_number,license_plate,source_raw_name").eq("company_id", companyId).in("id", vehicleIds) : Promise.resolve({ data: [], error: null }),
    vehicleIds.length ? supabase.from("reference_machines").select("id,name,full_name,brand,model,series,license_plate,source_raw_name").eq("company_id", companyId).in("id", vehicleIds) : Promise.resolve({ data: [], error: null }),
    driverIds.length ? supabase.from("company_people").select("id,full_name").eq("company_id", companyId).in("id", driverIds) : Promise.resolve({ data: [], error: null }),
    driverIds.length ? supabase.from("reference_specialists").select("id,full_name,name_ru,name_kz,name_en").eq("company_id", companyId).in("id", driverIds) : Promise.resolve({ data: [], error: null }),
    driverIds.length ? supabase.from("profiles").select("id,full_name,email").eq("company_id", companyId).in("id", driverIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const resourceError = [vehiclesResult, machinesResult, peopleResult, specialistsResult, profilesResult]
    .map((result: any) => result.error).find(Boolean);
  if (resourceError) throw resourceError;

  const byId = (rows: any[]) => new Map(rows.map((row) => [String(row.id), row]));
  const batchesById = byId(batchesResult.data || []);
  const ticketsById = byId(ticketRows);
  const {
    displayByBatchId: harvestTicketIdByBatchId,
    effectiveByBatchId: effectiveHarvestTicketIdByBatchId,
  } = resolveHarvestTicketIdsByBatch(lineage, ticketRows);
  const cropsById = byId(cropsResult.data || []);
  const varietiesById = byId(varietiesResult.data || []);
  const reproductionsById = byId(reproductionsResult.data || []);
  const fieldsById = byId(fieldsResult.data || []);
  const seasonsById = byId(seasonsResult.data || []);
  const warehousesById = byId(warehousesResult.data || []);
  const vehiclesById = byId([...(vehiclesResult.data || []), ...(machinesResult.data || [])]);
  const driversById = byId([...(peopleResult.data || []), ...(specialistsResult.data || []), ...(profilesResult.data || [])]);

  const ledgerSelect = "id,inventory_batch_id,batch_id_text,ticket_id,processing_id,reason_ref_id,warehouse_id,direction,delta_qty_signed,reason_type,occurred_at,created_by,is_storno,storno_of_entry_id,notes";
  const [ledgerByBatchResult, ledgerByTextResult, ledgerByTicketResult, allocationsByBatchResult, allocationsByTextResult] = await Promise.all([
    batchIds.length
      ? loadInChunks<any>(batchIds, (chunk) => supabase
          .from("stock_ledger_entries")
          .select(ledgerSelect)
          .eq("company_id", companyId)
          .in("inventory_batch_id", chunk)
          .order("id", { ascending: true }))
          .then((data) => ({ data, error: null }))
      : Promise.resolve({ data: [], error: null }),
    batchIds.length
      ? loadInChunks<any>(batchIds, (chunk) => supabase
          .from("stock_ledger_entries")
          .select(ledgerSelect)
          .eq("company_id", companyId)
          .in("batch_id_text", chunk)
          .order("id", { ascending: true }))
          .then((data) => ({ data, error: null }))
      : Promise.resolve({ data: [], error: null }),
    ticketIds.length
      ? loadInChunks<any>(ticketIds, (chunk) => supabase
          .from("stock_ledger_entries")
          .select(ledgerSelect)
          .eq("company_id", companyId)
          .in("ticket_id", chunk)
          .order("id", { ascending: true }))
          .then((data) => ({ data, error: null }))
      : Promise.resolve({ data: [], error: null }),
    batchIds.length
      ? loadInChunks<any>(batchIds, (chunk) => supabase
          .from("warehouse_issue_request_item_allocations")
          .select("id,request_id,batch_id,batch_id_text,prepared_quantity,issued_quantity")
          .eq("company_id", companyId)
          .in("batch_id", chunk)
          .order("id", { ascending: true }))
          .then((data) => ({ data, error: null }))
      : Promise.resolve({ data: [], error: null }),
    batchIds.length
      ? loadInChunks<any>(batchIds, (chunk) => supabase
          .from("warehouse_issue_request_item_allocations")
          .select("id,request_id,batch_id,batch_id_text,prepared_quantity,issued_quantity")
          .eq("company_id", companyId)
          .in("batch_id_text", chunk)
          .order("id", { ascending: true }))
          .then((data) => ({ data, error: null }))
      : Promise.resolve({ data: [], error: null }),
  ]);
  const accountingLoadError = [ledgerByBatchResult, ledgerByTextResult, ledgerByTicketResult, allocationsByBatchResult, allocationsByTextResult]
    .map((result: any) => result.error).find(Boolean);
  if (accountingLoadError) throw accountingLoadError;

  const dedupeById = (rows: any[]) => Array.from(new Map(rows.map((row) => [String(row.id), row])).values());
  const ledgerEntries = dedupeById([
    ...(ledgerByBatchResult.data || []),
    ...(ledgerByTextResult.data || []),
    ...(ledgerByTicketResult.data || []),
  ]);
  const outgoingLedgerEntries = ledgerEntries.filter((entry: any) => {
    const reason = String(entry.reason_type || "").toLowerCase();
    return Number(entry.delta_qty_signed || 0) < -0.000001 && !entry.is_storno && !reason.includes("harvest_incoming");
  });
  const movementTicketIds = ids(outgoingLedgerEntries.map((entry: any) => entry.ticket_id));
  const ledgerProcessingIds = ids(outgoingLedgerEntries
    .filter((entry: any) => String(entry.reason_type || "").toLowerCase().includes("processing_input"))
    .map((entry: any) => entry.processing_id || entry.reason_ref_id));
  const [movementTicketsResult, transformationsResult] = await Promise.all([
    movementTicketIds.length
      ? supabase
          .from("tickets")
          .select("id,ticket_no,ticket_type,op_type,status,created_at,finalized_at,created_by,vehicle_id,driver_id,warehouse_from_id,warehouse_to_id,gross_weight_kg,tare_weight_kg,net_weight_kg,notes,is_voided,void_reason")
          .eq("company_id", companyId)
          .in("id", movementTicketIds)
      : Promise.resolve({ data: [], error: null }),
    lotIds.length
      ? supabase
          .from("batch_transformations")
          .select("id,harvest_lot_id,node_warehouse_id,transformation_type,status,processing_node_id,source_ticket_id,started_at,completed_at,created_by,completed_by,note")
          .eq("company_id", companyId)
          .in("harvest_lot_id", lotIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (movementTicketsResult.error || transformationsResult.error) {
    throw movementTicketsResult.error || transformationsResult.error;
  }
  const movementTicketRows = (movementTicketsResult.data || []) as any[];
  const transformationRows = (transformationsResult.data || []) as any[];
  const processingIds = ids([
    ...ledgerProcessingIds,
    ...transformationRows.map((row) => row.id),
  ]);
  const traceVehicleIds = ids(movementTicketRows.map((row) => row.vehicle_id));
  const traceDriverIds = ids(movementTicketRows.map((row) => row.driver_id));
  const traceProfileIds = ids([
    ...outgoingLedgerEntries.map((row: any) => row.created_by),
    ...movementTicketRows.map((row) => row.created_by),
    ...transformationRows.flatMap((row) => [row.created_by, row.completed_by]),
  ]);
  const processingNodeIds = ids(transformationRows.map((row) => row.processing_node_id));
  const [transformationInputsResult, transformationOutputsResult, traceVehiclesResult, traceMachinesResult, tracePeopleResult, traceSpecialistsResult, traceDriversResult, traceProfilesResult, processingNodesResult] = await Promise.all([
    processingIds.length
      ? supabase.from("batch_transformation_inputs").select("transformation_id,batch_id,warehouse_from_id,input_weight_kg").eq("company_id", companyId).in("transformation_id", processingIds)
      : Promise.resolve({ data: [], error: null }),
    processingIds.length
      ? supabase.from("batch_transformation_outputs").select("transformation_id,line_type,batch_class,warehouse_to_id,output_weight_kg,output_batch_id,source_ticket_id,output_type,output_role,physical_state").eq("company_id", companyId).in("transformation_id", processingIds)
      : Promise.resolve({ data: [], error: null }),
    traceVehicleIds.length
      ? supabase.from("reference_vehicles").select("id,name,custom_name,full_name,brand,model,series,plate_number,license_plate,source_raw_name").eq("company_id", companyId).in("id", traceVehicleIds)
      : Promise.resolve({ data: [], error: null }),
    traceVehicleIds.length
      ? supabase.from("reference_machines").select("id,name,full_name,brand,model,series,license_plate,source_raw_name").eq("company_id", companyId).in("id", traceVehicleIds)
      : Promise.resolve({ data: [], error: null }),
    traceDriverIds.length
      ? supabase.from("company_people").select("id,full_name").eq("company_id", companyId).in("id", traceDriverIds)
      : Promise.resolve({ data: [], error: null }),
    traceDriverIds.length
      ? supabase.from("reference_specialists").select("id,full_name,name_ru,name_kz,name_en").eq("company_id", companyId).in("id", traceDriverIds)
      : Promise.resolve({ data: [], error: null }),
    traceDriverIds.length
      ? supabase.from("profiles").select("id,full_name,email").eq("company_id", companyId).in("id", traceDriverIds)
      : Promise.resolve({ data: [], error: null }),
    traceProfileIds.length
      ? supabase.from("profiles").select("id,full_name,email").in("id", traceProfileIds)
      : Promise.resolve({ data: [], error: null }),
    processingNodeIds.length
      ? supabase.from("processing_nodes").select("id,name").eq("company_id", companyId).in("id", processingNodeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const traceError = [
    transformationInputsResult,
    transformationOutputsResult,
    traceVehiclesResult,
    traceMachinesResult,
    tracePeopleResult,
    traceSpecialistsResult,
    traceDriversResult,
    traceProfilesResult,
    processingNodesResult,
  ].map((result: any) => result.error).find(Boolean);
  if (traceError) throw traceError;

  const movementTicketsById = byId(movementTicketRows);
  const transformationsById = byId(transformationRows);
  const transformationInputsById = new Map<string, any>(
    (transformationInputsResult.data || []).map((row: any) => [String(row.transformation_id), row])
  );
  const transformationOutputsById = new Map<string, any[]>();
  for (const output of transformationOutputsResult.data || []) {
    const key = String((output as any).transformation_id);
    transformationOutputsById.set(key, [...(transformationOutputsById.get(key) || []), output]);
  }
  const traceVehiclesById = byId([...(traceVehiclesResult.data || []), ...(traceMachinesResult.data || [])]);
  const traceDriversById = byId([...(tracePeopleResult.data || []), ...(traceSpecialistsResult.data || []), ...(traceDriversResult.data || [])]);
  const traceProfilesById = byId(traceProfilesResult.data || []);
  const processingNodesById = byId(processingNodesResult.data || []);
  const allocations = dedupeById([
    ...(allocationsByBatchResult.data || []),
    ...(allocationsByTextResult.data || []),
  ]);
  const requestIds = ids(allocations.map((row) => row.request_id));
  const requestsResult = requestIds.length
    ? await supabase
        .from("warehouse_issue_requests")
        .select("id,status,warehouse_request_status,source_warehouse_id")
        .eq("company_id", companyId)
        .in("id", requestIds)
    : { data: [], error: null };
  if (requestsResult.error) throw requestsResult.error;
  const requestsById = byId(requestsResult.data || []);
  const openRequest = (request: any) => {
    const canonical = String(request?.warehouse_request_status || "");
    return canonical
      ? ["pending", "collecting", "ready_for_pickup"].includes(canonical)
      : ["new", "active", "preparing", "ready"].includes(String(request?.status || ""));
  };
  const sourceTicketToBatch = new Map<string, string>();
  links.forEach((link) => {
    if (link.source_ticket_id) sourceTicketToBatch.set(String(link.source_ticket_id), String(link.inventory_batch_id));
  });
  (batchesResult.data || []).forEach((batch: any) => {
    if (batch.source_ticket_id) sourceTicketToBatch.set(String(batch.source_ticket_id), String(batch.id));
  });
  const resolveLedgerBatchId = (entry: any): string | null => {
    const direct = String(entry.inventory_batch_id || entry.batch_id_text || "");
    if (direct && batchIds.includes(direct)) return direct;
    return sourceTicketToBatch.get(String(entry.ticket_id || "")) || null;
  };
  const resolveAllocationBatchId = (entry: any): string | null => {
    const direct = String(entry.batch_id || entry.batch_id_text || "");
    return direct && batchIds.includes(direct) ? direct : null;
  };

  return lotRows.flatMap((lot) => {
    const memberLinks = links.filter((link) => String(link.harvest_lot_id) === String(lot.id));
    const memberLineage = lineage.filter((row) => row.harvestLotId === String(lot.id));
    const linkedTrips = memberLinks.map((link) => {
      const batch = batchesById.get(String(link.inventory_batch_id)) || {};
      const ticketId = harvestTicketIdByBatchId.get(String(link.inventory_batch_id));
      const ticket = ticketsById.get(String(ticketId || "")) || {};
      const fieldId = String(ticket.field_id || lot.source_field_id || "") || null;
      const field = fieldsById.get(String(fieldId || ""));
      const vehicle = vehiclesById.get(String(ticket.vehicle_id || ""));
      const driver = driversById.get(String(ticket.driver_id || ""));
      const transportAudit = (ticket.audit_json?.transport || {}) as Record<string, unknown>;
      const transportIdentity = resolveTransportIdentity({
        ...(vehicle || {}),
        name: vehicle?.name || transportAudit.vehicle_name_snapshot,
        plate: vehicle?.plate_number || vehicle?.license_plate || transportAudit.vehicle_plate_snapshot,
      });
      return {
        id: String(batch.id || link.inventory_batch_id),
        batchCode: String(batch.batch_code || "Рейс"),
        ticketId: ticket.id ? String(ticket.id) : null,
        ticketNo: String(ticket.ticket_no || "—"),
        fieldId,
        fieldName: String(field?.name || "Поле не уточнено"),
        warehouseId: ticket.warehouse_to_id ? String(ticket.warehouse_to_id) : null,
        netWeightKg: Number(ticket.net_weight_kg || 0),
        moisturePercent: batch.moisture_percent == null ? null : Number(batch.moisture_percent),
        vehicleName: transportIdentity.label || null,
        driverName: String(driver?.full_name || driver?.name_ru || driver?.name_en || driver?.name_kz || driver?.email || "") || null,
        status: ticket.is_voided || ticket.status === "voided" ? "voided" : String(ticket.status || "unknown"),
        opType: String(ticket.op_type || ""),
        isFinalized: ticket.is_finalized === true,
        isVoided: ticket.is_voided === true,
        replacementTicketId: ticket.replacement_ticket_id ? String(ticket.replacement_ticket_id) : null,
        occurredAt: ticket.finalized_at || ticket.created_at || batch.created_at || null,
      };
    });
    const trips = Array.from(new Map(
      linkedTrips
        .filter((trip) => trip.ticketId && trip.opType === "harvest_incoming")
        .map((trip) => [String(trip.ticketId), trip] as const)
    ).values());
    const validTrips = trips.filter((trip) => (
      trip.status === "finalized"
      && trip.isFinalized
      && !trip.isVoided
      && !trip.replacementTicketId
    ));
    const receivedKg = validTrips.reduce((sum, trip) => sum + trip.netWeightKg, 0);
    const voidedKg = trips.filter((trip) => trip.status === "voided").reduce((sum, trip) => sum + trip.netWeightKg, 0);
    const stockRows = allStockRows.filter((row) => String(row.harvest_lot_id) === String(lot.id) && Number(row.current_weight_kg || 0) > 0.0001);
    const stockByWarehouse = new Map<string, { warehouse_id: string; current_weight_kg: number; components: any[] }>();
    for (const row of stockRows) {
      const warehouseKey = String(row.warehouse_id || "");
      const current = stockByWarehouse.get(warehouseKey) || {
        warehouse_id: warehouseKey,
        current_weight_kg: 0,
        components: [],
      };
      const componentWeight = Number(row.current_weight_kg || 0);
      current.current_weight_kg += componentWeight;
      current.components.push({
        batchClass: String(row.batch_class || "commodity"),
        physicalState: String(row.physical_state || "SOURCE"),
        quantityKg: componentWeight,
        tripCount: Number(row.trip_count || 0),
      });
      stockByWarehouse.set(warehouseKey, current);
    }
    const warehouseStockRows = Array.from(stockByWarehouse.values());
    const totalCurrent = stockRows.reduce((sum, row) => sum + Number(row.current_weight_kg || 0), 0);
    const crop = cropsById.get(String(lot.crop_id || ""));
    const variety = varietiesById.get(String(lot.variety_id || ""));
    const reproduction = reproductionsById.get(String(lot.reproduction_id || ""));
    const season = seasonsById.get(String(lot.season_id || ""));
    const sampleBatch = memberLinks.map((link) => batchesById.get(String(link.inventory_batch_id))).find(Boolean) || {};
    const cropName = lot.identity_kind === "crop_mix"
      ? String(sampleBatch.display_name || "Зерносмесь")
      : localizedName(crop, "ru") || "Культура не уточнена";
    const processingEligible = canUseGrainProcessing({
      cropSlug: crop?.slug,
      cropName,
      categorySlug: crop?.category,
      categoryName: crop?.crop_category,
      subcategory: crop?.subcategory || crop?.crop_subcategory,
    });
    const productId = String(sampleBatch.product_id || "");
    const productIds = ids(memberLinks.map((link) => batchesById.get(String(link.inventory_batch_id))?.product_id));
    const memberBatchIds = new Set(memberLinks.map((link) => String(link.inventory_batch_id)));
    const lotLedgerEntries = ledgerEntries.filter((entry) => {
      const resolvedBatchId = resolveLedgerBatchId(entry);
      return Boolean(resolvedBatchId && memberBatchIds.has(resolvedBatchId));
    });
    const lotAllocations = allocations.filter((allocation) => {
      const resolvedBatchId = resolveAllocationBatchId(allocation);
      return Boolean(resolvedBatchId && memberBatchIds.has(resolvedBatchId));
    });
    const companyAccounting = calculateHarvestLotAccounting({
      receivedKg,
      voidedKg,
      currentKg: totalCurrent,
      ledgerEntries: lotLedgerEntries,
    });

    return warehouseStockRows.map((stock) => {
      const warehouse = warehousesById.get(String(stock.warehouse_id || ""));
      const currentWeight = Number(stock.current_weight_kg || 0);
      const warehouseTrips = trips.filter(
        (trip) => String(trip.warehouseId || "") === String(stock.warehouse_id || "")
      );
      const warehouseValidTrips = warehouseTrips.filter((trip) => (
        trip.status === "finalized"
        && trip.isFinalized
        && !trip.isVoided
        && !trip.replacementTicketId
      ));
      const warehouseLedgerEntries = lotLedgerEntries.filter(
        (entry) => String(entry.warehouse_id || "") === String(stock.warehouse_id || "")
      );
      const stockBearingBatchIds = memberLinks.flatMap((link) => {
        const batch = batchesById.get(String(link.inventory_batch_id));
        return String(batch?.warehouse_id || "") === String(stock.warehouse_id || "")
          && Number(batch?.current_weight_kg || 0) > 0.0001
          ? [String(link.inventory_batch_id)]
          : [];
      });
      const warehouseMemberBatchIds = ids([
        ...stockBearingBatchIds,
        ...warehouseLedgerEntries.map((entry) => resolveLedgerBatchId(entry)),
      ]);
      const accountingEvidenceComplete = hasCompleteHarvestTicketLineage(
        memberLineage,
        effectiveHarvestTicketIdByBatchId,
        warehouseMemberBatchIds
      );
      const warehouseLineageTicketIds = new Set(
        warehouseMemberBatchIds
          .map((batchId) => effectiveHarvestTicketIdByBatchId.get(batchId))
          .filter((ticketId): ticketId is string => Boolean(ticketId))
      );
      const warehouseOriginTrips = trips.filter((trip) => Boolean(
        trip.ticketId && warehouseLineageTicketIds.has(trip.ticketId)
      ));
      const warehouseValidOriginTrips = warehouseOriginTrips.filter((trip) => (
        trip.status === "finalized"
        && trip.isFinalized
        && !trip.isVoided
        && !trip.replacementTicketId
      ));
      const warehouseValidOriginTripIds = new Set(warehouseValidOriginTrips.map((trip) => trip.ticketId));
      const warehouseFieldSummaryMap = new Map<string, { fieldId: string | null; fieldName: string; netWeightKg: number; tripCount: number }>();
      warehouseOriginTrips.forEach((trip) => {
        const key = trip.fieldId || "missing";
        const current = warehouseFieldSummaryMap.get(key) || {
          fieldId: trip.fieldId,
          fieldName: trip.fieldName,
          netWeightKg: 0,
          tripCount: 0,
        };
        if (warehouseValidOriginTripIds.has(trip.ticketId)) {
          current.netWeightKg += trip.netWeightKg;
          current.tripCount += 1;
        }
        warehouseFieldSummaryMap.set(key, current);
      });
      const warehouseFieldSummaries = Array.from(warehouseFieldSummaryMap.values())
        .sort((left, right) => left.fieldName.localeCompare(right.fieldName, "ru"));
      const warehouseFieldNames = warehouseFieldSummaries.map((item) => item.fieldName).join(", ");
      const warehouseDates = warehouseValidOriginTrips.map((trip) => trip.occurredAt).filter(Boolean).sort();
      const warehouseReceivedKg = warehouseValidTrips.reduce((sum, trip) => sum + trip.netWeightKg, 0);
      const warehouseVoidedKg = warehouseTrips
        .filter((trip) => trip.status === "voided")
        .reduce((sum, trip) => sum + trip.netWeightKg, 0);
      const reservedKg = lotAllocations.reduce((sum, allocation) => {
        const request = requestsById.get(String(allocation.request_id || ""));
        if (!openRequest(request) || String(request?.source_warehouse_id || "") !== String(stock.warehouse_id || "")) return sum;
        return sum + Math.max(Number(allocation.prepared_quantity || 0) - Number(allocation.issued_quantity || 0), 0);
      }, 0);
      const accounting = calculateHarvestLotAccounting({
        receivedKg: warehouseReceivedKg,
        voidedKg: warehouseVoidedKg,
        currentKg: currentWeight,
        reservedKg,
        ledgerEntries: warehouseLedgerEntries,
      });
      const stornoTargetEntryIds = new Set(
        warehouseLedgerEntries
          .map((entry: any) => String(entry.storno_of_entry_id || ""))
          .filter(Boolean)
      );
      const outgoingDocuments = warehouseLedgerEntries
        .filter((entry: any) => {
          const reason = String(entry.reason_type || "").toLowerCase();
          return Number(entry.delta_qty_signed || 0) < -0.000001
            && !entry.is_storno
            && !stornoTargetEntryIds.has(String(entry.id || ""))
            && !reason.includes("harvest_incoming");
        })
        .map((entry: any) => {
          const reason = String(entry.reason_type || "").toLowerCase();
          const processingId = reason.includes("processing_input")
            ? String(entry.processing_id || entry.reason_ref_id || "")
            : "";
          const transformation = processingId ? transformationsById.get(processingId) : null;
          const input = processingId ? transformationInputsById.get(processingId) : null;
          const ticketId = String(entry.ticket_id || "");
          const ticket = ticketId ? movementTicketsById.get(ticketId) : null;
          const sourceTicket = transformation?.source_ticket_id
            ? ticketsById.get(String(transformation.source_ticket_id))
            : null;
          const vehicle = ticket?.vehicle_id ? traceVehiclesById.get(String(ticket.vehicle_id)) : null;
          const driver = ticket?.driver_id ? traceDriversById.get(String(ticket.driver_id)) : null;
          const actorId = String(
            transformation?.completed_by || transformation?.created_by || ticket?.created_by || entry.created_by || ""
          );
          const actor = actorId ? traceProfilesById.get(actorId) : null;
          const outputs = processingId ? (transformationOutputsById.get(processingId) || []) : [];
          const sourceType = transformation
            ? "processing_document"
            : ticket
              ? "weighbridge_ticket"
              : "missing";
          return {
            id: String(entry.id),
            label: movementLabel(entry.reason_type),
            quantityKg: Math.abs(Number(entry.delta_qty_signed || 0)),
            occurredAt: entry.occurred_at || transformation?.completed_at || ticket?.finalized_at || null,
            warehouseName: localizedName(warehouse, "ru", ["name"]) || "Склад",
            actorName: String(actor?.full_name || actor?.email || "") || null,
            sourceType,
            sourceId: transformation?.id ? String(transformation.id) : ticket?.id ? String(ticket.id) : null,
            documentNo: ticket?.ticket_no
              ? String(ticket.ticket_no)
              : transformation
                ? "Документ переработки"
                : null,
            ticketId: ticket?.id ? String(ticket.id) : null,
            ticketNo: ticket?.ticket_no ? String(ticket.ticket_no) : null,
            vehicleName: resolveTransportIdentity(vehicle || {}).label || null,
            driverName: String(driver?.full_name || driver?.name_ru || driver?.name_en || driver?.name_kz || driver?.email || "") || null,
            notes: String(entry.notes || transformation?.note || ticket?.notes || "") || null,
            direction: "out" as const,
            processingDocument: transformation ? {
              id: String(transformation.id),
              transformationType: String(transformation.transformation_type || "processing"),
              status: String(transformation.status || ""),
              processingNodeName: String(processingNodesById.get(String(transformation.processing_node_id || ""))?.name || "") || null,
              startedAt: transformation.started_at || null,
              completedAt: transformation.completed_at || null,
              sourceWarehouseName: String(warehousesById.get(String(input?.warehouse_from_id || ""))?.name || "") || null,
              inputBatchId: input?.batch_id ? String(input.batch_id) : null,
              inputBatchCode: String(batchesById.get(String(input?.batch_id || ""))?.batch_code || "") || null,
              inputWeightKg: Number(input?.input_weight_kg || 0),
              sourceTicketId: sourceTicket?.id ? String(sourceTicket.id) : null,
              sourceTicketNo: sourceTicket?.ticket_no ? String(sourceTicket.ticket_no) : null,
              createdByName: String(traceProfilesById.get(String(transformation.created_by || ""))?.full_name || traceProfilesById.get(String(transformation.created_by || ""))?.email || "") || null,
              completedByName: String(traceProfilesById.get(String(transformation.completed_by || ""))?.full_name || traceProfilesById.get(String(transformation.completed_by || ""))?.email || "") || null,
              note: transformation.note ? String(transformation.note) : null,
              outputs: outputs.map((output: any) => ({
                lineType: String(output.line_type || "other"),
                batchClass: String(output.batch_class || ""),
                warehouseName: String(warehousesById.get(String(output.warehouse_to_id || ""))?.name || "") || null,
                weightKg: Number(output.output_weight_kg || 0),
              })),
            } : null,
          } as const;
        })
        .sort((a, b) => new Date(b.occurredAt || 0).getTime() - new Date(a.occurredAt || 0).getTime());
      const processingDocuments = processingEligible
        ? transformationRows
            .filter((transformation) => String(transformation.harvest_lot_id || "") === String(lot.id))
            .flatMap((transformation) => {
              const transformationId = String(transformation.id || "");
              const outputs = (transformationOutputsById.get(transformationId) || [])
                .filter((output: any) => String(output.warehouse_to_id || "") === String(stock.warehouse_id || ""));
              if (!outputs.length) return [];
              const input = transformationInputsById.get(transformationId);
              const sourceTicket = transformation.source_ticket_id
                ? ticketsById.get(String(transformation.source_ticket_id))
                : null;
              const actorId = String(transformation.completed_by || transformation.created_by || "");
              const actor = actorId ? traceProfilesById.get(actorId) : null;
              return [{
                id: `processing:${transformationId}:${stock.warehouse_id}`,
                label: `${processingLabel(transformation.transformation_type)}: поступление результата`,
                quantityKg: outputs.reduce((sum: number, output: any) => sum + Number(output.output_weight_kg || 0), 0),
                occurredAt: transformation.completed_at || transformation.started_at || null,
                warehouseName: localizedName(warehouse, "ru", ["name"]) || "Склад",
                actorName: String(actor?.full_name || actor?.email || "") || null,
                sourceType: "processing_document" as const,
                sourceId: transformationId,
                documentNo: "Документ обработки",
                ticketId: outputs.find((output: any) => output.source_ticket_id)?.source_ticket_id || null,
                ticketNo: null,
                vehicleName: null,
                driverName: null,
                notes: String(transformation.note || "") || null,
                direction: "processing" as const,
                processingDocument: {
                  id: transformationId,
                  transformationType: String(transformation.transformation_type || "processing"),
                  status: String(transformation.status || ""),
                  processingNodeName: String(processingNodesById.get(String(transformation.processing_node_id || ""))?.name || "") || null,
                  startedAt: transformation.started_at || null,
                  completedAt: transformation.completed_at || null,
                  sourceWarehouseName: String(warehousesById.get(String(input?.warehouse_from_id || ""))?.name || "") || null,
                  inputBatchId: input?.batch_id ? String(input.batch_id) : null,
                  inputBatchCode: String(batchesById.get(String(input?.batch_id || ""))?.batch_code || "") || null,
                  inputWeightKg: Number(input?.input_weight_kg || 0),
                  sourceTicketId: sourceTicket?.id ? String(sourceTicket.id) : null,
                  sourceTicketNo: sourceTicket?.ticket_no ? String(sourceTicket.ticket_no) : null,
                  createdByName: String(traceProfilesById.get(String(transformation.created_by || ""))?.full_name || traceProfilesById.get(String(transformation.created_by || ""))?.email || "") || null,
                  completedByName: String(traceProfilesById.get(String(transformation.completed_by || ""))?.full_name || traceProfilesById.get(String(transformation.completed_by || ""))?.email || "") || null,
                  note: transformation.note ? String(transformation.note) : null,
                  outputs: outputs.map((output: any) => ({
                    lineType: String(output.line_type || output.output_role || "other"),
                    batchClass: String(output.batch_class || ""),
                    warehouseName: String(warehousesById.get(String(output.warehouse_to_id || ""))?.name || "") || null,
                    weightKg: Number(output.output_weight_kg || 0),
                  })),
                },
              }];
            })
        : [];
      const historyDocuments = [...processingDocuments, ...outgoingDocuments]
        .sort((a, b) => new Date(b.occurredAt || 0).getTime() - new Date(a.occurredAt || 0).getTime());
      return {
        id: String(lot.id),
        batchCode: String(lot.lot_code),
        warehouseId: String(stock.warehouse_id || ""),
        warehouseName: localizedName(warehouse, "ru", ["name"]) || "Склад",
        productId,
        productIds,
        productName: cropName,
        cropId: lot.crop_id ? String(lot.crop_id) : null,
        cropName,
        cropCategorySlug: String(crop?.category || ""),
        processingEligible,
        detailLevel: "full" as const,
        varietyId: lot.variety_id ? String(lot.variety_id) : null,
        varietyName: brandName(variety) || "Не уточнён",
        reproductionId: lot.reproduction_id ? String(lot.reproduction_id) : null,
        reproductionName: localizedName(reproduction, "ru", ["name", "code"]) || "Не уточнена",
        fieldId: warehouseFieldSummaries.length === 1 ? warehouseFieldSummaries[0].fieldId : null,
        fieldName: warehouseFieldNames || "Талонное происхождение отсутствует",
        operationLineId: null,
        cropStructureLabel: warehouseFieldNames ? `Поля: ${warehouseFieldNames}` : "Талонное происхождение отсутствует",
        seasonLabel: String(season?.year || season?.name || "Сезон не уточнён"),
        operationName: "Приёмка урожая",
        firstReceivedAt: warehouseDates[0] || null,
        lastReceivedAt: warehouseDates[warehouseDates.length - 1] || null,
        receivedKg: accounting.receivedKg,
        companyReceivedKg: receivedKg,
        companyCurrentKg: companyAccounting.physicalKg,
        voidedKg: accounting.voidedKg,
        removedKg: accounting.impurityKg,
        cleanMassKg: accounting.physicalKg,
        impurityPercent: accounting.receivedKg > 0 ? (accounting.impurityKg / accounting.receivedKg) * 100 : 0,
        processingInputKg: accounting.processingInputKg,
        processingOutputKg: accounting.processingOutputKg,
        transferInKg: accounting.transferInKg,
        transferOutKg: accounting.transferOutKg,
        writeoffKg: accounting.writeoffKg,
        issueKg: accounting.issueKg,
        otherAdjustmentKg: accounting.otherAdjustmentKg,
        reservedKg: accounting.reservedKg,
        availableKg: accounting.availableKg,
        reconciliationDeltaKg: accounting.reconciliationDeltaKg,
        reconciliationState: accountingEvidenceComplete
          ? Math.abs(accounting.reconciliationDeltaKg) > 0.001 ? "mismatch" : "reconciled"
          : "incomplete_lineage",
        harvestedAreaHa: null,
        grossYieldTPerHa: null,
        cleanYieldTPerHa: null,
        aggregateLot: true,
        aggregateLotId: String(lot.id),
        tripCount: warehouseValidOriginTrips.length,
        originState: warehouseOriginTrips.length > 0 ? "ticket_lineage" as const : "ticket_lineage_absent" as const,
        stockComponents: stock.components.sort((left, right) => right.quantityKg - left.quantityKg),
        reviewState: lot.review_state,
        reviewReasons: Array.isArray(lot.review_reasons) ? lot.review_reasons : [],
        fieldSummaries: warehouseFieldSummaries,
        tripBatches: warehouseOriginTrips,
        outgoingDocuments: historyDocuments,
        tickets: warehouseOriginTrips.filter((trip) => trip.ticketId).map((trip) => ({
          id: trip.ticketId,
          ticketNo: trip.ticketNo,
          operation: "harvest_incoming" as const,
          netWeightKg: trip.netWeightKg,
          occurredAt: trip.occurredAt,
        })),
        movements: warehouseOriginTrips.filter((trip) => trip.status !== "voided").map((trip) => ({
          id: trip.id,
          label: `Рейс ${trip.ticketNo}`,
          quantityKg: trip.netWeightKg,
          direction: "in" as const,
          occurredAt: trip.occurredAt,
          ticketNo: trip.ticketNo,
        })),
      };
    });
  });
}

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });
    const warehouseId = String(request.nextUrl.searchParams.get("warehouseId") || "").trim() || null;
    const lotId = String(request.nextUrl.searchParams.get("lotId") || "").trim() || null;
    const aggregateLots = request.nextUrl.searchParams.get("view") === "lots";
    if (aggregateLots) {
      const lots = request.nextUrl.searchParams.get("detail") === "summary"
        ? await loadAggregateHarvestLotSummaries(supabase, companyId, warehouseId, lotId)
        : await loadAggregateHarvestLots(supabase, companyId, warehouseId, lotId);
      if (lots !== null) return NextResponse.json({ batches: lots });
    }

    let batchQuery = supabase
      .from("inventory_batches")
      .select("id,batch_code,product_id,crop_id,variety_id,reproduction_id,source_field_id,source_ticket_id,season_id,batch_class,origin_type,warehouse_id")
      .eq("company_id", companyId)
      .eq("origin_type", "harvest")
      .order("created_at", { ascending: false })
      .limit(500);
    if (warehouseId) batchQuery = batchQuery.eq("warehouse_id", warehouseId);
    const { data: batchRows, error: batchError } = await batchQuery;
    if (batchError) throw batchError;

    const batches = batchRows || [];
    if (!batches.length) return NextResponse.json({ batches: [] });

    const batchIds = ids(batches.map((row: any) => row.id));
    const sourceTicketIds = ids(batches.map((row: any) => row.source_ticket_id));
    const productIds = ids(batches.map((row: any) => row.product_id));
    const cropIds = ids(batches.map((row: any) => row.crop_id));
    const varietyIds = ids(batches.map((row: any) => row.variety_id));
    const reproductionIds = ids(batches.map((row: any) => row.reproduction_id));
    const fieldIds = ids(batches.map((row: any) => row.source_field_id));
    const seasonIds = ids(batches.map((row: any) => row.season_id));

    const [ticketsResult, linesResult, productsResult, cropsResult, varietiesResult, reproductionsResult, fieldsResult, seasonsResult] = await Promise.all([
      supabase
        .from("tickets")
        .select("id,ticket_no,batch_id,op_type,warehouse_from_id,warehouse_to_id,field_id,net_weight_kg,status,is_finalized,is_voided,created_at,finalized_at,linked_operation_id,crop_structure_allocation_id")
        .eq("company_id", companyId)
        .in("batch_id", batchIds)
        .in("op_type", ["harvest_incoming", "weighbridge_impurities"]),
      sourceTicketIds.length
        ? supabase
            .from("ticket_lines")
            .select("ticket_id,operation_line_id")
            .eq("company_id", companyId)
            .in("ticket_id", sourceTicketIds)
        : Promise.resolve({ data: [], error: null }),
      productIds.length ? supabase.from("products").select("id,name,trade_name,normalized_name").in("id", productIds) : Promise.resolve({ data: [], error: null }),
      cropIds.length ? supabase.from("crops").select("id,name,name_ru,name_kz,name_en").in("id", cropIds) : Promise.resolve({ data: [], error: null }),
      varietyIds.length ? supabase.from("varieties").select("id,name").in("id", varietyIds) : Promise.resolve({ data: [], error: null }),
      reproductionIds.length ? supabase.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en,code").in("id", reproductionIds) : Promise.resolve({ data: [], error: null }),
      fieldIds.length ? supabase.from("fields").select("id,name").eq("company_id", companyId).in("id", fieldIds) : Promise.resolve({ data: [], error: null }),
      seasonIds.length ? supabase.from("seasons").select("id,name,year").eq("company_id", companyId).in("id", seasonIds) : Promise.resolve({ data: [], error: null }),
    ]);

    const firstError = [ticketsResult, linesResult, productsResult, cropsResult, varietiesResult, reproductionsResult, fieldsResult, seasonsResult]
      .map((result: any) => result.error)
      .find(Boolean);
    if (firstError) throw firstError;

    const sourceLineByTicket = new Map<string, any>();
    for (const line of linesResult.data || []) {
      if (!sourceLineByTicket.has(String((line as any).ticket_id))) {
        sourceLineByTicket.set(String((line as any).ticket_id), line);
      }
    }
    const operationLineIds = ids(Array.from(sourceLineByTicket.values()).map((line: any) => line.operation_line_id));
    const operationLinesResult = operationLineIds.length
      ? await supabase
          .from("operation_lines")
          .select("id,planned_area_ha,actual_area_ha")
          .eq("company_id", companyId)
          .in("id", operationLineIds)
      : { data: [], error: null };
    if (operationLinesResult.error) throw operationLinesResult.error;

    const ticketRows = (ticketsResult.data || []) as any[];
    const finalized = ticketRows.filter((ticket) => ticket.is_finalized && ticket.status === "finalized" && !ticket.is_voided);
    const operationIds = ids(finalized.map((ticket) => ticket.linked_operation_id));
    const allocationIds = ids(finalized.map((ticket) => ticket.crop_structure_allocation_id));
    const [operationsResult, allocationsResult] = await Promise.all([
      operationIds.length
        ? supabase
            .from("operations")
            .select("id,operation_type,operation_type_slug,date")
            .eq("company_id", companyId)
            .in("id", operationIds)
        : Promise.resolve({ data: [], error: null }),
      allocationIds.length
        ? supabase
            .from("crop_structure")
            .select("id,area,field_id,crop_id,variety_id,reproduction_id")
            .eq("company_id", companyId)
            .in("id", allocationIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (operationsResult.error || allocationsResult.error) {
      throw operationsResult.error || allocationsResult.error;
    }
    const warehouseIds = ids(finalized.map((ticket) => ticket.op_type === "harvest_incoming" ? ticket.warehouse_to_id : ticket.warehouse_from_id));
    const warehousesResult = warehouseIds.length
      ? await supabase
          .from("warehouses")
          .select("id,name,name_ru,name_kz,name_en,warehouse_type")
          .eq("company_id", companyId)
          .in("id", warehouseIds)
      : { data: [], error: null };
    if (warehousesResult.error) throw warehousesResult.error;

    const mapById = (rows: any[]) => new Map(rows.map((row) => [String(row.id), row]));
    const productById = mapById((productsResult.data || []) as any[]);
    const cropById = mapById((cropsResult.data || []) as any[]);
    const varietyById = mapById((varietiesResult.data || []) as any[]);
    const reproductionById = mapById((reproductionsResult.data || []) as any[]);
    const fieldById = mapById((fieldsResult.data || []) as any[]);
    const seasonById = mapById((seasonsResult.data || []) as any[]);
    const warehouseById = mapById((warehousesResult.data || []) as any[]);
    const operationLineById = mapById((operationLinesResult.data || []) as any[]);
    const operationById = mapById((operationsResult.data || []) as any[]);
    const allocationById = mapById((allocationsResult.data || []) as any[]);

    const summaries = batches.flatMap((batch: any) => {
      const batchTickets = finalized.filter((ticket) => String(ticket.batch_id || "") === String(batch.id));
      const incoming = batchTickets.filter((ticket) => ticket.op_type === "harvest_incoming");
      if (!incoming.length) return [];
      const removed = batchTickets.filter((ticket) => ticket.op_type === "weighbridge_impurities");
      const receivedKg = incoming.reduce((sum, ticket) => sum + Number(ticket.net_weight_kg || 0), 0);
      const removedKg = removed.reduce((sum, ticket) => sum + Number(ticket.net_weight_kg || 0), 0);
      const sourceTicketId = String(batch.source_ticket_id || incoming[0]?.id || "");
      const sourceLine = sourceLineByTicket.get(sourceTicketId);
      const operationLine = sourceLine?.operation_line_id
        ? operationLineById.get(String(sourceLine.operation_line_id))
        : null;
      const harvestedAreaHa = Number(operationLine?.actual_area_ha || operationLine?.planned_area_ha || 0) || null;
      const metrics = calculateHarvestBatchMetrics(receivedKg, removedKg, harvestedAreaHa);
      const warehouseId = String(incoming[0]?.warehouse_to_id || "");
      const warehouse = warehouseById.get(warehouseId);
      const product = productById.get(String(batch.product_id || ""));
      const crop = cropById.get(String(batch.crop_id || ""));
      const variety = varietyById.get(String(batch.variety_id || ""));
      const reproduction = reproductionById.get(String(batch.reproduction_id || ""));
      const field = fieldById.get(String(batch.source_field_id || incoming[0]?.field_id || ""));
      const season = seasonById.get(String(batch.season_id || ""));
      const linkedOperation = operationById.get(String(incoming[0]?.linked_operation_id || ""));
      const allocation = allocationById.get(String(incoming[0]?.crop_structure_allocation_id || ""));
      const incomingDates = incoming
        .map((ticket) => String(ticket.finalized_at || ticket.created_at || ""))
        .filter(Boolean)
        .sort();
      const ticketSummaries = batchTickets
        .slice()
        .sort((a, b) => String(a.finalized_at || a.created_at || "").localeCompare(String(b.finalized_at || b.created_at || "")))
        .map((ticket) => ({
          id: String(ticket.id),
          ticketNo: String(ticket.ticket_no || ticket.id),
          operation: ticket.op_type as "harvest_incoming" | "weighbridge_impurities",
          netWeightKg: Number(ticket.net_weight_kg || 0),
          occurredAt: ticket.finalized_at || ticket.created_at || null,
        }));
      const allocationArea = Number(allocation?.area || 0);
      const identityLabel = [
        localizedName(crop, "ru", ["name"]) || "Культура не указана",
        brandName(variety),
        localizedName(reproduction, "ru", ["name", "code"]),
      ].filter(Boolean).join(" / ");

      return [{
        id: String(batch.id),
        batchCode: String(batch.batch_code || batch.id),
        warehouseId,
        warehouseName: localizedName(warehouse, "ru", ["name"]) || "Склад урожая",
        productId: String(batch.product_id || ""),
        productName: brandName(product) || localizedName(crop, "ru", ["name"]) || "Урожай",
        cropId: batch.crop_id ? String(batch.crop_id) : null,
        cropName: localizedName(crop, "ru", ["name"]) || "Культура не указана",
        varietyId: batch.variety_id ? String(batch.variety_id) : null,
        varietyName: brandName(variety) || "",
        reproductionId: batch.reproduction_id ? String(batch.reproduction_id) : null,
        reproductionName: localizedName(reproduction, "ru", ["name", "code"]) || "",
        fieldId: batch.source_field_id ? String(batch.source_field_id) : null,
        fieldName: String(field?.name || "Поле не указано"),
        operationLineId: sourceLine?.operation_line_id ? String(sourceLine.operation_line_id) : null,
        cropStructureLabel: `${String(field?.name || "Поле не указано")} · ${identityLabel}${allocationArea > 0 ? ` · ${allocationArea.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} га` : ""}`,
        seasonLabel: String(season?.name || season?.year || "Сезон не указан"),
        operationName: String(linkedOperation?.operation_type || "Уборка"),
        firstReceivedAt: incomingDates[0] || null,
        lastReceivedAt: incomingDates[incomingDates.length - 1] || null,
        ...metrics,
        harvestedAreaHa,
        tickets: ticketSummaries,
        movements: ticketSummaries.map((ticket) => ({
          id: ticket.id,
          label: ticket.operation === "harvest_incoming" ? "Поступление с поля" : "Вывоз примесей",
          quantityKg: ticket.netWeightKg,
          direction: ticket.operation === "harvest_incoming" ? "in" as const : "out" as const,
          occurredAt: ticket.occurredAt,
          ticketNo: ticket.ticketNo,
        })),
      }];
    });

    return NextResponse.json({ batches: summaries });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить партии урожая" },
      { status: 500 }
    );
  }
}
