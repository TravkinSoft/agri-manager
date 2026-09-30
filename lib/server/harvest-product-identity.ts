import type { SupabaseClient } from "@supabase/supabase-js";
import { localizedName } from "@/lib/i18n/helpers";

type CropRow = {
  id: string;
  name?: string | null;
  name_ru?: string | null;
  name_kz?: string | null;
  name_en?: string | null;
};

export type HarvestProductIdentity = {
  id: string;
  name: string;
  created: boolean;
};

const selectColumns = "id,name,trade_name,normalized_name,company_id,type,product_type,crop_id,variety_id,seed_reproduction_id,is_derived_inventory,derived_identity_key";

export function harvestCropIdentityKey(cropId: string): string {
  return `harvest-crop-v1:${cropId}`;
}

async function findExistingHarvestProduct(
  supabase: SupabaseClient,
  companyId: string,
  cropId: string
) {
  const derivedKey = harvestCropIdentityKey(cropId);
  const { data: existing, error: existingError } = await supabase
    .from("products")
    .select(selectColumns)
    .eq("company_id", companyId)
    .eq("archived", false)
    .or(`derived_identity_key.eq.${derivedKey},and(type.eq.produce,crop_id.eq.${cropId},variety_id.is.null,seed_reproduction_id.is.null)`)
    .order("is_derived_inventory", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  return existing || null;
}

export async function ensureHarvestProductIdentity(params: {
  supabase: SupabaseClient;
  companyId: string;
  actorProfileId: string;
  crop: CropRow;
}): Promise<HarvestProductIdentity> {
  const { supabase, companyId, actorProfileId, crop } = params;
  const existing = await findExistingHarvestProduct(supabase, companyId, crop.id);
  if (existing?.id) {
    return {
      id: String(existing.id),
      name: String(existing.name || localizedName(crop, "ru", ["name"]) || "Урожай"),
      created: false,
    };
  }

  const cropName = localizedName(crop, "ru", ["name"]) || String(crop.name || "Урожай").trim();
  const derivedKey = harvestCropIdentityKey(crop.id);
  const { data: created, error: createError } = await supabase
    .from("products")
    .insert({
      company_id: companyId,
      user_id: actorProfileId,
      name: cropName,
      name_ru: cropName,
      type: "produce",
      product_type: null,
      unit: "kg",
      base_uom: "kg",
      accounting_mode: "bulk_mass",
      is_seed_material: false,
      is_active: true,
      archived: false,
      requires_review: false,
      crop_id: crop.id,
      variety_id: null,
      seed_reproduction_id: null,
      is_derived_inventory: true,
      derived_identity_key: derivedKey,
      description: "Автоматическая складская номенклатура урожая по культуре.",
    })
    .select(selectColumns)
    .single();

  if (!createError && created?.id) {
    return { id: String(created.id), name: cropName, created: true };
  }

  if (String((createError as any)?.code || "") === "23505") {
    const raced = await findExistingHarvestProduct(supabase, companyId, crop.id);
    if (raced?.id) {
      return { id: String(raced.id), name: String(raced.name || cropName), created: false };
    }
  }

  throw createError || new Error("Не удалось создать складскую номенклатуру урожая.");
}
