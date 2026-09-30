import { NextRequest, NextResponse } from "next/server";
import { fieldsMapErrorResponse, resolveFieldsMapContext } from "@/lib/fields-map/server";

function isUuidLike(value: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(String(value || "").trim());
}

async function mutateImportState(params: {
  importId: string;
  companyId: string;
  actorId: string;
  action: "activate" | "deactivate" | "archive";
  expectedRevision: Record<string, unknown>;
  expectedTargetUpdatedAt: string;
  supabase: Awaited<ReturnType<typeof resolveFieldsMapContext>>["supabase"];
}) {
  const result = await params.supabase.rpc("set_field_map_import_state_v3", {
    p_company_id: params.companyId,
    p_import_id: params.importId,
    p_actor_id: params.actorId,
    p_action: params.action,
    p_expected_revision: params.expectedRevision,
    p_expected_target_updated_at: params.expectedTargetUpdatedAt,
  });
  if (result.error) throw new Error(result.error.message);
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await resolveFieldsMapContext(request, { mutation: true });
    const { companyId, supabase, actor } = context;
    const importId = String(params.id || "").trim();
    if (!isUuidLike(importId)) {
      return NextResponse.json({ error: "Некорректный import id" }, { status: 400 });
    }

    const body = await request.json();
    const action = String(body?.action || "").trim().toLowerCase();
    const expectedRevision = body?.expected_map_revision;
    const expectedTargetUpdatedAt = String(body?.expected_target_updated_at || "").trim();
    if (!expectedRevision || typeof expectedRevision !== "object" || Array.isArray(expectedRevision) || !expectedTargetUpdatedAt) {
      return NextResponse.json({ error: "История импортов устарела. Обновите карту и повторите действие." }, { status: 409 });
    }

    const importRes = await supabase
      .from("field_map_imports")
      .select("id,status")
      .eq("company_id", companyId)
      .eq("id", importId)
      .maybeSingle();
    if (importRes.error || !importRes.data?.id) {
      return NextResponse.json({ error: importRes.error?.message || "Импорт не найден" }, { status: 404 });
    }

    if (action === "activate") {
      if (importRes.data.status !== "imported") {
        return NextResponse.json({ error: "Активировать можно только завершённый импорт" }, { status: 409 });
      }
      await mutateImportState({ importId, companyId, actorId: actor.id, action, expectedRevision, expectedTargetUpdatedAt, supabase });
      return NextResponse.json({ ok: true, action: "activate" });
    }
    if (action === "deactivate") {
      await mutateImportState({ importId, companyId, actorId: actor.id, action, expectedRevision, expectedTargetUpdatedAt, supabase });
      return NextResponse.json({ ok: true, action: "deactivate" });
    }
    if (action === "delete" || action === "archive") {
      await mutateImportState({ importId, companyId, actorId: actor.id, action: "archive", expectedRevision, expectedTargetUpdatedAt, supabase });
      return NextResponse.json({ ok: true, action: "archive" });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    return fieldsMapErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await resolveFieldsMapContext(request, { mutation: true });
    const { companyId, supabase, actor } = context;
    const importId = String(params.id || "").trim();
    if (!isUuidLike(importId)) {
      return NextResponse.json({ error: "Некорректный import id" }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const expectedRevision = body?.expected_map_revision;
    const expectedTargetUpdatedAt = String(body?.expected_target_updated_at || "").trim();
    if (!expectedRevision || typeof expectedRevision !== "object" || Array.isArray(expectedRevision) || !expectedTargetUpdatedAt) {
      return NextResponse.json({ error: "История импортов устарела. Обновите карту и повторите действие." }, { status: 409 });
    }
    await mutateImportState({ importId, companyId, actorId: actor.id, action: "archive", expectedRevision, expectedTargetUpdatedAt, supabase });
    return NextResponse.json({ ok: true, action: "delete" });
  } catch (error) {
    return fieldsMapErrorResponse(error);
  }
}
