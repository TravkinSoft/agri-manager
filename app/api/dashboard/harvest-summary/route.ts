import { NextRequest, NextResponse } from "next/server";
import { resolveWeighbridgeSession, asSessionErrorResponse } from "@/app/api/weighbridge/_auth";
import {
  buildHarvestFilterOptions,
  buildHarvestOverview,
  buildWarehouseHarvestRows,
  resolveHarvestPeriod,
  type HarvestDashboardFilters,
  type HarvestOverview,
  type HarvestPeriodPreset,
} from "@/lib/dashboard/harvest-summary";
import type { HarvestBatchSummary, WeighbridgeTicket } from "@/lib/types/weighbridge";
import {
  lotByTicketIdFromLineage,
  resolveHarvestLotTicketLineage,
} from "@/lib/weighbridge/harvest-lot-lineage";
import { resolveTransportIdentity } from "@/lib/weighbridge/transport";
import { getServiceClient } from "@/lib/supabase/service";

const DASHBOARD_ROLES = ["global_admin", "company_admin", "agronomist", "director", "accountant", "legal_operator"] as const;
const PERIOD_PRESETS = new Set<HarvestPeriodPreset>(["current_day", "previous_day", "current_shift", "last_24_hours", "season", "custom"]);
const LINEAGE_QUERY_CHUNK_SIZE = 200;
const LINEAGE_QUERY_CONCURRENCY = 4;
const LINEAGE_QUERY_PAGE_SIZE = 1000;
const SUMMARY_SOURCE = "effective finalized harvest_incoming tickets";

const uniqueIds = (values: unknown[]) => Array.from(new Set(
  values.map((value) => String(value || "").trim()).filter(Boolean)
));

