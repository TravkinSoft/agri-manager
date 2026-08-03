export const AGROCHEMICAL_WAREHOUSE_TYPES = [
  "agrochemical",
  "pesticide",
  "fertilizer",
  "additive",
  "universal",
] as const;

export const AGROCHEMICAL_PRODUCT_TYPES = ["pesticide", "fertilizer", "additive"] as const;

export const HARVEST_WAREHOUSE_TYPES = [
  "grain",
  "seed",
  "vegetable",
  "potato_storage",
  "temporary",
] as const;

export const SEED_MATERIAL_WAREHOUSE_TYPES = [
  "seed",
  "grain",
  "vegetable",
  "potato_storage",
  "universal",
  "temporary",
] as const;

export function isAgrochemicalWarehouseType(value: unknown): boolean {
  return (AGROCHEMICAL_WAREHOUSE_TYPES as readonly string[]).includes(
    String(value || "").trim().toLowerCase()
  );
}

export function isAgrochemicalProductType(value: unknown): boolean {
  return (AGROCHEMICAL_PRODUCT_TYPES as readonly string[]).includes(
    String(value || "").trim().toLowerCase()
  );
}

export function isHarvestWarehouseType(value: unknown): boolean {
  return (HARVEST_WAREHOUSE_TYPES as readonly string[]).includes(
    String(value || "").trim().toLowerCase()
  );
}

export function isSeedMaterialWarehouseType(value: unknown): boolean {
  return (SEED_MATERIAL_WAREHOUSE_TYPES as readonly string[]).includes(
    String(value || "").trim().toLowerCase()
  );
}

export function isReceiptWarehouseType(value: unknown): boolean {
  return isAgrochemicalWarehouseType(value) || isSeedMaterialWarehouseType(value);
}

export function warehouseProductTypeLabel(value: unknown): string {
  const type = String(value || "").trim().toLowerCase();
  if (type === "pesticide") return "Пестицид";
  if (type === "fertilizer") return "Удобрение";
  if (type === "additive") return "Добавка";
  if (type === "crop" || type === "produce") return "Урожай";
  if (type === "seed") return "Семена";
  if (type === "organic") return "Органика";
  if (type === "fuel") return "ГСМ";
  if (type === "material") return "Материал";
  return "Категория не указана";
}

export function warehouseTypeLabel(value: unknown): string {
  const type = String(value || "").trim().toLowerCase();
  if (isAgrochemicalWarehouseType(type)) return "Агрохимический";
  if (type === "seed") return "Семенной";
  if (type === "grain") return "Зерновой";
  if (type === "vegetable" || type === "potato_storage") return "Овощехранилище";
  if (type === "fuel") return "ГСМ";
  if (type === "temporary") return "Временный";
  return "Назначение не задано";
}
