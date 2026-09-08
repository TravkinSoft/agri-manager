export type HarvestLotFieldSource = {
  fieldId: unknown;
  fieldName: unknown;
};

const cleanText = (value: unknown) => String(value || "").trim();

export function summarizeAggregateHarvestLotFields(sources: readonly HarvestLotFieldSource[]) {
  const fieldsById = new Map<string, string>();
  for (const source of sources) {
    const fieldId = cleanText(source.fieldId);
    const fieldName = cleanText(source.fieldName);
    if (fieldId && fieldName) fieldsById.set(fieldId, fieldName);
  }

  const fields = Array.from(fieldsById, ([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name, "ru") || left.id.localeCompare(right.id));
  const fieldNames = Array.from(new Set(fields.map((field) => field.name)));

  return {
    fieldId: fields.length === 1 ? fields[0].id : null,
    fieldName: fieldNames.join(", "),
    fieldCount: fields.length,
  };
}

export function buildHarvestLotOptionLabel(input: {
  fieldName: unknown;
  cropName: unknown;
  varietyName: unknown;
  reproductionName: unknown;
  cleanMassKg: unknown;
}) {
  const identity = [input.cropName, input.varietyName, input.reproductionName]
    .map(cleanText)
    .filter(Boolean)
    .join(" / ");
  const cleanMassKg = Number(input.cleanMassKg);
  const formattedMass = (Number.isFinite(cleanMassKg) ? cleanMassKg : 0)
    .toLocaleString("ru-RU", { maximumFractionDigits: 3 });

  return [
    cleanText(input.fieldName) || "Поле не указано",
    identity,
    `остаток ${formattedMass} кг`,
  ].filter(Boolean).join(" · ");
}
