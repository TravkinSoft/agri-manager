export const AGROCHEMICAL_WAREHOUSE_TYPES = [
  "agrochemical",
  "pesticide",
  "fertilizer",
  "additive",
  "universal",
] as const;

export const AGROCHEMICAL_PRODUCT_TYPES = ["pesticide", "fertilizer", "additive"] as const;

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

export function warehouseProductTypeLabel(value: unknown): string {
  const type = String(value || "").trim().toLowerCase();
  if (type === "pesticide") return "Пестицид";
  if (type === "fertilizer") return "Удобрение";
  if (type === "additive") return "Добавка";
  return "Другое";
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
