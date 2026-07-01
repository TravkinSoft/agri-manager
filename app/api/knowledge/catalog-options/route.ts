import { NextRequest, NextResponse } from "next/server";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";
import { loadKnowledgeCatalogOptions } from "@/lib/knowledge/draft-resolver";

function jsonAuthError(error: unknown) {
  if (error instanceof SessionAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}

async function requireGlobalAdmin(request: NextRequest) {
  const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
  if (actor.role !== "global_admin") {
    throw new SessionAuthError("Only global admin can read knowledge catalog options", 403);
  }
  return actor;
}

export async function GET(request: NextRequest) {
  try {
    await requireGlobalAdmin(request);
    const options = await loadKnowledgeCatalogOptions(getServiceClient());
    return NextResponse.json({ options });
  } catch (error) {
    const authError = jsonAuthError(error);
    if (authError) return authError;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load knowledge catalog options" },
      { status: 500 }
    );
  }
}
