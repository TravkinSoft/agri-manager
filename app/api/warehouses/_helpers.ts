import type { NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";

export const WAREHOUSE_READ_ROLES = [
  "company_admin",
  "global_admin",
  "warehouse",
  "warehouse_operator",
  "weighman",
  "agronomist",
  "director",
] as const;

export const WAREHOUSE_WRITE_ROLES = ["company_admin", "global_admin"] as const;

export function normalizeWarehouseRow(row: any) {
  return {
    id: String(row.id),
    company_id: row.company_id ? String(row.company_id) : null,
    name: String(row.name || "Склад"),
    warehouse_type: row.warehouse_type ?? null,
    storage_capacity_kg: row.storage_capacity_kg == null ? null : Number(row.storage_capacity_kg),
    capacity_value: row.capacity_value == null ? null : Number(row.capacity_value),
    capacity_unit: row.capacity_unit ?? null,
    responsible_user_id: row.responsible_user_id ?? null,
    location: row.location ?? null,
    description: row.description ?? null,
    archived: row.archived === true,
    is_archived: row.is_archived === true,
    archived_at: row.archived_at ?? null,
    archived_by_user_id: row.archived_by_user_id ?? null,
    user_id: String(row.user_id || ""),
    created_by_user_id: row.created_by_user_id ?? null,
    updated_by_user_id: row.updated_by_user_id ?? null,
    created_at: String(row.created_at || ""),
  };
}

export function toNullableText(value: unknown): string | null {
  const text = String(value || "").trim();
  return text ? text : null;
}

export async function resolveWarehouseForActor(request: NextRequest, warehouseId: string) {
  try {
    const actor = await getServerActorFromSession(request);
    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const supabase = getServiceClient();

    const { data: existing, error: existingError } = await supabase
      .from("warehouses")
      .select("*")
      .eq("id", warehouseId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existingError) {
      throw new Error(existingError.message);
    }

    return { actor, companyId, supabase, existing: existing || null };
  } catch (error) {
    if (error instanceof SessionAuthError) throw error;
    throw error;
  }
}

