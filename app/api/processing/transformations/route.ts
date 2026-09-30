import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  WEIGHBRIDGE_READ_ROLES,
  WEIGHBRIDGE_WRITE_ROLES,
  asSessionErrorResponse,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";
import { canUseGrainProcessing } from "@/lib/weighbridge/crop-processing";
import { processingBalanceTolerance } from "@/lib/weighbridge/processing-work-state";

const WEIGHBRIDGE_TRANSFORMATION_COLUMNS = [
  "id",
  "company_id",
  "transformation_type",
  "processing_method",
  "status",
  "processing_state",
  "processing_node_id",
  "node_warehouse_id",
  "harvest_lot_id",
  "source_ticket_id",
  "started_at",
  "completed_at",
  "created_at",
  "note",
  "expected_water_loss_kg",
  "finish_requested_at",
  "last_main_output_marked_at",
  "completed_by",
  "closed_by",
].join(",");

type TransformationLoadOptions = {
  weighbridgeScope?: boolean;
  historyLimit?: number;
};

const nameOf = (row: any, fallback = "-") =>
  String(row?.name_ru || row?.name || row?.full_name || row?.batch_code || fallback);

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "Unknown error");
  }
  return "Unknown error";
};

const batchLabel = (batch: any) => {
  if (!batch) return "Партия";
  const product = nameOf(batch.product || batch.crop, "Продукт");
  const variety = nameOf(batch.variety, "");
  const reproduction = nameOf(batch.reproduction, "");
  const identity = [product, variety, reproduction].filter(Boolean).join(" / ");
  return `${identity}${batch.batch_code ? ` · ${batch.batch_code}` : ""}`;
};

