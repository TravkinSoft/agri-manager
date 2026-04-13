import { supabase } from "@/lib/supabase/client";
import { localizedName } from "@/lib/i18n/helpers";
import { Language } from "@/lib/i18n/translations";
import type {
  WarehouseIssueRequest,
  WarehouseIssueRequestStatus,
} from "@/lib/types/warehouse-request";

function normalizeStatus(value: unknown): WarehouseIssueRequestStatus {
  if (value === "issued") return "received_confirmed";
  if (
    value === "ready" ||
    value === "issued_by_warehouse" ||
    value === "received_confirmed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "new";
}

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export async function getWarehouseIssueRequests(
  companyId: string,
  language: Language = "ru"
): Promise<WarehouseIssueRequest[]> {
  const { data, error } = await supabase
    .from("warehouse_issue_requests")
    .select(`
      *,
      fields:field_id(name),
      operations:operation_id(operation_type, date),
      recipient:recipient_user_id(email),
      source_warehouse:source_warehouse_id(name, name_ru, name_kz, name_en),
      items:warehouse_issue_request_items(
        id,
        request_id,
        company_id,
        product_id,
        product_category,
        required_quantity,
        issued_quantity,
        unit,
        created_at,
        products:product_id(name, name_ru, name_kz, name_en, type, unit)
      )
    `)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((row: any) => ({
    ...row,
    status: normalizeStatus(row.status),
    field_name: localizedName(row.fields, language, ["name"]) || "-",
    operation_type: row.operations?.operation_type || "-",
    operation_date: row.operations?.date || null,
    recipient_email: row.recipient?.email || "-",
    source_warehouse_name: localizedName(row.source_warehouse, language, ["name"]) || null,
    items: (row.items || []).map((item: any) => ({
      ...item,
      required_quantity: toNumber(item.required_quantity),
      issued_quantity: item.issued_quantity === null ? null : toNumber(item.issued_quantity),
      product_name: localizedName(item.products, language, ["name"]) || "-",
      product_type: item.products?.type || item.product_category || "-",
      product_unit: item.products?.unit || item.unit || "kg",
    })),
  })) as WarehouseIssueRequest[];
}

export async function updateWarehouseIssueRequestStatus(params: {
  requestId: string;
  companyId: string;
  status: WarehouseIssueRequestStatus;
  sourceWarehouseId?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    status: params.status,
    updated_at: now,
  };

  if (params.sourceWarehouseId !== undefined) {
    payload.source_warehouse_id = params.sourceWarehouseId || null;
  }

  if (params.status === "ready") payload.ready_at = now;
  if (params.status === "cancelled") payload.cancelled_at = now;

  const { error } = await supabase
    .from("warehouse_issue_requests")
    .update(payload)
    .eq("id", params.requestId)
    .eq("company_id", params.companyId);

  if (error) throw new Error(error.message);
}

export async function issueWarehouseRequest(params: {
  requestId: string;
  actorUserId: string;
  sourceWarehouseId: string;
}): Promise<void> {
  const { error } = await supabase.rpc("issue_warehouse_request", {
    p_request_id: params.requestId,
    p_actor_user_id: params.actorUserId,
    p_source_warehouse_id: params.sourceWarehouseId,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function getRecipientWarehouseIssueRequests(params: {
  companyId: string;
  recipientUserId: string;
  language?: Language;
}): Promise<WarehouseIssueRequest[]> {
  const { data, error } = await supabase
    .from("warehouse_issue_requests")
    .select(`
      *,
      fields:field_id(name),
      operations:operation_id(operation_type, date),
      recipient:recipient_user_id(email),
      source_warehouse:source_warehouse_id(name, name_ru, name_kz, name_en),
      items:warehouse_issue_request_items(
        id,
        request_id,
        company_id,
        product_id,
        product_category,
        required_quantity,
        issued_quantity,
        unit,
        created_at,
        products:product_id(name, name_ru, name_kz, name_en, type, unit)
      )
    `)
    .eq("company_id", params.companyId)
    .eq("recipient_user_id", params.recipientUserId)
    .in("status", ["issued_by_warehouse", "received_confirmed"])
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (data || []).map((row: any) => ({
    ...row,
    status: normalizeStatus(row.status),
    field_name: localizedName(row.fields, params.language || "ru", ["name"]) || "-",
    operation_type: row.operations?.operation_type || "-",
    operation_date: row.operations?.date || null,
    recipient_email: row.recipient?.email || "-",
    source_warehouse_name: localizedName(row.source_warehouse, params.language || "ru", ["name"]) || null,
    items: (row.items || []).map((item: any) => ({
      ...item,
      required_quantity: toNumber(item.required_quantity),
      issued_quantity: item.issued_quantity === null ? null : toNumber(item.issued_quantity),
      product_name: localizedName(item.products, params.language || "ru", ["name"]) || "-",
      product_type: item.products?.type || item.product_category || "-",
      product_unit: item.products?.unit || item.unit || "kg",
    })),
  })) as WarehouseIssueRequest[];
}

export async function confirmWarehouseReceipt(params: {
  requestId: string;
  actorUserId: string;
}): Promise<void> {
  const { error } = await supabase.rpc("confirm_warehouse_request_receipt", {
    p_request_id: params.requestId,
    p_actor_user_id: params.actorUserId,
  });

  if (error) throw new Error(error.message);
}

export async function createIssueTicketFromRequest(params: {
  requestId: string;
  actorUserId: string;
  sourceWarehouseId: string;
}): Promise<{ ticketId: string; ticketNo?: string; duplicate?: boolean }> {
  const response = await fetch("/api/weighbridge/from-request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requestId: params.requestId,
      actorUserId: params.actorUserId,
      sourceWarehouseId: params.sourceWarehouseId,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to create weighbridge ticket");
  }

  return {
    ticketId: String(payload.ticketId),
    ticketNo: payload.ticketNo ? String(payload.ticketNo) : undefined,
    duplicate: Boolean(payload.duplicate),
  };
}
