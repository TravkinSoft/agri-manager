import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { getServerActorFromSession, resolveCompanyForActor, SessionAuthError } from "@/lib/auth/server-session";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private", Vary: "Authorization, Cookie" };

// A global administrator's selected company differs from their home company.
// Read through the same server ACL as user administration; never relax profile RLS.
export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true, skipCache: true });
    const companyId = resolveCompanyForActor(actor, request.nextUrl.searchParams.get("company_id"));
    const db = getServiceClient();
    await assertActorAccess({ supabase: db, actorUserId: actor.id, companyId, allowedRoles: ["global_admin", "company_admin"] });
    const profiles: unknown[] = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await db.from("profiles")
        .select("id,full_name,email,role,status,created_at,updated_at")
        .eq("company_id", companyId).order("created_at", { ascending: false }).order("id")
        .range(from, from + 499);
      if (error) throw error;
      profiles.push(...(data ?? []));
      if ((data?.length ?? 0) < 500) break;
    }
    return NextResponse.json({ profiles }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SessionAuthError ? error.message : "Не удалось загрузить пользователей компании" },
      { status: error instanceof SessionAuthError ? error.status : 500, headers });
  }
}
