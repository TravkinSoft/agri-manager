import { localizeUnit } from "@/lib/i18n/helpers";
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

const RATE_TYPE_LABELS: Record<string, string> = {
  per_ha: "на 1 га",
  per_1000_l_solution: "на 1000 л рабочего раствора",
  per_l_water: "на 1 л воды",
  per_t_seed: "на 1 т семян",
  per_100kg_seed: "на 100 кг семян",
  per_1000_seeds: "на 1000 семян",
  manual: "вручную",
};

const RATE_UNIT_LABELS: Record<string, string> = {
  "l/ha": "л/га",
  "kg/ha": "кг/га",
  "g/ha": "г/га",
  "ml/ha": "мл/га",
  "l/t_seed": "л/т семян",
  "ml/t_seed": "мл/т семян",
  "kg/t_seed": "кг/т семян",
  "g/t_seed": "г/т семян",
  "l/100kg_seed": "л/100 кг семян",
  "ml/100kg_seed": "мл/100 кг семян",
  "kg/100kg_seed": "кг/100 кг семян",
  "g/100kg_seed": "г/100 кг семян",
  "l/1000_seeds": "л/1000 семян",
  "ml/1000_seeds": "мл/1000 семян",
  "kg/1000_seeds": "кг/1000 семян",
  "g/1000_seeds": "г/1000 семян",
  "l/1000_l_solution": "л/1000 л рабочего раствора",
  "ml/1000_l_solution": "мл/1000 л рабочего раствора",
  "kg/1000_l_solution": "кг/1000 л рабочего раствора",
  "g/1000_l_solution": "г/1000 л рабочего раствора",
  "ml/l_water": "мл/л воды",
  "g/l_water": "г/л воды",
  "l/l_water": "л/л воды",
  "kg/l_water": "кг/л воды",
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
  const raw = text(value);
  if (!raw || raw === "unknown") return "Не указано";
  return localizeUnit(raw, "ru") || fallbackLabel(raw);
}

export function formatKnowledgeRateType(value: unknown): string {
  const raw = text(value);
  if (!raw) return "Не указано";
  return RATE_TYPE_LABELS[normalizeMaterialRateBasis(raw, "manual")] || fallbackLabel(raw);
}

export function formatKnowledgeRateUnit(value: unknown): string {
  const raw = text(value);
  if (!raw || raw === "unknown") return "Не указано";
  return RATE_UNIT_LABELS[raw] || localizeUnit(raw, "ru") || raw.replace(/_/g, " ");
}

export function formatKnowledgeMatchReason(value: unknown): string {
  const raw = text(value);
  if (!raw) return "Причина совпадения не указана.";
  const match = MATCH_REASON_LABELS.find(([pattern]) => pattern.test(raw));
  return match?.[1] || raw.replace(/_/g, " ");
}
