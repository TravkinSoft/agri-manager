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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const operationId = String(id || "").trim();
    if (!operationId) return NextResponse.json({ error: "operation id is required" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, String(body.companyId || "").trim() || null);
    const supabase = await getUserScopedClientFromRequest(request);
    const idempotency = requireOperationIdempotency(request, { ...body, operationId, transition: "start" });

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
      actionLabel: "Operation start",
    });

    const { data, error } = await supabase.rpc("transition_operation_atomic_v1", {
      p_company_id: companyId,
      p_actor_profile_id: actor.id,
      p_operation_id: operationId,
      p_transition: "start",
      p_idempotency_key: idempotency.key,
      p_request_fingerprint: idempotency.fingerprint,
    });
    if (error || !data) {
      const failure = operationMutationError(error, "Operation was not started");
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
