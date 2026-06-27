import { normalizeMaterialRateBasis } from "@/lib/materials/metadata";
import type { KnowledgeMatchType, KnowledgeRecommendation } from "@/lib/knowledge/types";

export const KNOWLEDGE_RECOMMENDATION_COPY: Record<
  KnowledgeRecommendation,
  {
    label: string;
    message: string;
    tone: "success" | "warning" | "accent";
  }
> = {
  UPDATE_EXISTING_PRODUCT: {
    label: "Обновить существующий паспорт",
    message:
      "Препарат уже есть в каталоге. Можно обновить существующий паспорт после проверки источников.",
    tone: "success",
  },
  REVIEW_POSSIBLE_DUPLICATES: {
    label: "Проверить возможные дубли",
    message:
      "Найдены похожие записи в каталоге. Перед созданием нового препарата нужно выбрать существующий препарат или проверить дубли.",
    tone: "warning",
  },
  POSSIBLE_NEW_PRODUCT: {
    label: "Возможный новый препарат",
    message:
      "Точного совпадения не найдено. Можно подготовить черновик нового препарата, но не создавать автоматически.",
    tone: "accent",
  },
};

const RUN_STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  analyzing: "Проверяется",
  matched: "Совпадения найдены",
  extracted: "Данные извлечены",
  needs_review: "Нужна проверка",
  pending: "Ожидает проверки",
  approved: "Одобрено",
  applied: "Применено",
  rejected: "Отклонено",
  failed: "Ошибка проверки",
};

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  pesticide: "Пестицид",
  fertilizer: "Удобрение",
  additive: "Добавка",
  adjuvant: "Добавка",
  seed: "Семена",
  unknown: "Не указано",
  other: "Другое",
};

const SUBCATEGORY_LABELS: Record<string, string> = {
  seed_treatment: "Протравитель семян",
  fungicide: "Фунгицид",
  insecticide: "Инсектицид",
  herbicide: "Гербицид",
  acaricide: "Акарицид",
  desiccant: "Десикант",
  growth_regulator: "Регулятор роста",
  pH_corrector: "pH-корректор",
  ph_corrector: "pH-корректор",
  pH_regulator: "pH-регулятор",
  ph_regulator: "pH-регулятор",
  adjuvant: "Адъювант",
  surfactant: "Адъювант",
  sticker: "Прилипатель",
  antifoam: "Пеногаситель",
  anti_foam: "Пеногаситель",
  water_conditioner: "Кондиционер воды",
  anti_salt: "Антисоль",
  micronutrient: "Микроудобрение",
  micro: "Микроудобрение",
  macro: "Макроудобрение",
  foliar: "Листовое удобрение",
  water_soluble: "Водорастворимое удобрение",
  organic: "Органическое удобрение",
  organomineral: "Органоминеральное удобрение",
  biostimulant: "Биостимулятор",
  unknown: "Не указано",
  other: "Другое",
};

const MATCH_TYPE_LABELS: Record<KnowledgeMatchType | string, string> = {
  exact: "Точное совпадение",
  alias: "Алиас",
  transliteration: "Алиас / транслитерация",
  manufacturer_prefix: "Производитель был в названии",
  fuzzy: "Похожее название",
  possible_duplicate: "Возможный дубль",
};

const UNIT_LABELS: Record<string, string> = {
  l: "литр",
  ml: "миллилитр",
  kg: "килограмм",
  g: "грамм",
  pcs: "штука",
};

const UNIT_ALIASES: Record<string, string> = {
  l: "l",
  lt: "l",
  liter: "l",
  litre: "l",
  "л": "l",
  ml: "ml",
  "мл": "ml",
  kg: "kg",
  "кг": "kg",
  g: "g",
  gr: "g",
  "г": "g",
  pcs: "pcs",
  pc: "pcs",
  piece: "pcs",
  pieces: "pcs",
  "шт": "pcs",
};

const RATE_CONTEXT_LABELS: Record<string, string> = {
  ha: "на 1 га",
  t_seed: "на 1000 кг семян",
  "100kg_seed": "на 100 кг семян",
  "1000_seeds": "на 1000 семян",
  "1000_l_solution": "на 1000 л рабочего раствора",
  l_water: "на 1 л воды",
};

const RATE_BASIS_CONTEXT: Record<string, string> = {
  per_ha: "ha",
  per_1000_l_solution: "1000_l_solution",
  per_l_water: "l_water",
  per_t_seed: "t_seed",
  per_100kg_seed: "100kg_seed",
  per_1000_seeds: "1000_seeds",
};

