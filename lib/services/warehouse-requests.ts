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
        issued_quantity: item.issued_quantity == null ? null : toNumber(item.issued_quantity),
        consumed_quantity: item.consumed_quantity == null ? null : toNumber(item.consumed_quantity),
        returned_quantity: item.returned_quantity == null ? null : toNumber(item.returned_quantity),
        planned_rate_per_ha: item.planned_rate_per_ha == null ? null : toNumber(item.planned_rate_per_ha),
        actual_rate_per_ha: item.actual_rate_per_ha == null ? null : toNumber(item.actual_rate_per_ha),
      }))
    : [];

  return {
    ...row,
    status: normalizeStatus(row.status),
    items,
  } as WarehouseIssueRequest;
}

export async function getWarehouseIssueRequests(
  companyId: string
): Promise<WarehouseIssueRequest[]> {
  const headers = await buildAuthHeaders("none");
  const params = new URLSearchParams();
  params.set("companyId", companyId);
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
}): Promise<WarehouseIssueRequest[]> {
  const headers = await buildAuthHeaders("none");
  const query = new URLSearchParams();
  query.set("companyId", params.companyId);
  query.set("mine", "true");
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
  status: WarehouseIssueRequestStatus;
  sourceWarehouseId?: string | null;
}): Promise<void> {
  const action =
    params.status === "preparing"
      ? "preparing"
      : params.status === "ready"
        ? "ready"
        : params.status === "cancelled"
          ? "cancel"
          : null;
  if (!action) {
    throw new Error(`Unsupported status action for ${params.status}`);
  }

  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/material-requests", {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      requestId: params.requestId,
      companyId: params.companyId,
      action,
      sourceWarehouseId: params.sourceWarehouseId || null,
    }),
  });
  await parseApiResponse(response);
}

export async function issueWarehouseRequest(params: {
  requestId: string;
  companyId: string;
  sourceWarehouseId: string;
  items?: Array<{ itemId: string; issuedQuantity: number; batchId?: string | null }>;
}): Promise<void> {
  const headers = await buildAuthHeaders("json");
  const response = await fetch(`/api/material-requests/${encodeURIComponent(params.requestId)}/issue`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      companyId: params.companyId,
      sourceWarehouseId: params.sourceWarehouseId,
      items: params.items || [],
    }),
  });
  await parseApiResponse(response);
}

export async function confirmWarehouseReceipt(params: {
  requestId: string;
  companyId: string;
}): Promise<void> {
  const headers = await buildAuthHeaders("json");
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
  items: Array<{ itemId: string; returnedQuantity: number }>;
}): Promise<void> {
  const headers = await buildAuthHeaders("json");
  const response = await fetch(`/api/material-requests/${encodeURIComponent(params.requestId)}/return`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      companyId: params.companyId,
      items: params.items,
    }),
  });
  await parseApiResponse(response);
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
