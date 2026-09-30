import { NextRequest, NextResponse } from "next/server";
import { loadCropCareBootstrap, updateCropCareScheme } from "@/lib/services/crop-care-schemes";
import { assertSchemeInCurrentSeason, assertWritableSeason, getCropCareRequestContext, jsonError } from "../_server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getCropCareRequestContext(request);
    const payload = await loadCropCareBootstrap(ctx.supabase, ctx.companyId);
    const { id } = await params;
    return NextResponse.json({
      ...payload,
      scheme: payload.schemes.find((scheme) => scheme.id === id) || null,
    });
  } catch (error) {
    return jsonError(error, "Failed to load crop care scheme");
  }
}

export async function PATCH(
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
      patch: body,
      actorUserId: ctx.actor.id,
    });
    const payload = await loadCropCareBootstrap(ctx.supabase, ctx.companyId);
    return NextResponse.json(payload);
  } catch (error) {
    return jsonError(error, "Failed to update crop care scheme");
  }
}
