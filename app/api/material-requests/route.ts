import { NextRequest, NextResponse } from "next/server";
import {
  MATERIAL_REQUEST_READ_ROLES,
  MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES,
  asMaterialRequestError,
  resolveMaterialRequestSession,
  toWorkflowStatus,
} from "@/app/api/material-requests/_helpers";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import { resolveWorkTitle } from "@/lib/operations/work-title";
import {
  OperationMutationInputError,
  operationMutationError,
  requireOperationIdempotency,
} from "@/lib/server/operation-mutation";

type MaterialRequestItemInput = {
  id?: unknown;
  itemId?: unknown;
  preparedQuantity?: unknown;
};
import { buildProductPassport } from "@/lib/products/product-passport";
import { hasQaDataMarker } from "@/lib/utils/qa-data";
import { isAgrochemicalProductType } from "@/lib/warehouse/warehouse-scope";
import { normalizeStockUom } from "@/lib/warehouse/stock-unit-contract";
import { calculateStockMath } from "@/lib/warehouse/stock-math";

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function getWarehouseProductBalance(
  supabase: any,
  companyId: string,
  warehouseId: string,
  productId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("v_stock_balance_identity")
    .select("quantity")
    .eq("company_id", companyId)
    .eq("warehouse_id", warehouseId)
    .eq("product_id", productId);

  if (error) throw error;
  return (data || []).reduce((sum: number, row: any) => sum + toNumber(row.quantity), 0);
}

async function getWarehouseProductReservations(params: {
  supabase: any;
  companyId: string;
  warehouseId: string;
  productId: string;
  unit: string | null;
  excludeRequestId: string;
}) {
  const { data, error } = await params.supabase
    .from("warehouse_issue_requests")
    .select("id,request_number,status,warehouse_request_status,warehouse_issue_request_items(product_id,actual_product_id,prepared_quantity,issued_quantity,unit,prepared_unit,issued_unit)")
    .eq("company_id", params.companyId)
    .eq("source_warehouse_id", params.warehouseId)
    .in("warehouse_request_status", ["pending", "collecting", "ready_for_pickup"]);
  if (error) throw error;

  let reserved = 0;
  const reservations: Array<{ request_id: string; request_number: string; quantity: number }> = [];
  for (const requestRow of data || []) {
    if (String((requestRow as any).id) === params.excludeRequestId) continue;
    let requestReserved = 0;
    for (const item of (requestRow as any).warehouse_issue_request_items || []) {
      if (String(item.actual_product_id || item.product_id || "") !== params.productId) continue;
      if (params.unit) {
        try {
          const itemUnit = normalizeStockUom(
            item.prepared_unit || item.issued_unit || item.unit
          ).baseUom;
          if (itemUnit !== normalizeStockUom(params.unit).baseUom) continue;
        } catch {
          continue;
        }
      }
      requestReserved += Math.max(
        Number(item.prepared_quantity || 0) - Number(item.issued_quantity || 0),
        0
      );
    }
    if (requestReserved > 0.000001) {
      reserved += requestReserved;
      reservations.push({
        request_id: String((requestRow as any).id),
        request_number: String((requestRow as any).request_number || (requestRow as any).id),
        quantity: Number(requestReserved.toFixed(4)),
      });
    }
  }
  return { reserved, reservations };
}

function workflowToRawStatuses(status: string): string[] {
  switch (status) {
    case "active":
      return ["active", "new"];
    case "preparing":
      return ["preparing"];
    case "ready":
      return ["ready"];
    case "issued":
      return ["issued_by_warehouse", "issued", "received_confirmed"];
    case "partially_issued":
      return ["partially_issued"];
    case "cancelled":
      return ["cancelled"];
    default:
      return [];
  }
}

function isV5WarehouseSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as any)?.message || error || "");
  return /warehouse_request_status|collecting_at|prepared_quantity|received_quantity|expected_consumed_quantity|shortage_quantity|package_size|package_count|reconciliation_status|substitution_status|planned_product_id|actual_product_id|schema cache|column/i.test(message);
}

