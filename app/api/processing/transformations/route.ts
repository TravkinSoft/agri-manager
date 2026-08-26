import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  WEIGHBRIDGE_READ_ROLES,
  WEIGHBRIDGE_WRITE_ROLES,
  asSessionErrorResponse,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";
import { isHarvestWarehouseType } from "@/lib/warehouse/warehouse-scope";

const STORED_OUTPUT_TYPES = new Set([
  "cleaned_seed",
  "commodity",
  "forage_fraction",
  "treated_seed",
  "calibrated_fraction",
  "packaged",
  "reclassified",
  "potato_marketable",
  "potato_seed",
  "potato_small",
  "other",
]);

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

async function loadTransformationItems(supabase: SupabaseClient, companyId: string) {
  const { data: transformations, error } = await supabase
    .from("batch_transformations")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = transformations || [];
  const ids = rows.map((row: any) => String(row.id));
  const sourceTicketIds = rows.map((row: any) => String(row.source_ticket_id || "")).filter(Boolean);
  const actorIds = Array.from(new Set(rows.flatMap((row: any) => [
    String(row.completed_by || ""),
    String(row.closed_by || ""),
  ]).filter(Boolean)));

  const [inputsRes, outputsRes, nodesRes, ticketsRes, lossesRes, actorsRes] = await Promise.all([
    ids.length
      ? supabase.from("batch_transformation_inputs").select("*").eq("company_id", companyId).in("transformation_id", ids)
      : Promise.resolve({ data: [] as any[], error: null }),
    ids.length
      ? supabase.from("batch_transformation_outputs").select("*").eq("company_id", companyId).in("transformation_id", ids)
      : Promise.resolve({ data: [] as any[], error: null }),
    supabase.from("processing_nodes").select("id,name,type,linked_warehouse_id").eq("company_id", companyId),
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
  const outputs = outputsRes.data || [];
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
          .select("id,batch_code,batch_class,product_id,crop_id,variety_id,reproduction_id,composition_hash,composition_snapshot,is_mixed_harvest,product:product_id(name,name_ru),crop:crop_id(name,name_ru),variety:variety_id(name,name_ru),reproduction:reproduction_id(name,name_ru)")
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

  return rows.map((row: any) => {
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
    const moistureLossKg = Number(row.expected_water_loss_kg || 0);
    const unallocatedKg = Math.max(inputTotalKg - mainOutputKg - byproductKg - stockWasteKg - approvedProcessLossKg - moistureLossKg, 0);
    const identityLabel = [
      nameOf(inputBatch?.crop || inputBatch?.product, "Сырьё"),
      nameOf(inputBatch?.variety, ""),
      nameOf(inputBatch?.reproduction, ""),
    ].filter(Boolean).join(" · ");
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
      unallocated_kg: unallocatedKg,
      input_moisture_percent: row.input_moisture_percent == null ? null : Number(row.input_moisture_percent),
      output_moisture_percent: row.output_moisture_percent == null ? null : Number(row.output_moisture_percent),
      input_moisture_coverage_kg: Number(row.input_moisture_coverage_kg || 0),
      output_moisture_coverage_kg: Number(row.output_moisture_coverage_kg || 0),
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
}

async function loadWaitingTickets(supabase: SupabaseClient, companyId: string, usedTicketIds: Set<string>) {
  const { data: tickets, error } = await supabase
    .from("tickets")
    .select("id,ticket_no,field_id,net_weight_kg,created_at,processing_node_id,batch_id,warehouse_to_id,lines:ticket_lines(product_name_snapshot)")
    .eq("company_id", companyId)
    .eq("op_type", "harvest_incoming")
    .eq("destination_kind", "processing_node")
    .eq("is_finalized", true)
    .eq("is_voided", false)
    .not("processing_node_id", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = (tickets || []).filter((row: any) => !usedTicketIds.has(String(row.id)));
  const fieldIds = Array.from(new Set(rows.map((row: any) => String(row.field_id || "")).filter(Boolean)));
  const nodeIds = Array.from(new Set(rows.map((row: any) => String(row.processing_node_id || "")).filter(Boolean)));
  const [fieldsRes, nodesRes] = await Promise.all([
    fieldIds.length
      ? supabase.from("fields").select("id,name").eq("company_id", companyId).in("id", fieldIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    nodeIds.length
      ? supabase.from("processing_nodes").select("id,name").eq("company_id", companyId).in("id", nodeIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (fieldsRes.error) throw fieldsRes.error;
  if (nodesRes.error) throw nodesRes.error;
  const fieldMap = new Map((fieldsRes.data || []).map((row: any) => [String(row.id), nameOf(row)]));
  const nodeMap = new Map((nodesRes.data || []).map((row: any) => [String(row.id), nameOf(row)]));

  return rows.map((ticket: any) => ({
    id: `ticket:${ticket.id}`,
    record_type: "waiting_ticket",
    company_id: companyId,
    transformation_type: "cleaning",
    status: "waiting",
    queue_status: "waiting",
    processing_node_id: String(ticket.processing_node_id),
    processing_node_name: nodeMap.get(String(ticket.processing_node_id)) || null,
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

async function validateOutputWarehouses(
  supabase: SupabaseClient,
  companyId: string,
  outputs: Array<{ line_type: string; warehouse_to_id: string | null; output_weight_kg: number }>
) {
  const ids = Array.from(new Set(outputs.map((row) => row.warehouse_to_id || "").filter(Boolean)));
  if (ids.length === 0) return;
  const { data, error } = await supabase
    .from("warehouses")
    .select("id,warehouse_type,archived,is_archived")
    .eq("company_id", companyId)
    .in("id", ids);
  if (error) throw error;
  const byId = new Map((data || []).map((row: any) => [String(row.id), row]));
  for (const id of ids) {
    const row: any = byId.get(id);
    if (!row || row.archived || row.is_archived || !isHarvestWarehouseType(row.warehouse_type)) {
      throw new Error("Склад результата недоступен для готовой продукции.");
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });
    const items = await loadTransformationItems(supabase, companyId);
    const usedTicketIds = new Set(items.map((row: any) => String(row.source_ticket_id || "")).filter(Boolean));
    const waiting = await loadWaitingTickets(supabase, companyId, usedTicketIds);
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
      requestedCompanyId: String(body.company_id || "").trim() || null,
    });
    const sourceTicketId = String(body.source_ticket_id || "").trim() || null;
    const outputs = (Array.isArray(body.outputs) ? body.outputs : [])
      .map((output: any) => ({
        line_type: String(output.line_type || "other"),
        batch_class: String(output.batch_class || "commodity"),
        warehouse_to_id: output.warehouse_to_id ? String(output.warehouse_to_id) : null,
        output_weight_kg: Number(output.output_weight_kg || 0),
      }))
      .filter((output: any) => output.output_weight_kg > 0);
    if (outputs.length === 0) {
      return NextResponse.json({ error: "Укажите выход готового продукта и/или потери." }, { status: 400 });
    }
    for (const output of outputs) {
      if (STORED_OUTPUT_TYPES.has(output.line_type) && !output.warehouse_to_id) {
        return NextResponse.json({ error: "Для готового продукта нужен склад назначения." }, { status: 400 });
      }
    }
    await validateOutputWarehouses(supabase, companyId, outputs);

    let input = body.input || {};
    let processingNodeId = body.processing_node_id ? String(body.processing_node_id) : null;
    if (sourceTicketId) {
      const { data: existing } = await supabase
        .from("batch_transformations")
        .select("id")
        .eq("company_id", companyId)
        .eq("source_ticket_id", sourceTicketId)
        .maybeSingle();
      if (existing?.id) return NextResponse.json({ id: String(existing.id), idempotent_replay: true });

      const { data: sourceTicket, error: sourceTicketError } = await supabase
        .from("tickets")
        .select("id,batch_id,warehouse_to_id,processing_node_id,net_weight_kg,status,is_finalized,is_voided,destination_kind")
        .eq("id", sourceTicketId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (
        sourceTicketError ||
        !sourceTicket?.id ||
        !sourceTicket.is_finalized ||
        sourceTicket.is_voided ||
        sourceTicket.destination_kind !== "processing_node" ||
        !sourceTicket.batch_id ||
        !sourceTicket.warehouse_to_id ||
        !sourceTicket.processing_node_id
      ) {
        return NextResponse.json({ error: "Исходный талон переработки недоступен или не закрыт." }, { status: 400 });
      }
      input = {
        batch_id: String(sourceTicket.batch_id),
        warehouse_from_id: String(sourceTicket.warehouse_to_id),
        input_weight_kg: Number(sourceTicket.net_weight_kg || 0),
      };
      processingNodeId = String(sourceTicket.processing_node_id);
    }

    const selectedHarvestLotId = String(input.harvest_lot_id || "").trim() || null;
    const sourcePhysicalState = String(input.source_physical_state || "SOURCE").trim() || "SOURCE";
    if ((!input.batch_id && !selectedHarvestLotId) || !input.warehouse_from_id || Number(input.input_weight_kg || 0) <= 0) {
      return NextResponse.json({ error: "Не определены партия, склад или масса сырья." }, { status: 400 });
    }

    const outputTotal = outputs.reduce((sum: number, row: any) => sum + Number(row.output_weight_kg || 0), 0);
    if (outputTotal > Number(input.input_weight_kg || 0) + 0.0001) {
      return NextResponse.json({ error: "Готовый продукт и потери не могут превышать массу сырья." }, { status: 400 });
    }

    const inputAllocations: Array<{ batch_id: string; input_weight_kg: number }> = [];
    if (selectedHarvestLotId) {
      const [{ data: lot, error: lotError }, { data: links, error: linksError }] = await Promise.all([
        supabase.from("harvest_lots").select("id").eq("id", selectedHarvestLotId).eq("company_id", companyId).eq("status", "active").maybeSingle(),
        supabase.from("harvest_lot_batches").select("inventory_batch_id").eq("company_id", companyId).eq("harvest_lot_id", selectedHarvestLotId),
      ]);
      const batchIds = Array.from(new Set((links || []).map((row: any) => String(row.inventory_batch_id || "")).filter(Boolean)));
      if (lotError || linksError || !lot?.id || !batchIds.length) {
        return NextResponse.json({ error: lotError?.message || linksError?.message || "Общая партия урожая не найдена." }, { status: 400 });
      }
      const [{ data: batches, error: batchesError }, { data: balances, error: balancesError }] = await Promise.all([
        supabase.from("inventory_batches").select("id,physical_state,received_at,created_at").eq("company_id", companyId).in("id", batchIds),
        supabase.from("v_stock_balance_identity").select("batch_id,quantity,uom").eq("company_id", companyId).eq("warehouse_id", input.warehouse_from_id).in("batch_id", batchIds).gt("quantity", 0),
      ]);
      if (batchesError || balancesError) {
        return NextResponse.json({ error: batchesError?.message || balancesError?.message || "Не удалось распределить сырьё." }, { status: 400 });
      }
      const balanceByBatch = new Map((balances || []).filter((row: any) => String(row.uom || "") === "kg").map((row: any) => [String(row.batch_id), Number(row.quantity || 0)]));
      const ordered = (batches || [])
        .filter((row: any) => String(row.physical_state || "SOURCE") === sourcePhysicalState && Number(balanceByBatch.get(String(row.id)) || 0) > 0)
        .sort((a: any, b: any) => String(a.received_at || a.created_at || "").localeCompare(String(b.received_at || b.created_at || "")) || String(a.id).localeCompare(String(b.id)));
      let remaining = Number(input.input_weight_kg || 0);
      for (const batch of ordered) {
        if (remaining <= 0.0001) break;
        const take = Math.min(remaining, Number(balanceByBatch.get(String(batch.id)) || 0));
        if (take > 0) inputAllocations.push({ batch_id: String(batch.id), input_weight_kg: take });
        remaining -= take;
      }
      if (remaining > 0.0001) {
        return NextResponse.json({ error: `Недостаточно остатка общей партии. Не хватает ${remaining.toFixed(3)} кг.` }, { status: 400 });
      }
    } else {
      const { data: batch, error: batchError } = await supabase
        .from("inventory_batches")
        .select("id,company_id")
        .eq("id", input.batch_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (batchError || !batch?.id) {
        return NextResponse.json({ error: "Входная партия не найдена." }, { status: 400 });
      }
      inputAllocations.push({ batch_id: String(batch.id), input_weight_kg: Number(input.input_weight_kg) });
    }

    const { data: transformation, error: transformationError } = await supabase
      .from("batch_transformations")
      .insert({
        ...(sourceTicketId ? { id: sourceTicketId } : {}),
        company_id: companyId,
        processing_node_id: processingNodeId,
        transformation_type: String(body.transformation_type || "cleaning"),
        status: "draft",
        source_ticket_id: sourceTicketId,
        harvest_lot_id: selectedHarvestLotId,
        source_physical_state: selectedHarvestLotId ? sourcePhysicalState : null,
        started_at: new Date().toISOString(),
        created_by: actor.id,
        note: body.note || null,
      })
      .select("id")
      .single();
    if (transformationError || !transformation?.id) {
      if (sourceTicketId && String((transformationError as any)?.code || "") === "23505") {
        const { data: racedTransformation } = await supabase
          .from("batch_transformations")
          .select("id")
          .eq("company_id", companyId)
          .eq("source_ticket_id", sourceTicketId)
          .maybeSingle();
        if (racedTransformation?.id) {
          return NextResponse.json({ id: String(racedTransformation.id), idempotent_replay: true });
        }
      }
      return NextResponse.json({ error: transformationError?.message || "Не удалось начать переработку." }, { status: 400 });
    }

    const cleanup = async () => {
      await supabase.from("batch_transformations").delete().eq("id", transformation.id).eq("company_id", companyId);
    };
    const { error: inputError } = await supabase.from("batch_transformation_inputs").insert(
      inputAllocations.map((allocation) => ({
        company_id: companyId,
        transformation_id: transformation.id,
        batch_id: allocation.batch_id,
        warehouse_from_id: input.warehouse_from_id,
        input_weight_kg: allocation.input_weight_kg,
        input_quality_json: body.input_quality_json || {},
      }))
    );
    if (inputError) {
      await cleanup();
      return NextResponse.json({ error: inputError.message }, { status: 400 });
    }
    const { error: outputsError } = await supabase.from("batch_transformation_outputs").insert(
      outputs.map((output: any) => ({
        company_id: companyId,
        transformation_id: transformation.id,
        warehouse_to_id: output.warehouse_to_id,
        line_type: output.line_type,
        output_weight_kg: output.output_weight_kg,
        output_quality_json: {},
        batch_class: output.batch_class,
      }))
    );
    if (outputsError) {
      await cleanup();
      return NextResponse.json({ error: outputsError.message }, { status: 400 });
    }

    if (sourceTicketId) {
      const { error: linkError } = await supabase
        .from("tickets")
        .update({ linked_processing_id: transformation.id })
        .eq("id", sourceTicketId)
        .eq("company_id", companyId);
      if (linkError) {
        await cleanup();
        return NextResponse.json({ error: linkError.message }, { status: 400 });
      }
    }
    return NextResponse.json({ id: String(transformation.id) });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
