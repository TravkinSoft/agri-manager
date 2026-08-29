import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_READ_ROLES,
  WEIGHBRIDGE_WRITE_ROLES,
  asSessionErrorResponse,
  requireWeighbridgeOperatorSession,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";
import { isHarvestDestinationPlace, isProcessingPlace } from "@/lib/warehouse/warehouse-scope";
import { canUseGrainProcessing } from "@/lib/weighbridge/crop-processing";
import { getCurrentSeason, loadActiveHarvestRouteList } from "./_data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });
    return NextResponse.json(await loadActiveHarvestRouteList(supabase, companyId));
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    return NextResponse.json(
      { error: sessionError?.error || (error instanceof Error ? error.message : "Не удалось загрузить активные уборки") },
      { status: sessionError?.status || 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestedCompanyId = String(body.companyId || "").trim() || null;
    const cropStructureId = String(body.cropStructureId || "").trim();
    const warehouseId = String(body.warehouseId || "").trim();
    if (!cropStructureId || !warehouseId) {
      return NextResponse.json({ error: "Выберите участок и место приёмки" }, { status: 400 });
    }
    if (!UUID_RE.test(cropStructureId) || !UUID_RE.test(warehouseId)) {
      return NextResponse.json({ error: "Участок или место приёмки имеют некорректный идентификатор" }, { status: 400 });
    }

    const context = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId,
    });
    if (context.actor.role === "weighman") {
      await requireWeighbridgeOperatorSession(request, context);
    }
    const [season, structureRes, warehouseRes, existingRes, activeCountRes] = await Promise.all([
      getCurrentSeason(context.supabase, context.companyId),
      context.supabase
        .from("crop_structure")
        .select("id,field_id,crop_id,season_id,archived")
        .eq("id", cropStructureId)
        .eq("company_id", context.companyId)
        .eq("archived", false)
        .maybeSingle(),
      context.supabase
        .from("warehouses")
        .select("id,warehouse_type,place_type,archived,is_archived")
        .eq("id", warehouseId)
        .eq("company_id", context.companyId)
        .eq("archived", false)
        .eq("is_archived", false)
        .maybeSingle(),
      context.supabase
        .from("weighbridge_active_harvests")
        .select("id,status")
        .eq("company_id", context.companyId)
        .eq("crop_structure_id", cropStructureId)
        .eq("warehouse_id", warehouseId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      context.supabase
        .from("weighbridge_active_harvests")
        .select("id", { count: "exact", head: true })
        .eq("company_id", context.companyId)
        .eq("status", "active"),
    ]);
    if (!season?.id) return NextResponse.json({ error: "Активный сезон не найден" }, { status: 409 });
    if (
      structureRes.error ||
      !structureRes.data?.id ||
      !structureRes.data.crop_id ||
      String(structureRes.data.season_id) !== String(season.id)
    ) {
      return NextResponse.json({ error: "Участок активного сезона не найден" }, { status: 400 });
    }
    if (
      warehouseRes.error ||
      !warehouseRes.data?.id ||
      !isHarvestDestinationPlace(warehouseRes.data.warehouse_type, warehouseRes.data.place_type)
    ) {
      return NextResponse.json({ error: "Место приёмки урожая недоступно" }, { status: 400 });
    }
    if (isProcessingPlace(warehouseRes.data.place_type)) {
      const { data: crop, error: cropError } = await context.supabase
        .from("crops")
        .select("slug,name,name_ru,category_id,category,crop_category,subcategory,crop_subcategory")
        .eq("id", structureRes.data.crop_id)
        .maybeSingle();
      const categoryResult = crop?.category_id
        ? await context.supabase.from("crop_categories").select("slug,name_ru").eq("id", crop.category_id).maybeSingle()
        : { data: null, error: null } as any;
      if (cropError || categoryResult.error) {
        return NextResponse.json({ error: cropError?.message || categoryResult.error?.message }, { status: 400 });
      }
      if (crop && !canUseGrainProcessing({
        cropSlug: crop.slug,
        cropName: crop.name_ru || crop.name,
        categorySlug: categoryResult.data?.slug || crop.category,
        categoryName: categoryResult.data?.name_ru || crop.crop_category,
        subcategory: crop.subcategory || crop.crop_subcategory,
      })) {
        return NextResponse.json(
          { error: "Овощные культуры направляйте на склад. Примеси оформляются отдельным талоном «Примеси»." },
          { status: 400 }
        );
      }
    }

    if (existingRes.error) throw new Error(existingRes.error.message);
    if (activeCountRes.error) throw new Error(activeCountRes.error.message);
    const existing = existingRes.data;
    if (existing?.status === "active") {
      return NextResponse.json({ error: "Такая активная уборка уже существует" }, { status: 409 });
    }
    if (Number(activeCountRes.count || 0) >= 4) {
      return NextResponse.json({ error: "Максимум 4 активные приёмки" }, { status: 409 });
    }

    const mutation = existing?.id
      ? context.supabase
          .from("weighbridge_active_harvests")
          .update({ status: "active", closed_at: null, closed_by: null })
          .eq("id", existing.id)
          .eq("company_id", context.companyId)
          .select("id,created_at,updated_at")
          .single()
      : context.supabase
          .from("weighbridge_active_harvests")
          .insert({
            company_id: context.companyId,
            season_id: String(season.id),
            crop_structure_id: cropStructureId,
            field_id: structureRes.data.field_id,
            warehouse_id: warehouseId,
            status: "active",
            created_by: context.actor.id,
          })
          .select("id,created_at,updated_at")
          .single();
    const { data: savedRoute, error: mutationError } = await mutation;
    if (mutationError) {
      if (mutationError.code === "23505") {
        return NextResponse.json({ error: "Такая активная уборка уже существует" }, { status: 409 });
      }
      if (mutationError.code === "23514" && mutationError.message.includes("Maximum 4 active harvest workspaces")) {
        return NextResponse.json({ error: "Максимум 4 активные приёмки" }, { status: 409 });
      }
      throw new Error(mutationError.message);
    }

    return NextResponse.json({
      routeId: String(savedRoute.id),
      seasonId: String(season.id),
      seasonYear: Number(season.year),
      createdAt: String(savedRoute.created_at || ""),
      updatedAt: String(savedRoute.updated_at || ""),
    });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    return NextResponse.json(
      { error: sessionError?.error || (error instanceof Error ? error.message : "Не удалось добавить активную уборку") },
      { status: sessionError?.status || 500 }
    );
  }
}
