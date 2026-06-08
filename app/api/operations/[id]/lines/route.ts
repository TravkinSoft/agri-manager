import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { resolveCanonicalOperationType } from "@/lib/operations/operation-engine";

const READ_ROLES = [
  "global_admin",
  "company_admin",
  "agronomist",
  "director",
  "specialist",
  "brigadier",
] as const;

const WRITE_ROLES = [
  "global_admin",
  "company_admin",
  "agronomist",
] as const;

function nullableUuid(value: unknown): string | null {
  const v = String(value || "").trim();
  return v || null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function allowsOperationLines(operation: { operation_category_slug?: string | null; operation_type_slug?: string | null; operation_type?: string | null }): boolean {
  const canonical = resolveCanonicalOperationType({
    categorySlug: operation.operation_category_slug,
    typeSlug: operation.operation_type_slug,
    operationType: operation.operation_type,
  });
  if (canonical) return canonical.requiresCropStructure;

  const categorySlug = String(operation.operation_category_slug || "").trim().toLowerCase();
  if (categorySlug === "seeding_planting" || categorySlug === "harvesting") return true;
  const merged = `${String(operation.operation_type_slug || "").toLowerCase()} ${String(operation.operation_type || "").toLowerCase()}`;
  return ["seed", "sow", "plant", "harvest", "посев", "посад", "уборк"].some((token) => merged.includes(token));
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getServerActorFromSession(request);
    const { id } = await context.params;
    const operationId = String(id || "").trim();
    if (!operationId) return NextResponse.json({ error: "operation id is required" }, { status: 400 });

    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const supabase = getServiceClient();

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...READ_ROLES],
    });

    const { data: operation, error: operationError } = await supabase
      .from("operations")
      .select("id,company_id,operation_category_slug,operation_type_slug,operation_type")
      .eq("id", operationId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (operationError) return NextResponse.json({ error: operationError.message }, { status: 400 });
    if (!operation?.id) return NextResponse.json({ error: "operation not found" }, { status: 404 });

    const { data, error } = await supabase
      .from("operation_lines")
      .select(`
        *,
        fields:field_id (name),
        crops:crop_id (name),
        varieties:variety_id (name),
        reproductions:reproduction_id (name)
      `)
      .eq("company_id", companyId)
      .eq("operation_id", operationId)
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const rows = (data || []).map((row: any) => ({
      ...row,
      field_name: row.fields?.name || null,
      crop_name: row.crops?.name || null,
      variety_name: row.varieties?.name || null,
      reproduction_name: row.reproductions?.name || null,
    }));

    return NextResponse.json({ operation_lines: rows });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getServerActorFromSession(request);
    const body = await request.json().catch(() => ({}));
    const { id } = await context.params;
    const operationId = String(id || "").trim();
    if (!operationId) return NextResponse.json({ error: "operation id is required" }, { status: 400 });

    const requestedCompanyId = String(body.companyId || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const supabase = getServiceClient();

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WRITE_ROLES],
    });

    const { data: operation, error: operationError } = await supabase
      .from("operations")
      .select("id,company_id,field_id,crop_structure_id,operation_category_slug,operation_type_slug,operation_type")
      .eq("id", operationId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (operationError) return NextResponse.json({ error: operationError.message }, { status: 400 });
    if (!operation?.id) return NextResponse.json({ error: "operation not found" }, { status: 404 });
    if (!allowsOperationLines(operation)) {
      return NextResponse.json({ error: "operation lines are not enabled for this operation type" }, { status: 400 });
    }

    const plannedArea = nullableNumber(body.planned_area_ha);
    if (plannedArea == null || plannedArea < 0) {
      return NextResponse.json({ error: "planned_area_ha must be >= 0" }, { status: 400 });
    }
    const actualArea = nullableNumber(body.actual_area_ha);
    if (actualArea != null && actualArea < 0) {
      return NextResponse.json({ error: "actual_area_ha must be >= 0" }, { status: 400 });
    }
    const rowCount = nullableNumber(body.row_count);
    if (rowCount != null && rowCount < 0) {
      return NextResponse.json({ error: "row_count must be >= 0" }, { status: 400 });
    }
    const rowSpacing = nullableNumber(body.row_spacing_m);
    if (rowSpacing != null && rowSpacing <= 0) {
      return NextResponse.json({ error: "row_spacing_m must be > 0" }, { status: 400 });
    }
    const seedSpacing = nullableNumber(body.seed_spacing_cm);
    if (seedSpacing != null && seedSpacing <= 0) {
      return NextResponse.json({ error: "seed_spacing_cm must be > 0" }, { status: 400 });
    }

    let resolvedCropId = nullableUuid(body.crop_id);
    if (!resolvedCropId && operation.crop_structure_id) {
      const { data: structureRow, error: structureError } = await supabase
        .from("crop_structure")
        .select("crop_id")
        .eq("id", operation.crop_structure_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (structureError) {
        return NextResponse.json({ error: structureError.message }, { status: 400 });
      }
      resolvedCropId = nullableUuid(structureRow?.crop_id);
    }

    const payload = {
      company_id: companyId,
      operation_id: operationId,
      field_id: nullableUuid(body.field_id) ?? operation.field_id ?? null,
      crop_id: resolvedCropId,
      variety_id: nullableUuid(body.variety_id),
      reproduction_id: nullableUuid(body.reproduction_id),
      planned_area_ha: plannedArea,
      actual_area_ha: actualArea,
      row_count: rowCount,
      row_spacing_m: rowSpacing,
      seed_spacing_cm: seedSpacing,
      notes: String(body.notes || "").trim() || null,
      created_by_user_id: actor.authUserId,
      updated_by_user_id: actor.authUserId,
    };

    const { data, error } = await supabase
      .from("operation_lines")
      .insert(payload)
      .select("*")
      .single();
    if (error || !data) return NextResponse.json({ error: error?.message || "failed to create line" }, { status: 400 });

    return NextResponse.json({ operation_line: data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
