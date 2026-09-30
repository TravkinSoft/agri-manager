import { NextRequest, NextResponse } from "next/server";
import { loadCropCareBootstrap, updateCropCareStep } from "@/lib/services/crop-care-schemes";
import { assertSchemeInCurrentSeason, assertWritableSeason, getCropCareRequestContext, jsonError } from "../../../_server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  try {
    const body = await request.json().catch(() => ({}));
    const ctx = await getCropCareRequestContext(request, body.companyId);
    assertWritableSeason(ctx.seasonState);
    const { id, stepId } = await params;
    await assertSchemeInCurrentSeason(ctx, id);
    await updateCropCareStep({
      supabase: ctx.supabase,
      companyId: ctx.companyId,
      schemeId: id,
      stepId,
      input: body,
      actorUserId: ctx.actor.id,
    });
    return NextResponse.json(await loadCropCareBootstrap(ctx.supabase, ctx.companyId));
  } catch (error) {
    return jsonError(error, "Failed to update crop care scheme step");
  }
}
