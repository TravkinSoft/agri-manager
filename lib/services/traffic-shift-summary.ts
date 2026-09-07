import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";
import type { TrafficClosedShiftSummary } from "@/lib/traffic/shift-summary";
import { normalizeTrafficClosedShiftSummary } from "@/lib/traffic/shift-summary-normalize";

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
