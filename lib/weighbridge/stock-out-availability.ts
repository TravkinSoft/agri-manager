type StockOutQuantityAtCreateInput = {
  lineQuantity: unknown;
  grossWeightKg: unknown;
  tareWeightKg: unknown;
  weighMethod: unknown;
};

export function resolveStockOutQuantityAtCreate(
  input: StockOutQuantityAtCreateInput
): number | null {
  const lineQuantity = Number(input.lineQuantity);
  if (String(input.weighMethod || "").toLowerCase() === "manual_override_with_reason") {
    return Number.isFinite(lineQuantity) && lineQuantity > 0 ? lineQuantity : null;
  }

  if (input.grossWeightKg == null || input.tareWeightKg == null) return null;
  const grossWeightKg = Number(input.grossWeightKg);
  const tareWeightKg = Number(input.tareWeightKg);
  const netWeightKg = grossWeightKg - tareWeightKg;
  return Number.isFinite(netWeightKg) && netWeightKg > 0 ? netWeightKg : null;
}
