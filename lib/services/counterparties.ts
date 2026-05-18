import type {
  Counterparty,
  CreateCounterpartyInput,
  ListCounterpartiesParams,
  UpdateCounterpartyInput,
} from "@/lib/types/counterparty";

async function parseJsonOrThrow(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Request failed");
  }
  return payload;
}

export async function listCounterparties(params: ListCounterpartiesParams): Promise<Counterparty[]> {
  const search = new URLSearchParams({
    companyId: params.companyId,
    userId: params.userId,
  });
  if (params.type && params.type !== "all") search.set("type", params.type);
  if (params.activeOnly !== undefined) search.set("activeOnly", String(params.activeOnly));

  const response = await fetch(`/api/counterparties?${search.toString()}`, {
    method: "GET",
    cache: "no-store",
  });
  const payload = await parseJsonOrThrow(response);
  return (payload.counterparties || []) as Counterparty[];
}

export async function createCounterparty(input: CreateCounterpartyInput): Promise<Counterparty> {
  const response = await fetch("/api/counterparties", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseJsonOrThrow(response);
  return payload.counterparty as Counterparty;
}

export async function updateCounterparty(counterpartyId: string, input: UpdateCounterpartyInput): Promise<Counterparty> {
  const response = await fetch(`/api/counterparties/${encodeURIComponent(counterpartyId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseJsonOrThrow(response);
  return payload.counterparty as Counterparty;
}
