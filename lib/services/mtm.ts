import { supabase } from "@/lib/supabase/client";
import type { MtmCatalogItem, MtmCatalogResponse, MtmModelKind, MtmModelOption, MtmOptionsResponse, MtmProductOption, MtmSaveRequest } from "@/lib/mtm/types";

export class MtmApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) { super(message); }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (init.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  if (error || !data.session?.access_token) throw new MtmApiError("Сессия истекла. Войдите снова.", 401);
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new MtmApiError(payload.error || "Не удалось выполнить запрос МТМ.", response.status, payload.code);
  return payload as T;
}

type PageQuery = { companyId: string; search?: string; offset?: number; limit?: number };
function queryString(query: PageQuery & { barcode?: string; kind?: string }) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") result.set(key, String(value));
  }
  return result.toString();
}

export function getMtmCatalog(query: PageQuery & { barcode?: string }, signal?: AbortSignal) {
  return request<MtmCatalogResponse>(`/api/mtm/catalog?${queryString(query)}`, { signal });
}
export function getMtmProducts(query: PageQuery, signal?: AbortSignal) {
  return request<MtmOptionsResponse<MtmProductOption>>(`/api/mtm/options?${queryString({ ...query, kind: "products" })}`, { signal });
}
export function getMtmModels(query: PageQuery & { kind: MtmModelKind }, signal?: AbortSignal) {
  return request<MtmOptionsResponse<MtmModelOption>>(`/api/mtm/options?${queryString(query)}`, { signal });
}
export function saveMtmItem(productId: string, body: MtmSaveRequest, signal?: AbortSignal) {
  return request<{ item: MtmCatalogItem }>(`/api/mtm/catalog/${encodeURIComponent(productId)}`, { method: "PUT", body: JSON.stringify(body), signal });
}