const MATCH_REASON_LABELS: Array<[RegExp, string]> = [
  [/known identity alias group/i, "Найдено в известной группе алиасов"],
  [/normalized trade\/name exact match/i, "Точное совпадение нормализованного названия"],
  [/manufacturer\/brand prefix stripped/i, "Название совпало после отделения производителя"],
  [/catalog search\/alias text matched/i, "Совпадение найдено по алиасам каталога"],
  [/normalized fuzzy similarity/i, "Похожее название"],
];

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function fallbackLabel(value: unknown): string {
  const raw = text(value);
  return raw || "Не указано";
}

function labelFromMap(value: unknown, map: Record<string, string>): string {
  const raw = text(value);
  if (!raw) return "Не указано";
  return map[raw] || map[raw.toLowerCase()] || raw.replace(/_/g, " ");
}

function normalizeUnit(value: unknown): string {
  const raw = text(value).toLowerCase();
  return UNIT_ALIASES[raw] || raw;
}

function unitLabel(value: unknown): string {
  const normalized = normalizeUnit(value);
  if (!normalized || normalized === "unknown") return "Не указано";
  return UNIT_LABELS[normalized] || fallbackLabel(value);
}

function consumptionLabelFromParts(unit: unknown, context: unknown): string {
  const unitText = unitLabel(unit);
  const contextKey = text(context);
  const contextText = RATE_CONTEXT_LABELS[contextKey];
  if (unitText === "Не указано" || !contextText) return "Не указано";
  return `${unitText} ${contextText}`;
}

function parseRateUnit(value: unknown): { unit: string; context: string } | null {
  const raw = text(value).toLowerCase();
  if (!raw || raw === "unknown" || raw === "manual") return null;
  const [unit, ...contextParts] = raw.split("/");
  const context = contextParts.join("/");
  if (!unit || !context) return null;
  return { unit: normalizeUnit(unit), context };
}

function normalizedIdentityText(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function verifiedConsumptionOverride(identityText: unknown): string | null {
  const normalized = normalizedIdentityText(identityText);
  if (normalized.includes("curamin") || normalized.includes("курамин")) {
    return consumptionLabelFromParts("l", "ha");
  }
  return null;
}

export function formatKnowledgeRecommendation(value: KnowledgeRecommendation | null | undefined) {
  return value ? KNOWLEDGE_RECOMMENDATION_COPY[value]?.label || fallbackLabel(value) : "Не указано";
}

export function formatKnowledgeRunStatus(value: unknown): string {
  return labelFromMap(value, RUN_STATUS_LABELS);
}

export function formatKnowledgeProductType(value: unknown): string {
  return labelFromMap(value, PRODUCT_TYPE_LABELS);
}

export function formatKnowledgeSubcategory(value: unknown): string {
  return labelFromMap(value, SUBCATEGORY_LABELS);
}

export function formatKnowledgeMatchType(value: unknown): string {
  return labelFromMap(value, MATCH_TYPE_LABELS);
}

export function formatKnowledgeStockUnit(value: unknown): string {
  return unitLabel(value);
}

export function formatKnowledgeRateType(value: unknown): string {
  const raw = text(value).toLowerCase();
  if (!raw || raw === "unknown") return "Не указано";
  const normalized = normalizeMaterialRateBasis(raw, "manual");
  if (normalized === "manual") return "вручную";
  return RATE_CONTEXT_LABELS[RATE_BASIS_CONTEXT[normalized]] || "Не указано";
}

export function formatKnowledgeRateUnit(value: unknown): string {
  const parsed = parseRateUnit(value);
  if (!parsed) return "Не указано";
  return consumptionLabelFromParts(parsed.unit, parsed.context);
}

export function formatKnowledgeConsumptionType(
  rateUnit: unknown,
  rateType: unknown,
  stockUnit: unknown,
  identityText?: unknown
): string {
  const override = verifiedConsumptionOverride(identityText);
  if (override) return override;

  const rawRateUnit = text(rateUnit).toLowerCase();
  if (rawRateUnit === "manual") return "вручную";

  const parsed = parseRateUnit(rateUnit);
  if (parsed) {
    return consumptionLabelFromParts(parsed.unit, parsed.context);
  }

  const rawRateType = text(rateType).toLowerCase();
  if (!rawRateType || rawRateType === "unknown") return "Не указано";

  const normalizedRateType = normalizeMaterialRateBasis(rawRateType, "manual");
  if (normalizedRateType === "manual") return "вручную";

  const context = RATE_BASIS_CONTEXT[normalizedRateType];
  return consumptionLabelFromParts(stockUnit, context);
}

export function formatKnowledgeMatchReason(value: unknown): string {
  const raw = text(value);
  if (!raw) return "Причина совпадения не указана.";
  const match = MATCH_REASON_LABELS.find(([pattern]) => pattern.test(raw));
  return match?.[1] || raw.replace(/_/g, " ");
}
