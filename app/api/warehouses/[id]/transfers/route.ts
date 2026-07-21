import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError } from "@/lib/auth/server-session";
import {
  WAREHOUSE_STOCK_WRITE_ROLES,
  resolveWarehouseForActor,
} from "@/app/api/warehouses/_helpers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const sourceWarehouseId = String(id || "").trim();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { actor, companyId, supabase, existing } = await resolveWarehouseForActor(
      request,
      sourceWarehouseId
    );
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_STOCK_WRITE_ROLES],
    });
    if (!existing?.id) {
      return NextResponse.json({ error: "Склад-источник не найден" }, { status: 404 });
    }

    const idempotencyKey = String(
      request.headers.get("Idempotency-Key") || body.idempotency_key || ""
    ).trim();
    if (!UUID_RE.test(idempotencyKey)) {
      return NextResponse.json({ error: "Idempotency-Key must be a UUID" }, { status: 400 });
    }
    const destinationWarehouseId = String(body.destination_warehouse_id || "").trim();
    const productId = String(body.product_id || "").trim();
    const quantity = Number(body.quantity);
    if (!UUID_RE.test(destinationWarehouseId) || !UUID_RE.test(productId)) {
      return NextResponse.json({ error: "Выберите склад назначения и материал" }, { status: 400 });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Количество должно быть больше нуля" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("create_warehouse_transfer_atomic_v1", {
      p_company_id: companyId,
      p_source_warehouse_id: sourceWarehouseId,
      p_destination_warehouse_id: destinationWarehouseId,
      p_product_id: productId,
      p_quantity: quantity,
      p_notes: body.notes == null ? null : String(body.notes),
      p_idempotency_key: idempotencyKey,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ transfer: data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось провести перемещение" },
      { status: 500 }
    );
  }
}
