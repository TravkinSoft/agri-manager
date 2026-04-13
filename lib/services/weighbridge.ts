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

export async function downloadTicketPdf(ticketId: string, userId: string) {
  const response = await fetch(
    `/api/weighbridge/tickets/${ticketId}/pdf?userId=${encodeURIComponent(userId)}`,
    {
      method: "GET",
      cache: "no-store",
    }
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || "Failed to generate PDF");
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ticket-${ticketId}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
