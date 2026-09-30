import { NextRequest, NextResponse } from "next/server";
import { getServerActorFromSession, getUserScopedClientFromRequest, resolveCompanyForActor, SessionAuthError } from "@/lib/auth/server-session";
import { operationMutationError, requireOperationIdempotency, OperationMutationInputError } from "@/lib/server/operation-mutation";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, String(body.companyId || "").trim() || null);
    const client = await getUserScopedClientFromRequest(request);
    const intent = requireOperationIdempotency(request, body);
    // The RPC checks its durable receipt before season/state/area checks and fingerprints the actual payload.
    const { data, error } = await client.rpc("agro_b1_mutate_operation", {
      p_company_id: companyId, p_actor_profile_id: actor.id, p_operation_id: id,
      p_action: body.action, p_payload: body.payload, p_idempotency_key: intent.key,
    });
    if (error) { const failure = operationMutationError(error, "Не удалось сохранить действие"); return NextResponse.json({ error: failure.message }, { status: failure.status }); }
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof SessionAuthError || error instanceof OperationMutationInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    const failure = operationMutationError(error, "Не удалось сохранить действие");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
