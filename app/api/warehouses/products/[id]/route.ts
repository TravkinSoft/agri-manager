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

async function resolveProduct(
  request: NextRequest,
  id: string,
  allowedRoles: readonly string[]
) {
  const actor = await getServerActorFromSession(request);
  const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
  const companyId = resolveCompanyForActor(actor, requestedCompanyId);
  const supabase = getServiceClient();

  await assertActorAccess({
    supabase,
    actorUserId: actor.id,
    companyId,
    allowedRoles: [...allowedRoles] as any,
  });

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { actor, companyId, supabase, existing: data || null };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const productId = String(id || "").trim();
    if (!productId) return NextResponse.json({ error: "Product id is required" }, { status: 400 });

    const { existing } = await resolveProduct(request, productId, READ_ROLES);
    if (!existing?.id) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    return NextResponse.json({ product: existing });
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

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const productId = String(id || "").trim();
    if (!productId) return NextResponse.json({ error: "Product id is required" }, { status: 400 });

    const { supabase, companyId, existing } = await resolveProduct(request, productId, WRITE_ROLES);
    if (!existing?.id) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name || "").trim();
      if (!name) return NextResponse.json({ error: "Product name is required" }, { status: 400 });
      patch.name = name;
    }
    if (body.type !== undefined) {
      const type = String(body.type || "").trim().toLowerCase();
      if (!PRODUCT_TYPES.has(type)) return NextResponse.json({ error: "Invalid product type" }, { status: 400 });
      patch.type = type;
      patch.product_type = ["pesticide", "fertilizer", "additive"].includes(type) ? type : null;
      patch.category = type === "additive" ? "additive" : null;
    }
    if (body.crop_id !== undefined) patch.crop_id = toNullableText(body.crop_id);
    if (body.product_form !== undefined) patch.product_form = toNullableText(body.product_form);
    if (body.accounting_mode !== undefined) {
      const accountingMode = String(body.accounting_mode || "").trim();
      if (!ACCOUNTING_MODES.has(accountingMode)) {
        return NextResponse.json({ error: "Invalid accounting_mode" }, { status: 400 });
      }
      patch.accounting_mode = accountingMode;
    }
    if (body.base_uom !== undefined || body.unit !== undefined) {
      const baseUom = normalizeStockUom(
        toNullableText(body.base_uom) || toNullableText(body.unit) || existing.base_uom || existing.unit
      ).baseUom;
      patch.base_uom = baseUom;
      patch.unit = baseUom;
    }
    if (body.pack_uom !== undefined) patch.pack_uom = toNullableText(body.pack_uom);
    if (body.unit_weight_kg !== undefined) patch.unit_weight_kg = toNullableNumber(body.unit_weight_kg);
    if (body.units_per_pack !== undefined) patch.units_per_pack = toNullableNumber(body.units_per_pack);
    if (body.description !== undefined) patch.description = toNullableText(body.description);
    if (body.is_active !== undefined) patch.is_active = body.is_active === true;
    if (body.archived !== undefined) patch.archived = body.archived === true;

    const { data, error } = await supabase
      .from("products")
      .update(patch)
      .eq("id", productId)
      .eq("company_id", companyId)
      .select("*")
      .single();
    if (error || !data) return NextResponse.json({ error: error?.message || "Failed to update product" }, { status: 400 });

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

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const productId = String(id || "").trim();
    if (!productId) return NextResponse.json({ error: "Product id is required" }, { status: 400 });

    const { supabase, companyId, existing } = await resolveProduct(request, productId, WRITE_ROLES);
    if (!existing?.id) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    const { data, error } = await supabase
      .from("products")
      .update({ archived: true })
      .eq("id", productId)
      .eq("company_id", companyId)
      .select("*")
      .single();
    if (error || !data) return NextResponse.json({ error: error?.message || "Failed to archive product" }, { status: 400 });

    return NextResponse.json({ product: data, archived: true });
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
