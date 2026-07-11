import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import { resolveCropIdentity } from "@/lib/operations/crop-identity";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_ROLES = [
  "global_admin",
  "company_admin",
  "agronomist",
  "director",
  "specialist",
  "brigadier",
] as const;

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, request.nextUrl.searchParams.get("companyId"));
    const supabase = getServiceClient();

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...READ_ROLES],
    });

    let query = supabase
      .from("operations")
      .select(`
        id,
        crop_structure:crop_structure_id (
          crops:crop_id (name,name_ru,name_kz,name_en,slug),
          varieties:variety_id (name),
          seed_reproductions:reproduction_id (name,name_ru,name_kz,name_en,code)
        ),
        operation_lines:operation_lines (
          crop_id,
          variety_id,
          reproduction_id,
          crops:crop_id (name,name_ru,name_kz,name_en,slug),
          varieties:variety_id (name),
          reproductions:reproduction_id (name,name_ru,name_kz,name_en,code)
        )
      `)
      .eq("company_id", companyId)
      .eq("archived", false);

    if (actor.role === "specialist" || actor.role === "brigadier") {
      query = query.or(`responsible_user_id.eq.${actor.id},assigned_to.eq.${actor.id}`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message || "Failed to load task crop identities");

    const identities = (data || []).map((operation: any) => {
      const cropStructure = relationOne(operation.crop_structure);
      const line = (Array.isArray(operation.operation_lines) ? operation.operation_lines : []).find(
        (item: any) => item.crop_id || item.variety_id || item.reproduction_id
      );
      const identity = resolveCropIdentity(
        {
          cropName: localizedName(cropStructure?.crops, "ru"),
          varietyName: brandName(cropStructure?.varieties),
          reproductionName: localizedName(cropStructure?.seed_reproductions, "ru"),
        },
        {
          cropName: localizedName(line?.crops, "ru"),
          varietyName: brandName(line?.varieties),
          reproductionName: localizedName(line?.reproductions, "ru"),
        }
      );

      return {
        operation_id: String(operation.id),
        crop_name: identity.cropName,
        variety_name: identity.varietyName,
        reproduction_name: identity.reproductionName,
      };
    });

    return NextResponse.json({ companyId, identities });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load task crop identities" },
      { status: 500 }
    );
  }
}
