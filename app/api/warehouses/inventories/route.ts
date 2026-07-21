import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import {
  WAREHOUSE_READ_ROLES,
  WAREHOUSE_STOCK_WRITE_ROLES,
  resolveWarehouseForActor,
} from "@/app/api/warehouses/_helpers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const inventoryId = String(request.nextUrl.searchParams.get("inventoryId") || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const supabase = await getUserScopedClientFromRequest(request);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_READ_ROLES],
    });

    if (inventoryId && !UUID_RE.test(inventoryId)) {
      return NextResponse.json({ error: "Некорректный номер инвентаризации" }, { status: 400 });
    }

    let documentQuery = supabase
      .from("warehouse_inventory_documents")
      .select("id,company_id,inventory_no,warehouse_id,status,snapshot_at,started_at,started_by,completed_at,completed_by,cancelled_at,cancelled_by,item_count,difference_count,notes,created_at,updated_at")
      .eq("company_id", companyId)
      .order("started_at", { ascending: false })
      .limit(inventoryId ? 1 : 100);
    if (inventoryId) documentQuery = documentQuery.eq("id", inventoryId);
    const { data: documents, error: documentError } = await documentQuery;
    if (documentError) throw new Error(documentError.message);

    const warehouseIds = Array.from(new Set((documents || []).map((row: any) => String(row.warehouse_id))));
    const profileIds = Array.from(new Set((documents || []).flatMap((row: any) => [
      String(row.started_by || ""),
      String(row.completed_by || ""),
      String(row.cancelled_by || ""),
    ]).filter(Boolean)));
    const documentIds = (documents || []).map((row: any) => String(row.id));
    const [warehouseResult, profileResult, itemResult] = await Promise.all([
      warehouseIds.length
        ? supabase.from("warehouses").select("id,name").eq("company_id", companyId).in("id", warehouseIds)
        : Promise.resolve({ data: [], error: null }),
      profileIds.length
        ? supabase.from("profiles").select("id,full_name,email").in("id", profileIds)
        : Promise.resolve({ data: [], error: null }),
      documentIds.length
        ? supabase
            .from("warehouse_inventory_items")
            .select("id,inventory_id,company_id,product_id,product_name_snapshot,product_type,uom,book_quantity,actual_quantity,difference_quantity,discovered,adjustment_ledger_entry_id,created_at,updated_at")
            .eq("company_id", companyId)
            .in("inventory_id", documentIds)
            .order("product_name_snapshot", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (warehouseResult.error || profileResult.error || itemResult.error) {
      throw new Error(warehouseResult.error?.message || profileResult.error?.message || itemResult.error?.message);
    }

    const warehouseById = new Map((warehouseResult.data || []).map((row: any) => [String(row.id), String(row.name || "Склад")]));
    const profileById = new Map((profileResult.data || []).map((row: any) => [
      String(row.id),
      String(row.full_name || row.email || "Пользователь"),
    ]));
    const itemsByDocument = new Map<string, any[]>();
    for (const rawItem of itemResult.data || []) {
      const item = {
        ...rawItem,
        book_quantity: Number((rawItem as any).book_quantity || 0),
        actual_quantity: (rawItem as any).actual_quantity == null ? null : Number((rawItem as any).actual_quantity),
        difference_quantity: (rawItem as any).difference_quantity == null ? null : Number((rawItem as any).difference_quantity),
      };
      const key = String((rawItem as any).inventory_id);
      itemsByDocument.set(key, [...(itemsByDocument.get(key) || []), item]);
    }

    return NextResponse.json({
      inventories: (documents || []).map((row: any) => ({
        ...row,
        warehouse_name: warehouseById.get(String(row.warehouse_id)) || "Склад",
        started_by_name: profileById.get(String(row.started_by || "")) || null,
        items: itemsByDocument.get(String(row.id)) || [],
      })),
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить инвентаризации" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const warehouseId = String(body.warehouseId || body.warehouse_id || "").trim();
    const inventoryId = String(body.inventoryId || body.inventory_id || "").trim();
    if (!UUID_RE.test(warehouseId) || !UUID_RE.test(inventoryId)) {
      return NextResponse.json({ error: "Выберите склад" }, { status: 400 });
    }
    const { actor, companyId, supabase, existing } = await resolveWarehouseForActor(request, warehouseId);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WAREHOUSE_STOCK_WRITE_ROLES],
    });
    if (!existing?.id) return NextResponse.json({ error: "Склад не найден" }, { status: 404 });

    const { data, error } = await supabase.rpc("start_warehouse_inventory_v1", {
      p_company_id: companyId,
      p_warehouse_id: warehouseId,
      p_notes: body.notes == null ? null : String(body.notes),
      p_inventory_id: inventoryId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ inventory: data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось начать инвентаризацию" },
      { status: 500 }
    );
  }
}
