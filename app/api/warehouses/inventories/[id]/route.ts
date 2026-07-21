import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import { WAREHOUSE_WRITE_ROLES } from "@/app/api/warehouses/_helpers";

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
      allowedRoles: [...WAREHOUSE_WRITE_ROLES],
    });

    const action = String(body.action || "save");
    const functionName = action === "complete"
      ? "complete_warehouse_inventory_v1"
      : action === "cancel"
        ? "cancel_warehouse_inventory_v1"
        : "save_warehouse_inventory_v1";
    const parameters = action === "save"
      ? {
          p_company_id: companyId,
          p_inventory_id: inventoryId,
          p_items: Array.isArray(body.items) ? body.items : [],
        }
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
