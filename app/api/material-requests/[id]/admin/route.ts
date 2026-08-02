import { NextRequest, NextResponse } from "next/server";
import {
  asMaterialRequestError,
  resolveMaterialRequestSession,
} from "@/app/api/material-requests/_helpers";
import {
  OperationMutationInputError,
  operationMutationError,
  requireOperationIdempotency,
} from "@/lib/server/operation-mutation";

const ADMIN_ROLES = ["global_admin", "company_admin"] as const;
const ADMIN_ACTIONS = ["return_to_preparation", "cancel", "record_loss"] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const requestId = String(id || "").trim();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "").trim();
    const reason = String(body.reason || "").trim();
    const items = Array.isArray(body.items) ? body.items : [];

    if (!requestId) {
      return NextResponse.json({ error: "request id is required" }, { status: 400 });
    }
    if (!ADMIN_ACTIONS.includes(action as (typeof ADMIN_ACTIONS)[number])) {
      return NextResponse.json({ error: "Unsupported admin action" }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: "Admin reason is required" }, { status: 400 });
    }
    if (action === "record_loss" && items.length === 0) {
      return NextResponse.json({ error: "Loss items are required" }, { status: 400 });
    }

    const { actor, companyId, supabase } = await resolveMaterialRequestSession(request, {
      allowedRoles: ADMIN_ROLES,
      requestedCompanyId: String(body.companyId || "").trim() || null,
    });
    const idempotency = requireOperationIdempotency(request, {
      ...body,
      requestId,
      action: `admin_${action}`,
    });

    const normalizedItems = items.map((raw: any) => ({
      item_id: String(raw?.itemId || raw?.item_id || "").trim(),
      loss_quantity: Number(raw?.lossQuantity ?? raw?.loss_quantity ?? 0),
    }));
    if (
      normalizedItems.some(
        (item) =>
          !item.item_id ||
          !Number.isFinite(item.loss_quantity) ||
          item.loss_quantity < 0
      )
    ) {
      return NextResponse.json({ error: "Invalid loss item payload" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc(
      "admin_transition_material_request_atomic_v13",
      {
        p_company_id: companyId,
        p_actor_profile_id: actor.id,
        p_request_id: requestId,
        p_action: action,
        p_reason: reason,
        p_items: normalizedItems,
        p_idempotency_key: idempotency.key,
        p_request_fingerprint: idempotency.fingerprint,
      }
    );
    if (error || !data) {
      const failure = operationMutationError(error, "Admin material request action failed");
      return NextResponse.json({ error: failure.message }, { status: failure.status });
    }
    return NextResponse.json(data);
  } catch (error) {
    const sessionError = asMaterialRequestError(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    if (error instanceof OperationMutationInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const failure = operationMutationError(error, "Unknown error");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
