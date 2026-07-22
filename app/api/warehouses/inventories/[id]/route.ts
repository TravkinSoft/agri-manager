import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
const INVENTORY_ACTION_ROLES = ["global_admin", "company_admin", "warehouse", "warehouse_operator", "weighman"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const inventoryId = String(id || "").trim();
    if (!UUID_RE.test(inventoryId)) {
      return NextResponse.json({ error: "Некорректный номер инвентаризации" }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, String(body.companyId || "").trim() || null);
    const supabase = await getUserScopedClientFromRequest(request);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...INVENTORY_ACTION_ROLES],
    });

    const action = String(body.action || "save");
    const functionName = action === "submit"
      ? "submit_warehouse_inventory_v2"
      : action === "approve"
        ? "approve_warehouse_inventory_v2"
        : action === "reject"
          ? "reject_warehouse_inventory_v2"
          : action === "cancel"
            ? "cancel_warehouse_inventory_v2"
            : "save_warehouse_inventory_v2";
    const parameters = action === "save"
      ? {
          p_company_id: companyId,
          p_inventory_id: inventoryId,
          p_items: Array.isArray(body.items) ? body.items : [],
        }
      : action === "reject"
        ? { p_company_id: companyId, p_inventory_id: inventoryId, p_comment: String(body.comment || "") }
        : { p_company_id: companyId, p_inventory_id: inventoryId };
    const { data, error } = await supabase.rpc(functionName, parameters);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ inventory: data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось обновить инвентаризацию" },
      { status: 500 }
    );
  }
}
