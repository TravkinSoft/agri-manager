import { supabase } from "@/lib/supabase/client";
import type {
  CreateMealOrderInput,
  CreateThermosInput,
  MealOrder,
  MealOrderStatus,
  MealThermosBootstrapPayload,
  MealAwaitingReturn,
  Thermos,
  ThermosReturnAction,
  ThermosStatus,
} from "@/lib/types/meal-thermoses";

async function buildAuthHeaders(contentType: "json" | "none" = "none") {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) {
    throw new Error("Session expired");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${data.session.access_token}`,
  };
  if (contentType === "json") {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

async function parseJsonOrThrow(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Request failed");
  }
  return payload;
}

function toQueryString(params: Record<string, string | null | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    const normalized = String(value || "").trim();
    if (normalized) {
      query.set(key, normalized);
    }
  });
  return query.toString();
}

export async function getMealThermosBootstrap(
  companyId: string,
  filters?: { mealDate?: string | null; status?: string | null }
) {
  const headers = await buildAuthHeaders("none");
  const qs = toQueryString({
    companyId,
    mealDate: filters?.mealDate || null,
    status: filters?.status || null,
  });
  const response = await fetch(`/api/meal-thermoses/bootstrap?${qs}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  return (await parseJsonOrThrow(response)) as MealThermosBootstrapPayload;
}

export async function getMealOrders(
  companyId: string,
  filters?: { mealDate?: string | null; status?: string | null }
) {
  const headers = await buildAuthHeaders("none");
  const qs = toQueryString({
    companyId,
    mealDate: filters?.mealDate || null,
    status: filters?.status || null,
  });
  const response = await fetch(`/api/meal-thermoses/orders?${qs}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const payload = (await parseJsonOrThrow(response)) as { orders: MealOrder[] };
  return payload.orders || [];
}

export async function createMealOrder(companyId: string, input: CreateMealOrderInput) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/meal-thermoses/orders", {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...input,
      companyId,
    }),
  });
  const payload = (await parseJsonOrThrow(response)) as { order: MealOrder };
  return payload.order;
}

export async function updateMealOrderStatus(
  orderId: string,
  companyId: string,
  status: MealOrderStatus
) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch(`/api/meal-thermoses/orders/${encodeURIComponent(orderId)}/status`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      companyId,
      status,
    }),
  });
  const payload = (await parseJsonOrThrow(response)) as { order: MealOrder };
  return payload.order;
}

export async function assignMealOrderThermoses(
  orderId: string,
  companyId: string,
  assignments: Array<{ meal_order_person_id: string; thermos_id: string }>,
  comment?: string | null
) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch(`/api/meal-thermoses/orders/${encodeURIComponent(orderId)}/assign`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      companyId,
      assignments,
      comment: comment || null,
    }),
  });
  return parseJsonOrThrow(response);
}

export async function issueMealOrder(orderId: string, companyId: string) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch(`/api/meal-thermoses/orders/${encodeURIComponent(orderId)}/issue`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      companyId,
    }),
  });
  return parseJsonOrThrow(response);
}

export async function returnMealOrderThermoses(
  orderId: string,
  companyId: string,
  updates: Array<{ meal_order_person_id: string; action: ThermosReturnAction; comment?: string | null }>
) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch(`/api/meal-thermoses/orders/${encodeURIComponent(orderId)}/returns`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      companyId,
      updates,
    }),
  });
  return parseJsonOrThrow(response);
}

export async function getThermoses(
  companyId: string,
  filters?: { status?: ThermosStatus | "all"; includeInactive?: boolean }
) {
  const headers = await buildAuthHeaders("none");
  const qs = toQueryString({
    companyId,
    status: filters?.status || null,
    includeInactive: filters?.includeInactive ? "true" : "false",
  });
  const response = await fetch(`/api/meal-thermoses/thermoses?${qs}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const payload = (await parseJsonOrThrow(response)) as { thermoses: Thermos[] };
  return payload.thermoses || [];
}

export async function createThermos(companyId: string, input: CreateThermosInput) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/meal-thermoses/thermoses", {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...input,
      companyId,
    }),
  });
  const payload = (await parseJsonOrThrow(response)) as { thermos: Thermos };
  return payload.thermos;
}

export async function updateThermos(
  thermosId: string,
  companyId: string,
  patch: { status?: ThermosStatus; label?: string | null; volume_l?: number | null; comment?: string | null }
) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch(`/api/meal-thermoses/thermoses/${encodeURIComponent(thermosId)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      ...patch,
      companyId,
    }),
  });
  const payload = (await parseJsonOrThrow(response)) as { thermos: Thermos };
  return payload.thermos;
}

export type { MealThermosBootstrapPayload, MealAwaitingReturn };

