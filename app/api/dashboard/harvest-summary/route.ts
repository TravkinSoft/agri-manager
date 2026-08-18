import { NextRequest, NextResponse } from "next/server";
import { resolveWeighbridgeSession, asSessionErrorResponse } from "@/app/api/weighbridge/_auth";
import {
  buildHarvestFilterOptions,
  buildHarvestOverview,
  buildWarehouseHarvestRows,
  resolveHarvestPeriod,
  type HarvestDashboardFilters,
  type HarvestPeriodPreset,
} from "@/lib/dashboard/harvest-summary";
import type { HarvestBatchSummary, WeighbridgeTicket } from "@/lib/types/weighbridge";
import { resolveTransportIdentity } from "@/lib/weighbridge/transport";

const DASHBOARD_ROLES = ["global_admin", "company_admin", "agronomist", "director"] as const;
const PERIOD_PRESETS = new Set<HarvestPeriodPreset>(["current_day", "previous_day", "current_shift", "last_24_hours", "season", "custom"]);

async function loadTickets(supabase: any, companyId: string): Promise<WeighbridgeTicket[]> {
  const rows: any[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("tickets")
      .select(`
        id,company_id,ticket_no,ticket_type,op_type,status,direction,source_kind,destination_kind,
        field_id,warehouse_from_id,warehouse_to_id,vehicle_id,driver_id,gross_weight_kg,tare_weight_kg,
        net_weight_kg,weigh_method,is_finalized,is_voided,finalized_at,voided_at,weighing_1_at,weighing_2_at,
        created_at,updated_at,notes,season_id,replacement_ticket_id,correction_of_ticket_id,requires_review,
        review_reason,audit_json,
        lines:ticket_lines(id,product_id,crop_id,product_name_snapshot,quantity,uom,moisture_percent,variety_id,
          variety_name_snapshot,reproduction_id,reproduction_name_snapshot,warehouse_to_id,
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
  const warehouseIds = Array.from(new Set(rows.flatMap((row) => [String(row.warehouse_to_id || ""), ...(row.lines || []).map((line: any) => String(line.warehouse_to_id || ""))]).filter(Boolean)));
  const vehicleIds = Array.from(new Set(rows.map((row) => String(row.vehicle_id || "")).filter(Boolean)));
  const driverIds = Array.from(new Set(rows.map((row) => String(row.driver_id || "")).filter(Boolean)));
  const [{ data: fields, error: fieldsError }, { data: warehouses, error: warehousesError }, { data: vehicles, error: vehiclesError }, { data: machines, error: machinesError }, { data: people, error: peopleError }, { data: specialists, error: specialistsError }, { data: driverProfiles, error: driverProfilesError }] = await Promise.all([
    fieldIds.length ? supabase.from("fields").select("id,name").eq("company_id", companyId).in("id", fieldIds) : Promise.resolve({ data: [], error: null }),
    warehouseIds.length ? supabase.from("warehouses").select("id,name").eq("company_id", companyId).in("id", warehouseIds) : Promise.resolve({ data: [], error: null }),
    vehicleIds.length ? supabase.from("reference_vehicles").select("id,name,custom_name,full_name,brand,model,series,plate_number,license_plate,source_raw_name").eq("company_id", companyId).in("id", vehicleIds) : Promise.resolve({ data: [], error: null }),
    vehicleIds.length ? supabase.from("reference_machines").select("id,name,full_name,brand,model,series,license_plate,plate_number,source_raw_name").eq("company_id", companyId).in("id", vehicleIds) : Promise.resolve({ data: [], error: null }),
    driverIds.length ? supabase.from("company_people").select("id,full_name").eq("company_id", companyId).in("id", driverIds) : Promise.resolve({ data: [], error: null }),
    driverIds.length ? supabase.from("reference_specialists").select("id,full_name,name_ru,name_kz,name_en").eq("company_id", companyId).in("id", driverIds) : Promise.resolve({ data: [], error: null }),
    driverIds.length ? supabase.from("profiles").select("id,full_name,email").eq("company_id", companyId).in("id", driverIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (fieldsError || warehousesError || vehiclesError || machinesError || peopleError || specialistsError || driverProfilesError) {
    throw fieldsError || warehousesError || vehiclesError || machinesError || peopleError || specialistsError || driverProfilesError;
  }
  const byId = (items: any[]) => new Map(items.map((item) => [String(item.id), item]));
  const fieldById = byId(fields || []);
  const warehouseById = byId(warehouses || []);
  const vehicleById = byId([...(vehicles || []), ...(machines || [])]);
  const driverById = byId([...(people || []), ...(specialists || []), ...(driverProfiles || [])]);

  const ticketIds = rows.map((row) => String(row.id));
  const { data: lotLinks, error: lotLinksError } = ticketIds.length
    ? await supabase
        .from("harvest_lot_batches")
        .select("harvest_lot_id,source_ticket_id")
        .eq("company_id", companyId)
        .in("source_ticket_id", ticketIds)
    : { data: [], error: null };
  if (lotLinksError) throw lotLinksError;
  const lotByTicketId = new Map((lotLinks || []).map((link: any) => [String(link.source_ticket_id), String(link.harvest_lot_id)]));

  return rows.map((row) => {
    const vehicle = vehicleById.get(String(row.vehicle_id || ""));
    const driver = driverById.get(String(row.driver_id || ""));
    const auditTransport = (row.audit_json?.transport || {}) as Record<string, unknown>;
    const transportIdentity = resolveTransportIdentity({
      ...(vehicle || {}),
      name: vehicle?.name || auditTransport.vehicle_name_snapshot,
      plate: vehicle?.plate_number || vehicle?.license_plate || auditTransport.vehicle_plate_snapshot,
    });
    return {
      ...row,
      harvest_lot_id: lotByTicketId.get(String(row.id)) || null,
      field_name_snapshot: String(fieldById.get(String(row.field_id || ""))?.name || "") || null,
      warehouse_to_name_snapshot: String(warehouseById.get(String(row.warehouse_to_id || ""))?.name || "") || null,
      vehicle_name_snapshot: transportIdentity.name || null,
      vehicle_plate_snapshot: transportIdentity.plate || null,
      driver_name_snapshot: String(driver?.full_name || driver?.name_ru || driver?.name_en || driver?.name_kz || driver?.email || "") || null,
      lines: (row.lines || []).map((line: any) => ({
        ...line,
        product_name: String(line.product_name_snapshot || line.products?.trade_name || line.products?.name || line.products?.normalized_name || "-"),
        variety_name: String(line.variety_name_snapshot || "-"),
        reproduction_name: String(line.reproduction_name_snapshot || "-"),
        warehouse_to_name: String(warehouseById.get(String(line.warehouse_to_id || ""))?.name || "") || null,
      })),
    };
  }) as WeighbridgeTicket[];
}

async function loadWarehouseRows(supabase: any, companyId: string): Promise<HarvestBatchSummary[]> {
  const { data: stocks, error: stockError } = await supabase
    .from("v_harvest_lot_stock_v1")
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

function readFilters(request: NextRequest): HarvestDashboardFilters {
  const read = (key: string) => String(request.nextUrl.searchParams.get(key) || "").trim() || null;
  return { cropId: read("cropId"), varietyId: read("varietyId"), reproductionId: read("reproductionId"), fieldId: read("fieldId"), warehouseId: read("warehouseId") };
}

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, { allowedRoles: DASHBOARD_ROLES });
    const section = String(request.nextUrl.searchParams.get("section") || "summary");
    const filters = readFilters(request);
    if (section === "warehouses") {
      const rows = buildWarehouseHarvestRows(await loadWarehouseRows(supabase, companyId), filters);
      return NextResponse.json({ rows, source: "v_harvest_lot_stock_v1" });
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

    if (section === "filters") {
      const warehouseRows = buildWarehouseHarvestRows(await loadWarehouseRows(supabase, companyId));
      return NextResponse.json({ options: buildHarvestFilterOptions(tickets, warehouseRows), operationalDayStartHour: period.operationalDayStartHour });
    }

    const warehouseRows = buildWarehouseHarvestRows(await loadWarehouseRows(supabase, companyId), filters);
    const summary = buildHarvestOverview(tickets, { period, filters, warehouseRows });
    return NextResponse.json({ ...summary, source: "effective finalized harvest_incoming tickets" });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить сводку" }, { status: 500 });
  }
}
