import { supabase } from "@/lib/supabase/client";
import type { WarehouseIssueRequest, WarehouseIssueRequestStatus } from "@/lib/types/warehouse-request";

async function buildAuthHeaders(contentType: "json" | "none" = "none") {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Session not found. Please log in again.");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${data.session.access_token}`,
  };
  if (contentType === "json") {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

async function parseApiResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Request failed");
  }
  return payload;
}

function normalizeStatus(value: unknown): WarehouseIssueRequestStatus {
  if (
    value === "new" ||
    value === "active" ||
    value === "preparing" ||
    value === "ready" ||
    value === "issued" ||
    value === "partially_issued" ||
    value === "issued_by_warehouse" ||
    value === "received_confirmed" ||
    value === "closed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "active";
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRequestRow(row: any): WarehouseIssueRequest {
  const items = Array.isArray(row.items)
    ? row.items.map((item: any) => ({
        ...item,
        required_quantity: toNumber(item.required_quantity),
        planned_quantity: item.planned_quantity == null ? null : toNumber(item.planned_quantity),
        prepared_quantity: item.prepared_quantity == null ? null : toNumber(item.prepared_quantity),
        issued_quantity: item.issued_quantity == null ? null : toNumber(item.issued_quantity),
        received_quantity: item.received_quantity == null ? null : toNumber(item.received_quantity),
        consumed_quantity: item.consumed_quantity == null ? null : toNumber(item.consumed_quantity),
        returned_quantity: item.returned_quantity == null ? null : toNumber(item.returned_quantity),
        planned_rate_per_ha: item.planned_rate_per_ha == null ? null : toNumber(item.planned_rate_per_ha),
        actual_rate_per_ha: item.actual_rate_per_ha == null ? null : toNumber(item.actual_rate_per_ha),
        expected_consumed_quantity: item.expected_consumed_quantity == null ? null : toNumber(item.expected_consumed_quantity),
        expected_return_quantity: item.expected_return_quantity == null ? null : toNumber(item.expected_return_quantity),
        return_received_quantity: item.return_received_quantity == null ? null : toNumber(item.return_received_quantity),
        shortage_quantity: item.shortage_quantity == null ? null : toNumber(item.shortage_quantity),
        loss_quantity: item.loss_quantity == null ? null : toNumber(item.loss_quantity),
        allocations: Array.isArray(item.allocations)
          ? item.allocations.map((allocation: any) => ({
              ...allocation,
              prepared_quantity: toNumber(allocation.prepared_quantity),
              issued_quantity: toNumber(allocation.issued_quantity),
            }))
          : [],
      }))
    : [];

  return {
    ...row,
    status: normalizeStatus(row.status),
    items,
  } as WarehouseIssueRequest;
}

export async function getWarehouseIssueRequests(
  companyId: string,
  options?: { includeTestData?: boolean; warehouseId?: string }
): Promise<WarehouseIssueRequest[]> {
  const headers = await buildAuthHeaders("none");
  const params = new URLSearchParams();
  params.set("companyId", companyId);
  if (options?.includeTestData) params.set("includeTestData", "true");
  if (options?.warehouseId) params.set("warehouseId", options.warehouseId);
  const response = await fetch(`/api/material-requests?${params.toString()}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const payload = await parseApiResponse(response);
  return Array.isArray(payload.requests) ? payload.requests.map(normalizeRequestRow) : [];
}

export async function getRecipientWarehouseIssueRequests(params: {
  companyId: string;
  recipientUserId: string;
  includeTestData?: boolean;
}): Promise<WarehouseIssueRequest[]> {
  const headers = await buildAuthHeaders("none");
  const query = new URLSearchParams();
  query.set("companyId", params.companyId);
  query.set("mine", "true");
  if (params.includeTestData) query.set("includeTestData", "true");
  const response = await fetch(`/api/material-requests?${query.toString()}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const payload = await parseApiResponse(response);
  const rows = Array.isArray(payload.requests) ? payload.requests.map(normalizeRequestRow) : [];
  return rows.filter((row: WarehouseIssueRequest) => {
    const assigned = String(row.assigned_specialist_id || row.recipient_user_id || "");
    return assigned === params.recipientUserId;
  });
}

export async function updateWarehouseIssueRequestStatus(params: {
  requestId: string;
  companyId: string;
  status: "ready";
  sourceWarehouseId?: string | null;
  items?: Array<{
    itemId: string;
    preparedQuantity: number;
    allocations: Array<{
      batchId?: string | null;
      batchIdText?: string | null;
      batchClass: string;
      batchLabel: string;
      quantity: number;
    }>;
  }>;
}): Promise<void> {
  const headers = await buildAuthHeaders("json");
  const idempotencyKey = crypto.randomUUID();
  headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch("/api/material-requests", {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      requestId: params.requestId,
      companyId: params.companyId,
      action: "ready",
      sourceWarehouseId: params.sourceWarehouseId || null,
      items: params.items || [],
      idempotency_key: idempotencyKey,
    }),
  });
  await parseApiResponse(response);
}

export async function adminTransitionWarehouseRequest(params: {
  requestId: string;
  companyId: string;
  action: "return_to_preparation" | "cancel" | "record_loss";
  reason: string;
  items?: Array<{ itemId: string; lossQuantity: number }>;
}): Promise<void> {
  const headers = await buildAuthHeaders("json");
  const idempotencyKey = crypto.randomUUID();
  headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(
    `/api/material-requests/${encodeURIComponent(params.requestId)}/admin`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        companyId: params.companyId,
        action: params.action,
        reason: params.reason,
        items: params.items || [],
        idempotency_key: idempotencyKey,
      }),
    }
  );
  await parseApiResponse(response);
}

