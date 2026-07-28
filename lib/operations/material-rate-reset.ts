type MaterialWithRate = {
  product_id?: string | null;
  rate_basis?: string | null;
  unit?: string | null;
  planned_rate?: number | null;
};

export function patchMaterialWithRateReset<T extends MaterialWithRate>(
  current: T,
  patch: Partial<T>
): T {
  const identityChanged =
    ("product_id" in patch && patch.product_id !== current.product_id) ||
    ("rate_basis" in patch && patch.rate_basis !== current.rate_basis) ||
    ("unit" in patch && patch.unit !== current.unit);

  return {
    ...current,
    ...patch,
    ...(identityChanged ? { planned_rate: null } : {}),
  };
}
