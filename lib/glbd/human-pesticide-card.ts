export const HUMAN_PESTICIDE_CARD_ROW_ORDER = [
  "Название",
  "Категория",
  "Тип действия",
  "Препаративная форма",
  "Действующие вещества",
  "Производитель",
  "Культуры",
  "Вредный объект",
  "Норма расхода препарата",
  "Расход рабочей жидкости",
  "Фаза и срок обработки",
  "Способ применения",
  "Максимальное количество обработок",
  "До уборки",
  "Ограничения",
] as const;

export type HumanPesticideCardRowLabel = (typeof HUMAN_PESTICIDE_CARD_ROW_ORDER)[number];

export type HumanPesticideCardData = {
  product: {
    id: string;
    tradeName: string;
    active: boolean;
  };
  rows: Array<{
    label: HumanPesticideCardRowLabel;
    value: string;
  }>;
  description: string | null;
  usageNotice: string | null;
  metadata: {
    ruleCount: number;
    readAllowed: boolean;
    recommendationAllowed: boolean;
    missingCriticalFields: string[];
    incomplete: boolean;
    readiness: {
      crop_canonical: number;
      target_canonical: number;
      rate_calculation_ready: number;
      unit_normalized: number;
      component_canonical: number;
      review_required: boolean;
    };
  };
};

export type HumanPesticideCardProduct = {
  id: string;
  trade_name?: string | null;
  name?: string | null;
  name_ru?: string | null;
  name_en?: string | null;
  description?: string | null;
  manufacturer?: string | null;
  formulation?: string | null;
  pesticide_category?: string | null;
  category?: string | null;
  subcategory?: string | null;
  mode_of_action_type?: string | null;
  is_active?: boolean | null;
  archived?: boolean | null;
};

export type HumanPesticideCompositionInput = {
  review_status?: string | null;
  role_in_product?: string | null;
  concentration_value?: number | string | null;
  concentration_unit?: string | null;
  concentration_text?: string | null;
  sort_order?: number | null;
  component?: {
    name_ru?: string | null;
    name_en?: string | null;
    component_type?: string | null;
  } | null;
};

export type HumanPesticideUsageRuleInput = {
  crop?: { name_ru?: string | null; name_en?: string | null } | null;
  target?: { name_ru?: string | null; name_en?: string | null } | null;
  target_text?: string | null;
  crop_name_raw?: string | null;
  crop_group_raw?: string | null;
  crop_name_original?: string | null;
  target_names_raw?: unknown;
  target_text_original?: string | null;
  rate_min?: number | string | null;
  rate_max?: number | string | null;
  rate_unit?: string | null;
  original_rate_value_text?: string | null;
  original_rate_unit_text?: string | null;
  original_rate_text?: string | null;
  working_fluid_min?: number | string | null;
  working_fluid_max?: number | string | null;
  working_fluid_unit?: string | null;
  application_method?: string | null;
  crop_stage?: string | null;
  target_stage?: string | null;
  timing_condition?: string | null;
  application_timing?: string | null;
  max_treatments?: number | string | null;
  harvest_interval_days?: number | string | null;
  restrictions?: string | null;
  restrictions_raw?: unknown;
  notes?: string | null;
  usage_summary?: string | null;
  source_text_raw?: string | null;
  original_source_text?: string | null;
};

type BuildHumanPesticideCardInput = {
  product: HumanPesticideCardProduct;
  aliases: string[];
  composition: HumanPesticideCompositionInput[];
  usageRules: HumanPesticideUsageRuleInput[];
  manufacturerName?: string | null;
  formulationName?: string | null;
  modeOfActionName?: string | null;
  safety?: {
    read_allowed?: boolean | null;
    recommendation_allowed?: boolean | null;
    missing_critical_fields?: unknown;
  } | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  herbicide: "Гербицид",
  fungicide: "Фунгицид",
  insecticide: "Инсектицид",
  seed_treatment: "Протравитель",
  seed_treater: "Протравитель",
  acaricide: "Акарицид",
  desiccant: "Десикант",
  rodenticide: "Родентицид",
  molluscicide: "Моллюскоцид",
  nematicide: "Нематицид",
  adjuvant: "Адъювант",
  surfactant: "Поверхностно-активное вещество",
  growth_regulator: "Регулятор роста",
};

const MODE_OF_ACTION_LABELS: Record<string, string> = {
  systemic: "Системный",
  contact: "Контактный",
  translaminar: "Трансламинарный",
  systemic_contact: "Системно-контактный",
  contact_systemic: "Контактно-системный",
  selective: "Избирательный",
  non_selective: "Сплошного действия",
};

