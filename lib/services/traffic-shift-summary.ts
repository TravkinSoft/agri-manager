import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";
import type {
  TrafficClosedShiftHistoryPage,
  TrafficClosedShiftSummary,
} from "@/lib/traffic/shift-summary";
import {
  normalizeTrafficClosedShiftHistoryPage,
  normalizeTrafficClosedShiftSummary,
} from "@/lib/traffic/shift-summary-normalize";

export async function getLatestClosedTrafficShiftSummary(): Promise<TrafficClosedShiftSummary | null> {
  let headers: HeadersInit;
  try {
    headers = await buildClientAuthHeaders("none");
  } catch (caught) {
    if (caught instanceof Error && caught.message.startsWith("Missing authorization token")) {
      throw Object.assign(caught, { status: 401 });
    }
    throw caught;
  }
  const response = await fetch("/api/dashboard/traffic-shift-summary", {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = Object.assign(
      new Error(payload?.error || "Не удалось загрузить итог смены"),
      { status: response.status },
    );
    throw error;
  }
  return normalizeTrafficClosedShiftSummary(payload?.summary);
}

async function historyAuthHeaders() {
  try {
    return await buildClientAuthHeaders("none");
  } catch (caught) {
    if (caught instanceof Error && caught.message.startsWith("Missing authorization token")) {
      throw Object.assign(caught, { status: 401 });
    }
    throw caught;
  }
}

async function historyResponse(
  query: URLSearchParams,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/dashboard/traffic-shift-history?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: await historyAuthHeaders(),
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(payload?.error || "Не удалось загрузить историю смен"),
      { status: response.status },
    );
  }
  return payload;
}

export async function getClosedTrafficShiftHistoryPage(
  options: { cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<TrafficClosedShiftHistoryPage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 10) });
  if (options.cursor) query.set("cursor", options.cursor);
  const payload = await historyResponse(query, signal);
  return normalizeTrafficClosedShiftHistoryPage(payload?.page);
}

export async function getClosedTrafficShiftSummaryById(
  shiftId: string,
  signal?: AbortSignal,
): Promise<TrafficClosedShiftSummary | null> {
  const payload = await historyResponse(new URLSearchParams({ shiftId }), signal);
  return normalizeTrafficClosedShiftSummary(payload?.summary);
}
