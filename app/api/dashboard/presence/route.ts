import { NextRequest } from "next/server";
import { getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServiceClient } from "@/lib/supabase/service";
import { summaryAccess } from "@/lib/dashboard/summary-server";
import { failed, noStore, sameOrigin, TrafficError } from "@/lib/traffic/server";
import type { SummaryPresence, SummaryShift } from "@/lib/dashboard/operational-summary";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const { companyId, db } = await summaryAccess(request);
    const shiftsOnly = request.nextUrl.searchParams.get("shiftsOnly") === "true";
    const latest = async (workspace: string) => {
      if (shiftsOnly) return { lastSeenAt: null };
      const result = await db.from("dashboard_operator_presence").select("last_seen_at")
        .eq("company_id", companyId).eq("workspace", workspace).order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
      if (result.error) throw result.error;
      return { lastSeenAt: result.data?.last_seen_at || null };
    };
    const latestShift = async (table: "weighbridge_shifts" | "ptc_combine_shifts"): Promise<SummaryShift | null> => {
      // A newer closed shift must not hide another operator's still-open shift.
      let result = await db.from(table).select("id,opened_at,closed_at")
        .eq("company_id", companyId).is("closed_at", null)
        .order("opened_at", { ascending: false }).limit(1).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) result = await db.from(table).select("id,opened_at,closed_at")
        .eq("company_id", companyId).order("opened_at", { ascending: false }).limit(1).maybeSingle();
      if (result.error) throw result.error;
      const shift = result.data;
      return shift ? { id: shift.id, status: shift.closed_at ? "closed" : "open",
        openedAt: shift.opened_at, closedAt: shift.closed_at } : null;
    };
    const [weighbridge, combine, weighbridgeShift, combineShift] = await Promise.all([
      latest("weighbridge"), latest("combine"), latestShift("weighbridge_shifts"), latestShift("ptc_combine_shifts"),
    ]);
    return noStore({ companyId, readOnly: true, serverTime: new Date().toISOString(),
      weighbridge: { ...weighbridge, shift: weighbridgeShift }, combine: { ...combine, shift: combineShift } } satisfies SummaryPresence);
  } catch (error) { return failed(error); }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const actor = await getServerActorFromSession(request, { skipCache: true });
    // Admin role-preview must never make an absent operator appear online.
    if (actor.isImpersonating || !["weighman", "mechanic_operator"].includes(actor.role)) throw new TrafficError("Нет доступа к сигналу оператора", 403);
    const companyId = resolveCompanyForActor(actor, null);
    const db = getServiceClient();
    await assertActorAccess({ supabase: db, actorUserId: actor.id, companyId, allowedRoles: ["weighman", "mechanic_operator"] });
    const workspace = actor.role === "weighman" ? "weighbridge" : "combine";
    // No user-supplied company/profile/time. Heartbeats never renew a PIN session.
    const result = await db.from("dashboard_operator_presence").upsert({ company_id: companyId,
      profile_id: actor.id, workspace, last_seen_at: new Date().toISOString() }, { onConflict: "company_id,profile_id,workspace" });
    if (result.error) throw result.error;
    return noStore({ ok: true });
  } catch (error) { return failed(error); }
}
