export type ImpuritySourceSelectionOption = {
  key: string;
  supportsSharedSelection: boolean;
};

export function normalizeImpuritySourceSelection(
  value: string[],
  options: ImpuritySourceSelectionOption[]
): string[] {
  const availableKeys = new Set(options.map((option) => option.key));
  return Array.from(new Set(value.filter((key) => availableKeys.has(key))));
}

export function isImpuritySourceSelectionBlocked(
  value: string[],
  candidate: ImpuritySourceSelectionOption,
  options: ImpuritySourceSelectionOption[]
): boolean {
  const normalizedValue = normalizeImpuritySourceSelection(value, options);
  if (normalizedValue.includes(candidate.key) || normalizedValue.length === 0) return false;

  const optionByKey = new Map(options.map((option) => [option.key, option]));
  const selectedContainsLegacyFallback = normalizedValue.some(
    (key) => !optionByKey.get(key)?.supportsSharedSelection
  );

  return !candidate.supportsSharedSelection || selectedContainsLegacyFallback;
}
