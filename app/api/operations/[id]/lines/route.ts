import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";

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
      .select("id,company_id")
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
      .select("id,company_id,field_id,crop_structure_id")
      .eq("id", operationId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (operationError) return NextResponse.json({ error: operationError.message }, { status: 400 });
    if (!operation?.id) return NextResponse.json({ error: "operation not found" }, { status: 404 });

    const plannedArea = nullableNumber(body.planned_area_ha);
    if (plannedArea == null || plannedArea < 0) {
      return NextResponse.json({ error: "planned_area_ha must be >= 0" }, { status: 400 });
    }

    const payload = {
      company_id: companyId,
      operation_id: operationId,
      field_id: nullableUuid(body.field_id) ?? operation.field_id ?? null,
      crop_id: nullableUuid(body.crop_id),
      variety_id: nullableUuid(body.variety_id),
      reproduction_id: nullableUuid(body.reproduction_id),
      planned_area_ha: plannedArea,
      actual_area_ha: nullableNumber(body.actual_area_ha),
      row_count: nullableNumber(body.row_count),
      row_spacing_m: nullableNumber(body.row_spacing_m),
      seed_spacing_cm: nullableNumber(body.seed_spacing_cm),
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

