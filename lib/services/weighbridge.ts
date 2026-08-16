import type { ActiveHarvestRoute, HarvestBatchSummary, TicketInput, TicketLineInput, WeighbridgeOperatorState, WeighbridgeTicket, WeighingInput } from "@/lib/types/weighbridge";
import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";
import { hasQaDataMarker } from "@/lib/utils/qa-data";
import type { WeighbridgeTransportPickerData } from "@/lib/weighbridge/transport-pairing";

async function parseJsonOrThrow(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || "Request failed") as Error & {
      status?: number;
      payload?: Record<string, unknown>;
    };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

type TicketListView = "open" | "today" | "history";
const TICKET_LIST_TTL_MS = 15_000;
const TICKET_DETAILS_TTL_MS = 30_000;
const ticketListCache = new Map<string, { expiresAt: number; tickets: WeighbridgeTicket[] }>();
const ticketListRequests = new Map<string, Promise<WeighbridgeTicket[]>>();
const ticketDetailsCache = new Map<string, { expiresAt: number; payload: unknown }>();
const ticketDetailsRequests = new Map<string, Promise<unknown>>();

export function invalidateWeighbridgeTicketCache(ticketId?: string) {
  ticketListCache.clear();
  if (ticketId) ticketDetailsCache.delete(ticketId);
  else ticketDetailsCache.clear();
}

async function parseTicketMutation(response: Response, ticketId?: string) {
  const payload = await parseJsonOrThrow(response);
  invalidateWeighbridgeTicketCache(ticketId);
  return payload;
}

export async function listTickets(
  companyId?: string,
  _userId?: string,
  options?: {
    workspace?: boolean;
    signal?: AbortSignal;
    view?: TicketListView;
    from?: string;
    limit?: number;
    fresh?: boolean;
  }
): Promise<WeighbridgeTicket[]> {
  const query = new URLSearchParams();
  if (companyId) query.set("companyId", companyId);
  if (options?.workspace) query.set("workspace", "true");
  if (options?.view) query.set("view", options.view);
  if (options?.from) query.set("from", options.from);
  if (options?.limit) query.set("limit", String(options.limit));
  const url = `/api/weighbridge/tickets${query.size ? `?${query.toString()}` : ""}`;
  const cacheKey = url;
  const cached = ticketListCache.get(cacheKey);
  if (!options?.fresh && cached && cached.expiresAt > Date.now()) return cached.tickets;
  if (!options?.fresh && !options?.signal) {
    const pending = ticketListRequests.get(cacheKey);
    if (pending) return pending;
  }

  const request = (async () => {
    const headers = await buildClientAuthHeaders("none");
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers,
      signal: options?.signal,
    });
    const payload = await parseJsonOrThrow(response);
    const tickets = ((payload.tickets || []) as WeighbridgeTicket[])
      .filter((ticket) => !hasQaDataMarker(JSON.stringify(ticket)));
    ticketListCache.set(cacheKey, { expiresAt: Date.now() + TICKET_LIST_TTL_MS, tickets });
    return tickets;
  })();
  if (!options?.signal) ticketListRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (!options?.signal) ticketListRequests.delete(cacheKey);
  }
}

export async function getWeighbridgeBootstrap(
  companyId?: string,
  _userId?: string,
  options?: { includeSummary?: boolean; signal?: AbortSignal }
) {
  const headers = await buildClientAuthHeaders("none");
  const query = new URLSearchParams();
  if (companyId) query.set("companyId", companyId);
  if (options?.includeSummary) query.set("summary", "true");
  const url = `/api/weighbridge/bootstrap${query.size ? `?${query.toString()}` : ""}`;
  const response = await fetch(url, { method: "GET", cache: "no-store", headers, signal: options?.signal });
  return parseJsonOrThrow(response);
}

