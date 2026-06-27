import { NextRequest, NextResponse } from "next/server";
import {
  assertNoGeneratedOperations,
  insertSchemeRevision,
  loadCropCareBootstrap,
  syncSchemeFieldsFromCropStructure,
} from "@/lib/services/crop-care-schemes";
import { assertSchemeInCurrentSeason, assertWritableSeason, getCropCareRequestContext, jsonError } from "../../../_server";

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
    await assertNoGeneratedOperations(
      ctx.supabase,
      ctx.companyId,
      id,
      "По схеме уже созданы операции. Синхронизация участков заблокирована в V1."
    );
    const fields = await syncSchemeFieldsFromCropStructure({
      supabase: ctx.supabase,
      companyId: ctx.companyId,
      schemeId: id,
      includedCropStructureIds: Array.isArray(body.included_crop_structure_ids)
        ? body.included_crop_structure_ids.map(String)
        : null,
    });
    await insertSchemeRevision({
      supabase: ctx.supabase,
      schemeId: id,
      companyId: ctx.companyId,
      changeType: "fields_synced",
      payload: { fields_count: fields.length },
      actorUserId: ctx.actor.id,
    });
    return NextResponse.json(await loadCropCareBootstrap(ctx.supabase, ctx.companyId));
  } catch (error) {
    return jsonError(error, "Failed to sync crop care scheme fields");
  }
}
