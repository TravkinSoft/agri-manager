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
  "brigadier",
] as const;

const FULL_EDIT_ROLES = new Set<string>(["global_admin", "company_admin", "agronomist"]);

const BRIGADIER_ALLOWED_KEYS = new Set([
  "actual_area_ha",
  "row_count",
  "row_spacing_m",
  "seed_spacing_cm",
  "notes",
  "completed",
  "completed_at",
]);

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nullableUuid(value: unknown): string | null {
  const v = String(value || "").trim();
  return v || null;
}

export async function GET(request: NextRequest, context: { params: Promise<{ lineId: string }> }) {
  try {
    const actor = await getServerActorFromSession(request);
    const { lineId } = await context.params;
    const id = String(lineId || "").trim();
    if (!id) return NextResponse.json({ error: "line id is required" }, { status: 400 });

    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const supabase = getServiceClient();

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...READ_ROLES],
    });

    const { data, error } = await supabase
      .from("operation_lines")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data?.id) return NextResponse.json({ error: "line not found" }, { status: 404 });

    return NextResponse.json({ operation_line: data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ lineId: string }> }) {
  try {
    const actor = await getServerActorFromSession(request);
    const { lineId } = await context.params;
    const id = String(lineId || "").trim();
    if (!id) return NextResponse.json({ error: "line id is required" }, { status: 400 });

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

    const { data: existing, error: existingError } = await supabase
      .from("operation_lines")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle();
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 400 });
    if (!existing?.id) return NextResponse.json({ error: "line not found" }, { status: 404 });

    if (!FULL_EDIT_ROLES.has(actor.role)) {
      const incomingKeys = Object.keys(body || {}).filter((key) => key !== "companyId");
      const hasDisallowed = incomingKeys.some((key) => !BRIGADIER_ALLOWED_KEYS.has(key));
      if (hasDisallowed) {
        return NextResponse.json({ error: "brigadier can edit only fact metrics" }, { status: 403 });
      }
    }

    const patch: Record<string, unknown> = {
      updated_by_user_id: actor.authUserId,
    };

    if (body.field_id !== undefined && FULL_EDIT_ROLES.has(actor.role)) patch.field_id = nullableUuid(body.field_id);
    if (body.crop_id !== undefined && FULL_EDIT_ROLES.has(actor.role)) patch.crop_id = nullableUuid(body.crop_id);
    if (body.variety_id !== undefined && FULL_EDIT_ROLES.has(actor.role)) patch.variety_id = nullableUuid(body.variety_id);
    if (body.reproduction_id !== undefined && FULL_EDIT_ROLES.has(actor.role)) patch.reproduction_id = nullableUuid(body.reproduction_id);
    if (body.planned_area_ha !== undefined && FULL_EDIT_ROLES.has(actor.role)) {
      const planned = nullableNumber(body.planned_area_ha);
      if (planned == null || planned < 0) {
        return NextResponse.json({ error: "planned_area_ha must be >= 0" }, { status: 400 });
      }
      patch.planned_area_ha = planned;
    }
    if (body.actual_area_ha !== undefined) {
      const actual = nullableNumber(body.actual_area_ha);
      if (actual != null && actual < 0) return NextResponse.json({ error: "actual_area_ha must be >= 0" }, { status: 400 });
      patch.actual_area_ha = actual;
    }
    if (body.row_count !== undefined) {
      const rowCount = nullableNumber(body.row_count);
      if (rowCount != null && rowCount < 0) return NextResponse.json({ error: "row_count must be >= 0" }, { status: 400 });
      patch.row_count = rowCount;
    }
    if (body.row_spacing_m !== undefined) {
      const rowSpacing = nullableNumber(body.row_spacing_m);
      if (rowSpacing != null && rowSpacing <= 0) return NextResponse.json({ error: "row_spacing_m must be > 0" }, { status: 400 });
      patch.row_spacing_m = rowSpacing;
    }
    if (body.seed_spacing_cm !== undefined) {
      const seedSpacing = nullableNumber(body.seed_spacing_cm);
      if (seedSpacing != null && seedSpacing <= 0) return NextResponse.json({ error: "seed_spacing_cm must be > 0" }, { status: 400 });
      patch.seed_spacing_cm = seedSpacing;
    }
    if (body.notes !== undefined) patch.notes = String(body.notes || "").trim() || null;
    if (body.completed === true) {
      patch.completed_by = actor.id;
      patch.completed_at = String(body.completed_at || "").trim() || new Date().toISOString();
    }

    const { data, error } = await supabase
      .from("operation_lines")
      .update(patch)
      .eq("company_id", companyId)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) return NextResponse.json({ error: error?.message || "failed to update line" }, { status: 400 });

    return NextResponse.json({ operation_line: data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ lineId: string }> }) {
  try {
    const actor = await getServerActorFromSession(request);
    const { lineId } = await context.params;
    const id = String(lineId || "").trim();
    if (!id) return NextResponse.json({ error: "line id is required" }, { status: 400 });

    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const supabase = getServiceClient();

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: ["global_admin", "company_admin", "agronomist"],
    });

    const { error } = await supabase
      .from("operation_lines")
      .delete()
      .eq("company_id", companyId)
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

