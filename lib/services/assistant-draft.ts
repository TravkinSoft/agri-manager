import { supabase } from "@/lib/supabase/client";
import { Language } from "@/lib/i18n/translations";
import { brandName, localizedName } from "@/lib/i18n/helpers";

export type DraftOption = {
  id: string;
  name: string;
  area?: number;
};

export type EquipmentResource = {
  id: string;
  name: string;
  group: "machines" | "equipment" | "drones";
};

export type AssistantDraftResources = {
  fields: DraftOption[];
  crops: DraftOption[];
  products: DraftOption[];
  specialists: DraftOption[];
  equipment: EquipmentResource[];
};

const DEFAULT_EQUIPMENT_RESOURCES: EquipmentResource[] = [
  { id: "machine:sprayer-self-propelled", name: "Самоходный опрыскиватель", group: "machines" },
  { id: "machine:tractor-universal", name: "Трактор универсальный", group: "machines" },
  { id: "drone:sprayer-drone", name: "Дрон-опрыскиватель", group: "drones" },
  { id: "equipment:boom-sprayer", name: "Штанговый опрыскиватель", group: "equipment" },
  { id: "equipment:mixing-unit", name: "Узел приготовления раствора", group: "equipment" },
];

function uniqueById(items: DraftOption[]): DraftOption[] {
  const map = new Map<string, DraftOption>();
  items.forEach((item) => {
    if (!item?.id || !item?.name) return;
    map.set(item.id, item);
  });
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAssistantDraftResources(
  companyId: string,
  language: Language = "ru"
): Promise<AssistantDraftResources> {
  if (!companyId) {
    return {
      fields: [],
      crops: [],
      products: [],
      specialists: [],
      equipment: DEFAULT_EQUIPMENT_RESOURCES,
    };
  }

  const [fieldsRes, productsRes, cropStructureRes, cropsRes, specialistsRes, machinesRes, equipmentRes] = await Promise.allSettled([
    supabase
      .from("fields")
      .select("id, name, area")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("name", { ascending: true }),
    supabase
      .from("products")
      .select("id, name, trade_name, normalized_name")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("name", { ascending: true }),
    supabase
      .from("crop_structure")
      .select("id, crops:crop_id(id, name, name_ru, name_kz, name_en)")
      .eq("company_id", companyId)
      .eq("archived", false),
    supabase
      .from("crops")
      .select("id, name, name_ru, name_kz, name_en")
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .eq("archived", false)
      .order("name", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .eq("company_id", companyId)
      .eq("role", "specialist")
      .eq("status", "active")
      .order("full_name", { ascending: true, nullsFirst: false })
      .order("email", { ascending: true }),
    supabase
      .from("reference_machines")
      .select("id, name, name_ru, name_kz, name_en, type")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("name", { ascending: true }),
    supabase
      .from("reference_equipment")
      .select("id, name, name_ru, name_kz, name_en")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("name", { ascending: true }),
  ]);

  const fields =
    fieldsRes.status === "fulfilled"
      ? ((fieldsRes.value.data || []).map((f: any) => ({
          id: String(f.id),
          name: String(f.name),
          area: Number(f.area || 0),
        })) as DraftOption[])
      : [];

  const products =
    productsRes.status === "fulfilled"
      ? ((productsRes.value.data || []).map((p: any) => ({
          id: String(p.id),
          name: brandName(p),
        })) as DraftOption[])
      : [];

  const cropStructureCrops =
    cropStructureRes.status === "fulfilled"
      ? (cropStructureRes.value.data || [])
          .map((row: any) => {
            const crop = row?.crops;
            if (!crop?.id) return null;
            const label = localizedName(crop, language, ["name"]);
            if (!label) return null;
            return { id: String(crop.id), name: label } as DraftOption;
          })
          .filter(Boolean) as DraftOption[]
      : [];

  const referenceCrops =
    cropsRes.status === "fulfilled"
      ? ((cropsRes.value.data || []).map((c: any) => ({
          id: String(c.id),
          name: localizedName(c, language, ["name"]),
        })) as DraftOption[])
      : [];

  const profileSpecialists =
    specialistsRes.status === "fulfilled"
      ? ((specialistsRes.value.data || []).map((u: any) => {
          const fullName = String(u.full_name || "").trim();
          const email = String(u.email || "");
          return { id: String(u.id), name: fullName || email };
        }) as DraftOption[])
      : [];

  const machineResources =
    machinesRes.status === "fulfilled"
      ? ((machinesRes.value.data || []).map((item: any) => ({
          id: `machine:${String(item.id)}`,
          name: localizedName(item, language, ["name"]),
          group: String(item.type || "machines") === "drone" ? "drones" : "machines",
        })) as EquipmentResource[])
      : [];

  const equipmentResources =
    equipmentRes.status === "fulfilled"
      ? ((equipmentRes.value.data || []).map((item: any) => ({
          id: `equipment:${String(item.id)}`,
          name: localizedName(item, language, ["name"]),
          group: "equipment" as const,
        })) as EquipmentResource[])
      : [];

  return {
    fields,
    products,
    specialists: uniqueById(profileSpecialists),
    crops: uniqueById([...cropStructureCrops, ...referenceCrops]),
    equipment:
      machineResources.length > 0 || equipmentResources.length > 0
        ? [...machineResources, ...equipmentResources]
        : DEFAULT_EQUIPMENT_RESOURCES,
  };
}
