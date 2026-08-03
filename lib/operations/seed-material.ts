export type SeedRateDisplayUnit = "kg_ha" | "t_ha";

export type SeedMaterialIdentity = {
  cropId: string | null;
  varietyId: string | null;
  reproductionId: string | null;
};

export function isCompleteSeedIdentity(identity: SeedMaterialIdentity): boolean {
  return Boolean(identity.cropId && identity.varietyId && identity.reproductionId);
}

export function seedIdentityKey(identity: SeedMaterialIdentity): string | null {
  if (!isCompleteSeedIdentity(identity)) return null;
  return `${identity.cropId}:${identity.varietyId}:${identity.reproductionId}`;
}

export function seedIdentitiesMatch(
  left: SeedMaterialIdentity,
  right: SeedMaterialIdentity
): boolean {
  const leftKey = seedIdentityKey(left);
  return leftKey !== null && leftKey === seedIdentityKey(right);
}

export function toCanonicalSeedRateKgHa(
  rate: number | null | undefined,
  unit: SeedRateDisplayUnit
): number | null {
  const numericRate = Number(rate);
  if (!Number.isFinite(numericRate) || numericRate <= 0) return null;
  return unit === "t_ha" ? numericRate * 1000 : numericRate;
}

export function fromCanonicalSeedRateKgHa(
  rateKgHa: number | null | undefined,
  unit: SeedRateDisplayUnit
): number | null {
  const numericRate = Number(rateKgHa);
  if (!Number.isFinite(numericRate) || numericRate <= 0) return null;
  return unit === "t_ha" ? numericRate / 1000 : numericRate;
}

export function calculateSeedRequirementKg(
  areaHa: number | null | undefined,
  rate: number | null | undefined,
  unit: SeedRateDisplayUnit
): number | null {
  const numericArea = Number(areaHa);
  const rateKgHa = toCanonicalSeedRateKgHa(rate, unit);
  if (!Number.isFinite(numericArea) || numericArea <= 0 || rateKgHa == null) return null;
  return Number((numericArea * rateKgHa).toFixed(6));
}

export function formatSeedMassRu(quantityKg: number | null | undefined): string {
  const value = Number(quantityKg);
  if (!Number.isFinite(value)) return "-";
  const formatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });
  return value >= 1000 ? `${formatter.format(value / 1000)} т` : `${formatter.format(value)} кг`;
}
