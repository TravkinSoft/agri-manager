import type { OperationDraft } from "@/lib/types/operation-draft";

export type DraftCalculationResult = {
  area: number;
  ratePerHa: number;
  mixtureVolumePerHa: number;
  mainProductTotal: number;
  additionalProductsTotal: number;
  productsTotal: number;
  finishedMixtureTotal: number;
  waterTotal: number;
  waterPercentage: number;
  productPercentage: number;
};

const EPS = 0.000001;

function parseNumeric(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const str = String(raw).replace(",", ".").trim();
  const matched = str.match(/-?\d+(\.\d+)?/);
  if (!matched) return 0;
  const num = Number(matched[0]);
  return Number.isFinite(num) ? num : 0;
}

function parseAdditionalProductsSum(raw: unknown): number {
  if (Array.isArray(raw)) {
    return raw.reduce((sum, item: any) => sum + parseNumeric(item?.rate_per_ha ?? item?.amount ?? 0), 0);
  }
  if (!raw) return 0;
  const text = String(raw);
  const lines = text.split(/\n|,/).map((line) => line.trim()).filter(Boolean);
  return lines.reduce((sum, line) => sum + parseNumeric(line), 0);
}

export function calculateDraftValues(
  draft: OperationDraft,
  fieldArea?: number
): DraftCalculationResult {
  const metadata = draft.metadata || {};
  const area = Math.max(parseNumeric(metadata.area ?? fieldArea ?? 0), 0);
  const ratePerHa = Math.max(parseNumeric(metadata.rate_per_ha ?? metadata.rate ?? 0), 0);
  const mixtureVolumePerHa = Math.max(
    parseNumeric(metadata.spray_volume_per_ha ?? metadata.water_rate ?? 0),
    0
  );

  const mainProductTotal = area * ratePerHa;
  const additionalProductsTotal = parseAdditionalProductsSum(
    metadata.additional_products_list ?? metadata.additional_products
  );
  const productsTotal = mainProductTotal + additionalProductsTotal;
  const finishedMixtureTotal = area * mixtureVolumePerHa;
  const waterTotal = Math.max(finishedMixtureTotal - productsTotal, 0);

  const productPercentage =
    finishedMixtureTotal > EPS ? (productsTotal / finishedMixtureTotal) * 100 : 0;
  const waterPercentage =
    finishedMixtureTotal > EPS ? (waterTotal / finishedMixtureTotal) * 100 : 0;

  return {
    area,
    ratePerHa,
    mixtureVolumePerHa,
    mainProductTotal,
    additionalProductsTotal,
    productsTotal,
    finishedMixtureTotal,
    waterTotal,
    waterPercentage,
    productPercentage,
  };
}

export function applyDraftCalculations(
  draft: OperationDraft,
  fieldArea?: number
): OperationDraft {
  const c = calculateDraftValues(draft, fieldArea);
  return {
    ...draft,
    metadata: {
      ...(draft.metadata || {}),
      area: c.area.toFixed(2),
      total_amount: c.mainProductTotal.toFixed(2),
      total_product_volume: c.productsTotal.toFixed(2),
      total_mixture_volume: c.finishedMixtureTotal.toFixed(2),
      total_water: c.waterTotal.toFixed(2),
      total_water_volume: c.waterTotal.toFixed(2),
      water_percentage: c.waterPercentage.toFixed(2),
      product_percentage: c.productPercentage.toFixed(2),
    },
  };
}