export async function getWeighbridgeResources(companyId?: string, options?: { signal?: AbortSignal }) {
  const headers = await buildClientAuthHeaders("none");
  const url = companyId
    ? `/api/weighbridge/resources?companyId=${encodeURIComponent(companyId)}`
    : "/api/weighbridge/resources";
  const response = await fetch(url, { method: "GET", cache: "no-store", headers, signal: options?.signal });
  return parseJsonOrThrow(response);
}

export async function getWeighbridgeTransportPickerData(
  companyId?: string,
  options?: { signal?: AbortSignal }
): Promise<WeighbridgeTransportPickerData> {
  const headers = await buildClientAuthHeaders("none");
  const url = companyId
    ? `/api/weighbridge/transport-pairs?companyId=${encodeURIComponent(companyId)}`
    : "/api/weighbridge/transport-pairs";
  const response = await fetch(url, { method: "GET", cache: "no-store", headers, signal: options?.signal });
  return parseJsonOrThrow(response) as Promise<WeighbridgeTransportPickerData>;
}

export async function listHarvestBatchSummaries(
  companyId?: string,
  options?: { warehouseId?: string; aggregateLots?: boolean }
): Promise<HarvestBatchSummary[]> {
  const headers = await buildClientAuthHeaders("none");
  const query = new URLSearchParams();
  if (companyId) query.set("companyId", companyId);
  if (options?.warehouseId) query.set("warehouseId", options.warehouseId);
  if (options?.aggregateLots) query.set("view", "lots");
  const url = `/api/weighbridge/harvest-batches${query.size ? `?${query.toString()}` : ""}`;
  const response = await fetch(url, { method: "GET", cache: "no-store", headers });
  const payload = await parseJsonOrThrow(response);
  return (payload.batches || []) as HarvestBatchSummary[];
}

export type ActiveHarvestRouteList = {
  seasonId: string | null;
  seasonYear: number | null;
  active: ActiveHarvestRoute[];
  completed: ActiveHarvestRoute[];
};

export type ActiveHarvestRouteMutationResult = {
  routeId: string;
  seasonId: string;
  seasonYear: number;
  createdAt: string;
  updatedAt: string;
};

export async function listActiveHarvestRoutes(companyId: string): Promise<ActiveHarvestRouteList> {
  const headers = await buildClientAuthHeaders("none");
  const response = await fetch(
    `/api/weighbridge/active-harvests?companyId=${encodeURIComponent(companyId)}`,
    { method: "GET", cache: "no-store", headers }
  );
  return parseJsonOrThrow(response) as Promise<ActiveHarvestRouteList>;
}

export async function createActiveHarvestRoute(
  companyId: string,
  cropStructureId: string,
  warehouseId: string
): Promise<ActiveHarvestRouteMutationResult> {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch("/api/weighbridge/active-harvests", {
    method: "POST",
    headers,
    body: JSON.stringify({ companyId, cropStructureId, warehouseId }),
  });
  return parseJsonOrThrow(response) as Promise<ActiveHarvestRouteMutationResult>;
}

export async function updateActiveHarvestRoute(
  companyId: string,
  routeId: string,
  action: "complete" | "restore"
): Promise<ActiveHarvestRouteList> {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch(`/api/weighbridge/active-harvests/${encodeURIComponent(routeId)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ companyId, action }),
  });
  return parseJsonOrThrow(response) as Promise<ActiveHarvestRouteList>;
}

export async function changeActiveHarvestRouteContext(
  companyId: string,
  routeId: string,
  cropStructureId: string,
  fieldId: string,
  warehouseId: string
): Promise<{ routeId: string; updatedAt: string }> {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch(`/api/weighbridge/active-harvests/${encodeURIComponent(routeId)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ companyId, action: "change_context", cropStructureId, fieldId, warehouseId }),
  });
  return parseJsonOrThrow(response) as Promise<{ routeId: string; updatedAt: string }>;
}

export async function getActiveShift(companyId?: string, _userId?: string) {
  const headers = await buildClientAuthHeaders("none");
  const url = companyId
    ? `/api/weighbridge/shifts?companyId=${encodeURIComponent(companyId)}`
    : "/api/weighbridge/shifts";
  const response = await fetch(url, { method: "GET", cache: "no-store", headers });
  return parseJsonOrThrow(response);
}

