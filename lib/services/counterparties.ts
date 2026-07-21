import { supabase } from "@/lib/supabase/client";
import type {
  Counterparty,
  CounterpartySearchResult,
  CreateCounterpartyInput,
  ListCounterpartiesParams,
  UpdateCounterpartyInput,
} from "@/lib/types/counterparty";

async function authHeaders(json = false): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Сессия истекла");
  return {
    Authorization: `Bearer ${data.session.access_token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function parseJsonOrThrow(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || "Request failed");
  return payload;
}

export async function listCounterparties(params: ListCounterpartiesParams): Promise<Counterparty[]> {
  const search = new URLSearchParams({ companyId: params.companyId });
  if (params.type && params.type !== "all") search.set("type", params.type);
  if (params.activeOnly !== undefined) search.set("activeOnly", String(params.activeOnly));
  if (params.status) search.set("status", params.status);
  if (params.country && params.country !== "all") search.set("country", params.country);
  if (params.search) search.set("search", params.search);
  const response = await fetch(`/api/counterparties?${search.toString()}`, {
    method: "GET",
    headers: await authHeaders(),
    cache: "no-store",
  });
  const payload = await parseJsonOrThrow(response);
  return (payload.counterparties || []) as Counterparty[];
}

export async function searchSupplierCounterparties(
  companyId: string,
  query: string,
): Promise<CounterpartySearchResult[]> {
  const search = new URLSearchParams({ companyId, q: query });
  const response = await fetch(`/api/counterparties/search?${search.toString()}`, {
    method: "GET",
    headers: await authHeaders(),
    cache: "no-store",
  });
  const payload = await parseJsonOrThrow(response);
  return (payload.results || []) as CounterpartySearchResult[];
}

export async function createCounterparty(input: CreateCounterpartyInput): Promise<Counterparty> {
  const response = await fetch("/api/counterparties", {
    method: "POST",
    headers: await authHeaders(true),
    body: JSON.stringify(input),
  });
  const payload = await parseJsonOrThrow(response);
  return payload.counterparty as Counterparty;
}

export async function updateCounterparty(
  counterpartyId: string,
  input: UpdateCounterpartyInput,
): Promise<Counterparty> {
  const response = await fetch(`/api/counterparties/${encodeURIComponent(counterpartyId)}`, {
    method: "PATCH",
    headers: await authHeaders(true),
    body: JSON.stringify(input),
  });
  const payload = await parseJsonOrThrow(response);
  return payload.counterparty as Counterparty;
}
