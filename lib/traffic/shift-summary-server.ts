import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/service";
import { ptcVehicleDisplayPlate } from "@/lib/traffic/vehicle-eligibility";
import {
  buildTrafficClosedShiftSummary,
  type ClosedTrafficShiftRow,
  type TrafficClosedShiftSummary,
  type TrafficShiftEvent,
  type TrafficShiftVehicleIdentity,
} from "@/lib/traffic/shift-summary";

const EVENT_PAGE_SIZE = 500;
const VEHICLE_CHUNK_SIZE = 100;
const SUMMARY_CACHE_MAX_COMPANIES = 100;
const SUMMARY_CACHE_TTL_MS = 60_000;

type ShiftDbRow = {
  id: string;
  operator_user_id: string;
  operator_name: string;
  field_id: string | null;
  opened_at: string;
  closed_at: string;
  hectares_shift: number | string | null;
  hectares_field_total: number | string | null;
};

type EventDbRow = TrafficShiftEvent & { id: string };

type VehicleDbRow = {
  id: string;
  name: string | null;
  brand: string | null;
  license_plate: string | null;
  plate_number: string | null;
  source_machine_id: string | null;
};

type CachedClosedShiftSummary = {
  shiftIdentity: string;
  cachedAt: number;
  summary: Promise<TrafficClosedShiftSummary>;
};

const closedShiftSummaryCache = new Map<string, CachedClosedShiftSummary>();

function closedShiftIdentity(row: ShiftDbRow) {
  return JSON.stringify([
    row.id,
    row.closed_at,
    row.opened_at,
    row.operator_user_id,
    row.operator_name,
    row.field_id,
    row.hectares_shift,
    row.hectares_field_total,
  ]);
}

function cacheClosedShiftSummary(
  companyId: string,
  entry: CachedClosedShiftSummary,
) {
  closedShiftSummaryCache.delete(companyId);
  closedShiftSummaryCache.set(companyId, entry);
  while (closedShiftSummaryCache.size > SUMMARY_CACHE_MAX_COMPANIES) {
    const oldestCompanyId = closedShiftSummaryCache.keys().next().value;
    if (!oldestCompanyId) break;
    closedShiftSummaryCache.delete(oldestCompanyId);
  }
}

async function readShiftEvents(
  db: SupabaseClient,
  companyId: string,
  openedAt: string,
  closedAt: string,
): Promise<TrafficShiftEvent[]> {
  const events: EventDbRow[] = [];
  for (let from = 0; ; from += EVENT_PAGE_SIZE) {
    const { data, error } = await db
      .from("ptc_events")
      .select("id,vehicle_id,actor_user_id,from_state,to_state,cycle,created_at")
      .eq("company_id", companyId)
      .gte("created_at", openedAt)
      .lte("created_at", closedAt)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + EVENT_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as EventDbRow[];
    events.push(...page);
    if (page.length < EVENT_PAGE_SIZE) return events;
  }
}

async function readVehicleIdentities(
  db: SupabaseClient,
  companyId: string,
  vehicleIds: string[],
): Promise<TrafficShiftVehicleIdentity[]> {
  const vehicles: TrafficShiftVehicleIdentity[] = [];
  for (let index = 0; index < vehicleIds.length; index += VEHICLE_CHUNK_SIZE) {
    const chunk = vehicleIds.slice(index, index + VEHICLE_CHUNK_SIZE);
    const { data, error } = await db
      .from("reference_vehicles")
      .select("id,name,brand,license_plate,plate_number,source_machine_id")
      .eq("company_id", companyId)
      .in("id", chunk)
      .order("id", { ascending: true });
    if (error) throw error;
    vehicles.push(...((data ?? []) as VehicleDbRow[]).map((row) => ({
      id: String(row.id),
      name: String(row.name || "Машина"),
      brand: row.brand ? String(row.brand) : null,
      plate: ptcVehicleDisplayPlate(row),
    })));
  }
  return vehicles;
}

export async function readLatestClosedTrafficShiftSummary(
  companyId: string,
  db: SupabaseClient = getServiceClient(),
): Promise<TrafficClosedShiftSummary | null> {
  const { data, error } = await db
    .from("ptc_combine_shifts")
    .select("id,operator_user_id,operator_name,field_id,opened_at,closed_at,hectares_shift,hectares_field_total")
    .eq("company_id", companyId)
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as ShiftDbRow;
  if (!row.closed_at) return null;

  const shiftIdentity = closedShiftIdentity(row);
  const cached = closedShiftSummaryCache.get(companyId);
  if (cached?.shiftIdentity === shiftIdentity &&
      Date.now() - cached.cachedAt < SUMMARY_CACHE_TTL_MS) {
    cacheClosedShiftSummary(companyId, cached);
    return cached.summary;
  }

  const summary = (async () => {
    const [events, fieldResult] = await Promise.all([
      readShiftEvents(db, companyId, row.opened_at, row.closed_at),
      row.field_id
        ? db.from("fields").select("id,name").eq("company_id", companyId).eq("id", row.field_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (fieldResult.error) throw fieldResult.error;
    const vehicleIds = Array.from(new Set(events
      .filter((event) => event.to_state === "loaded")
      .map((event) => event.vehicle_id)));
    const vehicles = await readVehicleIdentities(db, companyId, vehicleIds);
    const shift: ClosedTrafficShiftRow = {
      id: String(row.id),
      operatorUserId: String(row.operator_user_id),
      operatorName: String(row.operator_name || "Комбайнёр"),
      fieldId: row.field_id ? String(row.field_id) : null,
      openedAt: String(row.opened_at),
      closedAt: String(row.closed_at),
      hectaresShift: row.hectares_shift === null ? null : Number(row.hectares_shift),
      hectaresFieldTotal: row.hectares_field_total === null ? null : Number(row.hectares_field_total),
    };
    return buildTrafficClosedShiftSummary(
      shift,
      events,
      vehicles,
      String((fieldResult.data as { name?: unknown } | null)?.name ?? "") || null,
    );
  })();
  const entry = { shiftIdentity, cachedAt: Date.now(), summary };
  cacheClosedShiftSummary(companyId, entry);
  try {
    return await summary;
  } catch (error) {
    if (closedShiftSummaryCache.get(companyId) === entry) {
      closedShiftSummaryCache.delete(companyId);
    }
    throw error;
  }
}
