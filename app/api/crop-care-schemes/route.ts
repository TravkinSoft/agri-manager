import { NextRequest, NextResponse } from "next/server";
import {
  createCropCareScheme,
  getCropStructureSections,
  loadCropCareBootstrap,
  type CropCareSchemeType,
} from "@/lib/services/crop-care-schemes";
import { assertWritableSeason, getCropCareRequestContext, jsonError } from "./_server";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getCropCareRequestContext(request);
    const sectionsMode = request.nextUrl.searchParams.get("sections") === "1";
    if (sectionsMode) {
      if (!ctx.season?.id) {
        return NextResponse.json({ sections: [], season: null });
      }
      const sections = await getCropStructureSections({
        supabase: ctx.supabase,
        companyId: ctx.companyId,
        seasonId: ctx.season.id,
        cropId: request.nextUrl.searchParams.get("cropId"),
        varietyId: request.nextUrl.searchParams.get("varietyId"),
      });
      return NextResponse.json({ sections, season: ctx.season, read_only: ctx.seasonState.readOnly });
    }
    const payload = await loadCropCareBootstrap(ctx.supabase, ctx.companyId);
    return NextResponse.json(payload);
  } catch (error) {
    return jsonError(error, "Failed to load crop care schemes");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const ctx = await getCropCareRequestContext(request, body.companyId);
    assertWritableSeason(ctx.seasonState);
    if (!ctx.season?.id) {
      return NextResponse.json({ error: "Нет активного сезона." }, { status: 409 });
    }
    const id = await createCropCareScheme({
      supabase: ctx.supabase,
      companyId: ctx.companyId,
      seasonId: ctx.season.id,
      cropId: String(body.crop_id || ""),
      varietyId: body.variety_id ? String(body.variety_id) : null,
      name: String(body.name || ""),
      schemeType: (body.scheme_type || "combined") as CropCareSchemeType,
      description: body.description ? String(body.description) : null,
      includedCropStructureIds: Array.isArray(body.included_crop_structure_ids)
        ? body.included_crop_structure_ids.map(String)
        : null,
      actorUserId: ctx.actor.id,
    });
    const payload = await loadCropCareBootstrap(ctx.supabase, ctx.companyId);
    return NextResponse.json({ id, ...payload });
  } catch (error) {
    return jsonError(error, "Failed to create crop care scheme");
  }
}
