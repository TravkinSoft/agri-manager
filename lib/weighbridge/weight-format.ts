const WEIGHT_NUMBER_FORMATTER = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

export function formatWeightNumber(value: unknown, emptyValue = "—") {
  if (value == null || value === "") return emptyValue;
  const number = Number(value);
  if (!Number.isFinite(number)) return emptyValue;
  return WEIGHT_NUMBER_FORMATTER.format(number).replace(/[\u00a0\u202f]/g, " ");
}

export function formatWeightKg(value: unknown, emptyValue = "—") {
  const formatted = formatWeightNumber(value, emptyValue);
  return formatted === emptyValue ? emptyValue : `${formatted} кг`;
}
