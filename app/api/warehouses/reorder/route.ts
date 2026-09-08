import { NextRequest, NextResponse } from "next/server";
import { WAREHOUSE_ENTITY_WRITE_ROLES } from "@/app/api/warehouses/_helpers";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";
import { WAREHOUSE_ORDER_MAX_ITEMS } from "@/lib/warehouse/warehouse-order";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(request: NextRequest) {
  if (process.env.WAREHOUSE_ORDER_WRITE_V1 !== "1") {
    return errorResponse("Изменение порядка складов временно отключено", 404);
  }

  try {
    const actor = await getServerActorFromSession(request);
    const body = await request.json().catch(() => ({}));
    const requestedCompanyId = String(body.companyId || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const rawWarehouseIds = Array.isArray(body.warehouseIds) ? body.warehouseIds : [];
    const warehouseIds = rawWarehouseIds.map((value: unknown) => String(value || "").trim());

    if (
      warehouseIds.length < 1
      || warehouseIds.length > WAREHOUSE_ORDER_MAX_ITEMS
      || warehouseIds.some((warehouseId: string) => !UUID_PATTERN.test(warehouseId))
      || new Set(warehouseIds).size !== warehouseIds.length
    ) {
      return errorResponse("Некорректный список складов", 400);
    }

    const serviceSupabase = getServiceClient();
    await assertActorAccess({
      supabase: serviceSupabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_ENTITY_WRITE_ROLES],
    });

    const { data, error } = await serviceSupabase.rpc("reorder_warehouses_atomic_v1", {
      p_company_id: companyId,
      p_warehouse_ids: warehouseIds,
    });

    if (error) {
      const code = String(error.code || "");
      const message = String(error.message || "");
      if (code === "40001" || message.includes("WAREHOUSE_ORDER_CONFLICT")) {
        return errorResponse("Список складов изменился. Обновите страницу и повторите.", 409);
      }
      if (code === "42501" || message.includes("WAREHOUSE_ORDER_SCOPE_MISMATCH")) {
        return errorResponse("Один из складов недоступен в выбранной компании", 403);
      }
      if (["22004", "22023"].includes(code) || message.includes("WAREHOUSE_ORDER_")) {
        return errorResponse("Некорректный список складов", 400);
      }
      if (code === "PGRST202" || code === "42883") {
        return errorResponse("Сохранение порядка ещё не подготовлено", 503);
      }
      return errorResponse("Не удалось сохранить порядок складов", 500);
    }

    return NextResponse.json({ result: data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Не удалось сохранить порядок складов",
      500,
    );
  }
}
