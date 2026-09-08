import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";
import type { HarvestDashboardFilters, HarvestPeriodPreset } from "@/lib/dashboard/harvest-summary";

export type HarvestDashboardQuery = {
  period: HarvestPeriodPreset;
  start?: string | null;
  end?: string | null;
  filters?: HarvestDashboardFilters;
};

type HarvestDashboardSection = "summary" | "warehouses" | "filters" | "bootstrap";

export type HarvestDashboardRequestOptions = {
  signal?: AbortSignal;
};

function queryString(section: HarvestDashboardSection, query?: HarvestDashboardQuery) {
  const params = new URLSearchParams({ section });
  if (query) {
    params.set("period", query.period);
    if (query.start) params.set("start", query.start);
    if (query.end) params.set("end", query.end);
    for (const [key, value] of Object.entries(query.filters || {})) if (value) params.set(key, value);
  }
  return params.toString();
}

async function getSection<T>(
  section: HarvestDashboardSection,
  query?: HarvestDashboardQuery,
  options: HarvestDashboardRequestOptions = {}
): Promise<T> {
  const headers = await buildClientAuthHeaders("none");
  const response = await fetch(`/api/dashboard/harvest-summary?${queryString(section, query)}`, {
    method: "GET",
    cache: "no-store",
    headers,
    signal: options.signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || "Не удалось загрузить сводку");
  return payload as T;
}

export const getHarvestSummary = <T,>(query: HarvestDashboardQuery, options?: HarvestDashboardRequestOptions) =>
  getSection<T>("summary", query, options);
export const getHarvestBootstrap = <T,>(query: HarvestDashboardQuery, options?: HarvestDashboardRequestOptions) =>
  getSection<T>("bootstrap", query, options);
export const getHarvestWarehouses = <T,>(query: HarvestDashboardQuery, options?: HarvestDashboardRequestOptions) =>
  getSection<T>("warehouses", query, options);
export const getHarvestFilters = <T,>(options?: HarvestDashboardRequestOptions) =>
  getSection<T>("filters", undefined, options);
