import { NextRequest } from "next/server";
import { getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServiceClient } from "@/lib/supabase/service";
import { failed, noStore, TrafficError } from "@/lib/traffic/server";
import { SUMMARY_SECTION_ROLES } from "@/lib/dashboard/summary-sections";
import { resolveHarvestPeriod } from "@/lib/dashboard/harvest-summary";
import { isSummaryDate, summaryDayKey } from "@/lib/dashboard/summary-periods";
import { buildCombineWorkday, type CombineShiftRow, type CombineSegmentRow, type CombinePlotInfo } from "@/lib/dashboard/combine-workday";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function pages<T>(query: () => any): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query().range(from, from + 499);
    if (result.error) throw result.error;
    rows.push(...result.data ?? []);
    if (!result.data || result.data.length < 500) return rows;
  }
}
async function chunks<T>(ids: string[], query: (ids: string[]) => any): Promise<T[]> {
  const result: T[] = [];
  const unique = Array.from(new Set(ids));
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = unique.slice(offset, offset + 100);
    result.push(...await pages<T>(() => query(batch)));
  }
  return result;
}

// No operator endpoints, shift tokens, device sessions or mutations are exposed.
export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request, { skipCache: true });
    if (!SUMMARY_SECTION_ROLES.some(role => role === actor.role)) throw new TrafficError("Нет доступа к сводке комбайнёра", 403);
    const companyId = resolveCompanyForActor(actor, request.nextUrl.searchParams.get("companyId"));
    const db = getServiceClient();
    await assertActorAccess({ supabase: db, actorUserId: actor.id, companyId, allowedRoles: [...SUMMARY_SECTION_ROLES] });
    const requestedPeriod = request.nextUrl.searchParams.get("period") || "latest_workday";
    if (!["active_shift", "date", "latest_workday", "current_day", "previous_day"].includes(requestedPeriod)) throw new TrafficError("Неизвестный период", 400);
    const requestedDate = request.nextUrl.searchParams.get("date") || "";
    if (requestedPeriod === "date" && !isSummaryDate(requestedDate)) throw new TrafficError("Неверная дата", 400);
    const serverTime = new Date().toISOString();
    const [company, history] = await Promise.all([
      db.from("companies").select("operational_day_start_hour").eq("id", companyId).maybeSingle(),
      pages<Pick<CombineShiftRow, "id" | "opened_at" | "closed_at">>(() => db.from("ptc_combine_shifts").select("id,opened_at,closed_at").eq("company_id", companyId)
        .lte("opened_at", serverTime).order("opened_at", { ascending: false }).order("id")),
    ]);
    if (company.error) throw company.error;
    const operationalDayStartHour = Number(company.data?.operational_day_start_hour ?? 7);
    const active = history.filter(shift => !shift.closed_at);
    const latestClosed = history.find(shift => shift.closed_at);
    const fallback = requestedPeriod === "active_shift" && !active.length ? latestClosed : null;
    const anchor = requestedPeriod === "date" ? `${requestedDate}T${String(operationalDayStartHour).padStart(2, "0")}:00:00+05:00`
      : requestedPeriod === "active_shift" ? active[active.length - 1]?.opened_at ?? fallback?.opened_at
      : requestedPeriod === "latest_workday" ? history[0]?.opened_at : null;
    const periodBase = resolveHarvestPeriod({
      preset: requestedPeriod === "previous_day" ? "previous_day" : "current_day",
      now: new Date(anchor || serverTime),
      operationalDayStartHour,
    });
    const end = requestedPeriod === "active_shift" ? new Date(Date.parse(serverTime) + 1).toISOString() : new Date(Date.parse(periodBase.start) + 86_400_000).toISOString();
    const date = (value: string) => new Date(value).toLocaleString("ru-RU", { timeZone: "Asia/Qyzylorda", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const period = { start: periodBase.start, end, label: `${date(periodBase.start)} — ${date(end)}` };
    const shifts = await pages<CombineShiftRow>(() => {
      const query = db.from("ptc_combine_shifts")
      .select("id,operator_user_id,operator_name,opened_at,closed_at,current_crop_structure_id,hectares_shift")
      .eq("company_id", companyId).gte("opened_at", period.start).lt("opened_at", end).lte("opened_at", serverTime)
      .order("opened_at").order("id");
      return fallback ? query.eq("id", fallback.id) : requestedPeriod === "active_shift" ? query.is("closed_at", null) : query;
    });
    const segments = await chunks<CombineSegmentRow>(shifts.map(row => row.id), ids => db.from("ptc_combine_field_segments")
      .select("id,shift_id,crop_structure_id,field_id,planned_area_ha,hectares_segment,ended_field_total_ha,closed_at")
      .eq("company_id", companyId).in("shift_id", ids).order("id"));
    const ids = [...segments.map(row => row.crop_structure_id), ...shifts.flatMap(row => row.current_crop_structure_id ? [row.current_crop_structure_id] : [])];
    const [structures, progress] = await Promise.all([
      chunks<any>(ids, batch => db.from("crop_structure").select("id,field_id,area,variety_id,reproduction_id").eq("company_id", companyId).in("id", batch).order("id")),
      chunks<any>(ids, batch => db.from("ptc_field_progress").select("crop_structure_id,actual_completed_ha,status").eq("company_id", companyId).in("crop_structure_id", batch).order("crop_structure_id")),
    ]);
    const [fields, varieties, reproductions] = await Promise.all([
      chunks<any>(structures.map(row => row.field_id), batch => db.from("fields").select("id,name").eq("company_id", companyId).in("id", batch).order("id")),
      chunks<any>(structures.flatMap(row => row.variety_id ? [row.variety_id] : []), batch => db.from("varieties").select("id,name,name_ru").in("id", batch).order("id")),
      chunks<any>(structures.flatMap(row => row.reproduction_id ? [row.reproduction_id] : []), batch => db.from("seed_reproductions").select("id,name,name_ru").in("id", batch).order("id")),
    ]);
    const byId = (rows: any[]) => new Map(rows.map(row => [row.id, row]));
    const fieldById = byId(fields), varietyById = byId(varieties), reproductionById = byId(reproductions);
    const progressById = new Map(progress.map(row => [row.crop_structure_id, row]));
    const plots: CombinePlotInfo[] = structures.map(row => {
      const variety = varietyById.get(row.variety_id), reproduction = reproductionById.get(row.reproduction_id);
      const plotProgress = progressById.get(row.id);
      return { id: row.id, areaHa: row.area == null ? null : Number(row.area),
        totalHa: plotProgress?.actual_completed_ha == null ? null : Number(plotProgress.actual_completed_ha),
        status: plotProgress?.status ?? "unknown",
        label: [fieldById.get(row.field_id)?.name || "Поле не указано", row.area == null ? null : `${Number(row.area).toLocaleString("ru-RU")} га`, variety?.name_ru || variety?.name, reproduction?.name_ru || reproduction?.name].filter(Boolean).join(" · ") };
    });
    return noStore({ ...buildCombineWorkday({ companyId, serverTime, period, shifts, segments, plots }),
      operationalDayStartHour,
      hasActiveShift: active.length > 0,
      availableDates: Array.from(new Set(history.filter(shift => shift.closed_at).map(shift => summaryDayKey(shift.opened_at, operationalDayStartHour)))).sort().reverse(),
    });
  } catch (error) { return failed(error); }
}
