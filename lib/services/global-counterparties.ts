import { supabase } from "@/lib/supabase/client";
import type { CounterpartyCountryCode, GlobalCounterparty } from "@/lib/types/counterparty";

async function headers(json = false): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Сессия истекла");
  return {
    Authorization: `Bearer ${data.session.access_token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function parse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || "Request failed");
  return payload;
}

export async function listGlobalCounterparties(params: {
  search?: string;
  country?: CounterpartyCountryCode | "all";
  status?: "active" | "archived" | "all";
}): Promise<GlobalCounterparty[]> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.country && params.country !== "all") query.set("country", params.country);
  if (params.status) query.set("status", params.status);
  const response = await fetch(`/api/global-admin/counterparties?${query.toString()}`, {
    headers: await headers(),
    cache: "no-store",
  });
  return (await parse(response)).counterparties || [];
}

export async function updateGlobalCounterparty(
  id: string,
  patch: {
    legalName?: string;
    taxId?: string;
    countryCode?: CounterpartyCountryCode;
    archived?: boolean;
  },
): Promise<GlobalCounterparty> {
  const response = await fetch(`/api/global-admin/counterparties/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: await headers(true),
    body: JSON.stringify(patch),
  });
  return (await parse(response)).counterparty;
}
