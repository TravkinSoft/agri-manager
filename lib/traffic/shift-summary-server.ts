import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/service";
import { ptcVehicleDisplayPlate } from "@/lib/traffic/vehicle-eligibility";
import {
  buildTrafficClosedShiftSummary,
  type ClosedTrafficShiftRow,
  type TrafficClosedShiftHistoryItem,
  type TrafficClosedShiftHistoryPage,
  type TrafficClosedShiftSummary,
  type TrafficShiftEvent,
  type TrafficShiftVehicleIdentity,
} from "@/lib/traffic/shift-summary";

const EVENT_PAGE_SIZE = 500;
const MAX_SHIFT_DURATION_MS = 36 * 60 * 60 * 1_000;
const MAX_SHIFT_EVENT_ROWS = 10_000;
const VEHICLE_CHUNK_SIZE = 100;
const HISTORY_PAGE_SIZE = 10;
const HISTORY_PAGE_SIZE_MAX = 25;
const SUMMARY_CACHE_MAX_COMPANIES = 100;
const SUMMARY_CACHE_TTL_MS = 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMPTZ_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

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

type TrafficShiftHistoryCursor = {
  closedAt: string;
  shiftId: string;
};

export class TrafficShiftHistoryInputError extends Error {
  constructor(message = "Invalid closed PTC shift history request") {
    super(message);
    this.name = "TrafficShiftHistoryInputError";
  }
}

export class TrafficShiftReconstructionLimitError extends Error {
  constructor(message = "Closed PTC shift exceeds the safe reconstruction budget") {
    super(message);
    this.name = "TrafficShiftReconstructionLimitError";
  }
}

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

function assertShiftId(shiftId: string) {
  if (!UUID_PATTERN.test(shiftId)) throw new TrafficShiftHistoryInputError();
}

function encodeHistoryCursor(row: ShiftDbRow) {
  return Buffer.from(JSON.stringify({
    closedAt: row.closed_at,
    shiftId: row.id,
  } satisfies TrafficShiftHistoryCursor), "utf8").toString("base64url");
}

function decodeHistoryCursor(cursor: string): TrafficShiftHistoryCursor {
  if (!cursor || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))
    throw new TrafficShiftHistoryInputError();
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<TrafficShiftHistoryCursor>;
    if (
      typeof value.closedAt !== "string" ||
      !TIMESTAMPTZ_PATTERN.test(value.closedAt) ||
      !Number.isFinite(Date.parse(value.closedAt)) ||
      typeof value.shiftId !== "string" ||
      !UUID_PATTERN.test(value.shiftId)
    ) throw new TrafficShiftHistoryInputError();
    return { closedAt: value.closedAt, shiftId: value.shiftId };
  } catch (error) {
    if (error instanceof TrafficShiftHistoryInputError) throw error;
    throw new TrafficShiftHistoryInputError();
  }
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function closedShiftHistoryItem(
  row: ShiftDbRow,
  fieldName: string | null,
): TrafficClosedShiftHistoryItem {
  const openedAt = Date.parse(row.opened_at);
  const closedAt = Date.parse(row.closed_at);
  return {
    shiftId: String(row.id),
    operatorName: String(row.operator_name || "Комбайнёр"),
    fieldName: fieldName?.trim() || null,
    openedAt: String(row.opened_at),
    closedAt: String(row.closed_at),
    durationMinutes: Number.isFinite(openedAt) && Number.isFinite(closedAt)
      ? Math.max(0, Math.round((closedAt - openedAt) / 60_000))
      : 0,
    hectaresShift: finiteNumber(row.hectares_shift),
    hectaresFieldTotal: finiteNumber(row.hectares_field_total),
  };
}