export async function GET(request: NextRequest) {
  try {
    const statusFilter = String(request.nextUrl.searchParams.get("status") || "").trim();
    const onlyMine = String(request.nextUrl.searchParams.get("mine") || "false").toLowerCase() === "true";

    const { actor, companyId, supabase } = await resolveMaterialRequestSession(request, {
      allowedRoles: MATERIAL_REQUEST_READ_ROLES,
    });

    const legacyItemSelect = `
          id,
          request_id,
          company_id,
          product_id,
          product_category,
          required_quantity,
          planned_quantity,
          issued_quantity,
          consumed_quantity,
          returned_quantity,
          unit,
          planned_rate_per_ha,
          actual_rate_per_ha,
          expected_return_quantity,
          return_received_quantity,
          loss_quantity,
          loss_reason,
          loss_comment,
          return_comment,
          batch_id,
          created_at,
          products:product_id(name, trade_name, normalized_name, type, unit, base_uom)
    `;
    const reconciliationItemSelect = `
          ${legacyItemSelect},
          prepared_quantity,
          prepared_unit,
          issued_unit,
          received_quantity,
          received_unit,
          expected_consumed_quantity,
          shortage_quantity,
          package_size,
          package_count,
          package_unit,
          reconciliation_status,
          substitution_status,
          planned_product_id,
          actual_product_id,
          substitution_reason,
          substitution_requested_by,
          substitution_approved_by,
          substitution_approved_at
    `;

    const buildQuery = (itemSelect: string) => {
      let query = supabase
        .from("warehouse_issue_requests")
        .select(`
        *,
        fields:field_id(name),
        operations:operation_id(operation_type, date, work_status, status, notes, archived),
        source_warehouse:source_warehouse_id(name, name_ru, name_kz, name_en),
        assigned_specialist:assigned_specialist_id(id, full_name, email),
        recipient:recipient_user_id(id, full_name, email),
        crops:crop_id(name,name_ru,name_kz,name_en,slug),
        varieties:variety_id(name),
        reproductions:reproduction_id(name,name_ru,name_kz,name_en,code),
        items:warehouse_issue_request_items(
          ${itemSelect}
        )
      `)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });

      if (statusFilter) {
        const rawStatuses = workflowToRawStatuses(statusFilter);
        if (rawStatuses.length > 0) {
          query = query.in("status", rawStatuses);
        }
      }

      if (onlyMine && (actor.role === "specialist" || actor.role === "brigadier")) {
        query = query.or(`assigned_specialist_id.eq.${actor.id},recipient_user_id.eq.${actor.id}`);
      }
      return query;
    };

    let { data, error } = await buildQuery(reconciliationItemSelect);
    if (error && isV5WarehouseSchemaError(error)) {
      const fallback = await buildQuery(legacyItemSelect);
      data = fallback.data;
      error = fallback.error;
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const rows = (data || []).filter((row: any) => {
      const operation = row.operations || {};
      if (operation.archived === true) return false;
      const qaText = [
        row.request_number,
        row.comment,
        operation.operation_type,
        operation.notes,
        row.fields?.name,
        row.source_warehouse?.name,
        row.source_warehouse?.name_ru,
      ].join(" ");
      return !hasQaDataMarker(qaText);
    }).map((row: any) => {
      const normalizedItems = (row.items || []).map((item: any) => {
        const plannedQty = toNumber(item.planned_quantity ?? item.required_quantity);
        const issuedQty = toNumber(item.issued_quantity);
        const preparedQty = item.prepared_quantity == null ? null : toNumber(item.prepared_quantity);
        const receivedQty = item.received_quantity == null ? null : toNumber(item.received_quantity);
        const consumedQty = item.consumed_quantity == null ? null : toNumber(item.consumed_quantity);
        const returnedQty = item.returned_quantity == null ? null : toNumber(item.returned_quantity);
        const expectedConsumedQty = item.expected_consumed_quantity == null ? null : toNumber(item.expected_consumed_quantity);
        const expectedReturnQty = item.expected_return_quantity == null ? null : toNumber(item.expected_return_quantity);
        const returnReceivedQty = item.return_received_quantity == null ? null : toNumber(item.return_received_quantity);
        const shortageQty = item.shortage_quantity == null ? null : toNumber(item.shortage_quantity);
        const lossQty = item.loss_quantity == null ? null : toNumber(item.loss_quantity);
        const packageSize = item.package_size == null ? null : toNumber(item.package_size);
        const packageCount = item.package_count == null ? null : toNumber(item.package_count);
        const passport = item.products
          ? buildProductPassport({ ...item.products, id: String(item.product_id || item.products.id || "") })
          : null;
        return {
          ...item,
          planned_quantity: plannedQty,
          prepared_quantity: preparedQty,
          received_quantity: receivedQty,
          issued_quantity: issuedQty,
          consumed_quantity: consumedQty,
          returned_quantity: returnedQty,
          expected_consumed_quantity: expectedConsumedQty,
          expected_return_quantity: expectedReturnQty,
          return_received_quantity: returnReceivedQty,
          shortage_quantity: shortageQty,
          loss_quantity: lossQty,
          package_size: packageSize,
          package_count: packageCount,
          product_name: passport?.displayName || brandName(item.products) || "-",
          product_type: item.products?.type || item.product_category || "-",
          product_unit:
            passport?.units.stockUnit && passport.units.stockUnit !== "unknown"
              ? passport.units.stockUnit
              : item.products?.base_uom || item.products?.unit || item.unit || "",
        };
      });

      const items =
        actor.role === "warehouse" || actor.role === "warehouse_operator"
          ? normalizedItems.filter((item: any) =>
              isAgrochemicalProductType(item.product_type || item.product_category)
            )
          : normalizedItems;
      const totalPlanned = items.reduce((sum: number, item: any) => sum + toNumber(item.planned_quantity), 0);
      const totalIssued = items.reduce((sum: number, item: any) => sum + toNumber(item.issued_quantity), 0);

      return {
        ...row,
        workflow_status: toWorkflowStatus(row.warehouse_request_status || row.status),
        field_name: row.fields?.name || "-",
        operation_type: resolveWorkTitle({
          operationType: row.operations?.operation_type || null,
          materials: items.map((item: any) => ({
            material_type: item.product_category,
            product_type: item.product_type,
            product_name: item.product_name,
          })),
        }),
        operation_date: row.operations?.date || null,
        operation_notes: row.operations?.notes || null,
        operation_work_status: row.operations?.work_status || row.operations?.status || null,
        crop_name: localizedName(row.crops, "ru") || null,
        variety_name: brandName(row.varieties) || null,
        reproduction_name: localizedName(row.reproductions, "ru", ["name", "code"]) || null,
        assigned_specialist_name: row.assigned_specialist?.full_name || row.assigned_specialist?.email || null,
        recipient_name: row.recipient?.full_name || row.recipient?.email || null,
        source_warehouse_name:
          row.source_warehouse?.name_ru ||
          row.source_warehouse?.name_kz ||
          row.source_warehouse?.name_en ||
          row.source_warehouse?.name ||
          null,
        total_planned_quantity: totalPlanned,
        total_issued_quantity: totalIssued,
        fully_issued: totalPlanned > 0 && totalIssued >= totalPlanned,
        items,
      };
    }).filter((row: any) => {
      if (actor.role !== "warehouse" && actor.role !== "warehouse_operator") return true;
      return row.items.length > 0;
    });

    return NextResponse.json({ requests: rows });
  } catch (error) {
    const sessionError = asMaterialRequestError(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestId = String(body.requestId || "").trim();
    const action = String(body.action || "").trim();
    const sourceWarehouseId = String(body.sourceWarehouseId || "").trim() || null;
    const itemsInput: MaterialRequestItemInput[] = Array.isArray(body.items)
      ? (body.items as MaterialRequestItemInput[])
      : [];

    if (!requestId) {
      return NextResponse.json({ error: "requestId is required" }, { status: 400 });
    }
    if (action !== "ready") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }

    const { actor, companyId, supabase } = await resolveMaterialRequestSession(request, {
      allowedRoles: MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES,
      requestedCompanyId: String(body.companyId || "").trim() || null,
    });
    const idempotency = requireOperationIdempotency(request, { ...body, requestId, action });

    const { data: existing, error: existingError } = await supabase
      .from("warehouse_issue_requests")
      .select("id,status")
      .eq("id", requestId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (existingError || !existing?.id) {
      return NextResponse.json(
        { error: existingError?.message || "Material request not found" },
        { status: 404 }
      );
    }

    const readyItemPlans = new Map<
      string,
      { preparedQuantity: number }
    >();
    if (action === "ready") {
      if (!sourceWarehouseId) {
        return NextResponse.json({ error: "Source warehouse is required before materials can be prepared" }, { status: 400 });
      }
      if (itemsInput.length === 0) {
        return NextResponse.json({ error: "Prepared quantities are required before materials can be marked ready" }, { status: 400 });
      }

      const { data: requestItems, error: requestItemsError } = await supabase
        .from("warehouse_issue_request_items")
        .select("id,product_id,planned_quantity,required_quantity,unit")
        .eq("request_id", requestId)
        .eq("company_id", companyId);
      if (requestItemsError) {
        return NextResponse.json({ error: requestItemsError.message || "Failed to load request materials" }, { status: 400 });
      }

      const inputByItemId = new Map(itemsInput.map((item) => [String(item.itemId || item.id || ""), item]));
      for (const item of requestItems || []) {
        const raw = inputByItemId.get(String(item.id));
        if (!raw) {
          return NextResponse.json({ error: `Prepared quantity is required for request item ${item.id}` }, { status: 400 });
        }
        const preparedQuantity =
          raw.preparedQuantity === null || raw.preparedQuantity === undefined || raw.preparedQuantity === ""
            ? 0
            : Number(Math.max(toNumber(raw.preparedQuantity), 0).toFixed(4));
        const productId = String(item.product_id || "");
        const onHand = await getWarehouseProductBalance(
          supabase,
          companyId,
          sourceWarehouseId,
          productId
        );
        const reservationState = await getWarehouseProductReservations({
          supabase,
          companyId,
          warehouseId: sourceWarehouseId,
          productId,
          unit: item.unit || null,
          excludeRequestId: requestId,
        });
        const stock = calculateStockMath(onHand, reservationState.reserved);
        if (preparedQuantity > stock.available + 0.000001) {
          return NextResponse.json(
            {
              error: `Недостаточно доступного остатка. Материал: ${item.product_id}; запрошено: ${preparedQuantity}; остаток: ${stock.onHand}; резерв: ${stock.reserved}; доступно: ${stock.available}; дефицит: ${Math.max(preparedQuantity - stock.available, 0)}`,
              product_id: item.product_id,
              requested_quantity: Number(item.planned_quantity ?? item.required_quantity ?? 0),
              on_hand_quantity: stock.onHand,
              reserved_quantity: stock.reserved,
              available_quantity: stock.available,
              deficit_quantity: Number(
                Math.max(preparedQuantity - stock.available, 0).toFixed(4)
              ),
              reservations: reservationState.reservations,
              requested_prepared_quantity: preparedQuantity,
            },
            { status: 409 }
          );
        }
        readyItemPlans.set(String(item.id), {
          preparedQuantity,
        });
      }

      if (!Array.from(readyItemPlans.values()).some((item) => item.preparedQuantity > 0.000001)) {
        return NextResponse.json({ error: "No available materials were prepared for this request" }, { status: 409 });
      }
    }

    const rpcItems = itemsInput.map((raw) => {
      const itemId = String(raw?.itemId || raw?.id || "").trim();
      const readyPlan = readyItemPlans.get(itemId);
      return {
        item_id: itemId,
        prepared_quantity: readyPlan?.preparedQuantity ?? toNumber(raw.preparedQuantity),
        prepared_unit: null,
      };
    }).filter((item) => item.item_id);
    const { data, error } = await supabase.rpc("update_material_request_stage_atomic_v1", {
      p_company_id: companyId,
      p_actor_profile_id: actor.id,
      p_request_id: requestId,
      p_action: action,
      p_source_warehouse_id: sourceWarehouseId,
      p_items: rpcItems,
      p_idempotency_key: idempotency.key,
      p_request_fingerprint: idempotency.fingerprint,
    });
    if (error || !data) {
      const failure = operationMutationError(error, "Material request stage was not saved");
      return NextResponse.json({ error: failure.message }, { status: failure.status });
    }
    return NextResponse.json(data);
  } catch (error) {
    const sessionError = asMaterialRequestError(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    if (error instanceof OperationMutationInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
