import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError } from "@/lib/auth/server-session";
import { resolveWarehouseForActor } from "@/app/api/warehouses/_helpers";
import { isAgrochemicalProductType, isAgrochemicalWarehouseType } from "@/lib/warehouse/warehouse-scope";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANUAL_TRANSFER_ROLES = ["global_admin", "warehouse", "warehouse_operator"] as const;

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
      allowedRoles: [...MANUAL_TRANSFER_ROLES],
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
    if (destinationWarehouseId === sourceWarehouseId) {
      return NextResponse.json({ error: "Склад назначения должен отличаться от склада-источника" }, { status: 400 });
    }
    const vehicleId = String(body.vehicle_id || "").trim();
    const driverId = String(body.driver_id || "").trim();
    if (!UUID_RE.test(vehicleId) || !UUID_RE.test(driverId)) {
      return NextResponse.json({ error: "Для внутреннего перемещения выберите машину и водителя" }, { status: 400 });
    }
    const [{ data: destination }, { data: vehicle }, { data: driver }, { data: product }] = await Promise.all([
      supabase.from("warehouses").select("id,warehouse_type").eq("id", destinationWarehouseId).eq("company_id", companyId).eq("archived", false).maybeSingle(),
      supabase.from("reference_vehicles").select("id").eq("id", vehicleId).eq("company_id", companyId).eq("archived", false).eq("is_active", true).maybeSingle(),
      supabase.from("reference_specialists").select("id").eq("id", driverId).eq("company_id", companyId).eq("archived", false).eq("status", "active").maybeSingle(),
      supabase.from("products").select("id,type,product_type,category,company_id").eq("id", productId).or(`company_id.eq.${companyId},company_id.is.null`).maybeSingle(),
    ]);
    if (!destination?.id) return NextResponse.json({ error: "Склад назначения не найден" }, { status: 400 });
    if (!vehicle?.id || !driver?.id) return NextResponse.json({ error: "Машина или водитель недоступны выбранной компании" }, { status: 400 });
    if (!product?.id) return NextResponse.json({ error: "Материал не найден" }, { status: 400 });
    if (
      actor.role !== "global_admin" &&
      (
        !isAgrochemicalWarehouseType(existing.warehouse_type) ||
        !isAgrochemicalWarehouseType(destination.warehouse_type) ||
        !isAgrochemicalProductType(product.product_type || product.type || product.category)
      )
    ) {
      return NextResponse.json(
        { error: "Складовщик может перемещать только агрохимию между агрохимическими складами" },
        { status: 403 }
      );
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
      p_notes: [
        body.notes == null ? "" : String(body.notes).trim(),
        `Машина: ${vehicleId}`,
        `Водитель: ${driverId}`,
      ].filter(Boolean).join("\n"),
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