export async function getWeighbridgeOperatorState(
  companyId?: string,
  options?: { signal?: AbortSignal }
): Promise<WeighbridgeOperatorState> {
  const headers = await buildClientAuthHeaders("none");
  const url = companyId
    ? `/api/weighbridge/operator-session?companyId=${encodeURIComponent(companyId)}`
    : "/api/weighbridge/operator-session";
  const response = await fetch(url, { method: "GET", cache: "no-store", headers, signal: options?.signal });
  return parseJsonOrThrow(response) as Promise<WeighbridgeOperatorState>;
}

async function mutateOperatorSession(body: Record<string, unknown>): Promise<WeighbridgeOperatorState> {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch("/api/weighbridge/operator-session", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return parseJsonOrThrow(response) as Promise<WeighbridgeOperatorState>;
}

export function unlockWeighbridgeOperator(companyId: string, personId: string, pin: string) {
  return mutateOperatorSession({ action: "unlock", companyId, personId, pin });
}

export function handoverWeighbridgeOperator(companyId: string, personId: string, pin: string, note?: string) {
  return mutateOperatorSession({ action: "handover", companyId, personId, pin, note });
}

export function lockWeighbridgeOperator(companyId: string) {
  return mutateOperatorSession({ action: "lock", companyId });
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

export async function getTicketDetails(ticketId: string, _userId?: string, options?: { fresh?: boolean }) {
  const cached = ticketDetailsCache.get(ticketId);
  if (!options?.fresh && cached && cached.expiresAt > Date.now()) return cached.payload;
  if (!options?.fresh) {
    const pending = ticketDetailsRequests.get(ticketId);
    if (pending) return pending;
  }
  const request = (async () => {
    const headers = await buildClientAuthHeaders("none");
    const response = await fetch(`/api/weighbridge/tickets/${ticketId}`, {
      method: "GET",
      cache: "no-store",
      headers,
    });
    const payload = await parseJsonOrThrow(response);
    ticketDetailsCache.set(ticketId, { expiresAt: Date.now() + TICKET_DETAILS_TTL_MS, payload });
    return payload;
  })();
  ticketDetailsRequests.set(ticketId, request);
  try {
    return await request;
  } finally {
    ticketDetailsRequests.delete(ticketId);
  }
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
    reason?: string | null;
    confirm_tare_variance?: boolean;
  }
) {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch(`/api/weighbridge/tickets/${ticketId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ ...patch }),
  });
  return parseTicketMutation(response, ticketId);
}

export async function startTicketCorrection(ticketId: string, reason: string) {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch(`/api/weighbridge/tickets/${ticketId}/correction`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "start", reason }),
  });
  return parseTicketMutation(response, ticketId);
}

export async function finalizeTicketCorrection(ticketId: string) {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch(`/api/weighbridge/tickets/${ticketId}/correction`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "finalize" }),
  });
  return parseTicketMutation(response, ticketId);
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
  return parseTicketMutation(response);
}

export async function finalizeTicket(ticketId: string, _actorUserId: string) {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch(`/api/weighbridge/tickets/${ticketId}/finalize`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  return parseTicketMutation(response, ticketId);
}

export async function voidTicket(ticketId: string, _actorUserId: string, reason: string) {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch(`/api/weighbridge/tickets/${ticketId}/void`, {
    method: "POST",
    headers,
    body: JSON.stringify({ reason }),
  });
  return parseTicketMutation(response, ticketId);
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
  return parseTicketMutation(response, ticketId);
}

export async function downloadTicketPdf(ticketId: string, _userId?: string) {
  if (!ticketId) throw new Error("Ticket id is required");
  const printUrl = `/weighbridge/${encodeURIComponent(ticketId)}/print?autoprint=1`;
  window.open(printUrl, "_blank", "noopener,noreferrer");
}
