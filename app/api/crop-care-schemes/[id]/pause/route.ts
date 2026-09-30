import { NextRequest, NextResponse } from "next/server";
import { loadCropCareBootstrap, updateCropCareScheme } from "@/lib/services/crop-care-schemes";
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
    await updateCropCareScheme({
      supabase: ctx.supabase,
      companyId: ctx.companyId,
      schemeId: id,
      patch: { status: "paused" },
      actorUserId: ctx.actor.id,
    });
    return NextResponse.json(await loadCropCareBootstrap(ctx.supabase, ctx.companyId));
  } catch (error) {
    return jsonError(error, "Failed to pause crop care scheme");
  }
}