const UNIT_LABELS: Record<string, string> = {
  "l/ha": "л/га",
  l_ha: "л/га",
  "л/га": "л/га",
  "kg/ha": "кг/га",
  kg_ha: "кг/га",
  "кг/га": "кг/га",
  "g/ha": "г/га",
  g_ha: "г/га",
  "г/га": "г/га",
  "ml/ha": "мл/га",
  ml_ha: "мл/га",
  "мл/га": "мл/га",
  "l/t": "л/т",
  l_t: "л/т",
  "л/т": "л/т",
  "kg/t": "кг/т",
  kg_t: "кг/т",
  "кг/т": "кг/т",
  "g/t": "г/т",
  g_t: "г/т",
  "г/т": "г/т",
  "ml/t": "мл/т",
  ml_t: "мл/т",
  "мл/т": "мл/т",
  "g/l": "г/л",
  g_l: "г/л",
  "г/л": "г/л",
  "g/kg": "г/кг",
  g_kg: "г/кг",
  "г/кг": "г/кг",
  "%": "%",
};

const TECHNICAL_DESCRIPTION_MARKERS = [
  "canonical branch-only qa reference",
  "branch-only qa",
  "qa placeholder",
  "assistant validation",
  "assistant_qa_dataset",
  "usage_rules",
  "import batch",
  "source payload",
  "dataset",
  "qa_flags",
  "структурированные нормы",
  "массиве usage",
];

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

export function cleanHumanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const result = String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/имидазолинон\s+ам/gi, "имидазолинонам")
    .trim();
  if (!result) return null;
  if (/^(?:не указано|unknown|n\/a|null|undefined|-)$/i.test(result)) return null;
  return result;
}

function normalizeKey(value: unknown): string {
  return cleanHumanText(value)
    ?.toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[–—−]/g, "-") || "";
}

function uniqueTexts(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = cleanHumanText(value);
    if (!text) continue;
    const key = normalizeKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function numberText(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(String(value).replace(",", "."));
  if (!Number.isFinite(number)) return cleanHumanText(value);
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 }).format(number);
}

function unitText(value: unknown): string | null {
  const unit = cleanHumanText(value);
  if (!unit) return null;
  const localized = UNIT_LABELS[unit.toLocaleLowerCase("ru-RU")];
  if (localized) return localized;
  if (/^[a-z]+(?:[_/][a-z]+)*$/i.test(unit)) return null;
  return unit;
}

function rangeText(min: unknown, max: unknown, unit: unknown): string | null {
  const minText = numberText(min);
  if (!minText) return null;
  const maxText = numberText(max);
  const suffix = unitText(unit);
  const range = maxText && maxText !== minText ? `${minText}–${maxText}` : minText;
  return `${range}${suffix ? ` ${suffix}` : ""}`;
}

function concentrationText(row: HumanPesticideCompositionInput): string | null {
  const structured = rangeText(row.concentration_value, null, row.concentration_unit);
  if (structured) return structured;
  const raw = cleanHumanText(row.concentration_text);
  if (!raw) return null;
  return raw
    .replace(/g\s*\/\s*l/gi, "г/л")
    .replace(/g\s*\/\s*kg/gi, "г/кг")
    .replace(/mg\s*\/\s*l/gi, "мг/л")
    .replace(/kg\s*\/\s*l/gi, "кг/л");
}

function compositionRole(row: HumanPesticideCompositionInput): string {
  const role = normalizeKey(row.role_in_product);
  const type = normalizeKey(row.component?.component_type);
  if (role === "safener" || type === "safener") return "Сафенер";
  if (role === "antidote" || type === "antidote") return "Антидот";
  if (role.includes("biological") || type.includes("biological")) return "Биологический компонент";
  if (role === "active" || type === "active_ingredient") return "Действующее вещество";
  return "Вспомогательный компонент";
}

function compositionDisplay(rows: HumanPesticideCompositionInput[]): string | null {
  const sorted = [...rows].sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0));
  const values = sorted.map((row) => {
    const name = cleanHumanText(row.component?.name_ru) || cleanHumanText(row.component?.name_en);
    if (!name) return null;
    const concentration = concentrationText(row);
    return `${compositionRole(row)}: ${name}${concentration ? ` — ${concentration}` : ""}`;
  });
  const unique = uniqueTexts(values);
  return unique.length ? unique.join("\n") : null;
}

