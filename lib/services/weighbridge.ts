import type { HarvestBatchSummary, TicketInput, TicketLineInput, WeighbridgeTicket, WeighingInput } from "@/lib/types/weighbridge";
import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";
import { hasQaDataMarker } from "@/lib/utils/qa-data";

async function parseJsonOrThrow(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Request failed");
  }
  return payload;
}

export async function listTickets(companyId?: string, _userId?: string): Promise<WeighbridgeTicket[]> {
  const headers = await buildClientAuthHeaders("none");
  const url = companyId
    ? `/api/weighbridge/tickets?companyId=${encodeURIComponent(companyId)}`
    : "/api/weighbridge/tickets";
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers,
  });
  const payload = await parseJsonOrThrow(response);
  return ((payload.tickets || []) as WeighbridgeTicket[]).filter((ticket) => !hasQaDataMarker(JSON.stringify(ticket)));
}

export async function getWeighbridgeBootstrap(companyId?: string, _userId?: string) {
  const headers = await buildClientAuthHeaders("none");
  const url = companyId
    ? `/api/weighbridge/bootstrap?companyId=${encodeURIComponent(companyId)}`
    : "/api/weighbridge/bootstrap";
  const response = await fetch(url, { method: "GET", cache: "no-store", headers });
  return parseJsonOrThrow(response);
}

export async function getWeighbridgeResources(companyId?: string) {
  const headers = await buildClientAuthHeaders("none");
  const url = companyId
    ? `/api/weighbridge/resources?companyId=${encodeURIComponent(companyId)}`
    : "/api/weighbridge/resources";
  const response = await fetch(url, { method: "GET", cache: "no-store", headers });
  return parseJsonOrThrow(response);
}

export async function listHarvestBatchSummaries(companyId?: string): Promise<HarvestBatchSummary[]> {
  const headers = await buildClientAuthHeaders("none");
  const url = companyId
    ? `/api/weighbridge/harvest-batches?companyId=${encodeURIComponent(companyId)}`
    : "/api/weighbridge/harvest-batches";
  const response = await fetch(url, { method: "GET", cache: "no-store", headers });
  const payload = await parseJsonOrThrow(response);
  return (payload.batches || []) as HarvestBatchSummary[];
}

export async function getActiveShift(companyId?: string, _userId?: string) {
  const headers = await buildClientAuthHeaders("none");
  const url = companyId
    ? `/api/weighbridge/shifts?companyId=${encodeURIComponent(companyId)}`
    : "/api/weighbridge/shifts";
  const response = await fetch(url, { method: "GET", cache: "no-store", headers });
  return parseJsonOrThrow(response);
}

export async function openShift(companyId?: string, _actorUserId?: string, openingNote?: string) {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch("/api/weighbridge/shifts", {
    method: "POST",
    headers,
    body: JSON.stringify({ companyId, openingNote }),
  });
  return parseJsonOrThrow(response);
}

export async function closeShift(
  companyId?: string,
  _actorUserId?: string,
  params?: { closingNote?: string; handoverNote?: string; force?: boolean }
) {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch("/api/weighbridge/shifts", {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      companyId,
      closingNote: params?.closingNote,
      handoverNote: params?.handoverNote,
      force: Boolean(params?.force),
    }),
  });
  return parseJsonOrThrow(response);
}

export async function getTicketDetails(ticketId: string, _userId?: string) {
  const headers = await buildClientAuthHeaders("none");
  const response = await fetch(`/api/weighbridge/tickets/${ticketId}`, {
    method: "GET",
    cache: "no-store",
    headers,
  });
  return parseJsonOrThrow(response);
}

export async function patchTicket(
  ticketId: string,
  _actorUserId: string,
  patch: {
    gross_weight_kg?: number;
    tare_weight_kg?: number;
    moisture_percent?: number | null;
    notes?: string | null;
    status?: "draft" | "active" | "ready_to_close";
  }
) {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch(`/api/weighbridge/tickets/${ticketId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ ...patch }),
  });
  return parseJsonOrThrow(response);
}

export async function createTicket(
  input: TicketInput,
  lines: TicketLineInput[],
  weighings: WeighingInput[] = [],
  idempotencyKey?: string
) {
  const headers = await buildClientAuthHeaders("json");
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch("/api/weighbridge/tickets", {
    method: "POST",
    headers,
    body: JSON.stringify({ ticket: input, lines, weighings }),
  });
  return parseJsonOrThrow(response);
}

export async function finalizeTicket(ticketId: string, _actorUserId: string) {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch(`/api/weighbridge/tickets/${ticketId}/finalize`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  return parseJsonOrThrow(response);
}

export async function voidTicket(ticketId: string, _actorUserId: string, reason: string) {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch(`/api/weighbridge/tickets/${ticketId}/void`, {
    method: "POST",
    headers,
    body: JSON.stringify({ reason }),
  });
  return parseJsonOrThrow(response);
}

export async function adminTicketAction(
  ticketId: string,
  _actorUserId: string,
  action: "void" | "archive" | "force_close",
  reason?: string
) {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch(`/api/weighbridge/tickets/${ticketId}/admin-action`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, reason }),
  });
  return parseJsonOrThrow(response);
}

export async function downloadTicketPdf(ticketId: string, _userId?: string) {
  if (!ticketId) throw new Error("Ticket id is required");
  const printUrl = `/weighbridge/${encodeURIComponent(ticketId)}/print?autoprint=1`;
  window.open(printUrl, "_blank", "noopener,noreferrer");
}
