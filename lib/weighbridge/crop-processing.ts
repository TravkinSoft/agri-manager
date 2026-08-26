type CropProcessingIdentity = {
  cropSlug?: unknown;
  cropName?: unknown;
  categorySlug?: unknown;
  categoryName?: unknown;
  subcategory?: unknown;
};

const normalized = (value: unknown) => String(value || "").trim().toLowerCase();

export function isVegetableCropForProcessing(identity: CropProcessingIdentity): boolean {
  const category = normalized(identity.categorySlug || identity.categoryName);
  const subcategory = normalized(identity.subcategory);
  const crop = normalized(identity.cropSlug || identity.cropName);

  return category === "vegetable"
    || category.includes("овощ")
    || ["tuber", "root"].includes(subcategory)
    || ["potato", "carrot", "картофель", "морковь"].includes(crop);
}

export function canUseGrainProcessing(identity: CropProcessingIdentity): boolean {
  return !isVegetableCropForProcessing(identity);
}