export function isCropParserFragment(value: unknown): boolean {
  const text = cleanHumanText(value);
  if (!text) return false;
  const openParentheses = (text.match(/\(/g) || []).length;
  const closeParentheses = (text.match(/\)/g) || []).length;
  if (openParentheses !== closeParentheses) return true;
  if (/^(?:устойчив(?:ые|ый|ая|ое)|гибрид(?:ы|а|ов)|сорт(?:а|ы|ов)|кроме|в том числе)\b/i.test(text)) {
    return true;
  }
  return /^\W*[а-яё]{2,25}\)$/i.test(text) && !/[,(]/.test(text.slice(0, -1));
}

function cropDisplay(rule: HumanPesticideUsageRuleInput): string | null {
  const canonical = cleanHumanText(rule.crop?.name_ru) || cleanHumanText(rule.crop?.name_en);
  const original = cleanHumanText(rule.crop_name_original);
  const raw = cleanHumanText(rule.crop_name_raw);
  const group = cleanHumanText(rule.crop_group_raw);
  const sourceCandidates = [original, raw, group].filter((value): value is string => Boolean(value) && !isCropParserFragment(value));

  if (canonical) {
    const qualifiedSource = [raw, original, group]
      .filter((value): value is string => Boolean(value) && !isCropParserFragment(value))
      .find((candidate) => {
      const canonicalKey = normalizeKey(canonical);
      const candidateKey = normalizeKey(candidate);
      return candidateKey !== canonicalKey
        && (candidateKey.startsWith(`${canonicalKey} `) || candidateKey.startsWith(`${canonicalKey} (`));
    });
    return qualifiedSource || canonical;
  }

  const preferred = sourceCandidates[0];
  if (!preferred) return null;
  return preferred;
}

function flattenRawText(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => flattenRawText(item));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      record.name_ru,
      record.name,
      record.label,
      record.value,
      record.target,
    ].flatMap((item) => flattenRawText(item));
  }
  const text = cleanHumanText(value);
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      return flattenRawText(JSON.parse(text));
    } catch {
      return [text];
    }
  }
  return [text];
}

function targetDisplay(rule: HumanPesticideUsageRuleInput): string | null {
  const canonical = cleanHumanText(rule.target?.name_ru) || cleanHumanText(rule.target?.name_en);
  if (canonical) return canonical;
  const original = cleanHumanText(rule.target_text_original);
  if (original) return original;
  const rawValues = uniqueTexts(flattenRawText(rule.target_names_raw));
  if (rawValues.length) return rawValues.join(", ");
  return cleanHumanText(rule.target_text);
}

function rateDisplay(rule: HumanPesticideUsageRuleInput): string | null {
  const structured = rangeText(rule.rate_min, rule.rate_max, rule.rate_unit);
  if (structured && unitText(rule.rate_unit)) return structured;
  return cleanHumanText(rule.original_rate_text)
    || rangeText(rule.original_rate_value_text, null, rule.original_rate_unit_text)
    || structured;
}

function extractWorkingFluid(rule: HumanPesticideUsageRuleInput): string | null {
  const structured = rangeText(rule.working_fluid_min, rule.working_fluid_max, rule.working_fluid_unit);
  if (structured) return structured;
  const source = uniqueTexts([
    rule.usage_summary,
    rule.notes,
    rule.restrictions,
    ...flattenRawText(rule.restrictions_raw),
    rule.source_text_raw,
    rule.original_source_text,
  ]).join(" ");
  const match = source.match(
    /расход\s+рабоч(?:ей|его)\s+(?:жидкости|раствора)\s*[:\-–—]?\s*(\d+(?:[.,]\d+)?)\s*(?:[-–—]\s*(\d+(?:[.,]\d+)?))?\s*л\s*\/\s*га/i,
  );
  if (!match) return null;
  return `${numberText(match[1])}${match[2] ? `–${numberText(match[2])}` : ""} л/га`;
}

function restrictionsDisplay(rule: HumanPesticideUsageRuleInput): string | null {
  const values = uniqueTexts([
    rule.restrictions,
    ...flattenRawText(rule.restrictions_raw),
  ]);
  return values.length ? values.join("; ") : null;
}

function aggregateRuleValues(
  rules: HumanPesticideUsageRuleInput[],
  valueForRule: (rule: HumanPesticideUsageRuleInput) => string | null,
): string | null {
  const entries = rules
    .map((rule) => ({ crop: cropDisplay(rule), value: cleanHumanText(valueForRule(rule)) }))
    .filter((entry): entry is { crop: string | null; value: string } => Boolean(entry.value));
  if (!entries.length) return null;
  const values = uniqueTexts(entries.map((entry) => entry.value));
  if (values.length === 1) return values[0];
  return uniqueTexts(entries.map((entry) => entry.crop ? `${entry.crop} — ${entry.value}` : entry.value)).join("\n");
}

