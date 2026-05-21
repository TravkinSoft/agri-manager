import { NextRequest, NextResponse } from "next/server";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const adminActor = await getServerActorFromSession(request, { ignoreImpersonation: true });

    return NextResponse.json({
      actor: {
        id: actor.id,
        authUserId: actor.authUserId,
        role: actor.role,
        roleRawKey: actor.roleRawKey,
        roleIsLegacyAlias: actor.roleIsLegacyAlias,
        companyId: actor.companyId,
        homeCompanyId: actor.homeCompanyId,
        contextCompanyId: actor.contextCompanyId,
        status: actor.status,
        email: actor.email,
        isImpersonating: actor.isImpersonating,
        impersonatedProfileId: actor.impersonatedProfileId,
        impersonatedCompanyId: actor.impersonatedCompanyId,
        impersonatedByProfileId: actor.impersonatedByProfileId,
        impersonatedByAuthUserId: actor.impersonatedByAuthUserId,
      },
      admin: {
        id: adminActor.id,
        role: adminActor.role,
        companyId: adminActor.companyId,
      },
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to resolve actor context" },
      { status: 500 }
    );
  }
}
