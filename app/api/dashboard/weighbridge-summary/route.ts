import { NextRequest } from "next/server";
import { failed, noStore, TrafficError } from "@/lib/traffic/server";
import { summaryAccess } from "@/lib/dashboard/summary-server";
import { projectShiftReport, type SummaryShift, type WeighbridgeOperationalSummary } from "@/lib/dashboard/operational-summary";
import { isWeighbridgeShiftReport } from "@/lib/weighbridge/shift-report";
import { previousSummaryDay, summaryDayKey } from "@/lib/dashboard/summary-periods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// This route cannot open/close a shift and never returns review tokens or operator sessions.
export async function GET(request: NextRequest) {
  try {
    const { companyId, db } = await summaryAccess(request);
    const requestedId = request.nextUrl.searchParams.get("shiftId");
    const requestedPeriod = request.nextUrl.searchParams.get("period");
    if (requestedPeriod && !["active_shift", "previous_day"].includes(requestedPeriod)) throw new TrafficError("Неизвестный период", 400);
    if (requestedId && requestedPeriod) throw new TrafficError("Выберите смену или период", 400);
    if (requestedId && !/^[0-9a-f-]{36}$/i.test(requestedId)) throw new TrafficError("Неверная смена", 400);
    const columns = "id,status,opened_at,closed_at";
    const [historyRows, open, company] = await Promise.all([
      (async () => {
        const rows: any[] = [];
        for (let from = 0; ; from += 500) {
          const result = await db.from("weighbridge_shifts").select(columns).eq("company_id", companyId)
            .order("opened_at", { ascending: false }).order("id").range(from, from + 499);
          if (result.error) throw result.error;
          rows.push(...result.data ?? []);
          if (!result.data || result.data.length < 500) return rows;
        }
      })(),
      db.from("weighbridge_shifts").select(columns).eq("company_id", companyId).eq("status", "open").order("opened_at", { ascending: false }).order("id").limit(1).maybeSingle(),
      db.from("companies").select("operational_day_start_hour").eq("id", companyId).maybeSingle(),
    ]);
    if (open.error || company.error) throw open.error || company.error;
    const serverTime = new Date().toISOString();
    const operationalDayStartHour = Number(company.data?.operational_day_start_hour ?? 7);
    // Keep the completed report visible between shifts; a newly opened empty shift wins.
    const currentOrLast = open.data || historyRows.find(row => row.status === "closed" && row.closed_at) || null;
    let selected = requestedPeriod === "active_shift" ? currentOrLast
      : requestedPeriod === "previous_day" ? historyRows.find(row => row.closed_at && summaryDayKey(row.opened_at, operationalDayStartHour) === previousSummaryDay(serverTime, operationalDayStartHour)) || null
      : currentOrLast;
    if (requestedId) {
      const result = await db.from("weighbridge_shifts").select(columns).eq("company_id", companyId).eq("id", requestedId).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new TrafficError("Смена недоступна", 404);
      selected = result.data;
    }
    const toShift = (row: any): SummaryShift => ({ id: row.id, status: row.status, openedAt: row.opened_at, closedAt: row.closed_at });
    const shifts = Array.from(new Map([...(selected ? [selected] : []), ...historyRows].map(row => [row.id, row])).values())
      .sort((a, b) => Date.parse(b.opened_at) - Date.parse(a.opened_at)).map(toShift);
    let report: WeighbridgeOperationalSummary["report"] = null;
    if (selected) {
      // STABLE, read-only RPC. Closed shifts return the saved report, open shifts a fresh snapshot.
      const result = await db.rpc("preview_weighbridge_shift_snapshot_v2", { p_company_id: companyId, p_shift_id: selected.id });
      if (result.error) throw result.error;
      if (isWeighbridgeShiftReport(result.data)) {
        if (request.nextUrl.searchParams.get("details") === "true") {
          return noStore({ companyId, readOnly: true, serverTime: new Date().toISOString(),
            report: { ...result.data, reviewToken: "" } });
        }
        report = projectShiftReport(result.data);
      }
    }
    return noStore({ companyId, readOnly: true, serverTime, operationalDayStartHour, shifts,
      selectedShift: selected ? toShift(selected) : null, report } satisfies WeighbridgeOperationalSummary);
  } catch (error) { return failed(error); }
}
