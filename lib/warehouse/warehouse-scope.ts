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
  "universal",
  "temporary",
] as const;

export const STORAGE_PLACE_TYPES = ["WAREHOUSE", "YARD", "DRYER", "CLEANER"] as const;

export type StoragePlaceType = typeof STORAGE_PLACE_TYPES[number];

export function parseStoragePlaceType(value: unknown): StoragePlaceType | null {
  const normalized = String(value || "").trim().toUpperCase();
  return (STORAGE_PLACE_TYPES as readonly string[]).includes(normalized)
    ? normalized as StoragePlaceType
    : null;
}

export function normalizeStoragePlaceType(value: unknown): StoragePlaceType {
  return parseStoragePlaceType(value) || "WAREHOUSE";
}

export function isProcessingPlace(value: unknown): boolean {
  return ["DRYER", "CLEANER"].includes(normalizeStoragePlaceType(value));
}

export function isOperationalStoragePlace(value: unknown): boolean {
  return ["YARD", "DRYER", "CLEANER"].includes(normalizeStoragePlaceType(value));
}

export function isHarvestDestinationPlace(warehouseType: unknown, placeType: unknown): boolean {
  return isOperationalStoragePlace(placeType) || isHarvestWarehouseType(warehouseType);
}

export function storagePlaceTypeLabel(value: unknown): string {
  const type = normalizeStoragePlaceType(value);
  if (type === "YARD") return "Площадка";
  if (type === "DRYER") return "Сушилка";
  if (type === "CLEANER") return "Очистка";
  return "Склад";
}

export function storagePlaceTypeGroupLabel(value: unknown): string {
  const type = normalizeStoragePlaceType(value);
  if (type === "YARD") return "Площадки";
  if (type === "DRYER") return "Сушилки";
  if (type === "CLEANER") return "Очистка";
  return "Склады";
}

export function storagePlaceTypeSortOrder(value: unknown): number {
  return STORAGE_PLACE_TYPES.indexOf(normalizeStoragePlaceType(value));
}

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