function timingDisplay(rule: HumanPesticideUsageRuleInput): string | null {
  const values = uniqueTexts([
    rule.application_timing,
    rule.crop_stage,
    rule.target_stage,
    rule.timing_condition,
  ]).map((value) => value
    .replace(
      /\s*расход\s*рабоч(?:ей|его)\s+(?:жидкости|раствора)\s*[:\-–—]?\s*\d+(?:[.,]\d+)?\s*(?:[-–—]\s*\d+(?:[.,]\d+)?)?\s*л\s*\/\s*га\.?/gi,
      "",
    )
    .trim()
  ).filter(Boolean);
  const withoutContainedDuplicates = values.filter((value, index) => (
    !values.some((other, otherIndex) => (
      index !== otherIndex
      && normalizeKey(other).length > normalizeKey(value).length
      && normalizeKey(other).includes(normalizeKey(value))
    ))
  ));
  return withoutContainedDuplicates.length ? withoutContainedDuplicates.join("; ") : null;
}

function maxTreatmentsDisplay(rule: HumanPesticideUsageRuleInput): string | null {
  const value = numberText(rule.max_treatments);
  if (!value) return null;
  const count = Number(String(rule.max_treatments).replace(",", "."));
  if (!Number.isFinite(count)) return value;
  const remainder10 = count % 10;
  const remainder100 = count % 100;
  const noun = remainder10 === 1 && remainder100 !== 11
    ? "обработка"
    : remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)
      ? "обработки"
      : "обработок";
  return `${value} ${noun}`;
}

function harvestIntervalDisplay(rule: HumanPesticideUsageRuleInput): string | null {
  const value = numberText(rule.harvest_interval_days);
  return value ? `${value} дн.` : null;
}

function productNameDisplay(product: HumanPesticideCardProduct): string | null {
  return cleanHumanText(product.trade_name)
    || cleanHumanText(product.name_ru)
    || cleanHumanText(product.name_en)
    || cleanHumanText(product.name);
}

function translatedValue(value: unknown, labels: Record<string, string>): string | null {
  const text = cleanHumanText(value);
  if (!text) return null;
  return labels[normalizeKey(text)] || text;
}

function usefulDescription(value: unknown): string | null {
  const text = cleanHumanText(value);
  if (!text || UUID_RE.test(text)) return null;
  const normalized = text.toLocaleLowerCase("ru-RU");
  if (TECHNICAL_DESCRIPTION_MARKERS.some((marker) => normalized.includes(marker))) return null;
  if (/\b(?:уникальн|максимальн\w*\s+эффектив|длительн\w*\s+защит|быстр\w*\s+действ|низк\w*\s+норм)/i.test(normalized)) {
    return null;
  }
  return text;
}

function derivedDescription(
  product: HumanPesticideCardProduct,
  category: string | null,
  formulation: string | null,
  composition: HumanPesticideCompositionInput[],
  rules: HumanPesticideUsageRuleInput[],
): string | null {
  const tradeName = cleanHumanText(product.trade_name) || cleanHumanText(product.name);
  if (!tradeName) return null;
  const sentences: string[] = [];
  sentences.push(category ? `${tradeName} — ${category.toLocaleLowerCase("ru-RU")}.` : `${tradeName} — препарат глобального каталога.`);
  if (formulation) sentences.push(`Препаративная форма: ${formulation}.`);
  const activeNames = uniqueTexts(
    composition
      .filter((row) => compositionRole(row) === "Действующее вещество")
      .map((row) => row.component?.name_ru || row.component?.name_en),
  );
  if (activeNames.length) sentences.push(`Действующие вещества: ${activeNames.join(", ")}.`);
  if (sentences.length < 2) {
    const method = uniqueTexts(rules.map((rule) => rule.application_method))[0];
    sentences.push(method ? `Общий способ применения: ${method.toLocaleLowerCase("ru-RU")}.` : "Сведения о применении приведены только при наличии подтверждённого регламента.");
  }
  return sentences.join(" ");
}

