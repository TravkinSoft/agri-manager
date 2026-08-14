import { brandName, localizedName } from "@/lib/i18n/helpers";
import type { ActiveHarvestRoute } from "@/lib/types/weighbridge";

type DbClient = any;

const CURRENT_SEASON_CACHE_TTL_MS = 60_000;
const currentSeasonCache = new Map<string, { expiresAt: number; value: any }>();

export async function getCurrentSeason(supabase: DbClient, companyId: string) {
  const cached = currentSeasonCache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const { data, error } = await supabase
    .from("seasons")
    .select("id,year,archived")
    .eq("company_id", companyId)
    .eq("archived", false)
    .order("year", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data || [];
  const currentYear = new Date().getFullYear();
  const value = rows.find((row: any) => Number(row.year) === currentYear) || rows[0] || null;
  currentSeasonCache.set(companyId, { expiresAt: Date.now() + CURRENT_SEASON_CACHE_TTL_MS, value });
  return value;
}

const uniqueIds = (values: unknown[]) => Array.from(new Set(
  values
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0 && value !== "null" && value !== "undefined")
));

export async function loadActiveHarvestRouteList(
  supabase: DbClient,
  companyId: string,
  season?: { id: string; year: number } | null
) {
  const activeSeason = season || await getCurrentSeason(supabase, companyId);
  if (!activeSeason?.id) {
    return { seasonId: null, seasonYear: null, active: [], completed: [] };
  }

  const { data: routeRows, error: routeError } = await supabase
    .from("weighbridge_active_harvests")
    .select("id,company_id,season_id,crop_structure_id,field_id,warehouse_id,status,created_at,updated_at,closed_at")
    .eq("company_id", companyId)
    .eq("season_id", activeSeason.id)
    .order("created_at", { ascending: true });
  if (routeError) throw new Error(routeError.message);

  const routes = routeRows || [];
  if (!routes.length) {
    return { seasonId: String(activeSeason.id), seasonYear: Number(activeSeason.year), active: [], completed: [] };
  }

  const structureIds = uniqueIds(routes.map((row: any) => row.crop_structure_id));
  const fieldIds = uniqueIds(routes.map((row: any) => row.field_id));
  const warehouseIds = uniqueIds(routes.map((row: any) => row.warehouse_id));

  const [structuresRes, fieldsRes, warehousesRes, ticketsRes] = await Promise.all([
    supabase
      .from("crop_structure")
      .select("id,field_id,area,crop_id,variety_id,reproduction_id")
      .in("id", structureIds),
    supabase.from("fields").select("id,name").in("id", fieldIds),
    supabase.from("warehouses").select("id,name,name_ru,name_kz,name_en").in("id", warehouseIds),
    supabase
      .from("tickets")
      .select("id,crop_structure_allocation_id,warehouse_to_id,status")
      .eq("company_id", companyId)
      .eq("op_type", "harvest_incoming")
      .in("status", ["draft", "active", "ready_to_close"]),
  ]);
  for (const result of [structuresRes, fieldsRes, warehousesRes, ticketsRes]) {
    if (result.error) throw new Error(result.error.message);
  }

  const structures = structuresRes.data || [];
  const cropIds = uniqueIds(structures.map((row: any) => row.crop_id));
  const varietyIds = uniqueIds(structures.map((row: any) => row.variety_id));
  const reproductionIds = uniqueIds(structures.map((row: any) => row.reproduction_id));
  const [cropsRes, varietiesRes, reproductionsRes] = await Promise.all([
    cropIds.length
      ? supabase.from("crops").select("id,name,name_ru,name_kz,name_en,slug").in("id", cropIds)
      : Promise.resolve({ data: [], error: null }),
    varietyIds.length
      ? supabase.from("varieties").select("id,name,name_ru,name_kz,name_en").in("id", varietyIds)
      : Promise.resolve({ data: [], error: null }),
    reproductionIds.length
      ? supabase.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en,code").in("id", reproductionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [cropsRes, varietiesRes, reproductionsRes]) {
    if (result.error) throw new Error(result.error.message);
  }

  const byId = (rows: any[]) => new Map(rows.map((row) => [String(row.id), row]));
  const structuresById = byId(structures);
  const fieldsById = byId(fieldsRes.data || []);
  const warehousesById = byId(warehousesRes.data || []);
  const cropsById = byId(cropsRes.data || []);
  const varietiesById = byId(varietiesRes.data || []);
  const reproductionsById = byId(reproductionsRes.data || []);
  const openCounts = new Map<string, number>();
  for (const ticket of ticketsRes.data || []) {
    const key = `${ticket.crop_structure_allocation_id || ""}:${ticket.warehouse_to_id || ""}`;
    openCounts.set(key, (openCounts.get(key) || 0) + 1);
  }

  const enriched: ActiveHarvestRoute[] = routes.map((row: any): ActiveHarvestRoute => {
    const structure = structuresById.get(String(row.crop_structure_id)) || {};
    const field = fieldsById.get(String(row.field_id)) || {};
    const warehouse = warehousesById.get(String(row.warehouse_id)) || {};
    const crop = cropsById.get(String(structure.crop_id || "")) || null;
    const variety = varietiesById.get(String(structure.variety_id || "")) || null;
    const reproduction = reproductionsById.get(String(structure.reproduction_id || "")) || null;
    const varietyId = structure.variety_id ? String(structure.variety_id) : null;
    const reproductionId = structure.reproduction_id ? String(structure.reproduction_id) : null;
    return {
      id: String(row.id),
      companyId: String(row.company_id),
      seasonId: String(row.season_id),
      seasonYear: Number(activeSeason.year),
      cropStructureId: String(row.crop_structure_id),
      fieldId: String(row.field_id),
      fieldName: String(field.name || "Поле"),
      areaHa: Number(structure.area || 0),
      warehouseId: String(row.warehouse_id),
      warehouseName: localizedName(warehouse, "ru", ["name"]) || "Место приёмки",
      cropId: String(structure.crop_id || ""),
      cropName: localizedName(crop, "ru", ["name", "slug"]) || "Культура",
      varietyId,
      varietyName: varietyId ? brandName(variety) || "Сорт не найден" : "Не указан",
      reproductionId,
      reproductionName: reproductionId
        ? localizedName(reproduction, "ru", ["name", "code"]) || "Репродукция не найдена"
        : "Не указана",
      requiresReview: !varietyId || !reproductionId || !variety || !reproduction,
      status: row.status === "completed" ? "completed" : "active",
      openTicketCount: openCounts.get(`${row.crop_structure_id}:${row.warehouse_id}`) || 0,
      createdAt: String(row.created_at || ""),
      updatedAt: String(row.updated_at || ""),
      closedAt: row.closed_at ? String(row.closed_at) : null,
    };
  });

  return {
    seasonId: String(activeSeason.id),
    seasonYear: Number(activeSeason.year),
    active: enriched.filter((row) => row.status === "active"),
    completed: enriched.filter((row) => row.status === "completed").reverse(),
  };
}
