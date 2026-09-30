import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

const FUEL_ROLES = ["admin", "company_admin", "global_admin", "warehouse", "fuel_operator"] as const;

const nameOfVehicle = (row: any) => {
  const parts = [row?.name || row?.full_name || "Техника", row?.plate_number || ""].filter(Boolean);
  return parts.join(" ").trim();
};

const monthKey = (value: string | null | undefined) => {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
};

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, String(request.nextUrl.searchParams.get("companyId") || "").trim() || null);

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...FUEL_ROLES],
    });

    const [sourcesRes, vehiclesRes, specialistsRes, issuesRes, transfersRes, limitsRes] = await Promise.all([
      supabase
        .from("fuel_sources")
        .select("*")
        .eq("company_id", companyId)
        .eq("archived", false)
        .order("name"),
      supabase
        .from("reference_vehicles")
        .select("*")
        .eq("company_id", companyId)
        .eq("archived", false)
        .order("name"),
      supabase
        .from("reference_specialists")
        .select("*")
        .eq("company_id", companyId)
        .eq("archived", false)
        .order("full_name"),
      supabase
        .from("fuel_issues")
        .select("id,issued_at,fuel_source_id,fuel_type,vehicle_id,mechanizator_id,liters,comment")
        .eq("company_id", companyId)
        .order("issued_at", { ascending: false })
        .limit(120),
      supabase
        .from("fuel_transfers")
        .select("id,transferred_at,from_fuel_source_id,to_fuel_source_id,fuel_type,liters,operator_personnel_id,comment")
        .eq("company_id", companyId)
        .order("transferred_at", { ascending: false })
        .limit(80),
      supabase
        .from("fuel_limits")
        .select("id,period_month,fuel_type,vehicle_id,mechanizator_id,limit_liters,is_active,archived")
        .eq("company_id", companyId)
        .eq("archived", false)
        .eq("is_active", true)
        .order("period_month", { ascending: false })
        .limit(200),
    ]);

    if (sourcesRes.error) return NextResponse.json({ error: sourcesRes.error.message }, { status: 400 });
    if (vehiclesRes.error) return NextResponse.json({ error: vehiclesRes.error.message }, { status: 400 });
    if (specialistsRes.error) return NextResponse.json({ error: specialistsRes.error.message }, { status: 400 });
    if (issuesRes.error) return NextResponse.json({ error: issuesRes.error.message }, { status: 400 });
    if (transfersRes.error) return NextResponse.json({ error: transfersRes.error.message }, { status: 400 });
    if (limitsRes.error) return NextResponse.json({ error: limitsRes.error.message }, { status: 400 });

    const sources = (sourcesRes.data || []).map((row: any) => ({
      ...row,
      capacity_liters: row.capacity_liters == null ? null : Number(row.capacity_liters || 0),
      current_balance_liters: Number(row.current_balance_liters || 0),
    }));
    const sourceMap = new Map(sources.map((row: any) => [String(row.id), row]));

    const vehicles = (vehiclesRes.data || []).map((row: any) => ({
      id: row.id,
      name: nameOfVehicle(row),
      plate_number: row.plate_number || null,
      vehicle_type: row.vehicle_type || null,
      is_active: row.is_active !== false,
      primary_responsible_personnel_id: row.primary_responsible_personnel_id || null,
    }));

    const mechanizators = (specialistsRes.data || [])
      .filter((row: any) => String(row.status || "active") === "active")
      .map((row: any) => ({
        id: row.id,
        full_name: String(row.full_name || "Специалист"),
        personnel_type: row.personnel_type || null,
        status: row.status || null,
      }));
    const mechanizatorMap = new Map(mechanizators.map((row: any) => [String(row.id), row]));
    const vehicleMap = new Map(vehicles.map((row: any) => [String(row.id), row]));

    const recentIssues = (issuesRes.data || []).map((row: any) => ({
      id: row.id,
      issued_at: row.issued_at,
      fuel_source_id: row.fuel_source_id,
      fuel_source_name: sourceMap.get(String(row.fuel_source_id))?.name || "Источник",
      fuel_type: row.fuel_type,
      vehicle_id: row.vehicle_id,
      vehicle_name: vehicleMap.get(String(row.vehicle_id))?.name || "Техника",
      mechanizator_id: row.mechanizator_id || null,
      mechanizator_name: row.mechanizator_id ? mechanizatorMap.get(String(row.mechanizator_id))?.full_name || null : null,
      liters: Number(row.liters || 0),
      comment: row.comment || null,
    }));

    const recentTransfers = (transfersRes.data || []).map((row: any) => ({
      id: row.id,
      transferred_at: row.transferred_at,
      from_fuel_source_id: row.from_fuel_source_id,
      from_fuel_source_name: sourceMap.get(String(row.from_fuel_source_id))?.name || "Источник",
      to_fuel_source_id: row.to_fuel_source_id,
      to_fuel_source_name: sourceMap.get(String(row.to_fuel_source_id))?.name || "Источник",
      fuel_type: row.fuel_type,
      liters: Number(row.liters || 0),
      operator_personnel_id: row.operator_personnel_id || null,
      operator_personnel_name: row.operator_personnel_id ? mechanizatorMap.get(String(row.operator_personnel_id))?.full_name || null : null,
      comment: row.comment || null,
    }));

    const monthIssueTotals = new Map<string, number>();
    const limitRows = limitsRes.data || [];
    const limitMonths = Array.from(
      new Set(
        limitRows
          .map((row: any) => monthKey(row.period_month))
          .filter(Boolean),
      ),
    );

    if (limitMonths.length) {
      const sortedMonths = [...limitMonths].sort();
      const minMonth = sortedMonths[0];
      const maxMonth = sortedMonths[sortedMonths.length - 1];
      const rangeStart = `${minMonth}-01`;
      const [maxYearRaw, maxMonthRaw] = maxMonth.split("-");
      const maxYear = Number(maxYearRaw);
      const maxMonthNum = Number(maxMonthRaw);
      const monthAfterMax = maxMonthNum === 12 ? `${maxYear + 1}-01` : `${maxYear}-${String(maxMonthNum + 1).padStart(2, "0")}`;
      const rangeEnd = `${monthAfterMax}-01`;

      const monthIssuesRes = await supabase
        .from("fuel_issues")
        .select("issued_at,fuel_type,vehicle_id,mechanizator_id,liters")
        .eq("company_id", companyId)
        .gte("issued_at", rangeStart)
        .lt("issued_at", rangeEnd);
      if (monthIssuesRes.error) return NextResponse.json({ error: monthIssuesRes.error.message }, { status: 400 });

      for (const issue of monthIssuesRes.data || []) {
        const keyMonth = monthKey(issue.issued_at);
        if (!keyMonth) continue;
        const fuelType = String(issue.fuel_type || "");
        const byVehicle = `${keyMonth}|${fuelType}|vehicle|${issue.vehicle_id}`;
        monthIssueTotals.set(byVehicle, (monthIssueTotals.get(byVehicle) || 0) + Number(issue.liters || 0));
        if (issue.mechanizator_id) {
          const byPerson = `${keyMonth}|${fuelType}|person|${issue.mechanizator_id}`;
          monthIssueTotals.set(byPerson, (monthIssueTotals.get(byPerson) || 0) + Number(issue.liters || 0));
        }
      }
    }

    const limits = limitRows.map((row: any) => {
      const month = monthKey(row.period_month);
      const fuelType = String(row.fuel_type || "");
      const key = row.vehicle_id
        ? `${month}|${fuelType}|vehicle|${row.vehicle_id}`
        : `${month}|${fuelType}|person|${row.mechanizator_id}`;
      const issued = Number(monthIssueTotals.get(key) || 0);
      const limit = Number(row.limit_liters || 0);
      const remaining = limit - issued;
      const targetLabel = row.vehicle_id
        ? vehicleMap.get(String(row.vehicle_id))?.name || "Техника"
        : mechanizatorMap.get(String(row.mechanizator_id))?.full_name || "Специалист";

      return {
        id: row.id,
        period_month: row.period_month,
        fuel_type: row.fuel_type,
        vehicle_id: row.vehicle_id || null,
        mechanizator_id: row.mechanizator_id || null,
        target_label: targetLabel,
        limit_liters: limit,
        issued_liters: issued,
        remaining_liters: remaining,
        exceeded: remaining < 0,
      };
    });

    return NextResponse.json({
      sources,
      vehicles,
      mechanizators,
      recentIssues,
      recentTransfers,
      limits,
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
