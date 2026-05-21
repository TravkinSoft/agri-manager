import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { ensureMaterialRequestForOperation } from "@/app/api/operations/_material-request-helper";

const ENSURE_ALLOWED_ROLES = ["global_admin", "company_admin", "agronomist"] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const operationId = String(id || "").trim();
    if (!operationId) {
      return NextResponse.json({ error: "operation id is required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const actor = await getServerActorFromSession(request);
    const requestedCompanyId = String(body.companyId || "").trim() || null;
    const companyId = resolveCompanyForActor(actor, requestedCompanyId);
    const supabase = getServiceClient();

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...ENSURE_ALLOWED_ROLES],
    });

    const { data: operationRow, error: operationError } = await supabase
      .from("operations")
      .select("id,company_id,field_id,crop_structure_id,date,notes,responsible_user_id")
      .eq("id", operationId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (operationError || !operationRow?.id) {
      return NextResponse.json({ error: operationError?.message || "Operation not found" }, { status: 404 });
    }

    let varietyId: string | null = null;
    let reproductionId: string | null = null;
    let cropId: string | null = null;
    if (operationRow.crop_structure_id) {
      const { data: structureRow } = await supabase
        .from("crop_structure")
        .select("crop_id,variety_id,reproduction_id")
        .eq("id", operationRow.crop_structure_id)
        .eq("company_id", companyId)
        .maybeSingle();
      cropId = String((structureRow as any)?.crop_id || "").trim() || null;
      varietyId = String((structureRow as any)?.variety_id || "").trim() || null;
      reproductionId = String((structureRow as any)?.reproduction_id || "").trim() || null;
    }

    const result = await ensureMaterialRequestForOperation({
      supabase,
      companyId,
      operationId: String(operationRow.id),
      fieldId: String(operationRow.field_id),
      operationDate: String(operationRow.date),
      notes: String(operationRow.notes || "").trim() || null,
      responsibleUserId: String(operationRow.responsible_user_id || "").trim() || null,
      plannedAreaHa: null,
      cropId,
      varietyId,
      reproductionId,
    });

    return NextResponse.json({
      operation_id: operationId,
      material_request: result,
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