export async function reconcileWarehouseReturn(params: {
  requestId: string;
  companyId: string;
  items: Array<{ itemId: string; returnedQuantity: number }>;
  closeWithoutReturn?: boolean;
}): Promise<void> {
  const headers = await buildAuthHeaders("json");
  const idempotencyKey = crypto.randomUUID();
  headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(
    `/api/material-requests/${encodeURIComponent(params.requestId)}/warehouse-return`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        companyId: params.companyId,
        items: params.items,
        closeWithoutReturn: Boolean(params.closeWithoutReturn),
        idempotency_key: idempotencyKey,
      }),
    }
  );
  await parseApiResponse(response);
}

export async function issueWarehouseRequest(params: {
  requestId: string;
  companyId: string;
  sourceWarehouseId: string;
  items?: Array<{ itemId: string; issuedQuantity: number }>;
}): Promise<void> {
  const headers = await buildAuthHeaders("json");
  const idempotencyKey = crypto.randomUUID();
  headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`/api/material-requests/${encodeURIComponent(params.requestId)}/issue`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      companyId: params.companyId,
      sourceWarehouseId: params.sourceWarehouseId,
      items: params.items || [],
      idempotency_key: idempotencyKey,
    }),
  });
  await parseApiResponse(response);
}

export async function confirmWarehouseReceipt(params: {
  requestId: string;
  companyId: string;
}): Promise<void> {
  const headers = await buildAuthHeaders("json");
  const idempotencyKey = crypto.randomUUID();
  headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`/api/material-requests/${encodeURIComponent(params.requestId)}/confirm`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      companyId: params.companyId,
    }),
  });
  await parseApiResponse(response);
}

export async function returnWarehouseRequestMaterials(params: {
  requestId: string;
  companyId: string;
  items: Array<{
    itemId: string;
    consumedQuantity?: number | null;
    returnedQuantity: number;
    lossQuantity?: number | null;
  }>;
  closeWithoutReturn?: boolean;
  acceptReturn?: boolean;
}): Promise<void> {
  const headers = await buildAuthHeaders("json");
  const idempotencyKey = crypto.randomUUID();
  headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`/api/material-requests/${encodeURIComponent(params.requestId)}/return`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      companyId: params.companyId,
      items: params.items,
      closeWithoutReturn: Boolean(params.closeWithoutReturn),
      acceptReturn: Boolean(params.acceptReturn),
      idempotency_key: idempotencyKey,
    }),
  });
  await parseApiResponse(response);
}

export async function acceptWarehouseReturnMaterials(params: {
  requestId: string;
  companyId: string;
  items: Array<{ itemId: string; returnedQuantity: number }>;
}): Promise<void> {
  return returnWarehouseRequestMaterials({
    requestId: params.requestId,
    companyId: params.companyId,
    items: params.items,
    acceptReturn: true,
  });
}

export async function createIssueTicketFromRequest(params: {
  requestId: string;
  companyId: string;
  sourceWarehouseId: string;
  vehicleId?: string | null;
}): Promise<{ ticketId: string; ticketNo?: string; duplicate?: boolean }> {
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/weighbridge/from-request", {
    method: "POST",
    headers,
    body: JSON.stringify({
      requestId: params.requestId,
      companyId: params.companyId,
      sourceWarehouseId: params.sourceWarehouseId,
      vehicleId: params.vehicleId || null,
    }),
  });
  const payload = await parseApiResponse(response);
  return {
    ticketId: String(payload.ticketId),
    ticketNo: payload.ticketNo ? String(payload.ticketNo) : undefined,
    duplicate: Boolean(payload.duplicate),
  };
}