async function loadTransformationItems(
  supabase: SupabaseClient,
  companyId: string,
  options: TransformationLoadOptions = {},
) {
  let rows: any[] = [];
  if (options.weighbridgeScope) {
    const historyLimit = Math.max(1, Math.min(50, Number(options.historyLimit || 10)));
    const [openResult, historyResult] = await Promise.all([
      supabase
        .from("batch_transformations")
        .select(WEIGHBRIDGE_TRANSFORMATION_COLUMNS)
        .eq("company_id", companyId)
        .not("status", "in", "(voided,completed)")
        .or("processing_state.is.null,processing_state.neq.processing_closed")
        .order("created_at", { ascending: false }),
      supabase
        .from("batch_transformations")
        .select(WEIGHBRIDGE_TRANSFORMATION_COLUMNS)
        .eq("company_id", companyId)
        .or("status.eq.voided,status.eq.completed,processing_state.eq.processing_closed")
        .order("created_at", { ascending: false })
        .limit(historyLimit),
    ]);
    if (openResult.error) throw openResult.error;
    if (historyResult.error) throw historyResult.error;
    const byId = new Map<string, any>();
    for (const row of [
      ...((openResult.data || []) as unknown as any[]),
      ...((historyResult.data || []) as unknown as any[]),
    ]) {
      byId.set(String(row.id), row);
    }
    rows = Array.from(byId.values()).sort((left, right) =>
      String(right.created_at || "").localeCompare(String(left.created_at || ""))
    );
  } else {
    const { data: transformations, error } = await supabase
      .from("batch_transformations")
      .select(WEIGHBRIDGE_TRANSFORMATION_COLUMNS)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    rows = (transformations || []) as unknown as any[];
  }
  const ids = rows.map((row: any) => String(row.id));
  const sourceTicketIds = rows.map((row: any) => String(row.source_ticket_id || "")).filter(Boolean);
  const nodeIds = Array.from(new Set(
    rows.map((row: any) => String(row.processing_node_id || "")).filter(Boolean),
  ));
  const actorIds = Array.from(new Set(rows.flatMap((row: any) => [
    String(row.completed_by || ""),
    String(row.closed_by || ""),
  ]).filter(Boolean)));

  const [inputsRes, outputsRes, nodesRes, ticketsRes, lossesRes, actorsRes] = await Promise.all([
    ids.length
      ? supabase.from("batch_transformation_inputs").select("transformation_id,batch_id,input_weight_kg,moisture_percent,warehouse_from_id,source_ticket_id").eq("company_id", companyId).in("transformation_id", ids)
      : Promise.resolve({ data: [] as any[], error: null }),
    ids.length
      ? supabase.from("batch_transformation_outputs").select("transformation_id,line_type,output_type,batch_class,output_weight_kg,moisture_percent,output_role,physical_state,warehouse_to_id,output_batch_id,source_ticket_id").eq("company_id", companyId).in("transformation_id", ids)
      : Promise.resolve({ data: [] as any[], error: null }),
    nodeIds.length
      ? supabase.from("processing_nodes").select("id,name,type,linked_warehouse_id").eq("company_id", companyId).in("id", nodeIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    sourceTicketIds.length
      ? supabase
          .from("tickets")
          .select("id,ticket_no,field_id,net_weight_kg,created_at,processing_node_id,lines:ticket_lines(product_name_snapshot)")
          .eq("company_id", companyId)
          .in("id", sourceTicketIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    ids.length
      ? supabase.from("batch_transformation_losses").select("transformation_id,loss_type,qty_kg,approved_by,approved_at").eq("company_id", companyId).in("transformation_id", ids)
      : Promise.resolve({ data: [] as any[], error: null }),
    actorIds.length
      ? supabase.from("profiles").select("id,full_name,email").in("id", actorIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (inputsRes.error) throw inputsRes.error;
  if (outputsRes.error) throw outputsRes.error;
  if (nodesRes.error) throw nodesRes.error;
  if (ticketsRes.error) throw ticketsRes.error;
  if (lossesRes.error) throw lossesRes.error;
  if (actorsRes.error) throw actorsRes.error;

  const inputs = inputsRes.data || [];
  const rawOutputs = outputsRes.data || [];
  const outputTicketIds = Array.from(new Set(
    rawOutputs.map((row: any) => String(row.source_ticket_id || "")).filter(Boolean),
  ));
  const outputTicketsRes = outputTicketIds.length
    ? await supabase.from("tickets").select("id,status,is_voided").eq("company_id", companyId).in("id", outputTicketIds)
    : { data: [] as any[], error: null };
  if (outputTicketsRes.error) throw outputTicketsRes.error;
  const activeOutputTicketIds = new Set((outputTicketsRes.data || [])
    .filter((ticket: any) => !ticket.is_voided && String(ticket.status || "") !== "voided")
    .map((ticket: any) => String(ticket.id)));
  const outputs = rawOutputs.filter((output: any) => !output.source_ticket_id
    || activeOutputTicketIds.has(String(output.source_ticket_id)));
  const batchIds = Array.from(new Set([
    ...inputs.map((row: any) => String(row.batch_id || "")).filter(Boolean),
    ...outputs.map((row: any) => String(row.output_batch_id || "")).filter(Boolean),
  ]));
  const warehouseIds = Array.from(new Set([
    ...inputs.map((row: any) => String(row.warehouse_from_id || "")).filter(Boolean),
    ...outputs.map((row: any) => String(row.warehouse_to_id || "")).filter(Boolean),
    ...rows.map((row: any) => String(row.node_warehouse_id || "")).filter(Boolean),
  ]));
  const fieldIds = Array.from(new Set((ticketsRes.data || []).map((row: any) => String(row.field_id || "")).filter(Boolean)));

  const [batchesRes, warehousesRes, fieldsRes] = await Promise.all([
    batchIds.length
      ? supabase
          .from("inventory_batches")
          .select("id,batch_code,batch_class,product_id,crop_id,variety_id,reproduction_id,composition_hash,composition_snapshot,is_mixed_harvest,product:product_id(name,name_ru),crop:crop_id(name,name_ru,slug,category,crop_category,subcategory,crop_subcategory),variety:variety_id(name,name_ru),reproduction:reproduction_id(name,name_ru)")
          .eq("company_id", companyId)
          .in("id", batchIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    warehouseIds.length
      ? supabase.from("warehouses").select("id,name,place_type").eq("company_id", companyId).in("id", warehouseIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    fieldIds.length
      ? supabase.from("fields").select("id,name").eq("company_id", companyId).in("id", fieldIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (batchesRes.error) throw batchesRes.error;
  if (warehousesRes.error) throw warehousesRes.error;
  if (fieldsRes.error) throw fieldsRes.error;

  const inputByTransformation = new Map<string, any[]>();
  for (const input of inputs) {
    const key = String(input.transformation_id);
    inputByTransformation.set(key, [...(inputByTransformation.get(key) || []), input]);
  }
  const outputByTransformation = new Map<string, any[]>();
  for (const output of outputs) {
    const key = String(output.transformation_id);
    outputByTransformation.set(key, [...(outputByTransformation.get(key) || []), output]);
  }
  const lossesByTransformation = new Map<string, any[]>();
  for (const loss of lossesRes.data || []) {
    const key = String((loss as any).transformation_id);
    lossesByTransformation.set(key, [...(lossesByTransformation.get(key) || []), loss]);
  }

  const batchMap = new Map((batchesRes.data || []).map((row: any) => [String(row.id), row]));
  const warehouseMap = new Map((warehousesRes.data || []).map((row: any) => [String(row.id), row]));
  const fieldMap = new Map((fieldsRes.data || []).map((row: any) => [String(row.id), nameOf(row)]));
  const nodeMap = new Map((nodesRes.data || []).map((row: any) => [String(row.id), row]));
  const ticketMap = new Map((ticketsRes.data || []).map((row: any) => [String(row.id), row]));
  const actorMap = new Map((actorsRes.data || []).map((row: any) => [String(row.id), nameOf(row, String(row.email || "Пользователь"))]));

  const items = rows.map((row: any) => {
    const transformationInputs = inputByTransformation.get(String(row.id)) || [];
    const transformationOutputs = outputByTransformation.get(String(row.id)) || [];
    const transformationLosses = lossesByTransformation.get(String(row.id)) || [];
    const firstInput = transformationInputs[0];
    const inputBatch = firstInput ? batchMap.get(String(firstInput.batch_id)) : null;
    const ticket = row.source_ticket_id ? ticketMap.get(String(row.source_ticket_id)) : null;
    const node = row.processing_node_id ? nodeMap.get(String(row.processing_node_id)) : null;
    const inputTotalKg = transformationInputs.reduce((sum: number, input: any) => sum + Number(input.input_weight_kg || 0), 0);
    const outputTypeOf = (output: any) => String(output.output_type || (
      output.line_type === "process_loss" ? "process_loss" :
      output.line_type === "shrink_loss" ? "moisture_loss" :
      String(output.batch_class || "") === "waste" ? "stock_waste" :
      ["forage_fraction", "potato_small"].includes(String(output.line_type || "")) ? "byproduct" : "main_product"
    ));
    const outputSum = (types: string[]) => transformationOutputs
      .filter((output: any) => types.includes(outputTypeOf(output)))
      .reduce((sum: number, output: any) => sum + Number(output.output_weight_kg || 0), 0);
    const mainOutputKg = outputSum(["main_product"]);
    const byproductKg = outputSum(["byproduct"]);
    const stockWasteKg = outputSum(["stock_waste"]);
    const approvedProcessLossKg = transformationLosses
      .filter((loss: any) => loss.loss_type !== "moisture_loss" && loss.approved_by && loss.approved_at)
      .reduce((sum: number, loss: any) => sum + Number(loss.qty_kg || 0), 0);
    const weightedMoisture = (massRows: any[], allowedOutputTypes?: string[]) => {
      const measuredRows = massRows.filter((massRow: any) => {
        if (allowedOutputTypes && !allowedOutputTypes.includes(outputTypeOf(massRow))) return false;
        return massRow.moisture_percent != null && Number(massRow.input_weight_kg ?? massRow.output_weight_kg ?? 0) > 0;
      });
      const coverageKg = measuredRows.reduce(
        (sum: number, massRow: any) => sum + Number(massRow.input_weight_kg ?? massRow.output_weight_kg ?? 0),
        0
      );
      if (coverageKg <= 0) return { percent: null as number | null, coverageKg: 0 };
      const weightedTotal = measuredRows.reduce(
        (sum: number, massRow: any) => sum
          + Number(massRow.input_weight_kg ?? massRow.output_weight_kg ?? 0) * Number(massRow.moisture_percent),
        0
      );
      return { percent: weightedTotal / coverageKg, coverageKg };
    };
    const inputMoisture = weightedMoisture(transformationInputs);
    const outputMoisture = weightedMoisture(transformationOutputs, ["main_product", "byproduct", "stock_waste"]);
    const isDrying = String(row.transformation_type || "") === "drying"
      || ["MECHANICAL_DRYING", "NATURAL_DRYING"].includes(String(row.processing_method || ""));
    let moistureLossKg = Number(row.expected_water_loss_kg || 0);
    let theoreticalOutputKg: number | null = null;
    if (
      isDrying
      && inputMoisture.percent != null
      && outputMoisture.percent != null
      && outputMoisture.percent < 100
    ) {
      const dryMatterKg = inputTotalKg * (1 - inputMoisture.percent / 100);
      theoreticalOutputKg = dryMatterKg / (1 - outputMoisture.percent / 100);
      moistureLossKg = Math.max(inputTotalKg - theoreticalOutputKg, 0);
    }
    const actualShrinkKg = inputTotalKg - mainOutputKg - byproductKg - stockWasteKg - approvedProcessLossKg;
    const balanceDeltaKg = Number((
      inputTotalKg - mainOutputKg - byproductKg - stockWasteKg - approvedProcessLossKg - moistureLossKg
    ).toFixed(3));
    const balanceTolerance = processingBalanceTolerance(inputTotalKg, isDrying);
    const unallocatedKg = Math.max(balanceDeltaKg, 0);
    const identityLabel = [
      nameOf(inputBatch?.crop || inputBatch?.product, "Сырьё"),
      nameOf(inputBatch?.variety, ""),
      nameOf(inputBatch?.reproduction, ""),
    ].filter(Boolean).join(" · ");
    const processingEligible = canUseGrainProcessing({
      cropSlug: inputBatch?.crop?.slug,
      cropName: inputBatch?.crop?.name_ru || inputBatch?.crop?.name,
      categorySlug: inputBatch?.crop?.category,
      categoryName: inputBatch?.crop?.crop_category,
      subcategory: inputBatch?.crop?.subcategory || inputBatch?.crop?.crop_subcategory,
    });
    const processingState = String(row.processing_state || (row.status === "completed" ? "processing_closed" : "in_processing"));
    return {
      id: String(row.id),
      record_type: "transformation",
      company_id: String(row.company_id),
      transformation_type: String(row.transformation_type),
      processing_method: row.processing_method ? String(row.processing_method) : null,
      status: String(row.status),
      queue_status: processingState === "processing_closed" ? "completed" : row.status === "voided" ? "voided" : "in_progress",
      processing_state: processingState,
      processing_node_id: row.processing_node_id ? String(row.processing_node_id) : null,
      node_warehouse_id: row.node_warehouse_id ? String(row.node_warehouse_id) : null,
      harvest_lot_id: row.harvest_lot_id ? String(row.harvest_lot_id) : null,
      product_id: inputBatch?.product_id ? String(inputBatch.product_id) : null,
      crop_id: inputBatch?.crop_id ? String(inputBatch.crop_id) : null,
      variety_id: inputBatch?.variety_id ? String(inputBatch.variety_id) : null,
      reproduction_id: inputBatch?.reproduction_id ? String(inputBatch.reproduction_id) : null,
      composition_hash: inputBatch?.composition_hash ? String(inputBatch.composition_hash) : null,
      composition_snapshot: Array.isArray(inputBatch?.composition_snapshot) ? inputBatch.composition_snapshot : [],
      is_mixed_harvest: Boolean(inputBatch?.is_mixed_harvest),
      processing_eligible: processingEligible,
      node_place_type: row.node_warehouse_id
        ? String((warehouseMap.get(String(row.node_warehouse_id)) as any)?.place_type || "WAREHOUSE").toUpperCase()
        : null,
      processing_node_name: node
        ? nameOf(node)
        : row.node_warehouse_id
          ? nameOf(warehouseMap.get(String(row.node_warehouse_id)), "Место обработки")
          : null,
      source_ticket_id: row.source_ticket_id ? String(row.source_ticket_id) : null,
      ticket_no: ticket?.ticket_no ? String(ticket.ticket_no) : null,
      field_name: ticket?.field_id ? fieldMap.get(String(ticket.field_id)) || null : null,
      crop_name: String(ticket?.lines?.[0]?.product_name_snapshot || inputBatch?.crop?.name_ru || inputBatch?.crop?.name || "Сырьё"),
      started_at: row.started_at || null,
      completed_at: row.completed_at || null,
      created_at: row.created_at,
      note: row.note || null,
      input_label: inputBatch ? batchLabel(inputBatch) : "Партия",
      input_weight_kg: inputTotalKg || Number(ticket?.net_weight_kg || 0),
      input_total_kg: inputTotalKg,
      identity_label: identityLabel,
      main_output_kg: mainOutputKg,
      byproduct_kg: byproductKg,
      stock_waste_kg: stockWasteKg,
      approved_process_loss_kg: approvedProcessLossKg,
      moisture_loss_kg: moistureLossKg,
      theoretical_output_kg: theoreticalOutputKg,
      actual_shrink_kg: actualShrinkKg,
      moisture_deviation_kg: balanceDeltaKg,
      balance_delta_kg: balanceDeltaKg,
      balance_tolerance_kg: balanceTolerance.toleranceKg,
      balance_absolute_tolerance_kg: balanceTolerance.absoluteToleranceKg,
      balance_relative_tolerance_percent: balanceTolerance.relativeTolerancePercent,
      balance_relative_tolerance_kg: balanceTolerance.relativeToleranceKg,
      balance_within_tolerance: Math.abs(balanceDeltaKg) <= balanceTolerance.toleranceKg,
      unallocated_kg: unallocatedKg,
      input_moisture_percent: inputMoisture.percent,
      output_moisture_percent: outputMoisture.percent,
      input_moisture_coverage_kg: inputMoisture.coverageKg,
      output_moisture_coverage_kg: outputMoisture.coverageKg,
      finish_requested_at: row.finish_requested_at || null,
      last_main_output_marked_at: row.last_main_output_marked_at || null,
      completed_by_name: row.completed_by ? actorMap.get(String(row.completed_by)) || null : null,
      closed_by_name: row.closed_by ? actorMap.get(String(row.closed_by)) || null : null,
      source_warehouse_name: firstInput?.warehouse_from_id
        ? nameOf(warehouseMap.get(String(firstInput.warehouse_from_id)), "Склад")
        : null,
      outputs: transformationOutputs.map((output: any) => ({
        line_type: String(output.line_type),
        output_type: outputTypeOf(output),
        output_role: output.output_role ? String(output.output_role) : null,
        physical_state: output.physical_state ? String(output.physical_state) : null,
        batch_class: String(output.batch_class || ""),
        warehouse_to_name: output.warehouse_to_id
          ? nameOf(warehouseMap.get(String(output.warehouse_to_id)), "Место назначения")
          : null,
        output_weight_kg: Number(output.output_weight_kg || 0),
      })),
    };
  });
  const usedTicketIds = new Set([
    ...rows.map((row: any) => String(row.source_ticket_id || "")),
    ...inputs.map((row: any) => String(row.source_ticket_id || "")),
  ].filter(Boolean));
  return { items, usedTicketIds };
}

async function loadWaitingTickets(supabase: SupabaseClient, companyId: string, usedTicketIds: Set<string>) {
  const { data: tickets, error } = await supabase
    .from("tickets")
    .select("id,ticket_no,field_id,net_weight_kg,created_at,processing_node_id,batch_id,warehouse_to_id,lines:ticket_lines(product_name_snapshot)")
    .eq("company_id", companyId)
    .eq("op_type", "harvest_incoming")
    .in("destination_kind", ["warehouse", "processing_node"])
    .eq("is_finalized", true)
    .eq("is_voided", false)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = (tickets || []).filter((row: any) => !usedTicketIds.has(String(row.id)));
  const fieldIds = Array.from(new Set(rows.map((row: any) => String(row.field_id || "")).filter(Boolean)));
  const nodeIds = Array.from(new Set(rows.map((row: any) => String(row.processing_node_id || "")).filter(Boolean)));
  const warehouseIds = Array.from(new Set(rows.map((row: any) => String(row.warehouse_to_id || "")).filter(Boolean)));
  const [fieldsRes, nodesRes, warehousesRes] = await Promise.all([
    fieldIds.length
      ? supabase.from("fields").select("id,name").eq("company_id", companyId).in("id", fieldIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    nodeIds.length
      ? supabase.from("processing_nodes").select("id,name").eq("company_id", companyId).in("id", nodeIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    warehouseIds.length
      ? supabase.from("warehouses").select("id,place_type").eq("company_id", companyId).in("id", warehouseIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (fieldsRes.error) throw fieldsRes.error;
  if (nodesRes.error) throw nodesRes.error;
  if (warehousesRes.error) throw warehousesRes.error;
  const fieldMap = new Map((fieldsRes.data || []).map((row: any) => [String(row.id), nameOf(row)]));
  const nodeMap = new Map((nodesRes.data || []).map((row: any) => [String(row.id), nameOf(row)]));
  const warehousePlaceTypeById = new Map(
    (warehousesRes.data || []).map((row: any) => [
      String(row.id),
      String(row.place_type || "").toUpperCase(),
    ]),
  );
  const transformationTypeByWarehouse = new Map(
    Array.from(warehousePlaceTypeById.entries()).map(([warehouseId, placeType]) => {
      const transformationType = placeType === "CLEANER"
        ? "cleaning"
        : placeType === "DRYER"
          ? "drying"
          : undefined;
      return [warehouseId, transformationType] as const;
    }),
  );

  return rows
    .filter((ticket: any) => {
      const placeType = warehousePlaceTypeById.get(String(ticket.warehouse_to_id));
      return placeType === "CLEANER" || placeType === "DRYER";
    })
    .map((ticket: any) => ({
    id: `ticket:${ticket.id}`,
    record_type: "waiting_ticket",
    company_id: companyId,
    transformation_type: transformationTypeByWarehouse.get(String(ticket.warehouse_to_id)),
    status: "waiting",
    queue_status: "waiting",
    processing_node_id: ticket.processing_node_id ? String(ticket.processing_node_id) : null,
    processing_node_name: ticket.processing_node_id
      ? nodeMap.get(String(ticket.processing_node_id)) || null
      : null,
    source_ticket_id: String(ticket.id),
    ticket_no: String(ticket.ticket_no),
    field_name: fieldMap.get(String(ticket.field_id)) || null,
    crop_name: String(ticket.lines?.[0]?.product_name_snapshot || "Сырьё"),
    started_at: null,
    completed_at: null,
    created_at: ticket.created_at,
    note: null,
    input_label: String(ticket.lines?.[0]?.product_name_snapshot || "Сырьё"),
    input_weight_kg: Number(ticket.net_weight_kg || 0),
    source_warehouse_name: null,
    outputs: [],
    }));
}

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });
    const weighbridgeScope = request.nextUrl.searchParams.get("scope") === "weighbridge";
    const requestedHistoryLimit = Number(request.nextUrl.searchParams.get("historyLimit") || 10);
    const historyLimit = Number.isFinite(requestedHistoryLimit)
      ? Math.max(1, Math.min(50, Math.floor(requestedHistoryLimit)))
      : 10;
    const { items, usedTicketIds } = await loadTransformationItems(supabase, companyId, {
      weighbridgeScope,
      historyLimit,
    });
    const waiting = weighbridgeScope
      ? []
      : await loadWaitingTickets(supabase, companyId, usedTicketIds);
    return NextResponse.json({ items: [...waiting, ...items] });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
    });
    const sourceTicketId = String(body.source_ticket_id || "").trim() || null;
    if (body.outputs != null && !Array.isArray(body.outputs)) {
      return NextResponse.json({ error: "Некорректный формат выходов обработки." }, { status: 400 });
    }
    const outputs = (Array.isArray(body.outputs) ? body.outputs : []).map((output: any) => ({
      line_type: output?.line_type,
      batch_class: output?.batch_class,
      warehouse_to_id: output?.warehouse_to_id ? String(output.warehouse_to_id) : null,
      output_weight_kg: output?.output_weight_kg,
    }));
    if (outputs.length === 0 && !sourceTicketId) {
      return NextResponse.json({ error: "Укажите выход готового продукта и/или потери." }, { status: 400 });
    }
    const input = body.input && typeof body.input === "object" ? body.input : {};
    const selectedHarvestLotId = String(input.harvest_lot_id || "").trim() || null;
    const sourcePhysicalState = String(input.source_physical_state || "SOURCE").trim() || "SOURCE";
    const processingNodeId = body.processing_node_id ? String(body.processing_node_id) : null;
    const { data, error } = await supabase.rpc("create_processing_transformation_atomic_v1", {
      p_actor_user_id: actor.id,
      p_company_id: companyId,
      p_transformation_type: String(body.transformation_type || "cleaning"),
      p_processing_node_id: processingNodeId,
      p_source_ticket_id: sourceTicketId,
      p_note: body.note == null ? null : String(body.note),
      p_input: {
        batch_id: input.batch_id ? String(input.batch_id) : null,
        harvest_lot_id: selectedHarvestLotId,
        source_physical_state: sourcePhysicalState,
        warehouse_from_id: input.warehouse_from_id ? String(input.warehouse_from_id) : null,
        input_weight_kg: input.input_weight_kg,
      },
      p_outputs: outputs,
      p_input_quality_json: body.input_quality_json || {},
    });
    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "23505" ? 409 : 400;
      return NextResponse.json({ error: error.message || "Не удалось начать переработку." }, { status });
    }
    const result = (data || {}) as Record<string, unknown>;
    if (!result.id) {
      return NextResponse.json({ error: "Не удалось начать переработку." }, { status: 500 });
    }
    return NextResponse.json({
      id: String(result.id),
      ...(result.idempotent_replay ? { idempotent_replay: true } : {}),
    });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
