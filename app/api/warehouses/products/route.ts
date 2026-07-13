import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { normalizeStockUom } from "@/lib/warehouse/stock-unit-contract";

const READ_ROLES = [
  "global_admin",
  "company_admin",
  "warehouse",
  "warehouse_operator",
  "weighman",
  "agronomist",
  "director",
] as const;

const WRITE_ROLES = [
  "global_admin",
  "company_admin",
  "warehouse",
  "warehouse_operator",
  "agronomist",
  "director",
] as const;

const PRODUCT_TYPES = new Set([
  "crop",
  "seed",
  "fertilizer",
  "pesticide",
  "additive",
  "organic",
  "fuel",
  "material",
  "produce",
]);

const ACCOUNTING_MODES = new Set([
  "bulk_mass",
  "unit_with_weight",
  "package_count",
]);

function toNullableText(value: unknown): string | null {
  const text = String(value || "").trim();
  return text || null;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseIncludeArchived(raw: unknown): boolean {
  return String(raw || "").trim().toLowerCase() === "true";
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const includeArchived = parseIncludeArchived(request.nextUrl.searchParams.get("includeArchived"));

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...READ_ROLES],
    });

    let query = supabase
      .from("products")
      .select("*")
      .eq("company_id", companyId)
      .order("name", { ascending: true });

    if (!includeArchived) {
      query = query.eq("archived", false);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({
      products: data || [],
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const body = await request.json().catch(() => ({}));
    const requestedCompanyId = String(body.companyId || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WRITE_ROLES],
    });

    const name = String(body.name || "").trim();
    const type = String(body.type || "").trim().toLowerCase();
    if (!name) return NextResponse.json({ error: "Product name is required" }, { status: 400 });
    if (!PRODUCT_TYPES.has(type)) return NextResponse.json({ error: "Invalid product type" }, { status: 400 });
    const baseUom = normalizeStockUom(toNullableText(body.base_uom) || toNullableText(body.unit)).baseUom;

    const payload = {
      company_id: companyId,
      user_id: actor.authUserId,
      name,
      type,
      product_type: ["pesticide", "fertilizer", "additive"].includes(type) ? type : null,
      category: type === "additive" ? "additive" : null,
      crop_id: toNullableText(body.crop_id),
      product_form: toNullableText(body.product_form),
      accounting_mode: ACCOUNTING_MODES.has(String(body.accounting_mode || ""))
        ? String(body.accounting_mode)
        : "bulk_mass",
      base_uom: baseUom,
      pack_uom: toNullableText(body.pack_uom),
      unit_weight_kg: toNullableNumber(body.unit_weight_kg),
      units_per_pack: toNullableNumber(body.units_per_pack),
      unit: baseUom,
      description: toNullableText(body.description),
      archived: false,
      is_active: body.is_active !== false,
    };

    const { data, error } = await supabase
      .from("products")
      .insert(payload)
      .select("*")
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Failed to create product" }, { status: 400 });
    }

    return NextResponse.json({ product: data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
