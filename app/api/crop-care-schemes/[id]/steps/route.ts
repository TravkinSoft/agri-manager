import { NextRequest, NextResponse } from "next/server";
import { createCropCareStep, loadCropCareBootstrap } from "@/lib/services/crop-care-schemes";
import { assertSchemeInCurrentSeason, assertWritableSeason, getCropCareRequestContext, jsonError } from "../../_server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json().catch(() => ({}));
    const ctx = await getCropCareRequestContext(request, body.companyId);
    assertWritableSeason(ctx.seasonState);
    const { id } = await params;
    await assertSchemeInCurrentSeason(ctx, id);
    const stepId = await createCropCareStep({
      supabase: ctx.supabase,
      companyId: ctx.companyId,
      schemeId: id,
      input: body,
      actorUserId: ctx.actor.id,
    });
    const payload = await loadCropCareBootstrap(ctx.supabase, ctx.companyId);
    return NextResponse.json({ step_id: stepId, ...payload });
  } catch (error) {
    return jsonError(error, "Failed to create crop care scheme step");
  }
}
