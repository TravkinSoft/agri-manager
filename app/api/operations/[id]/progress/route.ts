import { NextRequest, NextResponse } from "next/server";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import {
  SeasonGuardError,
  assertSeasonWritableForMutation,
  resolveOperationSeasonIdForGuard,
} from "@/lib/seasons/season-guard";
import {
  OperationMutationInputError,
  operationMutationError,
  requireOperationIdempotency,
} from "@/lib/server/operation-mutation";

function toPositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const operationId = String(id || "").trim();
    if (!operationId) return NextResponse.json({ error: "operation id is required" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const completedArea = toPositiveNumber(body.completedAreaHa ?? body.completed_area_ha);
    if (!completedArea) {
      return NextResponse.json({ error: "Completed area must be greater than zero" }, { status: 400 });
    }

    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, String(body.companyId || "").trim() || null);
    const supabase = await getUserScopedClientFromRequest(request);
    const idempotency = requireOperationIdempotency(request, { ...body, operationId, action: "progress" });

    const { data: operation, error: operationError } = await supabase
      .from("operations")
      .select("crop_structure_id")
      .eq("id", operationId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (operationError || !operation) {
      return NextResponse.json({ error: operationError?.message || "Operation not found" }, { status: 404 });
    }
    const seasonId = await resolveOperationSeasonIdForGuard(supabase, {
      companyId,
      cropStructureId: operation.crop_structure_id,
    });
    await assertSeasonWritableForMutation(supabase, {
      companyId,
      seasonId,
      actionLabel: "Operation progress",
    });

    const { data, error } = await supabase.rpc("save_operation_progress_atomic_v1", {
      p_company_id: companyId,
      p_actor_profile_id: actor.id,
      p_operation_id: operationId,
      p_completed_area_ha: completedArea,
      p_allow_overrun: Boolean(body.allowOverrun),
      p_stop_reason: String(body.stopReason || body.stop_reason || "").trim() || null,
      p_comment: String(body.comment || "").trim() || null,
      p_weather_note: String(body.weatherNote || body.weather_note || "").trim() || null,
      p_idempotency_key: idempotency.key,
      p_request_fingerprint: idempotency.fingerprint,
    });
    if (error || !data) {
      const failure = operationMutationError(error, "Operation progress was not saved");
      return NextResponse.json({ error: failure.message }, { status: failure.status });
    }
    return NextResponse.json(data);
  } catch (error) {
    if (
      error instanceof SessionAuthError ||
      error instanceof SeasonGuardError ||
      error instanceof OperationMutationInputError
    ) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const failure = operationMutationError(error, "Unknown error");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
