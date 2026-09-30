import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import {
  SessionAuthError,
  getServerActorFromSession,
  resolveCompanyForActor,
  type ServerActorContext,
} from "@/lib/auth/server-session";
import { getCropCareSchemeHeader, getCurrentCareSeason, isSeasonReadOnly } from "@/lib/services/crop-care-schemes";

const PLANNER_ROLES = new Set(["global_admin", "company_admin", "agronomist", "director"]);

export function jsonError(error: unknown, fallback = "Unknown error") {
  if (error instanceof SessionAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const status = typeof (error as any)?.status === "number" ? Math.max(400, Math.min(599, (error as any).status)) : 500;
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status }
  );
}

export function assertPlanner(actor: ServerActorContext, companyId: string) {
  if (String(actor.status || "active") !== "active") {
    throw new SessionAuthError("Actor profile is not active", 403);
  }
  if (!PLANNER_ROLES.has(actor.role)) {
    throw new SessionAuthError("Access denied for current role", 403);
  }
  if (actor.role !== "global_admin" && actor.companyId !== companyId) {
    throw new SessionAuthError("Actor does not belong to the target company", 403);
  }
}

export async function getCropCareRequestContext(request: NextRequest, bodyCompanyId?: string | null) {
  const actor = await getServerActorFromSession(request);
  const requestedCompanyId =
    bodyCompanyId ||
    request.nextUrl.searchParams.get("companyId") ||
    request.nextUrl.searchParams.get("company_id") ||
    null;
  const companyId = resolveCompanyForActor(actor, requestedCompanyId);
  assertPlanner(actor, companyId);
  const supabase = getServiceClient();
  const season = await getCurrentCareSeason(supabase, companyId);
  return {
    actor,
    companyId,
    supabase,
    season,
    seasonState: isSeasonReadOnly(season),
  };
}

export function assertWritableSeason(seasonState: { readOnly: boolean; reason: string | null }) {
  if (seasonState.readOnly) {
    throw new SessionAuthError(seasonState.reason || "Season is read-only", 409);
  }
}

type CropCareRequestContext = Awaited<ReturnType<typeof getCropCareRequestContext>>;

export async function assertSchemeInCurrentSeason(ctx: CropCareRequestContext, schemeId: string) {
  if (!ctx.season?.id) {
    throw new SessionAuthError("Нет активного сезона. Изменения запрещены.", 409);
  }
  const scheme = await getCropCareSchemeHeader(ctx.supabase, ctx.companyId, schemeId);
  if (scheme.season_id !== ctx.season.id) {
    throw new SessionAuthError("Схема относится к другому сезону. Изменения запрещены.", 409);
  }
  return scheme;
}