function humanDescription(
  product: HumanPesticideCardProduct,
  category: string | null,
  formulation: string | null,
  composition: HumanPesticideCompositionInput[],
  rules: HumanPesticideUsageRuleInput[],
): string | null {
  const existing = usefulDescription(product.description);
  if (!existing) return derivedDescription(product, category, formulation, composition, rules);
  const sentences = existing
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => cleanHumanText(sentence))
    .filter((sentence): sentence is string => Boolean(sentence))
    .slice(0, 4);
  if (sentences.length >= 2) return sentences.join(" ");
  const supplement = derivedDescription(product, category, formulation, composition, rules)
    ?.split(/(?<=[.!?])\s+/)
    .map((sentence) => cleanHumanText(sentence))
    .find((sentence) => sentence && normalizeKey(sentence) !== normalizeKey(sentences[0]));
  return uniqueTexts([sentences[0], supplement]).join(" ") || null;
}

function missingCriticalFields(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueTexts(value);
}

export function buildHumanPesticideCard(input: BuildHumanPesticideCardInput): HumanPesticideCardData {
  const category = translatedValue(
    input.product.pesticide_category || input.product.category || input.product.subcategory,
    CATEGORY_LABELS,
  );
  const modeOfAction = cleanHumanText(input.modeOfActionName)
    || translatedValue(input.product.mode_of_action_type, MODE_OF_ACTION_LABELS);
  const formulation = cleanHumanText(input.formulationName) || cleanHumanText(input.product.formulation);
  const manufacturer = cleanHumanText(input.manufacturerName) || cleanHumanText(input.product.manufacturer);
  const rules = input.usageRules;

  const rowValues: Record<HumanPesticideCardRowLabel, string | null> = {
    "Название": productNameDisplay(input.product),
    "Категория": category,
    "Тип действия": modeOfAction,
    "Препаративная форма": formulation,
    "Действующие вещества": compositionDisplay(input.composition),
    "Производитель": manufacturer,
    "Культуры": uniqueTexts(rules.map(cropDisplay)).join("\n") || null,
    "Вредный объект": uniqueTexts(rules.map(targetDisplay)).join("\n") || null,
    "Норма расхода препарата": aggregateRuleValues(rules, rateDisplay),
    "Расход рабочей жидкости": aggregateRuleValues(rules, extractWorkingFluid),
    "Фаза и срок обработки": aggregateRuleValues(rules, timingDisplay),
    "Способ применения": aggregateRuleValues(rules, (rule) => cleanHumanText(rule.application_method)),
    "Максимальное количество обработок": aggregateRuleValues(rules, maxTreatmentsDisplay),
    "До уборки": aggregateRuleValues(rules, harvestIntervalDisplay),
    "Ограничения": aggregateRuleValues(rules, restrictionsDisplay),
  };

  const rows = HUMAN_PESTICIDE_CARD_ROW_ORDER
    .map((label) => ({ label, value: cleanHumanText(rowValues[label]) }))
    .filter((row): row is { label: HumanPesticideCardRowLabel; value: string } => Boolean(row.value));

  const description = humanDescription(input.product, category, formulation, input.composition, rules);
  const missing = missingCriticalFields(input.safety?.missing_critical_fields);
  const cropCanonical = rules.filter((rule) => Boolean(rule.crop)).length;
  const targetCanonical = rules.filter((rule) => Boolean(rule.target)).length;
  const rateCalculationReady = rules.filter((rule) => (
    numberText(rule.rate_min) !== null
    && unitText(rule.rate_unit) !== null
  )).length;
  const unitNormalized = rules.filter((rule) => {
    const unit = cleanHumanText(rule.rate_unit);
    return Boolean(unit && UNIT_LABELS[unit.toLocaleLowerCase("ru-RU")]);
  }).length;
  const componentCanonical = input.composition.filter((row) => Boolean(row.component)).length;

  return {
    product: {
      id: input.product.id,
      tradeName: cleanHumanText(input.product.trade_name) || cleanHumanText(input.product.name) || "Препарат",
      active: Boolean(input.product.is_active) && !Boolean(input.product.archived),
    },
    rows,
    description,
    usageNotice: rules.length ? null : "В текущей GLBD нет заполненного регламента применения.",
    metadata: {
      ruleCount: rules.length,
      readAllowed: input.safety?.read_allowed !== false,
      recommendationAllowed: input.safety?.recommendation_allowed === true,
      missingCriticalFields: missing,
      incomplete: rules.length === 0 || missing.length > 0,
      readiness: {
        crop_canonical: cropCanonical,
        target_canonical: targetCanonical,
        rate_calculation_ready: rateCalculationReady,
        unit_normalized: unitNormalized,
        component_canonical: componentCanonical,
        review_required:
          rules.some((rule) => !rule.crop || (!rule.target && Boolean(targetDisplay(rule))))
          || input.composition.some((row) => Boolean(row.review_status) && normalizeKey(row.review_status) !== "approved")
          || missing.length > 0,
      },
    },
  };
}
