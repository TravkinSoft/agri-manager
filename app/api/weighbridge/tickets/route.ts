import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WEIGHBRIDGE_READ_ROLES, WEIGHBRIDGE_WRITE_ROLES, asSessionErrorResponse, requireWeighbridgeOperatorSession, resolveWeighbridgeSession, weighbridgeUserError } from "@/app/api/weighbridge/_auth";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import type { TicketInput, TicketLineInput, WeighingInput } from "@/lib/types/weighbridge";
import { resolveWarehouseStockContract } from "@/lib/server/warehouse-stock-contract";
import type { StockBusinessEvent } from "@/lib/warehouse/stock-unit-contract";
import { resolveHarvestTicketContext } from "@/lib/server/harvest-ticket-context";
import { ensureHarvestProductIdentity } from "@/lib/server/harvest-product-identity";
import { isHarvestWarehouseType } from "@/lib/warehouse/warehouse-scope";
import { isWeighedSupplierProduct } from "@/lib/weighbridge/product-rules";
import { parseStrictWeightKg } from "@/lib/weighbridge/weight-input";
import { isWeighbridgePersonnelRole } from "@/lib/weighbridge/personnel";
import { isCargoTractor, isCargoVehicle, isTrailerTransport } from "@/lib/weighbridge/transport";
import { enrichTicketOperatorAttribution } from "@/lib/server/weighbridge-ticket-attribution";

function buildTicketNo(companyId: string): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const entropy = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `WB-${companyId.slice(0, 6).toUpperCase()}-${stamp}-${entropy}`;
}

const sameNullable = (a: unknown, b: unknown) => String(a || "") === String(b || "");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function cleanupCreatedHarvestProduct(supabase: SupabaseClient, productId: string | null) {
  if (!productId) return;
  await supabase
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("is_derived_inventory", true)
    .like("derived_identity_key", "harvest-crop-v1:%");
}

async function cleanupCreatedTicket(
  supabase: SupabaseClient,
  ticketId: string,
  createdHarvestProductId: string | null = null
) {
  await supabase.from("ticket_weighings").delete().eq("ticket_id", ticketId);
  await supabase.from("ticket_lines").delete().eq("ticket_id", ticketId);
  await supabase.from("tickets").delete().eq("id", ticketId);
  await cleanupCreatedHarvestProduct(supabase, createdHarvestProductId);
}

async function resolveActiveSeasonId(
  supabase: SupabaseClient,
  companyId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("seasons")
    .select("id,year")
    .eq("company_id", companyId)
    .eq("archived", false)
    .order("year", { ascending: false });
  if (error) throw error;
  const nowYear = new Date().getFullYear();
  const rows = data || [];
  const current = rows.find((x: any) => Number(x.year) === nowYear);
  return String(current?.id || rows[0]?.id || "");
}

async function resolveActiveShiftId(
  supabase: SupabaseClient,
  companyId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("weighbridge_shifts")
    .select("id,status")
    .eq("company_id", companyId)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (String(error.message || "").toLowerCase().includes("weighbridge_shifts")) return null;
    throw error;
  }
  return String(data?.id || "");
}

const WEIGHBRIDGE_TICKET_SELECT = `
  *,
  lines:ticket_lines(
    id,
    product_id,
    quantity,
    uom,
    warehouse_from_id,
    warehouse_to_id,
    unit_price,
    amount,
    moisture_percent,
    notes,
    product_name_snapshot,
    variety_id,
    variety_name_snapshot,
    reproduction_id,
    reproduction_name_snapshot,
    batch_class,
    batch_id,
    operation_line_id,
    lot_id,
    composition_snapshot,
    composition_hash,
    is_mixed_harvest,
    products:product_id(name,trade_name,normalized_name),
    varieties:variety_id(name),
    reproductions:reproduction_id(name,name_ru,name_kz,name_en,code)
  )
`;

