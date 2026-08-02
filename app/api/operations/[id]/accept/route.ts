import { NextRequest, NextResponse } from "next/server";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
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
    const idempotency = requireOperationIdempotency(request, { ...body, operationId, transition: "accept" });

    const { data, error } = await supabase.rpc("transition_operation_atomic_v1", {
      p_company_id: companyId,
      p_actor_profile_id: actor.id,
      p_operation_id: operationId,
      p_transition: "accept",
      p_idempotency_key: idempotency.key,
      p_request_fingerprint: idempotency.fingerprint,
    });
    if (error || !data) {
      const failure = operationMutationError(error, "Operation was not accepted");
      return NextResponse.json({ error: failure.message }, { status: failure.status });
    }
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof SessionAuthError || error instanceof OperationMutationInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const failure = operationMutationError(error, "Unknown error");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