async function readShiftEvents(
  db: SupabaseClient,
  companyId: string,
  openedAt: string,
  closedAt: string,
): Promise<TrafficShiftEvent[]> {
  const openedAtMs = Date.parse(openedAt);
  const closedAtMs = Date.parse(closedAt);
  if (
    !Number.isFinite(openedAtMs) ||
    !Number.isFinite(closedAtMs) ||
    closedAtMs < openedAtMs ||
    closedAtMs - openedAtMs > MAX_SHIFT_DURATION_MS
  ) {
    throw new TrafficShiftReconstructionLimitError();
  }

  const events: EventDbRow[] = [];
  let cursor: { createdAt: string; id: string } | null = null;
  for (;;) {
    const remainingBudget = MAX_SHIFT_EVENT_ROWS - events.length;
    const pageSize = Math.min(EVENT_PAGE_SIZE, remainingBudget);
    let query = db
      .from("ptc_events")
      .select("id,vehicle_id,actor_user_id,from_state,to_state,cycle,created_at")
      .eq("company_id", companyId)
      .gte("created_at", openedAt)
      .lte("created_at", closedAt)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (cursor) {
      query = query.or(
        `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
      );
    }
    // Fetch one sentinel row beyond the current page/budget. It is never used
    // in analytics; its sole purpose is to fail rather than return a partial
    // (and therefore false) shift summary.
    const { data, error } = await query.limit(pageSize + 1);
    if (error) throw error;
    const page = (data ?? []) as EventDbRow[];
    if (page.length > pageSize) {
      if (remainingBudget <= EVENT_PAGE_SIZE) {
        throw new TrafficShiftReconstructionLimitError();
      }
      events.push(...page.slice(0, pageSize));
    } else {
      events.push(...page);
      return events;
    }
    const last = events[events.length - 1];
    if (!last?.created_at || !last.id) {
      throw new TrafficShiftReconstructionLimitError();
    }
    cursor = { createdAt: last.created_at, id: last.id };
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

async function readSummaryForClosedShiftRow(
  db: SupabaseClient,
  companyId: string,
  row: ShiftDbRow,
): Promise<TrafficClosedShiftSummary> {
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
    hectaresShift: finiteNumber(row.hectares_shift),
    hectaresFieldTotal: finiteNumber(row.hectares_field_total),
  };
  return buildTrafficClosedShiftSummary(
    shift,
    events,
    vehicles,
    String((fieldResult.data as { name?: unknown } | null)?.name ?? "") || null,
  );
}

/**
 * Reads only durable shift rows for the list. Event-derived analytics are
 * intentionally deferred until the user expands one concrete shift.
 */
export async function readClosedTrafficShiftHistoryPage(
  companyId: string,
  options: { cursor?: string | null; limit?: number } = {},
  db: SupabaseClient = getServiceClient(),
): Promise<TrafficClosedShiftHistoryPage> {
  const requestedLimit = Number.isFinite(options.limit)
    ? Math.trunc(options.limit as number)
    : HISTORY_PAGE_SIZE;
  const limit = Math.max(1, Math.min(HISTORY_PAGE_SIZE_MAX, requestedLimit));
  const cursor = options.cursor ? decodeHistoryCursor(options.cursor) : null;

  let query = db
    .from("ptc_combine_shifts")
    .select("id,operator_user_id,operator_name,field_id,opened_at,closed_at,hectares_shift,hectares_field_total")
    .eq("company_id", companyId)
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .order("id", { ascending: false });
  if (cursor) {
    query = query.or(
      `closed_at.lt.${cursor.closedAt},and(closed_at.eq.${cursor.closedAt},id.lt.${cursor.shiftId})`,
    );
  }
  const { data, error } = await query.limit(limit + 1);
  if (error) throw error;
  const rows = ((data ?? []) as ShiftDbRow[]).filter((row) => Boolean(row.closed_at));
  const pageRows = rows.slice(0, limit);
  const fieldIds = Array.from(new Set(pageRows.flatMap((row) => row.field_id ? [row.field_id] : [])));
  const fieldResult = fieldIds.length
    ? await db
        .from("fields")
        .select("id,name")
        .eq("company_id", companyId)
        .in("id", fieldIds)
        .order("id", { ascending: true })
    : { data: [], error: null };
  if (fieldResult.error) throw fieldResult.error;
  const fieldNames = new Map((fieldResult.data ?? []).map((row) => [
    String((row as { id: unknown }).id),
    String((row as { name?: unknown }).name ?? "") || null,
  ]));
  return {
    items: pageRows.map((row) => closedShiftHistoryItem(
      row,
      row.field_id ? fieldNames.get(row.field_id) ?? null : null,
    )),
    nextCursor: rows.length > limit && pageRows.length
      ? encodeHistoryCursor(pageRows[pageRows.length - 1])
      : null,
  };
}

export async function readClosedTrafficShiftSummaryById(
  companyId: string,
  shiftId: string,
  db: SupabaseClient = getServiceClient(),
): Promise<TrafficClosedShiftSummary | null> {
  assertShiftId(shiftId);
  const { data, error } = await db
    .from("ptc_combine_shifts")
    .select("id,operator_user_id,operator_name,field_id,opened_at,closed_at,hectares_shift,hectares_field_total")
    .eq("company_id", companyId)
    .eq("id", shiftId)
    .not("closed_at", "is", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as ShiftDbRow;
  if (!row.closed_at) return null;
  return readSummaryForClosedShiftRow(db, companyId, row);
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

  const summary = readSummaryForClosedShiftRow(db, companyId, row);
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