export async function GET(request: NextRequest) {
  try {
    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });
    const workspace = request.nextUrl.searchParams.get("workspace") === "true";
    const view = request.nextUrl.searchParams.get("view");
    const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 0);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 60, 1), 100);
    let data: any[] | null = null;
    let error: any = null;
    if (workspace) {
      const [openResult, recentResult] = await Promise.all([
        supabase
          .from("tickets")
          .select(WEIGHBRIDGE_TICKET_SELECT)
          .eq("company_id", companyId)
          .in("status", ["draft", "active", "ready_to_close"])
          .order("created_at", { ascending: true })
          .limit(100),
        supabase
          .from("tickets")
          .select(WEIGHBRIDGE_TICKET_SELECT)
          .eq("company_id", companyId)
          .in("status", ["finalized", "voided"])
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      error = openResult.error || recentResult.error;
      data = [...(openResult.data || []), ...(recentResult.data || [])];
    } else {
      let query = supabase
        .from("tickets")
        .select(WEIGHBRIDGE_TICKET_SELECT)
        .eq("company_id", companyId);
      if (view === "open") {
        query = query.eq("op_type", "harvest_incoming").in("status", ["draft", "active", "ready_to_close"]);
      } else if (view === "today") {
        const from = String(request.nextUrl.searchParams.get("from") || "").trim();
        query = query.eq("op_type", "harvest_incoming").eq("status", "finalized");
        if (from) query = query.gte("finalized_at", from);
      } else if (view === "history") {
        query = query.eq("op_type", "harvest_incoming");
      }
      const result = await query
        .order("created_at", { ascending: view === "open" })
        .limit(view ? limit : 200);
      data = result.data;
      error = result.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const fieldIds = Array.from(new Set((data || []).map((row: any) => String(row.field_id || "")).filter(Boolean)));
    const [{ data: company }, { data: fields, error: fieldsError }] = await Promise.all([
      supabase.from("companies").select("id,name").eq("id", companyId).maybeSingle(),
      fieldIds.length
        ? supabase.from("fields").select("id,name").eq("company_id", companyId).in("id", fieldIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (fieldsError) return NextResponse.json({ error: fieldsError.message }, { status: 400 });
    const companyName = String((company as any)?.name || "").trim() || null;
    const fieldById = new Map((fields || []).map((field: any) => [String(field.id), String(field.name || "")]));

    const tickets = (data || []).map((row: any) => ({
      ...row,
      company_name: companyName,
      field_name_snapshot: fieldById.get(String(row.field_id || "")) || null,
      lines: (row.lines || []).map((line: any) => ({
        id: String(line.id),
        product_id: String(line.product_id),
        quantity: Number(line.quantity || 0),
        uom: String(line.uom || "legacy/unknown"),
        warehouse_from_id: line.warehouse_from_id ? String(line.warehouse_from_id) : null,
        warehouse_to_id: line.warehouse_to_id ? String(line.warehouse_to_id) : null,
        unit_price: line.unit_price == null ? null : Number(line.unit_price),
        amount: line.amount == null ? null : Number(line.amount),
        moisture_percent: line.moisture_percent == null ? null : Number(line.moisture_percent),
        notes: line.notes ? String(line.notes) : null,
        product_name: String(line.product_name_snapshot || brandName(line.products) || "-"),
        variety_id: line.variety_id ? String(line.variety_id) : null,
        variety_name: String(line.variety_name_snapshot || brandName(line.varieties) || "-"),
        reproduction_id: line.reproduction_id ? String(line.reproduction_id) : null,
        reproduction_name: String(line.reproduction_name_snapshot || localizedName(line.reproductions, "ru", ["name", "code"]) || "-"),
        batch_class: line.batch_class ? String(line.batch_class) : null,
        batch_id: line.batch_id ? String(line.batch_id) : null,
        operation_line_id: line.operation_line_id ? String(line.operation_line_id) : null,
        lot_id: line.lot_id ? String(line.lot_id) : null,
        composition_snapshot: Array.isArray(line.composition_snapshot) ? line.composition_snapshot : [],
        composition_hash: line.composition_hash ? String(line.composition_hash) : null,
        is_mixed_harvest: Boolean(line.is_mixed_harvest),
      })),
    }));

    const attributedTickets = await enrichTicketOperatorAttribution(supabase, companyId, tickets, {
      includeTechnicalAudit: actor.role === "global_admin",
    });

    return NextResponse.json({ tickets: attributedTickets });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const timing = {
    authMs: 0,
    validationMs: 0,
    dbMs: 0,
    rpcMs: 0,
    totalMs: 0,
    steps: {} as Record<string, number>,
  };
  const measure = async <T,>(name: string, task: () => PromiseLike<T>): Promise<T> => {
    const stepStartedAt = Date.now();
    try {
      return await task();
    } finally {
      timing.steps[name] = Date.now() - stepStartedAt;
    }
  };
  try {
    const body = await request.json();
    const rawTicket = (body?.ticket || {}) as TicketInput;
    const authStartedAt = Date.now();
    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId: String(body?.companyId || rawTicket.company_id || "").trim() || null,
    });
    timing.authMs = Date.now() - authStartedAt;
    const validationStartedAt = Date.now();
    const ticket = {
      ...rawTicket,
      company_id: companyId,
      created_by: actor.id,
    } as TicketInput;
    const lines = (Array.isArray(body?.lines) ? body.lines : []) as TicketLineInput[];
    const weighings = (Array.isArray(body?.weighings) ? body.weighings : []) as WeighingInput[];
    if (rawTicket.gross_weight_kg != null) {
      const parsed = parseStrictWeightKg(rawTicket.gross_weight_kg, "Брутто");
      if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
      ticket.gross_weight_kg = parsed.value;
    }
    if (rawTicket.tare_weight_kg != null) {
      const parsed = parseStrictWeightKg(rawTicket.tare_weight_kg, "Тара");
      if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
      ticket.tare_weight_kg = parsed.value;
    }
    for (const weighing of weighings) {
      const parsed = parseStrictWeightKg((weighing as any).measured_weight_kg, "Вес");
      if (!parsed.ok || parsed.value <= 0) {
        return NextResponse.json({ error: parsed.ok ? "Вес должен быть больше нуля." : parsed.message }, { status: 400 });
      }
      weighing.measured_weight_kg = parsed.value;
    }
    const rawIdempotencyKey = String(request.headers.get("Idempotency-Key") || "").trim();
    if (rawIdempotencyKey && !UUID_RE.test(rawIdempotencyKey)) {
      return NextResponse.json({ error: "Idempotency-Key must be a UUID" }, { status: 400 });
    }
    const idempotencyKey = rawIdempotencyKey || null;
    const requestFingerprint = idempotencyKey
      ? createHash("sha256").update(JSON.stringify({ ticket: rawTicket, lines, weighings })).digest("hex")
      : null;

    if (idempotencyKey) {
      const { data: existingTicket, error: existingTicketError } = await measure("idempotency_lookup", () => supabase
        .from("tickets")
        .select("*")
        .eq("id", idempotencyKey)
        .eq("company_id", companyId)
        .maybeSingle());
      if (existingTicketError) {
        return NextResponse.json({ error: existingTicketError.message }, { status: 400 });
      }
      if (existingTicket?.id) {
        const existingFingerprint = String((existingTicket as any)?.audit_json?.request_fingerprint || "");
        if (existingFingerprint !== requestFingerprint) {
          return NextResponse.json({ error: "Idempotency-Key was already used with another ticket payload" }, { status: 409 });
        }
        return NextResponse.json({ ticket: existingTicket, idempotent_replay: true });
      }
    }

    if (!ticket.ticket_type || !ticket.op_type || !ticket.direction) {
      return NextResponse.json({ error: "ticket_type, op_type and direction are required" }, { status: 400 });
    }
    if (!ticket.source_kind || !ticket.destination_kind) {
      return NextResponse.json({ error: "source_kind and destination_kind are required" }, { status: 400 });
    }
    const isSupplierReceipt =
      String(ticket.direction || "") === "incoming" &&
      String(ticket.op_type || "").toLowerCase() === "supplier_receipt";
    const isWarehouseTransfer =
      String(ticket.direction || "") === "transfer" &&
      String(ticket.op_type || "").toLowerCase() === "warehouse_transfer";
    const isFieldIssue =
      String(ticket.direction || "") === "outgoing" &&
      String(ticket.op_type || "").toLowerCase() === "issue_to_field";
    const isShipment =
      String(ticket.direction || "") === "outgoing" &&
      String(ticket.op_type || "").toLowerCase() === "shipment_outbound";
    const isDisposal =
      String(ticket.direction || "") === "outgoing" &&
      String(ticket.op_type || "").toLowerCase() === "disposal";
    const isHarvestIncoming =
      String(ticket.direction || "") === "incoming" &&
      String(ticket.op_type || "").toLowerCase() === "harvest_incoming";
    let harvestIsCropMix = false;
    let harvestCompositionSnapshot: Array<Record<string, unknown>> = [];
    let harvestCompositionHash: string | null = null;
    let harvestCropForProduct: {
      id: string;
      name?: string | null;
      name_ru?: string | null;
      name_kz?: string | null;
      name_en?: string | null;
    } | null = null;
    let createdHarvestProductId: string | null = null;
    const isImpurityRemoval =
      String(ticket.direction || "") === "outgoing" &&
      String(ticket.op_type || "").toLowerCase() === "weighbridge_impurities";

    if (isHarvestIncoming) {
      if (!ticket.field_id || !ticket.crop_structure_allocation_id) {
        return NextResponse.json(
          { error: "Выберите поле и участок / культуру для прихода урожая." },
          { status: 400 }
        );
      }

      const destinationKind = String(ticket.destination_kind || "warehouse").trim().toLowerCase();
      const warehouseId = String(ticket.warehouse_to_id || ticket.destination_id || "").trim();
      const destinationWarehouseStartedAt = Date.now();
      const destinationWarehousePromise = destinationKind === "warehouse"
        ? Promise.resolve(supabase
            .from("warehouses")
            .select("id,company_id,warehouse_type,archived,is_archived")
            .eq("company_id", companyId)
            .eq("id", warehouseId)
            .maybeSingle()).finally(() => {
              timing.steps.destination_warehouse = Date.now() - destinationWarehouseStartedAt;
            })
        : Promise.resolve({ data: null, error: null } as any);
      const harvestContext = await measure("harvest_context", () => resolveHarvestTicketContext({
        supabase,
        companyId,
        fieldId: String(ticket.field_id),
        allocationId: String(ticket.crop_structure_allocation_id),
      }));
      if (harvestContext.status !== "ready") {
        return NextResponse.json({ error: harvestContext.message }, { status: 409 });
      }
      if (lines.length !== 1) {
        return NextResponse.json(
          { error: "Приход урожая должен содержать одну складскую номенклатуру." },
          { status: 400 }
        );
      }

      harvestIsCropMix = harvestContext.allocation?.landUseType === "crop_mix";
      if (harvestIsCropMix) {
        const { data: derivedProduct, error: derivedProductError } = await supabase.rpc(
          "ensure_crop_mix_inventory_product_v1",
          {
            p_company_id: companyId,
            p_actor_profile_id: actor.id,
            p_crop_structure_id: String(ticket.crop_structure_allocation_id),
          }
        );
        if (derivedProductError || !(derivedProduct as any)?.product_id) {
          return NextResponse.json(
            { error: derivedProductError?.message || "Не удалось создать складскую идентичность урожая зерносмеси." },
            { status: 400 }
          );
        }
        lines[0].product_id = String((derivedProduct as any).product_id);
        lines[0].crop_id = null;
        lines[0].variety_id = null;
        lines[0].reproduction_id = null;
        harvestCompositionSnapshot = Array.isArray((derivedProduct as any).composition_snapshot)
          ? (derivedProduct as any).composition_snapshot
          : [];
        harvestCompositionHash = String((derivedProduct as any).composition_hash || "") || null;
        (lines[0] as any).composition_snapshot = harvestCompositionSnapshot;
        (lines[0] as any).composition_hash = harvestCompositionHash;
        (lines[0] as any).is_mixed_harvest = true;
      } else {
        const { data: crop, error: cropError } = await measure("harvest_crop", () => supabase
          .from("crops")
          .select("id,name,name_ru,name_kz,name_en")
          .eq("id", harvestContext.allocation?.cropId || "")
          .maybeSingle());
        if (cropError || !crop?.id) {
          return NextResponse.json(
            { error: cropError?.message || "Не удалось подтвердить культуру урожая." },
            { status: 400 }
          );
        }
        harvestCropForProduct = {
          id: String(crop.id),
          name: crop.name,
          name_ru: crop.name_ru,
          name_kz: crop.name_kz,
          name_en: crop.name_en,
        };
      }

      ticket.season_id = harvestContext.seasonId;
      ticket.linked_operation_id = harvestContext.operationId || null;
      const identityReviewReasons = harvestIsCropMix
        ? []
        : [
            !harvestContext.allocation?.varietyId ? "missing_variety" : "",
            !harvestContext.allocation?.reproductionId ? "missing_reproduction" : "",
          ].filter(Boolean);
      ticket.requires_review = identityReviewReasons.length > 0;
      ticket.review_reason = identityReviewReasons.join(",") || null;
      ticket.audit_json = identityReviewReasons.length > 0
        ? {
            ...((ticket.audit_json || {}) as Record<string, unknown>),
            identity_review_reasons: identityReviewReasons,
            identity_backfill_allocation_id: String(ticket.crop_structure_allocation_id),
          }
        : ticket.audit_json || null;
      for (const line of lines) {
        line.operation_line_id = harvestContext.operationLineId || null;
        line.crop_id = harvestIsCropMix ? null : harvestContext.allocation?.cropId || null;
        line.variety_id = harvestIsCropMix ? null : harvestContext.allocation?.varietyId || null;
        line.reproduction_id = harvestIsCropMix ? null : harvestContext.allocation?.reproductionId || null;
      }

      if (destinationKind === "warehouse") {
        const { data: destinationWarehouse, error: destinationWarehouseError } = await destinationWarehousePromise;
        if (
          destinationWarehouseError ||
          !destinationWarehouse?.id ||
          destinationWarehouse.archived ||
          destinationWarehouse.is_archived ||
          !isHarvestWarehouseType(destinationWarehouse.warehouse_type)
        ) {
          return NextResponse.json(
            { error: "Выберите активный склад, разрешённый для приёма урожая." },
            { status: 400 }
          );
        }
        ticket.destination_kind = "warehouse";
        ticket.destination_id = String(destinationWarehouse.id);
        ticket.processing_node_id = null;
        ticket.warehouse_to_id = String(destinationWarehouse.id);
        for (const line of lines) {
          line.warehouse_to_id = String(destinationWarehouse.id);
        }
      } else {
        return NextResponse.json({ error: "Урожай можно направить только на склад." }, { status: 400 });
      }
    }
    const isDirectWarehouseTransfer =
      isWarehouseTransfer &&
      String(ticket.weigh_method || "").toLowerCase() === "manual_override_with_reason";
    const isDirectFieldIssue =
      isFieldIssue &&
      String(ticket.weigh_method || "").toLowerCase() === "manual_override_with_reason";
    const supplierReceiptMode = String((ticket as any).receipt_mode || "weighbridge");
    const isDirectSupplierReceipt = isSupplierReceipt && supplierReceiptMode === "direct";
    const operatorSession = isDirectWarehouseTransfer || isDirectFieldIssue || isDirectSupplierReceipt
      ? null
      : await requireWeighbridgeOperatorSession(request, { companyId, supabase });
    if (operatorSession) {
      (ticket as any).created_by_person_id = operatorSession.operator.id;
    }
    const requiresVehicle =
      isShipment ||
      isHarvestIncoming ||
      isImpurityRemoval ||
      (isWarehouseTransfer && !isDirectWarehouseTransfer) ||
      (isFieldIssue && !isDirectFieldIssue);
    const activeShiftStartedAt = Date.now();
    const activeShiftIdPromise = operatorSession?.shift?.id
      ? Promise.resolve<string | null>(operatorSession.shift.id)
      : isDirectSupplierReceipt
      ? Promise.resolve<string | null>(null)
        : resolveActiveShiftId(supabase, ticket.company_id).finally(() => {
          timing.steps.active_shift = Date.now() - activeShiftStartedAt;
        });
    const vehicleGuardStartedAt = Date.now();
    const transportAudit = ticket.audit_json?.transport as Record<string, unknown> | undefined;
    const requestedTrailerId = String(transportAudit?.trailer_id || "").trim() || null;
    const vehicleGuardPromise = ticket.vehicle_id
      ? Promise.all([
          supabase
            .from("reference_vehicles")
            .select("id,name,model,plate_number,type,fleet_type,status,is_active,archived,transport_model:transport_model_id(category,full_name)")
            .eq("company_id", ticket.company_id)
            .eq("id", ticket.vehicle_id)
            .maybeSingle(),
          supabase
            .from("reference_machines")
            .select("id,name,model,license_plate,type,status,is_active,archived")
            .eq("company_id", ticket.company_id)
            .eq("id", ticket.vehicle_id)
            .maybeSingle(),
          supabase
            .from("tickets")
            .select("id, ticket_no")
            .eq("company_id", ticket.company_id)
            .eq("vehicle_id", ticket.vehicle_id)
            .in("status", ["draft", "active", "ready_to_close"])
            .limit(1),
        ]).finally(() => {
          timing.steps.vehicle_guard = Date.now() - vehicleGuardStartedAt;
        })
      : null;
    const trailerGuardPromise = requestedTrailerId
      ? Promise.all([
          supabase
            .from("reference_vehicles")
            .select("id,name,model,plate_number,type,fleet_type,status,is_active,archived,transport_model:transport_model_id(category,full_name)")
            .eq("company_id", ticket.company_id)
            .eq("id", requestedTrailerId)
            .maybeSingle(),
          supabase
            .from("tickets")
            .select("id,ticket_no")
            .eq("company_id", ticket.company_id)
            .eq("audit_json->transport->>trailer_id", requestedTrailerId)
            .in("status", ["draft", "active", "ready_to_close"])
            .limit(1),
        ])
      : null;
    const driverGuardPromise = ticket.driver_id
      ? Promise.all([
          supabase
            .from("company_people")
            .select("id,company_id,role_type,status,deleted_at")
            .eq("id", ticket.driver_id)
            .eq("company_id", ticket.company_id)
            .eq("status", "active")
            .is("deleted_at", null)
            .maybeSingle(),
          supabase
            .from("tickets")
            .select("id,ticket_no,vehicle_id")
            .eq("company_id", ticket.company_id)
            .eq("driver_id", ticket.driver_id)
            .in("status", ["draft", "active", "ready_to_close"])
            .limit(1),
        ])
      : null;
    if (requiresVehicle && !ticket.vehicle_id) {
      return NextResponse.json({ error: "vehicle_id is required" }, { status: 400 });
    }
    if (requiresVehicle && !ticket.driver_id) {
      return NextResponse.json({ error: "driver_id is required" }, { status: 400 });
    }
    if (isFieldIssue && !isDirectFieldIssue && !ticket.driver_id) {
      return NextResponse.json({ error: "responsible person is required for field issue" }, { status: 400 });
    }
    if (ticket.direction === "processing" && String(ticket.op_type || "").toLowerCase() === "drying") {
      if (!ticket.processing_point_from_id) {
        return NextResponse.json({ error: "processing_point_from_id is required for drying" }, { status: 400 });
      }
    }
    if (!lines.length) {
      return NextResponse.json({ error: "At least one ticket line is required" }, { status: 400 });
    }
    if (isImpurityRemoval) {
      const impurityType = String(ticket.audit_json?.impurity_type || "").trim();
      if (!ticket.batch_id || !ticket.warehouse_from_id) {
        return NextResponse.json({ error: "Выберите склад и партию урожая." }, { status: 400 });
      }
      if (!ticket.vehicle_id || !ticket.driver_id) {
        return NextResponse.json({ error: "Выберите водителя и машину." }, { status: 400 });
      }
      if (!Number.isFinite(Number(ticket.gross_weight_kg)) || Number(ticket.gross_weight_kg) <= 0) {
        return NextResponse.json({ error: "Укажите брутто." }, { status: 400 });
      }
      if (!["soil_and_trash", "nonconforming_crop", "plant_residues", "other"].includes(impurityType)) {
        return NextResponse.json({ error: "Выберите вид примесей." }, { status: 400 });
      }
      if (impurityType === "other" && !String(ticket.notes || "").trim()) {
        return NextResponse.json({ error: "Для вида «Прочее» добавьте комментарий." }, { status: 400 });
      }
      if (lines.length !== 1) {
        return NextResponse.json({ error: "Вывоз примесей поддерживает одну партию на талон." }, { status: 400 });
      }

      const [{ data: batch, error: batchError }, { data: warehouse, error: warehouseError }, { data: harvestTicket, error: harvestTicketError }] = await Promise.all([
        supabase
          .from("inventory_batches")
          .select("id,batch_code,product_id,crop_id,variety_id,reproduction_id,batch_class,source_ticket_id,origin_type")
          .eq("company_id", companyId)
          .eq("id", ticket.batch_id)
          .eq("origin_type", "harvest")
          .maybeSingle(),
        supabase
          .from("warehouses")
          .select("id,warehouse_type,archived,is_archived")
          .eq("company_id", companyId)
          .eq("id", ticket.warehouse_from_id)
          .maybeSingle(),
        supabase
          .from("tickets")
          .select("id,warehouse_to_id,status,is_finalized,is_voided")
          .eq("company_id", companyId)
          .eq("batch_id", ticket.batch_id)
          .eq("op_type", "harvest_incoming")
          .eq("warehouse_to_id", ticket.warehouse_from_id)
          .eq("status", "finalized")
          .eq("is_finalized", true)
          .eq("is_voided", false)
          .limit(1)
          .maybeSingle(),
      ]);
      if (batchError || !batch?.id) {
        return NextResponse.json({ error: "Партия урожая не найдена в выбранной компании." }, { status: 400 });
      }
      if (warehouseError || !warehouse?.id || warehouse.archived || warehouse.is_archived || !isHarvestWarehouseType(warehouse.warehouse_type)) {
        return NextResponse.json({ error: "Выберите активный склад урожая." }, { status: 400 });
      }
      if (harvestTicketError || !harvestTicket?.id) {
        return NextResponse.json({ error: "Партия не была принята на выбранный склад закрытым талоном урожая." }, { status: 400 });
      }

      ticket.source_kind = "warehouse";
      ticket.source_id = String(warehouse.id);
      ticket.destination_kind = "impurity_removal";
      ticket.destination_id = null;
      ticket.warehouse_to_id = null;
      ticket.processing_node_id = null;
      ticket.audit_json = { ...(ticket.audit_json || {}), impurity_type: impurityType };
      const line = lines[0];
      line.product_id = String(batch.product_id || "");
      line.crop_id = batch.crop_id ? String(batch.crop_id) : null;
      line.variety_id = batch.variety_id ? String(batch.variety_id) : null;
      line.reproduction_id = batch.reproduction_id ? String(batch.reproduction_id) : null;
      line.batch_id = String(batch.id);
      line.lot_id = String(batch.batch_code || batch.id);
      line.batch_class = String(batch.batch_class || "commodity");
      line.warehouse_from_id = String(warehouse.id);
      line.warehouse_to_id = null;
      line.uom = "kg";
      if (!line.product_id) {
        return NextResponse.json({ error: "У партии урожая не определена складская номенклатура." }, { status: 400 });
      }
    }
    if (isWarehouseTransfer) {
      if (!ticket.warehouse_from_id || !ticket.warehouse_to_id) {
        return NextResponse.json({ error: "source and destination warehouses are required for transfer" }, { status: 400 });
      }
      if (String(ticket.warehouse_from_id) === String(ticket.warehouse_to_id)) {
        return NextResponse.json({ error: "Склад назначения должен отличаться от склада-источника" }, { status: 400 });
      }
      if (lines.length !== 1) {
        return NextResponse.json({ error: "warehouse transfer currently supports one stock identity per ticket" }, { status: 400 });
      }
      const line = lines[0];
      const qty = Number(line.quantity || 0);
      if (!line.product_id || !Number.isFinite(qty) || qty <= 0) {
        return NextResponse.json({ error: "transfer product identity and positive quantity are required" }, { status: 400 });
      }
    }
    if (isFieldIssue) {
      if (!ticket.warehouse_from_id || !ticket.field_id) {
        return NextResponse.json({ error: "source warehouse and field are required for field issue" }, { status: 400 });
      }
      if (!["seed_planting_material", "fertilizer", "organic", "other"].includes(String((ticket as any).field_material_category || ""))) {
        return NextResponse.json({ error: "field material category is required for field issue" }, { status: 400 });
      }
      if (lines.length !== 1) {
        return NextResponse.json({ error: "field issue currently supports one stock identity per ticket" }, { status: 400 });
      }
      const line = lines[0];
      const qty = Number(line.quantity || 0);
      if (!line.product_id || !Number.isFinite(qty) || qty <= 0) {
        return NextResponse.json({ error: "field issue product identity and positive quantity are required" }, { status: 400 });
      }
    }
    if (isShipment || isDisposal) {
      if (!ticket.warehouse_from_id) {
        return NextResponse.json({ error: "source warehouse is required" }, { status: 400 });
      }
      if (lines.length !== 1) {
        return NextResponse.json({ error: "operation currently supports one stock identity per ticket" }, { status: 400 });
      }
      const line = lines[0];
      const qty = Number(line.quantity || 0);
      if (!line.product_id || !Number.isFinite(qty) || qty <= 0) {
        return NextResponse.json({ error: "stock identity and positive quantity are required" }, { status: 400 });
      }
      if (isShipment) {
        if (!ticket.buyer_id || String(ticket.destination_kind || "") !== "counterparty") {
          return NextResponse.json({ error: "counterparty is required for shipment" }, { status: 400 });
        }
        if (!ticket.vehicle_id || !ticket.driver_id) {
          return NextResponse.json({ error: "vehicle and driver are required for shipment" }, { status: 400 });
        }
      }
      if (isDisposal && !String(ticket.notes || "").trim()) {
        return NextResponse.json({ error: "comment/reason is required for write-off" }, { status: 400 });
      }
    }

    if (isSupplierReceipt) {
      if (!ticket.supplier_id || String(ticket.source_kind || "") !== "supplier") {
        return NextResponse.json({ error: "supplier_id is required for supplier receipt" }, { status: 400 });
      }
      if (supplierReceiptMode === "direct") {
        ticket.warehouse_to_id = null;
        ticket.destination_id = null;
        ticket.gross_weight_kg = null;
        ticket.tare_weight_kg = null;
        ticket.weigh_method = "manual_override_with_reason";
      } else {
        if (!ticket.warehouse_to_id || String(ticket.destination_kind || "") !== "warehouse") {
          return NextResponse.json({ error: "warehouse_to_id is required for weighed supplier receipt" }, { status: 400 });
        }
        const gross = Number(ticket.gross_weight_kg || 0);
        if (!Number.isFinite(gross) || gross <= 0) {
          return NextResponse.json({ error: "Укажите брутто для прихода через весовую." }, { status: 400 });
        }
        if (lines.length !== 1) {
          return NextResponse.json({ error: "Один весовой талон может содержать только один товар" }, { status: 400 });
        }
      }
      for (const line of lines) {
        const qty = Number(line.quantity || 0);
        if (!line.product_id || !Number.isFinite(qty) || qty <= 0) {
          return NextResponse.json({ error: "product and positive quantity are required for supplier receipt lines" }, { status: 400 });
        }
        line.warehouse_to_id = supplierReceiptMode === "direct"
          ? line.warehouse_to_id || null
          : ticket.warehouse_to_id || null;
        if (!line.warehouse_to_id) {
          return NextResponse.json({ error: "Выберите склад по каждой строке поставки" }, { status: 400 });
        }
      }
    }

    if (isHarvestIncoming && !harvestIsCropMix && harvestCropForProduct) {
      try {
        const cropForProduct = harvestCropForProduct;
        const harvestProduct = await measure("harvest_product_identity", () => ensureHarvestProductIdentity({
          supabase,
          companyId,
          actorProfileId: actor.id,
          crop: cropForProduct,
        }));
        lines[0].product_id = harvestProduct.id;
        createdHarvestProductId = harvestProduct.created ? harvestProduct.id : null;
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Не удалось подготовить номенклатуру урожая." },
          { status: 400 }
        );
      }
    }

    const stockEvent: StockBusinessEvent = isHarvestIncoming
      ? "harvest_incoming"
      : isImpurityRemoval
        ? "manual_writeoff"
      : isSupplierReceipt
        ? "supplier_receipt"
        : isWarehouseTransfer
          ? "manual_transfer"
          : isFieldIssue
            ? "field_issue"
            : isShipment
              ? "shipment"
              : isDisposal
                ? "disposal"
                : "processing";

    let stockContractPersistenceSchema: "v2" | "legacy" = "v2";
    for (const line of lines) {
      const productAccess = isHarvestIncoming
        ? { data: { id: line.product_id }, error: null }
        : await measure("product_access", () => supabase
            .from("products")
            .select("id,product_type,type,category,stock_unit,base_uom,unit,physical_state,is_seed_material")
            .eq("id", line.product_id)
            .or(`company_id.eq.${ticket.company_id},company_id.is.null`)
            .maybeSingle());
      const product = productAccess.data as any;
      if (productAccess.error || !product?.id) {
        return NextResponse.json({ error: "Номенклатура недоступна выбранной компании" }, { status: 400 });
      }
      const catalogStockUnit = String(product.stock_unit || "").trim().toLowerCase();
      if (isDirectSupplierReceipt && !catalogStockUnit) {
        return NextResponse.json({ error: "Для номенклатуры не задана единица хранения" }, { status: 400 });
      }
      if (!isDirectSupplierReceipt && isSupplierReceipt && !isWeighedSupplierProduct({
        productType: product.product_type || product.type || product.category,
        stockUnit: catalogStockUnit || product.base_uom || product.unit,
        physicalState: product.physical_state,
        isSeedMaterial: product.is_seed_material,
      })) {
        return NextResponse.json({ error: "Эта номенклатура не принимается через весовую" }, { status: 400 });
      }
      const contract = await measure("stock_contract", () => resolveWarehouseStockContract(supabase, {
        companyId: ticket.company_id,
        productId: line.product_id,
        quantity: line.quantity,
        inputUom: line.uom,
        requestedBatchClass: line.batch_class,
        event: stockEvent,
        fieldMaterialCategory: ticket.field_material_category,
      }));
      if (contract.persistenceSchema === "legacy") {
        stockContractPersistenceSchema = "legacy";
      }
      if (!isDirectSupplierReceipt && contract.baseUom !== "kg" && !isDirectWarehouseTransfer && !isDirectFieldIssue) {
        return NextResponse.json(
          { error: "Литры и штуки нельзя подменять весом нетто. Используйте прямой документ с количеством в единице товара." },
          { status: 400 }
        );
      }
      if (isDirectSupplierReceipt && contract.baseUom !== catalogStockUnit) {
        return NextResponse.json({ error: "Единица строки должна совпадать с единицей хранения номенклатуры" }, { status: 400 });
      }
      line.quantity = contract.baseQuantity;
      line.uom = contract.baseUom;
      line.batch_class = contract.batchClass;
      line.mass_kg = contract.massKg;
      line.density_kg_per_l = contract.densityKgPerL;
      line.density_unit = contract.densityUnit;
      line.density_source = contract.densitySource;
      line.density_verification_status = contract.densityVerificationStatus;
      line.density_verified_at = contract.densityVerifiedAt;
      line.unit_source = contract.unitSource;
      line.unit_contract_version = contract.unitContractVersion;
    }

    if (isWarehouseTransfer) {
      const line = lines[0];
      const requiredQty = Number(line.quantity || 0);
      const { data: balances, error: balanceError } = await supabase
        .from("v_stock_balance_identity")
        .select("product_id,variety_id,reproduction_id,batch_id,batch_class,uom,quantity")
        .eq("company_id", ticket.company_id)
        .eq("warehouse_id", ticket.warehouse_from_id)
        .eq("product_id", line.product_id)
        .gt("quantity", 0);
      if (balanceError) {
        return NextResponse.json({ error: balanceError.message }, { status: 400 });
      }
      const match = (balances || []).find((row: any) =>
        sameNullable(row.variety_id, line.variety_id) &&
        sameNullable(row.reproduction_id, line.reproduction_id) &&
        (sameNullable(row.batch_id, line.batch_id) || sameNullable(row.batch_id, line.lot_id)) &&
        String(row.batch_class || "") === String(line.batch_class || "") &&
        String(row.uom || "") === String(line.uom || "")
      );
      const available = Number(match?.quantity || 0);
      if (!match) {
        return NextResponse.json({ error: "Selected stock identity does not belong to source warehouse" }, { status: 400 });
      }
      if (isDirectWarehouseTransfer && available < requiredQty) {
        return NextResponse.json(
          { error: `Недостаточно остатка для перемещения. Доступно: ${available.toFixed(3)} кг, нужно: ${requiredQty.toFixed(3)} кг` },
          { status: 400 }
        );
      }
    }
    if (isShipment || isDisposal) {
      const line = lines[0];
      const requiredQty = Number(line.quantity || 0);
      const { data: balances, error: balanceError } = await supabase
        .from("v_stock_balance_identity")
        .select("product_id,variety_id,reproduction_id,batch_id,batch_class,uom,quantity")
        .eq("company_id", ticket.company_id)
        .eq("warehouse_id", ticket.warehouse_from_id)
        .eq("product_id", line.product_id)
        .gt("quantity", 0);
      if (balanceError) {
        return NextResponse.json({ error: balanceError.message }, { status: 400 });
      }
      const match = (balances || []).find((row: any) =>
        sameNullable(row.variety_id, line.variety_id) &&
        sameNullable(row.reproduction_id, line.reproduction_id) &&
        (sameNullable(row.batch_id, line.batch_id) || sameNullable(row.batch_id, line.lot_id)) &&
        String(row.batch_class || "") === String(line.batch_class || "") &&
        String(row.uom || "") === String(line.uom || "")
      );
      const available = Number(match?.quantity || 0);
      if (!match) {
        return NextResponse.json({ error: "Selected stock identity does not belong to source warehouse" }, { status: 400 });
      }
      if (available < requiredQty) {
        return NextResponse.json(
          { error: `Недостаточно остатка по выбранной складской идентичности. Доступно: ${available.toFixed(3)} кг, нужно: ${requiredQty.toFixed(3)} кг` },
          { status: 400 }
        );
      }
    }
    if (isFieldIssue) {
      const line = lines[0];
      const requiredQty = Number(line.quantity || 0);
      const { data: balances, error: balanceError } = await supabase
        .from("v_stock_balance_identity")
        .select("product_id,variety_id,reproduction_id,batch_id,batch_class,uom,quantity")
        .eq("company_id", ticket.company_id)
        .eq("warehouse_id", ticket.warehouse_from_id)
        .eq("product_id", line.product_id)
        .gt("quantity", 0);
      if (balanceError) {
        return NextResponse.json({ error: balanceError.message }, { status: 400 });
      }
      const match = (balances || []).find((row: any) =>
        sameNullable(row.variety_id, line.variety_id) &&
        sameNullable(row.reproduction_id, line.reproduction_id) &&
        (sameNullable(row.batch_id, line.batch_id) || sameNullable(row.batch_id, line.lot_id)) &&
        String(row.batch_class || "") === String(line.batch_class || "") &&
        String(row.uom || "") === String(line.uom || "")
      );
      const available = Number(match?.quantity || 0);
      if (!match) {
        return NextResponse.json({ error: "Selected stock identity does not belong to source warehouse" }, { status: 400 });
      }
      if (isDirectFieldIssue && available < requiredQty) {
        return NextResponse.json(
          { error: `Недостаточно остатка для отпуска в поле. Доступно: ${available.toFixed(3)} кг, нужно: ${requiredQty.toFixed(3)} кг` },
          { status: 400 }
        );
      }

      if (!ticket.crop_structure_allocation_id) {
        return NextResponse.json({ error: "crop_structure_allocation_id is required for field issue" }, { status: 400 });
      }
      const fieldIssueSeasonId = await resolveActiveSeasonId(supabase, ticket.company_id);
      if (!fieldIssueSeasonId) {
        return NextResponse.json({ error: "Active season not found for company" }, { status: 400 });
      }
      const { data: selectedFieldIssueAllocation, error: selectedFieldIssueAllocationError } = await supabase
        .from("crop_structure")
        .select("id,crop_id,variety_id,reproduction_id,area")
        .eq("company_id", ticket.company_id)
        .eq("season_id", fieldIssueSeasonId)
        .eq("field_id", ticket.field_id)
        .eq("id", ticket.crop_structure_allocation_id)
        .eq("archived", false)
        .maybeSingle();
      if (selectedFieldIssueAllocationError || !selectedFieldIssueAllocation?.id) {
        return NextResponse.json(
          { error: selectedFieldIssueAllocationError?.message || "Selected crop structure allocation does not belong to this field/company/active season" },
          { status: 400 }
        );
      }

      if (String((ticket as any).field_material_category || "") === "seed_planting_material") {
        if (!line.crop_id || !line.variety_id || !line.reproduction_id) {
          return NextResponse.json({ error: "seed field issue requires crop, variety and reproduction identity" }, { status: 400 });
        }
        if (
          String((selectedFieldIssueAllocation as any).crop_id || "") !== String(line.crop_id || "") ||
          String((selectedFieldIssueAllocation as any).variety_id || "") !== String(line.variety_id || "") ||
          String((selectedFieldIssueAllocation as any).reproduction_id || "") !== String(line.reproduction_id || "")
        ) {
          return NextResponse.json(
            { error: "Seed material does not match selected crop structure allocation crop/variety/reproduction" },
            { status: 400 }
          );
        }
        const seasonId = await resolveActiveSeasonId(supabase, ticket.company_id);
        if (!seasonId) {
          return NextResponse.json({ error: "Active season not found for company" }, { status: 400 });
        }
        const { data: structureRows, error: structureError } = await supabase
          .from("crop_structure")
          .select("id,crop_id,variety_id,reproduction_id")
          .eq("company_id", ticket.company_id)
          .eq("season_id", seasonId)
          .eq("field_id", ticket.field_id)
          .eq("archived", false)
          .not("variety_id", "is", null)
          .not("reproduction_id", "is", null);
        if (structureError) {
          return NextResponse.json({ error: structureError.message }, { status: 400 });
        }
        const matchingAllocation = (structureRows || []).find((row: any) =>
          String(row.crop_id || "") === String(line.crop_id || "") &&
          String(row.variety_id || "") === String(line.variety_id || "") &&
          String(row.reproduction_id || "") === String(line.reproduction_id || "")
        );
        if (!matchingAllocation) {
          return NextResponse.json(
            { error: "Seed material does not match field crop structure crop/variety/reproduction" },
            { status: 400 }
          );
        }
        if (String(matchingAllocation.id) !== String(ticket.crop_structure_allocation_id)) {
          const selectedStillMatches = String((selectedFieldIssueAllocation as any).id) === String(ticket.crop_structure_allocation_id);
          if (!selectedStillMatches) {
            return NextResponse.json({ error: "Selected crop structure allocation is invalid" }, { status: 400 });
          }
        }
      }
    }
    if (isHarvestIncoming) {
      if (!ticket.field_id) {
        return NextResponse.json({ error: "field_id is required for harvest incoming" }, { status: 400 });
      }
      if (!ticket.crop_structure_allocation_id) {
        return NextResponse.json({ error: "crop_structure_allocation_id is required for harvest incoming" }, { status: 400 });
      }
      if (!ticket.warehouse_to_id) {
        return NextResponse.json({ error: "Не определено место приёмки урожая." }, { status: 400 });
      }
      if (!ticket.driver_id) {
        return NextResponse.json({ error: "driver_id is required for harvest incoming" }, { status: 400 });
      }
      if (!ticket.vehicle_id) {
        return NextResponse.json({ error: "vehicle_id is required for harvest incoming" }, { status: 400 });
      }
      const gross = Number(ticket.gross_weight_kg || 0);
      if (!Number.isFinite(gross) || gross <= 0) {
        return NextResponse.json({ error: "gross_weight_kg is required and must be positive for harvest incoming" }, { status: 400 });
      }
      const grossWeighings = weighings.filter((item) => Number(item.weighing_no) === 1);
      if (weighings.some((item) => Number(item.weighing_no) !== 1) || grossWeighings.length > 1) {
        return NextResponse.json({ error: "При создании талона допускается только первое взвешивание брутто." }, { status: 400 });
      }
      if (grossWeighings.length === 0) {
        weighings.push({
          weighing_no: 1,
          measured_weight_kg: gross,
          measured_at: new Date().toISOString(),
          device_source: "manual",
          operator_user_id: actor.id,
        });
      } else {
        const grossEvent = grossWeighings[0];
        if (Math.abs(Number(grossEvent.measured_weight_kg || 0) - gross) > 0.001) {
          return NextResponse.json({ error: "Первое взвешивание должно совпадать с брутто талона." }, { status: 400 });
        }
        grossEvent.device_source = "manual";
        grossEvent.operator_user_id = actor.id;
      }
      for (const line of lines) {
        if (!harvestIsCropMix && !line.crop_id) {
          return NextResponse.json(
            { error: "crop_id is required for harvest incoming lines" },
            { status: 400 }
          );
        }
        const lineQty = Number(line.quantity || 0);
        if (!Number.isFinite(lineQty) || lineQty <= 0) {
          return NextResponse.json({ error: "line quantity must be positive for harvest incoming" }, { status: 400 });
        }
      }
    }

    const requestedOperationLineIds = Array.from(
      new Set(
        lines
          .map((line) => String((line as any).operation_line_id || "").trim())
          .filter(Boolean)
      )
    );
    if (requestedOperationLineIds.length > 0) {
      const { data: operationLines, error: operationLinesError } = await supabase
        .from("operation_lines")
        .select("id,operation_id,field_id,company_id")
        .eq("company_id", ticket.company_id)
        .in("id", requestedOperationLineIds);
      if (operationLinesError) {
        return NextResponse.json({ error: operationLinesError.message }, { status: 400 });
      }
      const operationLineMap = new Map((operationLines || []).map((row: any) => [String(row.id), row]));
      for (const operationLineId of requestedOperationLineIds) {
        const row = operationLineMap.get(operationLineId);
        if (!row) {
          return NextResponse.json({ error: `operation_line_id ${operationLineId} is invalid for actor company` }, { status: 400 });
        }
        if (ticket.linked_operation_id && String(row.operation_id || "") !== String(ticket.linked_operation_id)) {
          return NextResponse.json(
            { error: `operation_line_id ${operationLineId} does not belong to linked_operation_id` },
            { status: 400 }
          );
        }
        if ((isFieldIssue || isHarvestIncoming) && ticket.field_id && row.field_id && String(row.field_id || "") !== String(ticket.field_id || "")) {
          return NextResponse.json(
            { error: `operation_line_id ${operationLineId} does not belong to selected field` },
            { status: 400 }
          );
        }
      }
    }

    if (ticket.linked_operation_id) {
      const { data: linkedOperation, error: linkedOperationError } = await supabase
        .from("operations")
        .select("id,field_id,company_id,operation_category_slug,operation_type_slug")
        .eq("company_id", ticket.company_id)
        .eq("id", ticket.linked_operation_id)
        .maybeSingle();
      if (linkedOperationError || !linkedOperation?.id) {
        return NextResponse.json({ error: "linked_operation_id is invalid for actor company" }, { status: 400 });
      }
      if ((isFieldIssue || isHarvestIncoming) && ticket.field_id && linkedOperation.field_id && String(linkedOperation.field_id || "") !== String(ticket.field_id || "")) {
        return NextResponse.json({ error: "linked_operation_id does not belong to selected field" }, { status: 400 });
      }
      if (
        isHarvestIncoming &&
        linkedOperation.operation_category_slug !== "harvesting" &&
        linkedOperation.operation_type_slug !== "harvesting"
      ) {
        return NextResponse.json({ error: "linked_operation_id must reference a harvesting operation" }, { status: 400 });
      }
    }

    const activeShiftId = await activeShiftIdPromise;
    if (!isDirectSupplierReceipt && !activeShiftId) {
      return NextResponse.json(
        { error: "Open weighbridge shift is required before ticket creation" },
        { status: 400 }
      );
    }

    if (isSupplierReceipt) {
      const { data: supplier, error: supplierError } = await supabase
        .from("counterparties")
        .select("id,is_active,archived,counterparty_type,roles")
        .eq("company_id", ticket.company_id)
        .eq("id", ticket.supplier_id)
        .maybeSingle();
      if (supplierError || !supplier?.id) {
        return NextResponse.json({ error: "Supplier not found in current company" }, { status: 400 });
      }
      const supplierRoles = Array.isArray((supplier as any).roles) ? (supplier as any).roles.map(String) : [];
      if (!supplier.is_active || supplier.archived || (!supplierRoles.includes("supplier") && !["supplier", "both"].includes(String(supplier.counterparty_type || "")))) {
        return NextResponse.json({ error: "Supplier is inactive or not allowed for receipt" }, { status: 400 });
      }
    }
    if (isShipment) {
      const { data: buyer, error: buyerError } = await supabase
        .from("counterparties")
        .select("id,is_active,archived,counterparty_type,roles")
        .eq("company_id", ticket.company_id)
        .eq("id", ticket.buyer_id)
        .maybeSingle();
      if (buyerError || !buyer?.id) {
        return NextResponse.json({ error: "Counterparty not found in current company" }, { status: 400 });
      }
      const buyerRoles = Array.isArray((buyer as any).roles) ? (buyer as any).roles.map(String) : [];
      if (!buyer.is_active || buyer.archived || (!buyerRoles.includes("buyer") && !["buyer", "both"].includes(String(buyer.counterparty_type || "")))) {
        return NextResponse.json({ error: "Counterparty is inactive or not allowed for shipment" }, { status: 400 });
      }
    }

    let selectedVehicle: {
      id: string;
      name: string;
      plate_number?: string | null;
      type?: string | null;
      fleet_type?: string | null;
      source: "reference_vehicles" | "reference_machines";
    } | null = null;
    if (ticket.vehicle_id) {
      const [vehicleResult, machineResult, activeTicketResult] =
        await (vehicleGuardPromise as NonNullable<typeof vehicleGuardPromise>);
      const { data: vehicle, error: vehicleError } = vehicleResult;
      const { data: machine, error: machineError } = machineResult;
      const { data: activeByVehicle, error: activeByVehicleError } = activeTicketResult;
      if (vehicleError || machineError) {
        return NextResponse.json({ error: vehicleError?.message || machineError?.message }, { status: 400 });
      }
      const vehicleModel = Array.isArray((vehicle as any)?.transport_model)
        ? (vehicle as any).transport_model[0]
        : (vehicle as any)?.transport_model;
      const cargoVehicle = vehicle?.id && isCargoVehicle({
        type: vehicle.type,
        fleet_type: vehicle.fleet_type,
        category: vehicleModel?.category,
      })
        ? vehicle
        : null;
      const cargoTractor = machine?.id && isCargoTractor(machine) ? machine : null;
      if (!cargoVehicle && !cargoTractor) {
        return NextResponse.json({ error: "Vehicle not found in current company" }, { status: 400 });
      }
      const selected = cargoVehicle || cargoTractor;
      if (!selected?.is_active || selected.archived) {
        return NextResponse.json({ error: "Vehicle is inactive or archived" }, { status: 400 });
      }
      selectedVehicle = cargoVehicle
        ? {
            id: String(cargoVehicle.id),
            name: String(cargoVehicle.name || "Транспорт"),
            plate_number: cargoVehicle.plate_number || null,
            type: cargoVehicle.type,
            fleet_type: cargoVehicle.fleet_type,
            source: "reference_vehicles",
          }
        : {
            id: String(cargoTractor!.id),
            name: String(cargoTractor!.name || "Трактор"),
            plate_number: cargoTractor!.license_plate || null,
            type: "tractor",
            fleet_type: "tractor",
            source: "reference_machines",
          };
      if (activeByVehicleError) {
        return NextResponse.json({ error: activeByVehicleError.message }, { status: 400 });
      }
      const activeVehicleTicket = (activeByVehicle || [])[0];
      if (activeVehicleTicket?.id) {
        return NextResponse.json(
          {
            error: "This vehicle already has an active ticket",
            code: "vehicle_active_ticket",
            ticketId: String(activeVehicleTicket.id),
            ticketNo: String(activeVehicleTicket.ticket_no || ""),
          },
          { status: 409 }
        );
      }
    }
    if (ticket.driver_id) {
      const [driverResult, activeDriverTicketResult] = await (
        driverGuardPromise as NonNullable<typeof driverGuardPromise>
      );
      const { data: driver, error: driverError } = driverResult;
      if (driverError || !driver?.id) {
        return NextResponse.json(
          { error: "Driver is unavailable in the current company personnel directory" },
          { status: 400 }
        );
      }
      if (!isWeighbridgePersonnelRole(driver.role_type)) {
        return NextResponse.json(
          { error: "Selected employee is not a driver or machine operator" },
          { status: 400 }
        );
      }
      if (activeDriverTicketResult.error) {
        return NextResponse.json({ error: activeDriverTicketResult.error.message }, { status: 400 });
      }
      const activeDriverTicket = (activeDriverTicketResult.data || [])[0];
      if (activeDriverTicket?.id) {
        return NextResponse.json(
          {
            error: "This driver already has an active ticket",
            code: "driver_active_ticket",
            ticketId: String(activeDriverTicket.id),
            ticketNo: String(activeDriverTicket.ticket_no || ""),
            vehicleId: activeDriverTicket.vehicle_id ? String(activeDriverTicket.vehicle_id) : null,
          },
          { status: 409 }
        );
      }
    }
    let selectedTrailer: any | null = null;
    if (requestedTrailerId) {
      if (requestedTrailerId === String(ticket.vehicle_id || "")) {
        return NextResponse.json({ error: "Trailer must differ from the main vehicle" }, { status: 400 });
      }
      const [{ data: trailer, error: trailerError }, { data: activeByTrailer, error: activeByTrailerError }] =
        await (trailerGuardPromise as NonNullable<typeof trailerGuardPromise>);
      const trailerTransportModel = (trailer as any)?.transport_model;
      const trailerModel = Array.isArray(trailerTransportModel)
        ? trailerTransportModel[0]
        : trailerTransportModel;
      if (
        trailerError ||
        activeByTrailerError ||
        !trailer?.id ||
        !trailer.is_active ||
        trailer.archived ||
        !isTrailerTransport({
          type: trailer.type,
          fleet_type: trailer.fleet_type,
          category: trailerModel?.category,
        })
      ) {
        return NextResponse.json(
          { error: trailerError?.message || activeByTrailerError?.message || "Trailer is unavailable in current company" },
          { status: 400 }
        );
      }
      if ((activeByTrailer || []).length > 0) {
        return NextResponse.json({ error: "This trailer already has an active ticket" }, { status: 400 });
      }
      selectedTrailer = trailer;
    }
    if (selectedVehicle) {
      ticket.audit_json = {
        ...((ticket.audit_json || {}) as Record<string, unknown>),
        transport: {
          ...((transportAudit || {}) as Record<string, unknown>),
          vehicle_source: selectedVehicle.source,
          vehicle_name_snapshot: selectedVehicle.name,
          vehicle_plate_snapshot: selectedVehicle.plate_number || null,
          trailer_id: selectedTrailer?.id ? String(selectedTrailer.id) : null,
          trailer_name_snapshot: selectedTrailer?.id ? String(selectedTrailer.name || "Прицеп") : null,
          trailer_plate_snapshot: selectedTrailer?.id ? String(selectedTrailer.plate_number || "") || null : null,
        },
      };
    }

    if (isDirectSupplierReceipt) {
      if (!idempotencyKey || !requestFingerprint) {
        return NextResponse.json({ error: "Idempotency-Key is required for invoice receipt" }, { status: 400 });
      }
      const { data: receipt, error: receiptError } = await supabase.rpc("create_supplier_invoice_atomic_v1", {
        p_company_id: ticket.company_id,
        p_supplier_id: ticket.supplier_id,
        p_document_no: ticket.supplier_document_no || null,
        p_notes: ticket.notes || null,
        p_lines: lines.map((line) => ({
          product_id: line.product_id,
          quantity: line.quantity,
          warehouse_id: line.warehouse_to_id,
          lot_number: line.lot_id || (line as any).supplier_lot || null,
          unit_price: line.unit_price ?? null,
          notes: line.notes || null,
        })),
        p_vehicle_id: ticket.vehicle_id || null,
        p_driver_id: ticket.driver_id || null,
        p_idempotency_key: idempotencyKey,
        p_request_fingerprint: requestFingerprint,
      });
      if (receiptError) {
        return NextResponse.json({ error: weighbridgeUserError(receiptError.message) }, { status: 400 });
      }
      const { data: finalizedTicket } = await supabase.from("tickets").select("*")
        .eq("id", String((receipt as any)?.receipt_id || idempotencyKey)).eq("company_id", companyId).maybeSingle();
      timing.validationMs = Date.now() - validationStartedAt;
      timing.totalMs = Date.now() - startedAt;
      return NextResponse.json({ ticket: finalizedTicket, receipt, idempotent_replay: Boolean((receipt as any)?.idempotent_replay), debug: timing });
    }

    timing.validationMs = Date.now() - validationStartedAt;
    const dbStartedAt = Date.now();
    const ticketNo = buildTicketNo(ticket.company_id);
    const productIds = Array.from(new Set(lines.map((line) => line.product_id).filter(Boolean).map(String)));
    const varietyIds = Array.from(new Set(lines.map((line) => line.variety_id).filter(Boolean).map(String)));
    const reproductionIds = Array.from(new Set(lines.map((line) => line.reproduction_id).filter(Boolean).map(String)));
    const productsPromise = productIds.length > 0
      ? Promise.resolve(
          supabase
            .from("products")
            .select("id,name,trade_name,normalized_name")
            .in("id", productIds)
            .or(`company_id.eq.${ticket.company_id},company_id.is.null`)
        )
      : Promise.resolve({ data: [] } as any);
    const varietiesPromise = varietyIds.length > 0
      ? Promise.resolve(supabase.from("varieties").select("id, name").in("id", varietyIds))
      : Promise.resolve({ data: [] } as any);
    const reproductionsPromise = reproductionIds.length > 0
      ? Promise.resolve(supabase.from("seed_reproductions").select("id, name").in("id", reproductionIds))
      : Promise.resolve({ data: [] } as any);
    const companyLookupStartedAt = Date.now();
    const companyPromise = Promise.resolve(
      supabase
        .from("companies")
        .select("id,name")
        .eq("id", ticket.company_id)
        .maybeSingle()
    ).finally(() => {
      timing.steps.company_lookup = Date.now() - companyLookupStartedAt;
    });

    const { data: createdTicket, error: ticketError } = await measure("ticket_insert", () => supabase
      .from("tickets")
      .insert({
        ...ticket,
        ...(idempotencyKey ? { id: idempotencyKey } : {}),
        audit_json: idempotencyKey
          ? {
              ...(((ticket as any).audit_json || {}) as Record<string, unknown>),
              idempotency_key: idempotencyKey,
              request_fingerprint: requestFingerprint,
            }
          : (ticket as any).audit_json || null,
        shift_id: ticket.shift_id || activeShiftId,
        ticket_no: ticketNo,
        status: isDirectSupplierReceipt ? "ready_to_close" : "active",
      })
      .select("*")
      .single());

    if (ticketError || !createdTicket?.id) {
      await cleanupCreatedHarvestProduct(supabase, createdHarvestProductId);
      return NextResponse.json({ error: ticketError?.message || "Failed to create ticket" }, { status: 400 });
    }

    const productsMap = new Map<string, string>();
    const varietiesMap = new Map<string, string>();
    const reproductionsMap = new Map<string, string>();
    const [productsResult, varietiesResult, reproductionsResult] = await measure("snapshot_lookup", () => Promise.all([
      productsPromise,
      varietiesPromise,
      reproductionsPromise,
    ]));
    for (const p of productsResult.data || []) {
      productsMap.set(String((p as any).id), brandName(p) || String((p as any).name || ""));
    }
    for (const v of varietiesResult.data || []) {
      varietiesMap.set(String((v as any).id), String((v as any).name));
    }
    for (const r of reproductionsResult.data || []) {
      reproductionsMap.set(String((r as any).id), String((r as any).name));
    }

    const linesPayload = lines.map((line) => ({
      ticket_id: createdTicket.id,
      company_id: ticket.company_id,
      product_id: line.product_id,
      crop_id: line.crop_id ?? null,
      quantity: Number(line.quantity || 0),
      uom: String(line.uom || "").trim(),
      warehouse_from_id: line.warehouse_from_id || (ticket.direction === "outgoing" || ticket.direction === "transfer" ? ticket.warehouse_from_id || null : null),
      warehouse_to_id: line.warehouse_to_id || (ticket.direction === "incoming" || ticket.direction === "transfer" ? ticket.warehouse_to_id || null : null),
      unit_price: line.unit_price == null ? null : Number(line.unit_price),
      amount: line.amount == null ? null : Number(line.amount),
      product_name_snapshot: productsMap.get(line.product_id) || null,
      variety_name_snapshot: line.variety_id ? varietiesMap.get(String(line.variety_id)) || null : null,
      reproduction_name_snapshot: line.reproduction_id ? reproductionsMap.get(String(line.reproduction_id)) || null : null,
      lot_id: line.lot_id || (line as any).supplier_lot || null,
      notes: [line.notes || "", (line as any).supplier_lot ? `Партия поставщика: ${(line as any).supplier_lot}` : ""].filter(Boolean).join("\n") || null,
      net_line_weight_kg:
        line.net_line_weight_kg == null ? null : Number(line.net_line_weight_kg),
      moisture_percent: line.moisture_percent ?? null,
      dockage_percent: line.dockage_percent ?? null,
      dirt_tare_percent: line.dirt_tare_percent ?? null,
      class_grade: line.class_grade ?? null,
      variety_id: line.variety_id ?? null,
      reproduction_id: line.reproduction_id ?? null,
      operation_line_id: (line as any).operation_line_id ?? null,
      batch_id: line.batch_id ?? null,
      batch_class: line.batch_class ?? null,
      ...(stockContractPersistenceSchema === "v2"
        ? {
            mass_kg: line.mass_kg ?? null,
            density_kg_per_l: line.density_kg_per_l ?? null,
            density_unit: line.density_unit ?? null,
            density_source: line.density_source ?? null,
            density_verification_status: line.density_verification_status ?? null,
            density_verified_at: line.density_verified_at ?? null,
            unit_source: line.unit_source ?? null,
            unit_contract_version: line.unit_contract_version ?? null,
          }
        : {}),
      composition_snapshot: (line as any).composition_snapshot || [],
      composition_hash: (line as any).composition_hash || null,
      is_mixed_harvest: Boolean((line as any).is_mixed_harvest),
    }));

    const weighingsPayload = weighings.map((item) => ({
        ticket_id: createdTicket.id,
        company_id: ticket.company_id,
        weighing_no: item.weighing_no,
        measured_weight_kg: Number(item.measured_weight_kg || 0),
        measured_at: item.measured_at || new Date().toISOString(),
        device_source: item.device_source || "manual",
        operator_user_id: item.operator_user_id || ticket.created_by,
        operator_person_id: operatorSession?.operator.id || null,
        weighbridge_shift_id: operatorSession?.shift.id || activeShiftId || null,
        comment: item.comment || null,
      }));
    const [linesInsertResult, weighingsInsertResult] = await Promise.all([
      measure("ticket_line_insert", () => supabase.from("ticket_lines").insert(linesPayload)),
      weighingsPayload.length > 0
        ? measure("gross_event_insert", () => supabase.from("ticket_weighings").insert(weighingsPayload))
        : Promise.resolve({ error: null } as any),
      ticket.vehicle_id && selectedVehicle?.source === "reference_vehicles"
        ? measure("vehicle_status_update", () => supabase
            .from("reference_vehicles")
            .update({ status: "in_trip" })
            .eq("id", ticket.vehicle_id)
            .eq("company_id", ticket.company_id))
        : Promise.resolve({ error: null } as any),
    ]);
    const linesError = linesInsertResult.error;
    const weighingsError = weighingsInsertResult.error;
    if (linesError || weighingsError) {
      await cleanupCreatedTicket(supabase, createdTicket.id, createdHarvestProductId);
      return NextResponse.json({ error: linesError?.message || weighingsError?.message || "Failed to create ticket details" }, { status: 400 });
    }
    timing.dbMs = Date.now() - dbStartedAt;

    if (isDirectSupplierReceipt) {
      const rpcStartedAt = Date.now();
      const { error: finalizeError } = await supabase.rpc("finalize_weighbridge_ticket_authenticated_v1", {
        p_ticket_id: createdTicket.id,
        p_actor_user_id: actor.id,
      });
      timing.rpcMs = Date.now() - rpcStartedAt;

      if (finalizeError) {
        await cleanupCreatedTicket(supabase, createdTicket.id, createdHarvestProductId);
        return NextResponse.json({ error: weighbridgeUserError(finalizeError.message) }, { status: 400 });
      }

      const { data: finalizedTicket } = await supabase
        .from("tickets")
        .select("*")
        .eq("id", createdTicket.id)
        .maybeSingle();

      timing.totalMs = Date.now() - startedAt;
      const { data: company } = await supabase
        .from("companies")
        .select("id,name")
        .eq("id", ticket.company_id)
        .maybeSingle();
      return NextResponse.json({
        ticket: {
          ...(finalizedTicket || createdTicket),
          company_name: String((company as any)?.name || "").trim() || null,
        },
        debug: timing,
      });
    }

    timing.totalMs = Date.now() - startedAt;
    const { data: company } = await companyPromise;
    return NextResponse.json({
      ticket: {
        ...createdTicket,
        company_name: String((company as any)?.name || "").trim() || null,
      },
      debug: timing,
    });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
