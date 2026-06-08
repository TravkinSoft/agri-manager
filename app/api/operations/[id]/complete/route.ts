import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { resolveCanonicalOperationType } from "@/lib/operations/operation-engine";

const COMPLETE_ALLOWED_ROLES = [
  "global_admin",
  "company_admin",
  "agronomist",
  "specialist",
  "brigadier",
] as const;

function requiresCropStructure(categorySlug: string | null, typeSlug: string | null, operationType: string | null): boolean {
  const canonical = resolveCanonicalOperationType({ categorySlug, typeSlug, operationType });
  if (canonical) return canonical.requiresCropStructure;

  const category = String(categorySlug || "").trim().toLowerCase();
  const type = String(typeSlug || "").trim().toLowerCase();
  const label = String(operationType || "").trim().toLowerCase();
  const merged = `${category} ${type} ${label}`;

  if (["logistics", "service", "service_operations", "post_harvest", "processing"].includes(category)) {
    return false;
  }

  return [
    "soil_preparation",
    "seeding_planting",
    "fertilization",
    "plant_protection",
    "crop_care",
    "irrigation",
    "harvesting",
    "spray",
    "seed",
    "sow",
    "plant",
    "fertiliz",
    "harvest",
    "полив",
    "посев",
    "посад",
    "удобрен",
    "опрыск",
    "уборк",
    "уход",
  ].some((token) => merged.includes(token));
}

function hasPositiveNumber(value: unknown): boolean {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0;
}

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
    const comment = String(body.comment || "").trim();
    const supabase = getServiceClient();

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...COMPLETE_ALLOWED_ROLES],
    });

    const { data: operation, error: operationError } = await supabase
      .from("operations")
      .select("id,company_id,responsible_user_id,work_status,status,crop_structure_id,operation_category_slug,operation_type_slug,operation_type")
      .eq("id", operationId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (operationError || !operation?.id) {
      return NextResponse.json(
        { error: operationError?.message || "Operation not found" },
        { status: 404 }
      );
    }

    const isAdmin =
      actor.role === "global_admin" || actor.role === "company_admin" || actor.role === "agronomist";
    const responsibleId = String(operation.responsible_user_id || "").trim();
    if (!isAdmin && responsibleId && responsibleId !== actor.id) {
      return NextResponse.json({ error: "Operation is assigned to another specialist" }, { status: 403 });
    }

    const isProductionOperation = requiresCropStructure(
      String(operation.operation_category_slug || ""),
      String(operation.operation_type_slug || ""),
      String(operation.operation_type || "")
    );

    if (isProductionOperation && !operation.crop_structure_id) {
      return NextResponse.json(
        { error: "Production operation cannot be completed without crop_structure_id" },
        { status: 400 }
      );
    }

    if (isProductionOperation && !comment) {
      return NextResponse.json({ error: "Completion comment is required" }, { status: 400 });
    }

    if (isProductionOperation) {
      const { data: lines, error: linesError } = await supabase
        .from("operation_lines")
        .select("id,actual_area_ha")
        .eq("operation_id", operationId)
        .eq("company_id", companyId);
      if (linesError) {
        return NextResponse.json({ error: linesError.message }, { status: 400 });
      }
      const hasActualArea = (lines || []).some((line: any) => hasPositiveNumber(line.actual_area_ha));
      if (!hasActualArea) {
        return NextResponse.json({ error: "Actual area is required before completion" }, { status: 400 });
      }

      const { data: materials, error: materialsError } = await supabase
        .from("operation_materials")
        .select("id,actual_rate,issued_quantity,consumed_quantity,returned_quantity")
        .eq("operation_id", operationId)
        .eq("company_id", companyId);
      if (materialsError) {
        return NextResponse.json({ error: materialsError.message }, { status: 400 });
      }

      const incompleteMaterial = (materials || []).find((material: any) => {
        const actualRateSet = material.actual_rate !== null && material.actual_rate !== undefined;
        const consumedSet = material.consumed_quantity !== null && material.consumed_quantity !== undefined;
        const returnedSet = material.returned_quantity !== null && material.returned_quantity !== undefined;
        const issued = Number(material.issued_quantity || 0);
        if (issued > 0) return !consumedSet || !returnedSet;
        return !actualRateSet && !consumedSet;
      });

      if (incompleteMaterial) {
        return NextResponse.json(
          { error: "Actual material usage and returns are required before completion", material_id: incompleteMaterial.id },
          { status: 400 }
        );
      }

      const impossibleMaterialFact = (materials || []).find((material: any) => {
        const issued = Number(material.issued_quantity || 0);
        const consumed = Number(material.consumed_quantity || 0);
        const returned = Number(material.returned_quantity || 0);
        return issued > 0 && consumed + returned > issued;
      });

      if (impossibleMaterialFact) {
        return NextResponse.json(
          {
            error: "Material fact cannot exceed issued quantity",
            material_id: impossibleMaterialFact.id,
          },
          { status: 400 }
        );
      }
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("operations")
      .update({
        work_status: "completed",
        status: "completed",
        completed_at: nowIso,
        specialist_comment: comment || null,
        updated_at: nowIso,
      })
      .eq("id", operationId)
      .eq("company_id", companyId)
      .select("*")
      .single();

    if (updateError || !updated?.id) {
      return NextResponse.json(
        { error: updateError?.message || "Failed to complete operation" },
        { status: 400 }
      );
    }

    return NextResponse.json({ operation: updated });
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
