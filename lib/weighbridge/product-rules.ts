const MASS_PRODUCT_TYPES = new Set([
  "crop",
  "grain",
  "harvest",
  "organic",
  "planting_material",
  "produce",
  "seed",
]);

const BLOCKED_PRODUCT_TYPES = new Set([
  "additive",
  "fuel",
  "machinery",
  "pesticide",
  "vehicle",
]);

const LIQUID_STATES = new Set(["liquid", "solution", "suspension"]);
const DRY_FERTILIZER_STATES = new Set(["crystal", "granule", "granular", "powder", "solid"]);

export type WeighbridgeProductDescriptor = {
  productType?: string | null;
  stockUnit?: string | null;
  physicalState?: string | null;
  isSeedMaterial?: boolean | null;
};

const normalized = (value: unknown) => String(value || "").trim().toLowerCase();

export function isWeighedSupplierProduct(product: WeighbridgeProductDescriptor): boolean {
  const productType = normalized(product.productType);
  const stockUnit = normalized(product.stockUnit);
  const physicalState = normalized(product.physicalState);

  if (stockUnit !== "kg" || BLOCKED_PRODUCT_TYPES.has(productType) || LIQUID_STATES.has(physicalState)) {
    return false;
  }
  if (product.isSeedMaterial || MASS_PRODUCT_TYPES.has(productType)) return true;
  return productType === "fertilizer" && (!physicalState || DRY_FERTILIZER_STATES.has(physicalState));
}

export function isWeighedFieldMaterial(product: WeighbridgeProductDescriptor): boolean {
  const productType = normalized(product.productType);
  if (!isWeighedSupplierProduct(product)) return false;
  return product.isSeedMaterial === true || ["seed", "planting_material", "fertilizer", "organic"].includes(productType);
}
