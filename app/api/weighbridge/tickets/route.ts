import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WEIGHBRIDGE_READ_ROLES, WEIGHBRIDGE_WRITE_ROLES, asSessionErrorResponse, resolveWeighbridgeSession, weighbridgeUserError } from "@/app/api/weighbridge/_auth";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import type { TicketInput, TicketLineInput, WeighingInput } from "@/lib/types/weighbridge";
import { resolveWarehouseStockContract } from "@/lib/server/warehouse-stock-contract";
import type { StockBusinessEvent } from "@/lib/warehouse/stock-unit-contract";
import { resolveHarvestTicketContext } from "@/lib/server/harvest-ticket-context";
import { isHarvestWarehouseType } from "@/lib/warehouse/warehouse-scope";

function buildTicketNo(companyId: string): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const entropy = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `WB-${companyId.slice(0, 6).toUpperCase()}-${stamp}-${entropy}`;
}

const sameNullable = (a: unknown, b: unknown) => String(a || "") === String(b || "");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function cleanupCreatedTicket(supabase: SupabaseClient, ticketId: string) {
  await supabase.from("ticket_weighings").delete().eq("ticket_id", ticketId);
  await supabase.from("ticket_lines").delete().eq("ticket_id", ticketId);
  await supabase.from("tickets").delete().eq("id", ticketId);
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

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });
    const { data, error } = await supabase
      .from("tickets")
      .select(`
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
          products:product_id(name,trade_name,normalized_name),
          varieties:variety_id(name),
          reproductions:reproduction_id(name,name_ru,name_kz,name_en,code)
        )
      `)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const { data: company } = await supabase
      .from("companies")
      .select("id,name")
      .eq("id", companyId)
      .maybeSingle();
    const companyName = String((company as any)?.name || "").trim() || null;

    const tickets = (data || []).map((row: any) => ({
      ...row,
      company_name: companyName,
      lines: (row.lines || []).map((line: any) => ({
        id: String(line.id),
        product_id: String(line.product_id),
        quantity: Number(line.quantity || 0),
        uom: String(line.uom || "legacy/unknown"),
        warehouse_from_id: line.warehouse_from_id ? String(line.warehouse_from_id) : null,
        warehouse_to_id: line.warehouse_to_id ? String(line.warehouse_to_id) : null,
        unit_price: line.unit_price == null ? null : Number(line.unit_price),
        amount: line.amount == null ? null : Number(line.amount),
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
      })),
    }));

    return NextResponse.json({ tickets });
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
    const rawIdempotencyKey = String(request.headers.get("Idempotency-Key") || "").trim();
    if (rawIdempotencyKey && !UUID_RE.test(rawIdempotencyKey)) {
      return NextResponse.json({ error: "Idempotency-Key must be a UUID" }, { status: 400 });
    }
    const idempotencyKey = rawIdempotencyKey || null;
    const requestFingerprint = idempotencyKey
      ? createHash("sha256").update(JSON.stringify({ ticket: rawTicket, lines, weighings })).digest("hex")
      : null;

    if (idempotencyKey) {
      const { data: existingTicket, error: existingTicketError } = await supabase
        .from("tickets")
        .select("*")
        .eq("id", idempotencyKey)
        .eq("company_id", companyId)
        .maybeSingle();
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

    if (isHarvestIncoming) {
      if (!ticket.field_id || !ticket.crop_structure_allocation_id) {
        return NextResponse.json(
          { error: "Выберите поле и участок / культуру для прихода урожая." },
          { status: 400 }
        );
      }

      const harvestContext = await resolveHarvestTicketContext({
        supabase,
        companyId,
        fieldId: String(ticket.field_id),
        allocationId: String(ticket.crop_structure_allocation_id),
      });
      if (harvestContext.status !== "ready" || !harvestContext.operationId || !harvestContext.operationLineId) {
        return NextResponse.json({ error: harvestContext.message }, { status: 409 });
      }

      ticket.season_id = harvestContext.seasonId;
      ticket.linked_operation_id = harvestContext.operationId;
      for (const line of lines) {
        line.operation_line_id = harvestContext.operationLineId;
        line.crop_id = harvestContext.allocation?.cropId || null;
        line.variety_id = harvestContext.allocation?.varietyId || null;
        line.reproduction_id = harvestContext.allocation?.reproductionId || null;
      }

      const destinationKind = String(ticket.destination_kind || "warehouse").trim().toLowerCase();
      if (destinationKind === "processing_node") {
        const processingNodeId = String(ticket.processing_node_id || ticket.destination_id || "").trim();
        const { data: node, error: nodeError } = await supabase
          .from("processing_nodes")
          .select("id,company_id,linked_warehouse_id,is_active,archived")
          .eq("company_id", companyId)
          .eq("id", processingNodeId)
          .eq("is_active", true)
          .eq("archived", false)
          .maybeSingle();
        if (nodeError || !node?.id || !node.linked_warehouse_id) {
          return NextResponse.json(
            { error: "Выбранная линия переработки недоступна или не связана со складом приёмки." },
            { status: 400 }
          );
        }

        const { data: linkedWarehouse, error: linkedWarehouseError } = await supabase
          .from("warehouses")
          .select("id,company_id,warehouse_type,archived,is_archived")
          .eq("company_id", companyId)
          .eq("id", node.linked_warehouse_id)
          .maybeSingle();
        if (
          linkedWarehouseError ||
          !linkedWarehouse?.id ||
          linkedWarehouse.archived ||
          linkedWarehouse.is_archived ||
          !isHarvestWarehouseType(linkedWarehouse.warehouse_type)
        ) {
          return NextResponse.json(
            { error: "Склад приёмки линии переработки не разрешён для урожая." },
            { status: 400 }
          );
        }

        ticket.destination_kind = "processing_node";
        ticket.destination_id = String(node.id);
        ticket.processing_node_id = String(node.id);
        ticket.warehouse_to_id = String(linkedWarehouse.id);
        for (const line of lines) {
          line.warehouse_to_id = String(linkedWarehouse.id);
        }
      } else if (destinationKind === "warehouse") {
        const warehouseId = String(ticket.warehouse_to_id || ticket.destination_id || "").trim();
        const { data: destinationWarehouse, error: destinationWarehouseError } = await supabase
          .from("warehouses")
          .select("id,company_id,warehouse_type,archived,is_archived")
          .eq("company_id", companyId)
          .eq("id", warehouseId)
          .maybeSingle();
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
        return NextResponse.json({ error: "Выберите направление: на склад или на переработку." }, { status: 400 });
      }
    }
    const isDirectWarehouseTransfer =
      isWarehouseTransfer &&
      String(ticket.weigh_method || "").toLowerCase() === "manual_override_with_reason";
    const isDirectFieldIssue =
      isFieldIssue &&
      String(ticket.weigh_method || "").toLowerCase() === "manual_override_with_reason";
    const supplierReceiptMode = String((ticket as any).receipt_mode || "weighbridge");
    const supplierReceiptKind = String((ticket as any).supplier_receipt_kind || "generic");
    const isDirectSupplierReceipt = isSupplierReceipt && supplierReceiptMode === "direct";
    const requiresVehicle =
      isShipment ||
      isHarvestIncoming ||
      (isSupplierReceipt && supplierReceiptMode !== "direct") ||
      (isWarehouseTransfer && !isDirectWarehouseTransfer) ||
      (isFieldIssue && !isDirectFieldIssue);
    const activeShiftIdPromise = isDirectSupplierReceipt
      ? Promise.resolve<string | null>(null)
      : resolveActiveShiftId(supabase, ticket.company_id);
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
    if (isWarehouseTransfer) {
      if (!ticket.warehouse_from_id || !ticket.warehouse_to_id) {
        return NextResponse.json({ error: "source and destination warehouses are required for transfer" }, { status: 400 });
      }
      if (String(ticket.warehouse_from_id) === String(ticket.warehouse_to_id)) {
        return NextResponse.json({ error: "source and destination warehouses must be different" }, { status: 400 });
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
      if (!["seed_planting_material", "fertilizer", "crop_protection", "organic", "fuel", "other"].includes(String((ticket as any).field_material_category || ""))) {
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
      if (!ticket.warehouse_to_id || String(ticket.destination_kind || "") !== "warehouse") {
        return NextResponse.json({ error: "warehouse_to_id is required for supplier receipt" }, { status: 400 });
      }
      if (supplierReceiptMode === "direct") {
        ticket.gross_weight_kg = null;
        ticket.tare_weight_kg = null;
        ticket.weigh_method = "manual_override_with_reason";
      } else {
        const gross = Number(ticket.gross_weight_kg || 0);
        if (!Number.isFinite(gross) || gross <= 0) {
          return NextResponse.json({ error: "Укажите брутто для прихода через весовую." }, { status: 400 });
        }
      }
      for (const line of lines) {
        const qty = Number(line.quantity || 0);
        if (!line.product_id || !Number.isFinite(qty) || qty <= 0) {
          return NextResponse.json({ error: "product and positive quantity are required for supplier receipt lines" }, { status: 400 });
        }
        line.uom = String(line.uom || "").trim();
        if (!line.uom) {
          return NextResponse.json({ error: "Выберите единицу измерения по каждой строке поставки" }, { status: 400 });
        }
        line.warehouse_to_id = line.warehouse_to_id || ticket.warehouse_to_id || null;
        if (!line.warehouse_to_id) {
          return NextResponse.json({ error: "Выберите склад по каждой строке поставки" }, { status: 400 });
        }
        if (supplierReceiptKind === "agro_identity") {
          if (!line.crop_id || !line.variety_id || !line.reproduction_id) {
            return NextResponse.json({ error: "crop_id, variety_id and reproduction_id are required for identity-aware supplier receipt" }, { status: 400 });
          }
          if (!line.lot_id && !(line as any).supplier_lot) {
            return NextResponse.json({ error: "supplier lot is required for identity-aware supplier receipt" }, { status: 400 });
          }
        }
      }
    }

    const stockEvent: StockBusinessEvent = isHarvestIncoming
      ? "harvest_incoming"
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

    for (const line of lines) {
      const contract = await resolveWarehouseStockContract(supabase, {
        companyId: ticket.company_id,
        productId: line.product_id,
        quantity: line.quantity,
        inputUom: line.uom,
        requestedBatchClass: line.batch_class,
        event: stockEvent,
        fieldMaterialCategory: ticket.field_material_category,
      });
      if (!isDirectSupplierReceipt && contract.baseUom !== "kg" && !isDirectWarehouseTransfer && !isDirectFieldIssue) {
        return NextResponse.json(
          { error: "Литры и штуки нельзя подменять весом нетто. Используйте прямой документ с количеством в единице товара." },
          { status: 400 }
        );
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
          { error: `РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РѕСЃС‚Р°С‚РєР° РґР»СЏ РїРµСЂРµРјРµС‰РµРЅРёСЏ. Р”РѕСЃС‚СѓРїРЅРѕ: ${available.toFixed(3)} РєРі, РЅСѓР¶РЅРѕ: ${requiredQty.toFixed(3)} РєРі` },
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
          { error: `РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РѕСЃС‚Р°С‚РєР° РґР»СЏ РѕС‚РїСѓСЃРєР° РІ РїРѕР»Рµ. Р”РѕСЃС‚СѓРїРЅРѕ: ${available.toFixed(3)} РєРі, РЅСѓР¶РЅРѕ: ${requiredQty.toFixed(3)} РєРі` },
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
      if (!ticket.linked_operation_id) {
        return NextResponse.json({ error: "Уборочная операция не определена автоматически." }, { status: 400 });
      }
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
      for (const line of lines) {
        if (!line.crop_id) {
          return NextResponse.json({ error: "crop_id is required for harvest incoming lines" }, { status: 400 });
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
        .select("id,is_active,archived,counterparty_type")
        .eq("company_id", ticket.company_id)
        .eq("id", ticket.supplier_id)
        .maybeSingle();
      if (supplierError || !supplier?.id) {
        return NextResponse.json({ error: "Supplier not found in current company" }, { status: 400 });
      }
      if (!supplier.is_active || supplier.archived || !["supplier", "both"].includes(String(supplier.counterparty_type || ""))) {
        return NextResponse.json({ error: "Supplier is inactive or not allowed for receipt" }, { status: 400 });
      }
    }
    if (isShipment) {
      const { data: buyer, error: buyerError } = await supabase
        .from("counterparties")
        .select("id,is_active,archived,counterparty_type")
        .eq("company_id", ticket.company_id)
        .eq("id", ticket.buyer_id)
        .maybeSingle();
      if (buyerError || !buyer?.id) {
        return NextResponse.json({ error: "Counterparty not found in current company" }, { status: 400 });
      }
      if (!buyer.is_active || buyer.archived || !["buyer", "both", "other"].includes(String(buyer.counterparty_type || ""))) {
        return NextResponse.json({ error: "Counterparty is inactive or not allowed for shipment" }, { status: 400 });
      }
    }

    if (ticket.vehicle_id) {
      const vehiclePromise = supabase
        .from("reference_vehicles")
        .select("id, name, plate_number, status, is_active, archived")
        .eq("company_id", ticket.company_id)
        .eq("id", ticket.vehicle_id)
        .maybeSingle();
      const activeByVehiclePromise = supabase
        .from("tickets")
        .select("id, ticket_no")
        .eq("company_id", ticket.company_id)
        .eq("vehicle_id", ticket.vehicle_id)
        .in("status", ["draft", "active", "ready_to_close"])
        .limit(1);
      const [{ data: vehicle, error: vehicleError }, { data: activeByVehicle, error: activeByVehicleError }] =
        await Promise.all([vehiclePromise, activeByVehiclePromise]);
      if (vehicleError || !vehicle?.id) {
        return NextResponse.json({ error: "Vehicle not found in current company" }, { status: 400 });
      }
      if (!vehicle.is_active || vehicle.archived) {
        return NextResponse.json({ error: "Vehicle is inactive or archived" }, { status: 400 });
      }
      if (activeByVehicleError) {
        return NextResponse.json({ error: activeByVehicleError.message }, { status: 400 });
      }
      if ((activeByVehicle || []).length > 0) {
        return NextResponse.json({ error: "This vehicle already has an active ticket" }, { status: 400 });
      }
    }

    if (isHarvestIncoming) {
      const seasonId = await resolveActiveSeasonId(supabase, ticket.company_id);
      if (!seasonId) {
        return NextResponse.json({ error: "Active season not found for company" }, { status: 400 });
      }
      const { data: structureRows, error: structureError } = await supabase
        .from("crop_structure")
        .select("id,field_id,season_id,crop_id,variety_id,reproduction_id,company_id")
        .eq("company_id", ticket.company_id)
        .eq("season_id", seasonId)
        .eq("field_id", ticket.field_id)
        .eq("archived", false);
      if (structureError) {
        return NextResponse.json({ error: structureError.message }, { status: 400 });
      }
      const allocation = (structureRows || []).find(
        (x: any) => String(x.id || "") === String(ticket.crop_structure_allocation_id || "")
      );
      if (!allocation) {
        return NextResponse.json(
          { error: "Selected crop_structure_allocation_id does not belong to this field/company/active season" },
          { status: 400 }
        );
      }
      const allowed = new Set(
        (structureRows || []).map(
          (x: any) => `${String(x.crop_id || "")}:${String(x.variety_id || "")}:${String(x.reproduction_id || "")}`
        )
      );
      for (const line of lines) {
        const keyV2 = `${String(line.crop_id || "")}:${String(line.variety_id || "")}:${String(line.reproduction_id || "")}`;
        if (!allowed.has(keyV2)) {
          return NextResponse.json(
            { error: "Line crop identity is not linked to field crop structure for active season" },
            { status: 400 }
          );
        }
        if (
          String(line.crop_id || "") !== String(allocation.crop_id || "") ||
          String(line.variety_id || "") !== String(allocation.variety_id || "") ||
          String(line.reproduction_id || "") !== String(allocation.reproduction_id || "")
        ) {
          return NextResponse.json(
            { error: "Line crop/variety/reproduction must match selected crop_structure_allocation_id" },
            { status: 400 }
          );
        }
      }
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

    const { data: createdTicket, error: ticketError } = await supabase
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
      .single();

    if (ticketError || !createdTicket?.id) {
      return NextResponse.json({ error: ticketError?.message || "Failed to create ticket" }, { status: 400 });
    }

    const productsMap = new Map<string, string>();
    const varietiesMap = new Map<string, string>();
    const reproductionsMap = new Map<string, string>();
    const [productsResult, varietiesResult, reproductionsResult] = await Promise.all([
      productsPromise,
      varietiesPromise,
      reproductionsPromise,
    ]);
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
      mass_kg: line.mass_kg ?? null,
      density_kg_per_l: line.density_kg_per_l ?? null,
      density_unit: line.density_unit ?? null,
      density_source: line.density_source ?? null,
      density_verification_status: line.density_verification_status ?? null,
      density_verified_at: line.density_verified_at ?? null,
      unit_source: line.unit_source ?? null,
      unit_contract_version: line.unit_contract_version ?? null,
    }));

    const { error: linesError } = await supabase.from("ticket_lines").insert(linesPayload);
    if (linesError) {
      await cleanupCreatedTicket(supabase, createdTicket.id);
      return NextResponse.json({ error: linesError.message }, { status: 400 });
    }

    if (weighings.length > 0) {
      const weighingsPayload = weighings.map((item) => ({
        ticket_id: createdTicket.id,
        company_id: ticket.company_id,
        weighing_no: item.weighing_no,
        measured_weight_kg: Number(item.measured_weight_kg || 0),
        measured_at: item.measured_at || new Date().toISOString(),
        device_source: item.device_source || "manual",
        operator_user_id: item.operator_user_id || ticket.created_by,
        comment: item.comment || null,
      }));
      const { error: weighingsError } = await supabase.from("ticket_weighings").insert(weighingsPayload);
      if (weighingsError) {
        await cleanupCreatedTicket(supabase, createdTicket.id);
        return NextResponse.json({ error: weighingsError.message }, { status: 400 });
      }
    }

    if (ticket.vehicle_id) {
      await supabase
        .from("reference_vehicles")
        .update({ status: "in_trip" })
        .eq("id", ticket.vehicle_id)
        .eq("company_id", ticket.company_id);
    }
    timing.dbMs = Date.now() - dbStartedAt;

    if (isDirectSupplierReceipt) {
      const rpcStartedAt = Date.now();
      const { error: finalizeError } = await supabase.rpc("finalize_weighbridge_ticket_v2", {
        p_ticket_id: createdTicket.id,
        p_actor_user_id: actor.id,
      });
      timing.rpcMs = Date.now() - rpcStartedAt;

      if (finalizeError) {
        await cleanupCreatedTicket(supabase, createdTicket.id);
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
    const { data: company } = await supabase
      .from("companies")
      .select("id,name")
      .eq("id", ticket.company_id)
      .maybeSingle();
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
