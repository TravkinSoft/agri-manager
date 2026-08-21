export type HarvestAllocationIdentity = {
  allocationId: string;
  cropId: string;
  varietyId: string | null;
  reproductionId: string | null;
  isIncomplete?: boolean;
};

export type HarvestProductCandidate = {
  id: string;
  name?: string | null;
  tradeName?: string | null;
  normalizedName?: string | null;
  type?: string | null;
  productType?: string | null;
  cropId?: string | null;
  varietyId?: string | null;
  reproductionId?: string | null;
};

const HARVEST_PRODUCT_TYPES = new Set(["produce", "crop", "harvest"]);

function normalizeHarvestLabel(value: unknown) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^a-zа-яё0-9]+/gi, " ")
    .trim();
}

function harvestProductType(product: HarvestProductCandidate) {
  return normalizeHarvestLabel(product.productType || product.type);
}

function productNameMatchesCrop(product: HarvestProductCandidate, cropNames: string[]) {
  const productNames = [product.name, product.tradeName, product.normalizedName]
    .map(normalizeHarvestLabel)
    .filter(Boolean);
  const normalizedCrops = cropNames.map(normalizeHarvestLabel).filter(Boolean);
  return productNames.some((productName) =>
    normalizedCrops.some(
      (cropName) =>
        productName === cropName ||
        productName.includes(cropName) ||
        cropName.includes(productName)
    )
  );
}

function harvestProductScore(
  product: HarvestProductCandidate,
  allocation: Pick<HarvestAllocationIdentity, "cropId" | "varietyId" | "reproductionId">,
  cropNames: string[]
) {
  if (!HARVEST_PRODUCT_TYPES.has(harvestProductType(product))) return -1;

  if (product.cropId) {
    if (String(product.cropId) !== allocation.cropId) return -1;
    if (product.varietyId && String(product.varietyId) !== String(allocation.varietyId || "")) return -1;
    if (
      product.reproductionId &&
      String(product.reproductionId) !== String(allocation.reproductionId || "")
    ) {
      return -1;
    }
    return 10 + (product.varietyId ? 2 : 0) + (product.reproductionId ? 1 : 0);
  }

  return productNameMatchesCrop(product, cropNames) ? 1 : -1;
}

export function isHarvestProductForAllocation(
  product: HarvestProductCandidate,
  allocation: Pick<HarvestAllocationIdentity, "cropId" | "varietyId" | "reproductionId">,
  cropNames: string[]
) {
  return harvestProductScore(product, allocation, cropNames) >= 0;
}

export function findHarvestProductForAllocation<T extends HarvestProductCandidate>(
  products: T[],
  allocation: Pick<HarvestAllocationIdentity, "cropId" | "varietyId" | "reproductionId">,
  cropNames: string[]
): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const product of products) {
    const score = harvestProductScore(product, allocation, cropNames);
    if (score > bestScore) {
      best = product;
      bestScore = score;
    }
  }
  return best;
}

export function automaticHarvestAllocation<T extends HarvestAllocationIdentity>(
  options: T[],
  config: { allowIncompleteIdentity?: boolean } = {}
): T | null {
  const complete = options.filter(
    (option) =>
      Boolean(option.cropId) &&
      (config.allowIncompleteIdentity || (
        !option.isIncomplete &&
        Boolean(option.varietyId) &&
        Boolean(option.reproductionId)
      ))
  );
  return options.length === 1 && complete.length === 1 ? complete[0] : null;
}

export function validateHarvestWeights(gross: number, tare: number):
  | { ok: true; net: number }
  | { ok: false; message: string } {
  if (!Number.isFinite(gross) || gross <= 0) {
    return { ok: false, message: "Брутто должно быть больше нуля." };
  }
  if (!Number.isFinite(tare) || tare < 0) {
    return { ok: false, message: "Тара должна быть неотрицательной." };
  }
  if (tare >= gross) {
    return { ok: false, message: "Тара должна быть меньше брутто." };
  }
  return { ok: true, net: gross - tare };
}

export function harvestIdentityMatches(
  allocation: Pick<HarvestAllocationIdentity, "cropId" | "varietyId" | "reproductionId">,
  line: { crop_id?: string | null; variety_id?: string | null; reproduction_id?: string | null }
) {
  return (
    String(line.crop_id || "") === allocation.cropId &&
    String(line.variety_id || "") === String(allocation.varietyId || "") &&
    String(line.reproduction_id || "") === String(allocation.reproductionId || "")
  );
}
