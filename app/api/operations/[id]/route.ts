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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const operationId = String(id || "").trim();
    if (!operationId) return NextResponse.json({ error: "operation id is required" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const companyIdInput = String(body.companyId || "").trim() || null;
    const operationPatch = body.operationPatch && typeof body.operationPatch === "object" ? body.operationPatch : {};
    const materials = Array.isArray(body.materials) ? body.materials : null;
    if (!materials) return NextResponse.json({ error: "Complete material set is required" }, { status: 400 });

    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, companyIdInput);
    const supabase = await getUserScopedClientFromRequest(request);
    const idempotency = requireOperationIdempotency(request, { ...body, operationId, action: "material_edit" });

    const { data, error } = await supabase.rpc("replace_operation_materials_atomic_v13", {
      p_company_id: companyId,
      p_actor_profile_id: actor.id,
      p_operation_id: operationId,
      p_operation_patch: operationPatch,
      p_materials: materials,
      p_idempotency_key: idempotency.key,
      p_request_fingerprint: idempotency.fingerprint,
    });
    if (error || !data) {
      const failure = operationMutationError(error, "Operation changes were not saved");
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
