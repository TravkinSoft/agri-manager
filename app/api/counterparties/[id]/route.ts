import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import { COUNTERPARTY_SELECT, normalizeCounterpartyRow } from "@/lib/counterparties/rows";

const WRITE_ROLES = ["company_admin", "global_admin"] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const actor = await getServerActorFromSession(request);
    const body = await request.json();
    const companyId = resolveCompanyForActor(actor, String(body.companyId || "").trim() || null);
    const counterpartyId = String(params.id || "").trim();
    if (!counterpartyId) return NextResponse.json({ error: "counterparty id is required" }, { status: 400 });

    const supabase = await getUserScopedClientFromRequest(request);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WRITE_ROLES],
    });
    const patch: Record<string, unknown> = {};
    if (body.isActive !== undefined) patch.is_active = body.isActive === true;
    if (body.archived !== undefined) patch.archived = body.archived === true;
    if (body.archived === false) patch.is_active = true;
    if (body.archived === true) patch.is_active = false;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No supported fields to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("counterparties")
      .update(patch)
      .eq("id", counterpartyId)
      .eq("company_id", companyId)
      .select(COUNTERPARTY_SELECT)
      .single();
    if (error || !data) throw new Error(error?.message || "Не удалось изменить статус");
    return NextResponse.json({ counterparty: normalizeCounterpartyRow(data) });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 400 });
  }
}