async function loadInChunks<T>(
  values: string[],
  query: (chunk: string[]) => any
): Promise<T[]> {
  const normalized = uniqueIds(values);
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

async function loadLotByTicketId(
  supabase: any,
  companyId: string,
  ticketIds: string[]
): Promise<Map<string, string>> {
  if (!ticketIds.length) return new Map();
  const [ticketLinks, sourceBatches] = await Promise.all([
    loadInChunks<any>(ticketIds, (chunk) => supabase
      .from("harvest_lot_batches")
      .select("harvest_lot_id,inventory_batch_id,source_ticket_id")
      .eq("company_id", companyId)
      .in("source_ticket_id", chunk)
      .order("inventory_batch_id", { ascending: true })),
    loadInChunks<any>(ticketIds, (chunk) => supabase
      .from("inventory_batches")
      .select("id,parent_batch_id,source_ticket_id")
      .eq("company_id", companyId)
      .in("source_ticket_id", chunk)
      .order("id", { ascending: true })),
  ]);

  const parentCandidateIds = uniqueIds([
    ...ticketLinks.map((link) => link.inventory_batch_id),
    ...sourceBatches.map((batch) => batch.id),
  ]);
  const descendantBatches: any[] = [];
  const seenBatchIds = new Set(parentCandidateIds);
  let parentFrontier = parentCandidateIds;
  while (parentFrontier.length) {
    const loadedChildren = await loadInChunks<any>(parentFrontier, (chunk) => supabase
      .from("inventory_batches")
      .select("id,parent_batch_id,source_ticket_id")
      .eq("company_id", companyId)
      .in("parent_batch_id", chunk)
      .order("id", { ascending: true }));
    const freshChildren = loadedChildren.filter((batch) => {
      const batchId = String(batch.id || "");
      return batchId && !seenBatchIds.has(batchId);
    });
    descendantBatches.push(...freshChildren);
    freshChildren.forEach((batch) => seenBatchIds.add(String(batch.id)));
    parentFrontier = uniqueIds(freshChildren.map((batch) => batch.id));
  }
  const lineageBatchIds = uniqueIds([
    ...parentCandidateIds,
    ...descendantBatches.map((batch) => batch.id),
  ]);
  const batchLinks = await loadInChunks<any>(lineageBatchIds, (chunk) => supabase
    .from("harvest_lot_batches")
    .select("harvest_lot_id,inventory_batch_id,source_ticket_id")
    .eq("company_id", companyId)
    .in("inventory_batch_id", chunk)
    .order("inventory_batch_id", { ascending: true }));

  const links = Array.from(new Map(
    [...ticketLinks, ...batchLinks].map((link) => [String(link.inventory_batch_id), link])
  ).values());
  const batches = Array.from(new Map(
    [...sourceBatches, ...descendantBatches].map((batch) => [String(batch.id), batch])
  ).values());
  const lineage = resolveHarvestLotTicketLineage(links, links, batches);
  return lotByTicketIdFromLineage(lineage, ticketIds).lotByTicketId;
}

async function loadTickets(supabase: any, companyId: string): Promise<WeighbridgeTicket[]> {
  const rows: any[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("tickets")
      .select(`
        id,company_id,ticket_no,ticket_type,op_type,status,direction,source_kind,destination_kind,
        field_id,crop_structure_allocation_id,warehouse_from_id,warehouse_to_id,vehicle_id,driver_id,ptc_event_id,ptc_cycle,gross_weight_kg,tare_weight_kg,
        net_weight_kg,accepted_weight_kg,weigh_method,is_finalized,is_voided,finalized_at,voided_at,weighing_1_at,weighing_2_at,
        created_at,updated_at,notes,season_id,replacement_ticket_id,correction_of_ticket_id,requires_review,
        review_reason,audit_json,
        lines:ticket_lines(id,product_id,crop_id,product_name_snapshot,quantity,uom,moisture_percent,variety_id,
          variety_name_snapshot,reproduction_id,reproduction_name_snapshot,warehouse_to_id,is_mixed_harvest,
          crop:crop_id(name,name_ru,name_kz,name_en,slug),
          products:product_id(name,trade_name,normalized_name))
      `)
      .eq("company_id", companyId)
      .eq("op_type", "harvest_incoming")
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }

  const fieldIds = Array.from(new Set(rows.map((row) => String(row.field_id || "")).filter(Boolean)));
  const allocationIds = Array.from(new Set(rows.map((row) => String(row.crop_structure_allocation_id || "")).filter(Boolean)));
  const warehouseIds = Array.from(new Set(rows.flatMap((row) => [String(row.warehouse_to_id || ""), ...(row.lines || []).map((line: any) => String(line.warehouse_to_id || ""))]).filter(Boolean)));
  const vehicleIds = Array.from(new Set(rows.map((row) => String(row.vehicle_id || "")).filter(Boolean)));
  const driverIds = Array.from(new Set(rows.map((row) => String(row.driver_id || "")).filter(Boolean)));
  const [{ data: fields, error: fieldsError }, { data: allocations, error: allocationsError }, { data: warehouses, error: warehousesError }, { data: vehicles, error: vehiclesError }, { data: machines, error: machinesError }, { data: people, error: peopleError }, { data: specialists, error: specialistsError }, { data: driverProfiles, error: driverProfilesError }] = await Promise.all([
    fieldIds.length ? supabase.from("fields").select("id,name").eq("company_id", companyId).in("id", fieldIds) : Promise.resolve({ data: [], error: null }),
    allocationIds.length ? supabase.from("crop_structure").select("id,field_id,area").eq("company_id", companyId).in("id", allocationIds) : Promise.resolve({ data: [], error: null }),
    warehouseIds.length ? supabase.from("warehouses").select("id,name").eq("company_id", companyId).in("id", warehouseIds) : Promise.resolve({ data: [], error: null }),
    vehicleIds.length ? supabase.from("reference_vehicles").select("id,name,custom_name,full_name,brand,model,series,plate_number,license_plate,source_raw_name").eq("company_id", companyId).in("id", vehicleIds) : Promise.resolve({ data: [], error: null }),
    vehicleIds.length ? supabase.from("reference_machines").select("id,name,full_name,brand,model,series,license_plate,source_raw_name").eq("company_id", companyId).in("id", vehicleIds) : Promise.resolve({ data: [], error: null }),
    driverIds.length ? supabase.from("company_people").select("id,full_name").eq("company_id", companyId).in("id", driverIds) : Promise.resolve({ data: [], error: null }),
    driverIds.length ? supabase.from("reference_specialists").select("id,person_id,full_name,name_ru,name_kz,name_en").eq("company_id", companyId).in("id", driverIds) : Promise.resolve({ data: [], error: null }),
    driverIds.length ? supabase.from("profiles").select("id,full_name,email").eq("company_id", companyId).in("id", driverIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (fieldsError || allocationsError || warehousesError || vehiclesError || machinesError || peopleError || specialistsError || driverProfilesError) {
    throw fieldsError || allocationsError || warehousesError || vehiclesError || machinesError || peopleError || specialistsError || driverProfilesError;
  }
  const byId = (items: any[]) => new Map(items.map((item) => [String(item.id), item]));
  const fieldById = byId(fields || []);
  const allocationById = byId(allocations || []);
  const warehouseById = byId(warehouses || []);
  const vehicleById = byId([...(vehicles || []), ...(machines || [])]);
  const driverById = byId([...(people || []), ...(specialists || []), ...(driverProfiles || [])]);
  const specialistById = byId(specialists || []);

  const ticketIds = rows.map((row) => String(row.id));
  const lotByTicketId = await loadLotByTicketId(supabase, companyId, ticketIds);
  const ptcEventIds = uniqueIds(rows.map((row) => row.ptc_event_id));
  const service = getServiceClient();
  const loadedPtcResult = ptcEventIds.length
    ? await service.from("ptc_events").select("id,vehicle_id,cycle,created_at").eq("company_id", companyId).in("id", ptcEventIds)
    : { data: [], error: null } as any;
  if (loadedPtcResult.error) throw loadedPtcResult.error;
  const loadedPtcRows = loadedPtcResult.data || [];
  const unloadingPtcResult = loadedPtcRows.length
    ? await service.from("ptc_events").select("vehicle_id,cycle,created_at").eq("company_id", companyId).eq("to_state", "unloading").in("vehicle_id", uniqueIds(loadedPtcRows.map((row: any) => row.vehicle_id)))
    : { data: [], error: null } as any;
  if (unloadingPtcResult.error) throw unloadingPtcResult.error;
  const unloadingByTrip = new Map((unloadingPtcResult.data || []).map((row: any) => [`${row.vehicle_id}:${row.cycle}`, row]));
  const tripMinutesByEvent = new Map(loadedPtcRows.flatMap((loaded: any) => {
    const unloading = unloadingByTrip.get(`${loaded.vehicle_id}:${loaded.cycle}`) as any;
    const minutes = unloading ? (Date.parse(unloading.created_at) - Date.parse(loaded.created_at)) / 60_000 : NaN;
    return Number.isFinite(minutes) && minutes >= 0 ? [[String(loaded.id), minutes] as const] : [];
  }));

  return rows.map((row) => {
    const vehicle = vehicleById.get(String(row.vehicle_id || ""));
    const driver = driverById.get(String(row.driver_id || ""));
    const specialist = specialistById.get(String(row.driver_id || ""));
    const allocation = allocationById.get(String(row.crop_structure_allocation_id || ""));
    const storedDriver = row.audit_json?.driver && typeof row.audit_json.driver === "object" && !Array.isArray(row.audit_json.driver)
      ? row.audit_json.driver as Record<string, unknown>
      : null;
    const storedDriverId = String(storedDriver?.person_id || "").trim();
    const canonicalDriverId = storedDriverId || String(specialist?.person_id || row.driver_id || "").trim() || null;
    const storedDriverName = String(storedDriver?.full_name_snapshot || "").trim();
    const auditTransport = (row.audit_json?.transport || {}) as Record<string, unknown>;
    const transportIdentity = resolveTransportIdentity({
      ...(vehicle || {}),
      name: auditTransport.vehicle_name_snapshot || vehicle?.name,
      plate: auditTransport.vehicle_plate_snapshot || vehicle?.plate_number || vehicle?.license_plate,
    });
    return {
      ...row,
      driver_id: canonicalDriverId,
      ptc_trip_minutes: tripMinutesByEvent.get(String(row.ptc_event_id || "")) ?? null,
      harvest_lot_id: lotByTicketId.get(String(row.id)) || null,
      field_name_snapshot: String(fieldById.get(String(row.field_id || ""))?.name || "") || null,
      crop_structure_area_ha: allocation?.field_id && String(allocation.field_id) === String(row.field_id || "")
        ? Number(allocation.area || 0) || null
        : null,
      warehouse_to_name_snapshot: String(warehouseById.get(String(row.warehouse_to_id || ""))?.name || "") || null,
      vehicle_name_snapshot: transportIdentity.name || null,
      vehicle_plate_snapshot: transportIdentity.plate || null,
      driver_name_snapshot: storedDriverName || String(driver?.full_name || driver?.name_ru || driver?.name_en || driver?.name_kz || driver?.email || "") || null,
      lines: (row.lines || []).map((line: any) => ({
        ...line,
        crop_slug: String(line.crop?.slug || "").trim() || null,
        crop_name: String(line.crop?.name_ru || line.crop?.name || line.crop?.name_kz || line.crop?.name_en || "").trim() || null,
        product_name: String(line.product_name_snapshot || line.crop?.name_ru || line.crop?.name || line.products?.trade_name || line.products?.name || line.products?.normalized_name || "-"),
        variety_name: String(line.variety_name_snapshot || "-"),
        reproduction_name: String(line.reproduction_name_snapshot || "-"),
        warehouse_to_name: String(warehouseById.get(String(line.warehouse_to_id || ""))?.name || "") || null,
        is_mixed_harvest: line.is_mixed_harvest === true,
      })),
    };
  }) as WeighbridgeTicket[];
}

async function loadWarehouseRows(
  supabase: any,
  harvestStockSupabase: any,
  companyId: string
): Promise<HarvestBatchSummary[]> {
  const { data: stocks, error: stockError } = await harvestStockSupabase
    .from("v_harvest_lot_stock_v2")
    .select("harvest_lot_id,warehouse_id,trip_count,current_weight_kg")
    .eq("company_id", companyId);
  if (stockError) throw stockError;
  const rows = (stocks || []).filter((stock: any) => Number(stock.current_weight_kg || 0) > 0);
  if (!rows.length) return [];

  const lotIds = Array.from(new Set(rows.map((row: any) => String(row.harvest_lot_id))));
  const warehouseIds = Array.from(new Set(rows.map((row: any) => String(row.warehouse_id)).filter(Boolean)));
  const [{ data: lots, error: lotsError }, { data: warehouses, error: warehousesError }] = await Promise.all([
    supabase.from("harvest_lots").select("id,season_id,crop_id,variety_id,reproduction_id,review_state").eq("company_id", companyId).in("id", lotIds),
    supabase.from("warehouses").select("id,name").eq("company_id", companyId).in("id", warehouseIds),
  ]);
  if (lotsError || warehousesError) throw lotsError || warehousesError;

  const lotRows = lots || [];
  const cropIds = Array.from(new Set(lotRows.map((lot: any) => String(lot.crop_id || "")).filter(Boolean)));
  const varietyIds = Array.from(new Set(lotRows.map((lot: any) => String(lot.variety_id || "")).filter(Boolean)));
  const reproductionIds = Array.from(new Set(lotRows.map((lot: any) => String(lot.reproduction_id || "")).filter(Boolean)));
  const [cropsResult, varietiesResult, reproductionsResult] = await Promise.all([
    cropIds.length ? supabase.from("crops").select("id,name,name_ru").in("id", cropIds) : Promise.resolve({ data: [], error: null }),
    varietyIds.length ? supabase.from("varieties").select("id,name,name_ru").in("id", varietyIds) : Promise.resolve({ data: [], error: null }),
    reproductionIds.length ? supabase.from("seed_reproductions").select("id,name,name_ru,code").in("id", reproductionIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const refError = cropsResult.error || varietiesResult.error || reproductionsResult.error;
  if (refError) throw refError;
  const byId = (items: any[]) => new Map(items.map((item) => [String(item.id), item]));
  const lotById = byId(lotRows);
  const warehouseById = byId(warehouses || []);
  const cropById = byId(cropsResult.data || []);
  const varietyById = byId(varietiesResult.data || []);
  const reproductionById = byId(reproductionsResult.data || []);
  const name = (row: any) => String(row?.name_ru || row?.name || row?.code || "").trim();

  return rows.map((stock: any) => {
    const lot = lotById.get(String(stock.harvest_lot_id));
    const currentKg = Number(stock.current_weight_kg || 0);
    return {
      id: String(stock.harvest_lot_id), batchCode: String(stock.harvest_lot_id), warehouseId: String(stock.warehouse_id || ""),
      warehouseName: name(warehouseById.get(String(stock.warehouse_id))) || "Склад не указан", productId: "", productName: name(cropById.get(String(lot?.crop_id))) || "Культура не указана",
      cropId: lot?.crop_id ? String(lot.crop_id) : null, cropName: name(cropById.get(String(lot?.crop_id))) || "Культура не указана",
      varietyId: lot?.variety_id ? String(lot.variety_id) : null, varietyName: name(varietyById.get(String(lot?.variety_id))) || "Не уточнён",
      reproductionId: lot?.reproduction_id ? String(lot.reproduction_id) : null, reproductionName: name(reproductionById.get(String(lot?.reproduction_id))) || "Не уточнена",
      fieldId: null, fieldName: "", operationLineId: null, cropStructureLabel: "", seasonLabel: "", operationName: "",
      seasonId: lot?.season_id ? String(lot.season_id) : null,
      firstReceivedAt: null, lastReceivedAt: null, receivedKg: currentKg, removedKg: 0, cleanMassKg: currentKg,
      impurityPercent: 0, harvestedAreaHa: null, grossYieldTPerHa: null, cleanYieldTPerHa: null,
      tripCount: Number(stock.trip_count || 0), reviewState: lot?.review_state || "requires_review", tickets: [], movements: [],
      aggregateLot: true, aggregateLotId: String(stock.harvest_lot_id),
    } satisfies HarvestBatchSummary;
  });
}

async function loadActivePtcPlotSelection(companyId: string): Promise<HarvestOverview["activeWeighbridgeSelection"]> {
  const db = getServiceClient();
  const selection = "id,current_crop_structure_id,updated_at";
  const { data: openShift, error: openShiftError } = await db
    .from("ptc_combine_shifts")
    .select(selection)
    .eq("company_id", companyId)
    .is("closed_at", null)
    .not("current_crop_structure_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (openShiftError) throw openShiftError;
  let shift = openShift;
  if (!shift) {
    const { data: latestShift, error: latestShiftError } = await db
      .from("ptc_combine_shifts")
      .select(selection)
      .eq("company_id", companyId)
      .not("current_crop_structure_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestShiftError) throw latestShiftError;
    shift = latestShift;
  }
  if (!shift?.current_crop_structure_id) return null;
  const { data: structure, error: structureError } = await db
    .from("crop_structure")
    .select("id,field_id,season_id,crop_id,variety_id,reproduction_id,area")
    .eq("company_id", companyId)
    .eq("id", shift.current_crop_structure_id)
    .eq("archived", false)
    .maybeSingle();
  if (structureError) throw structureError;
  if (!structure?.id) return null;
  const [fieldResult, cropResult, varietyResult, reproductionResult] = await Promise.all([
    db.from("fields").select("id,name").eq("company_id", companyId).eq("id", structure.field_id).maybeSingle(),
    db.from("crops").select("id,name,name_ru,name_kz,name_en").eq("id", structure.crop_id).maybeSingle(),
    structure.variety_id ? db.from("varieties").select("id,name,name_ru,name_kz,name_en").eq("id", structure.variety_id).maybeSingle() : Promise.resolve({ data: null, error: null } as any),
    structure.reproduction_id ? db.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en,code").eq("id", structure.reproduction_id).maybeSingle() : Promise.resolve({ data: null, error: null } as any),
  ]);
  const error = fieldResult.error || cropResult.error || varietyResult.error || reproductionResult.error;
  if (error) throw error;
  const name = (row: any) => String(row?.name_ru || row?.name || row?.name_kz || row?.name_en || row?.code || "").trim() || null;
  return {
    ticketId: "",
    occurredAt: String(shift.updated_at),
    fieldId: String(structure.field_id),
    fieldName: String(fieldResult.data?.name || "Поле не указано"),
    cropStructureAllocationId: String(structure.id),
    harvestLotId: null,
    seasonId: structure.season_id ? String(structure.season_id) : null,
    cropId: structure.crop_id ? String(structure.crop_id) : null,
    cropName: name(cropResult.data) || "Культура не указана",
    varietyId: structure.variety_id ? String(structure.variety_id) : null,
    varietyName: name(varietyResult.data),
    reproductionId: structure.reproduction_id ? String(structure.reproduction_id) : null,
    reproductionName: name(reproductionResult.data),
    areaHa: Number(structure.area || 0) || null,
  };
}

function readFilters(request: NextRequest): HarvestDashboardFilters {
  const read = (key: string) => String(request.nextUrl.searchParams.get(key) || "").trim() || null;
  return { cropId: read("cropId"), varietyId: read("varietyId"), reproductionId: read("reproductionId"), fieldId: read("fieldId"), warehouseId: read("warehouseId") };
}

async function attachVerifiedCurrentPlotYield(
  supabase: any,
  companyId: string,
  summary: HarvestOverview,
): Promise<HarvestOverview> {
  const selection = summary.activeWeighbridgeSelection;
  if (!selection) return summary;

  let allocationQuery = supabase
    .from("crop_structure")
    .select("id,field_id,season_id,crop_id,variety_id,reproduction_id,area,archived")
    .eq("company_id", companyId)
    .eq("field_id", selection.fieldId)
    .eq("archived", false);
  if (selection.seasonId) allocationQuery = allocationQuery.eq("season_id", selection.seasonId);
  const { data: allocations, error: allocationsError } = await allocationQuery;
  if (allocationsError) throw allocationsError;

  const activeAllocations = allocations || [];
  const exactAllocation = activeAllocations.find((row: any) => String(row.id) === selection.cropStructureAllocationId);
  const selectionIsExact = exactAllocation
    && String(exactAllocation.crop_id || "") === String(selection.cropId || "")
    && String(exactAllocation.variety_id || "") === String(selection.varietyId || "")
    && String(exactAllocation.reproduction_id || "") === String(selection.reproductionId || "");
  if (!selectionIsExact) {
    return { ...summary, currentPlotHarvestedAreaStatus: "no_selection" };
  }

  const { data: segments, error: segmentsError } = await getServiceClient()
    .from("ptc_combine_field_segments")
    .select("id,crop_structure_id,closed_at,hectares_segment")
    .eq("company_id", companyId)
    .eq("crop_structure_id", selection.cropStructureAllocationId)
    .not("closed_at", "is", null)
    .gte("closed_at", summary.period.start)
    .lt("closed_at", summary.period.end)
    .order("closed_at", { ascending: true });
  if (segmentsError) throw segmentsError;

  // hectares_shift is the work done during each closed shift and may be summed
  // for the current working day. hectares_field_total is a cumulative field
  // checkpoint, so it is deliberately never used as this period's denominator.
  const harvestedAreaHa = (segments || []).reduce((total: number, row: any) => {
    const value = Number(row.hectares_segment);
    return Number.isFinite(value) && value > 0 ? total + value : total;
  }, 0);
  if (!(harvestedAreaHa > 0)) {
    return { ...summary, currentPlotHarvestedAreaStatus: "no_closed_shift" };
  }
  return {
    ...summary,
    currentPlotHarvestedAreaHa: harvestedAreaHa,
    currentPlotYieldTPerHa: summary.currentPlotAcceptedKg / 1000 / harvestedAreaHa,
    currentPlotHarvestedAreaStatus: "verified",
  };
}

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: DASHBOARD_ROLES,
      serverProfileRead: true,
    });
    const section = String(request.nextUrl.searchParams.get("section") || "summary");
    const filters = readFilters(request);
    if (section === "warehouses") {
      const rows = buildWarehouseHarvestRows(await loadWarehouseRows(supabase, getServiceClient(), companyId), filters);
      return NextResponse.json({ rows, source: "v_harvest_lot_stock_v2" });
    }

    const [tickets, seasonResult, shiftResult, companyResult] = await Promise.all([
      loadTickets(supabase, companyId),
      supabase.from("seasons").select("id,year,start_date,end_date").eq("company_id", companyId).eq("archived", false).order("year", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("weighbridge_shifts").select("id,status,opened_at,closed_at").eq("company_id", companyId).eq("status", "open").order("opened_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("companies").select("id,name,operational_day_start_hour").eq("id", companyId).maybeSingle(),
    ]);
    if (seasonResult.error || shiftResult.error || companyResult.error) throw seasonResult.error || shiftResult.error || companyResult.error;
    const presetRaw = String(request.nextUrl.searchParams.get("period") || "current_day") as HarvestPeriodPreset;
    const preset = PERIOD_PRESETS.has(presetRaw) ? presetRaw : "current_day";
    const period = resolveHarvestPeriod({
      preset,
      customStart: request.nextUrl.searchParams.get("start"),
      customEnd: request.nextUrl.searchParams.get("end"),
      season: seasonResult.data,
      shift: shiftResult.data,
      operationalDayStartHour: Number(companyResult.data?.operational_day_start_hour ?? 7),
    });
    const seasonPeriod = resolveHarvestPeriod({
      preset: "season",
      season: seasonResult.data,
      operationalDayStartHour: Number(companyResult.data?.operational_day_start_hour ?? 7),
    });

    const [loadedWarehouseRows, activePtcSelection] = await Promise.all([
      loadWarehouseRows(supabase, getServiceClient(), companyId),
      loadActivePtcPlotSelection(companyId),
    ]);
    const filterWarehouseRows = buildWarehouseHarvestRows(loadedWarehouseRows);
    if (section === "filters") {
      return NextResponse.json({
        options: buildHarvestFilterOptions(tickets, filterWarehouseRows),
        operationalDayStartHour: period.operationalDayStartHour,
      });
    }

    const warehouseRows = buildWarehouseHarvestRows(loadedWarehouseRows, filters);
    const periodSummary = await attachVerifiedCurrentPlotYield(
      supabase,
      companyId,
      buildHarvestOverview(tickets, { period, filters, warehouseRows, activeSelection: activePtcSelection }),
    );
    const seasonDrivers = buildHarvestOverview(tickets, { period: seasonPeriod }).potatoDrivers;
    const summary = { ...periodSummary, potatoDrivers: seasonDrivers };
    if (section === "bootstrap") {
      return NextResponse.json({
        summary: { ...summary, source: SUMMARY_SOURCE },
        options: buildHarvestFilterOptions(tickets, filterWarehouseRows),
        operationalDayStartHour: period.operationalDayStartHour,
      });
    }
    return NextResponse.json({ ...summary, source: SUMMARY_SOURCE });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить сводку" }, { status: 500 });
  }
}
