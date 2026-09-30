import { NextRequest, NextResponse } from "next/server";
import { POST as createOperationPost } from "@/app/api/operations/route";
import {
  buildOperationPayloadFromScheme,
  insertSchemeRevision,
  loadCropCareBootstrap,
  loadCropCareSchemes,
} from "@/lib/services/crop-care-schemes";
import { assertSchemeInCurrentSeason, assertWritableSeason, getCropCareRequestContext, jsonError } from "../../../../_server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  try {
    const body = await request.json().catch(() => ({}));
    const ctx = await getCropCareRequestContext(request, body.companyId);
    assertWritableSeason(ctx.seasonState);
    const { id, stepId } = await params;
    const schemeHeader = await assertSchemeInCurrentSeason(ctx, id);
    if (schemeHeader.status !== "active") {
      return NextResponse.json({ error: "Операции можно создавать только по активной схеме" }, { status: 409 });
    }

    const { data: existingLink, error: existingError } = await ctx.supabase
      .from("crop_care_scheme_operations")
      .select("id,operation_id,status")
      .eq("company_id", ctx.companyId)
      .eq("crop_care_scheme_id", id)
      .eq("step_id", stepId)
      .eq("status", "active")
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existingLink?.operation_id) {
      return NextResponse.json({
        created: false,
        skipped_reason: "operation_already_exists",
        operation_id: existingLink.operation_id,
        ...(await loadCropCareBootstrap(ctx.supabase, ctx.companyId)),
      });
    }

    const schemes = ctx.season?.id ? await loadCropCareSchemes(ctx.supabase, ctx.companyId, ctx.season.id) : [];
    const scheme = schemes.find((item) => item.id === id);
    if (!scheme) return NextResponse.json({ error: "Схема не найдена." }, { status: 404 });
    const step = scheme.steps.find((item) => item.id === stepId);
    if (!step) return NextResponse.json({ error: "Этап не найден." }, { status: 404 });
    if (!step.responsible_user_id) {
      return NextResponse.json({ error: "Назначьте ответственного перед созданием операции." }, { status: 400 });
    }
    if (!scheme.fields.some((field) => field.included)) {
      return NextResponse.json({ error: "В схеме нет выбранных участков." }, { status: 400 });
    }

    const operationPayload = buildOperationPayloadFromScheme({
      companyId: ctx.companyId,
      scheme,
      fields: scheme.fields,
      step,
      materials: step.materials,
    });
    const idempotencyKey = `crop-care:${id}:${stepId}:v1`;
    const headers = new Headers();
    const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
    if (authHeader) headers.set("Authorization", authHeader);
    headers.set("Content-Type", "application/json");
    headers.set("Idempotency-Key", idempotencyKey);

    const operationRequest = new NextRequest(new URL("/api/operations", request.url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...operationPayload,
        idempotency_key: idempotencyKey,
      }),
    });

    const operationResponse = await createOperationPost(operationRequest);
    const operationBody = await operationResponse.json().catch(() => ({}));
    if (!operationResponse.ok || !operationBody?.operation?.id) {
      return NextResponse.json(
        { error: operationBody?.error || "Не удалось создать операцию по этапу.", details: operationBody },
        { status: operationResponse.status || 400 }
      );
    }

    const operationId = String(operationBody.operation.id);
    const { error: linkError } = await ctx.supabase.from("crop_care_scheme_operations").insert({
      crop_care_scheme_id: id,
      step_id: stepId,
      company_id: ctx.companyId,
      operation_id: operationId,
      idempotency_key: idempotencyKey,
      generated_by_user_id: ctx.actor.id,
      notes: "Generated from crop care scheme step",
    });
    if (linkError && !String(linkError.message || "").toLowerCase().includes("duplicate")) {
      throw new Error(linkError.message);
    }

    await ctx.supabase
      .from("crop_care_scheme_steps")
      .update({ status: "generated", updated_by_user_id: ctx.actor.id })
      .eq("id", stepId)
      .eq("company_id", ctx.companyId)
      .eq("crop_care_scheme_id", id);

    await insertSchemeRevision({
      supabase: ctx.supabase,
      schemeId: id,
      companyId: ctx.companyId,
      changeType: "operation_generated",
      payload: { step_id: stepId, operation_id: operationId },
      actorUserId: ctx.actor.id,
    });

    return NextResponse.json({
      created: true,
      operation_id: operationId,
      material_request: operationBody.material_request || null,
      ...(await loadCropCareBootstrap(ctx.supabase, ctx.companyId)),
    });
  } catch (error) {
    return jsonError(error, "Failed to generate operation from crop care scheme step");
  }
}
