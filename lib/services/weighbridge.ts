import type { TicketInput, TicketLineInput, WeighbridgeTicket, WeighingInput } from "@/lib/types/weighbridge";

async function parseJsonOrThrow(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Request failed");
  }
  return payload;
}

export async function listTickets(companyId: string, userId: string): Promise<WeighbridgeTicket[]> {
  const response = await fetch(`/api/weighbridge/tickets?companyId=${encodeURIComponent(companyId)}&userId=${encodeURIComponent(userId)}`, {
    method: "GET",
    cache: "no-store",
  });
  const payload = await parseJsonOrThrow(response);
  return payload.tickets || [];
}

export async function getWeighbridgeBootstrap(companyId: string, userId: string) {
  const response = await fetch(
    `/api/weighbridge/bootstrap?companyId=${encodeURIComponent(companyId)}&userId=${encodeURIComponent(userId)}`,
    { method: "GET", cache: "no-store" }
  );
  return parseJsonOrThrow(response);
}

export async function getActiveShift(companyId: string, userId: string) {
  const response = await fetch(
    `/api/weighbridge/shifts?companyId=${encodeURIComponent(companyId)}&userId=${encodeURIComponent(userId)}`,
    { method: "GET", cache: "no-store" }
  );
  return parseJsonOrThrow(response);
}

export async function openShift(companyId: string, actorUserId: string, openingNote?: string) {
  const response = await fetch("/api/weighbridge/shifts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId, actorUserId, openingNote }),
  });
  return parseJsonOrThrow(response);
}

export async function closeShift(
  companyId: string,
  actorUserId: string,
  params?: { closingNote?: string; handoverNote?: string; force?: boolean }
) {
  const response = await fetch("/api/weighbridge/shifts", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId,
      actorUserId,
      closingNote: params?.closingNote,
      handoverNote: params?.handoverNote,
      force: Boolean(params?.force),
    }),
  });
  return parseJsonOrThrow(response);
}

export async function getTicketDetails(ticketId: string, userId: string) {
  const response = await fetch(`/api/weighbridge/tickets/${ticketId}?userId=${encodeURIComponent(userId)}`, {
    method: "GET",
    cache: "no-store",
  });
  return parseJsonOrThrow(response);
}

export async function patchTicket(
  ticketId: string,
  actorUserId: string,
  patch: {
    gross_weight_kg?: number;
    tare_weight_kg?: number;
    notes?: string | null;
    status?: "draft" | "active" | "ready_to_close";
  }
) {
  const response = await fetch(`/api/weighbridge/tickets/${ticketId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actorUserId, ...patch }),
  });
  return parseJsonOrThrow(response);
}

export async function createTicket(input: TicketInput, lines: TicketLineInput[], weighings: WeighingInput[] = []) {
  const response = await fetch("/api/weighbridge/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: input, lines, weighings }),
  });
  return parseJsonOrThrow(response);
}

export async function finalizeTicket(ticketId: string, actorUserId: string) {
  const response = await fetch(`/api/weighbridge/tickets/${ticketId}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actorUserId }),
  });
  return parseJsonOrThrow(response);
}

export async function voidTicket(ticketId: string, actorUserId: string, reason: string) {
  const response = await fetch(`/api/weighbridge/tickets/${ticketId}/void`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actorUserId, reason }),
  });
  return parseJsonOrThrow(response);
}

export async function adminTicketAction(
  ticketId: string,
  actorUserId: string,
  action: "void" | "archive" | "force_close",
  reason?: string
) {
  const response = await fetch(`/api/weighbridge/tickets/${ticketId}/admin-action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actorUserId, action, reason }),
  });
  return parseJsonOrThrow(response);
}

export async function downloadTicketPdf(ticketId: string, userId: string) {
  if (!ticketId) throw new Error("Ticket id is required");
  const printUrl = `/weighbridge/${encodeURIComponent(ticketId)}/print?autoprint=1&userId=${encodeURIComponent(userId)}`;
  window.open(printUrl, "_blank", "noopener,noreferrer");
}
