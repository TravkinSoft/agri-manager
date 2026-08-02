import { Language } from "@/lib/i18n/translations";

export type UnitCode = "kg" | "g" | "l" | "ml" | "ha" | "pcs" | "t" | "m" | "roll" | "pack";

const unitByLocale: Record<Language, Record<UnitCode, string>> = {
  ru: { kg: "кг", g: "г", l: "л", ml: "мл", ha: "га", pcs: "шт", t: "т", m: "м", roll: "бухта", pack: "уп." },
  kz: { kg: "кг", g: "г", l: "л", ml: "мл", ha: "га", pcs: "дана", t: "т", m: "м", roll: "орама", pack: "қапт." },
  en: { kg: "kg", g: "g", l: "l", ml: "ml", ha: "ha", pcs: "pcs", t: "t", m: "m", roll: "roll", pack: "pack" },
};

const unitAliases: Record<string, UnitCode> = {
  kg: "kg",
  кг: "kg",
  "кг.": "kg",
  kilogram: "kg",
  kilograms: "kg",
  g: "g",
  gr: "g",
  gram: "g",
  grams: "g",
  г: "g",
  гр: "g",
  "г.": "g",
  l: "l",
  lt: "l",
  litre: "l",
  litres: "l",
  л: "l",
  "л.": "l",
  liter: "l",
  liters: "l",
  ml: "ml",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  мл: "ml",
  "мл.": "ml",
  ha: "ha",
  га: "ha",
  "га.": "ha",
  hectare: "ha",
  hectares: "ha",
  pcs: "pcs",
  pc: "pcs",
  шт: "pcs",
  дана: "pcs",
  piece: "pcs",
  pieces: "pcs",
  t: "t",
  т: "t",
  "т.": "t",
  ton: "t",
  tons: "t",
  tonne: "t",
  tonnes: "t",
  m: "m",
  meter: "m",
  meters: "m",
  metre: "m",
  metres: "m",
  м: "m",
  "м.": "m",
  roll: "roll",
  rolls: "roll",
  бухта: "roll",
  бухты: "roll",
  pack: "pack",
  package: "pack",
  packages: "pack",
  уп: "pack",
  "уп.": "pack",
  упаковка: "pack",
};

const unknownUnitByLocale: Record<Language, string> = {
  ru: "не указано",
  kz: "көрсетілмеген",
  en: "unknown",
};

const unitPhraseAliases: Record<
  string,
  {
    ru: string;
    kz: string;
    en: string;
  }
> = {
  "t seed": { ru: "т семян", kz: "т тұқым", en: "t seed" },
  "ton seed": { ru: "т семян", kz: "т тұқым", en: "t seed" },
  "tonne seed": { ru: "т семян", kz: "т тұқым", en: "t seed" },
  "100kg seed": { ru: "100 кг семян", kz: "100 кг тұқым", en: "100 kg seed" },
  "100 kg seed": { ru: "100 кг семян", kz: "100 кг тұқым", en: "100 kg seed" },
  "1000 seeds": { ru: "1000 семян", kz: "1000 тұқым", en: "1000 seeds" },
};

function normalizeUnitKey(unit: unknown): string {
  return String(unit || "")
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .replace(/[.]+$/g, "");
}

function localizeUnitPart(part: string, language: Language): string {
  const normalized = normalizeUnitKey(part);
  const phrase = unitPhraseAliases[normalized];
  if (phrase) return phrase[language] || phrase.en;
  const countMatch = normalized.match(/^(\d+(?:[,.]\d+)?)\s*(.+)$/);
  if (countMatch) {
    return `${countMatch[1]} ${localizeUnit(countMatch[2], language)}`;
  }
  const code = unitAliases[normalized];
  return code ? unitByLocale[language][code] : part.trim();
}

const fallbackNameTranslations: Record<
  string,
  {
    ru?: string;
    kz?: string;
    en?: string;
  }
> = {
  // Crops
  barley: { ru: "Ячмень", kz: "Арпа", en: "Barley" },
  beans: { ru: "Бобы", kz: "Бұршақ", en: "Beans" },
  carrot: { ru: "Морковь", kz: "Сәбіз", en: "Carrot" },
  corn: { ru: "Кукуруза", kz: "Жүгері", en: "Corn" },
  fallow: { ru: "Пар", kz: "Пар", en: "Fallow" },
  flax: { ru: "Лен", kz: "Зығыр", en: "Flax" },
  "grass mix": { ru: "Травосмесь", kz: "Шөп қоспасы", en: "Grass mix" },
  "grass-mix": { ru: "Травосмесь", kz: "Шөп қоспасы", en: "Grass mix" },
  lentils: { ru: "Чечевица", kz: "Жасымық", en: "Lentils" },
  lucerne: { ru: "Люцерна", kz: "Жоңышқа", en: "Lucerne" },
  oat: { ru: "Овёс", kz: "Сұлы", en: "Oat" },
  oats: { ru: "Овёс", kz: "Сұлы", en: "Oats" },
  "oats/grass mix": { ru: "Овёс/травосмесь", kz: "Сұлы/шөп қоспасы", en: "Oats/Grass Mix" },
  "oats-grass-mix": { ru: "Овёс/травосмесь", kz: "Сұлы/шөп қоспасы", en: "Oats/Grass Mix" },
  pea: { ru: "Горох", kz: "Бұршақ", en: "Pea" },
  peas: { ru: "Горох", kz: "Бұршақ", en: "Peas" },
  potato: { ru: "Картофель", kz: "Картоп", en: "Potato" },
  potatoes: { ru: "Картофель", kz: "Картоп", en: "Potatoes" },
  soybeans: { ru: "Соя", kz: "Соя", en: "Soybeans" },
  sunflower: { ru: "Подсолнечник", kz: "Күнбағыс", en: "Sunflower" },
  wheat: { ru: "Пшеница", kz: "Бидай", en: "Wheat" },
  vegetables: { ru: "Овощи", kz: "Көкөністер", en: "Vegetables" },
  "perennial grass": { ru: "Многолетние травы", kz: "Көпжылдық шөптер", en: "Perennial grass" },
  "perennial-grass": { ru: "Многолетние травы", kz: "Көпжылдық шөптер", en: "Perennial grass" },
  "sudan grass": { ru: "Суданская трава", kz: "Судан шөбі", en: "Sudan grass" },
  "sudan-grass": { ru: "Суданская трава", kz: "Судан шөбі", en: "Sudan grass" },

  // Warehouses
  "main storage facility": { ru: "Основной склад", kz: "Негізгі қойма", en: "Main Storage Facility" },
  "pesticide storage": { ru: "Склад пестицидов", kz: "Пестицид қоймасы", en: "Pesticide Storage" },
  "fertilizer warehouse": { ru: "Склад удобрений", kz: "Тыңайтқыш қоймасы", en: "Fertilizer Warehouse" },
  "seed warehouse": { ru: "Склад семян", kz: "Тұқым қоймасы", en: "Seed Warehouse" },

  // Seed reproductions
  original: { ru: "Оригинальные", kz: "Оригинал", en: "Original" },
  elite: { ru: "Элита", kz: "Элита", en: "Elite" },
  superelite: { ru: "Суперэлита", kz: "Суперэлита", en: "Superelite" },
  "super elite": { ru: "Суперэлита", kz: "Суперэлита", en: "Super elite" },
  "first reproduction": { ru: "1 репродукция", kz: "1 репродукция", en: "First reproduction" },
  "second reproduction": { ru: "2 репродукция", kz: "2 репродукция", en: "Second reproduction" },
  "third reproduction": { ru: "3 репродукция", kz: "3 репродукция", en: "Third reproduction" },
};

function fallbackTranslateName(value: string, language: Language): string {
  const key = value.trim().toLowerCase();
  const entry = fallbackNameTranslations[key];
  if (!entry) return value;
  return entry[language] || entry.en || value;
}

export function localizeUnit(unit: unknown, language: Language): string {
  const raw = String(unit || "").trim();
  const normalized = normalizeUnitKey(raw);
  if (!normalized) return "";
  if (["unknown", "неизвестно", "не указано", "n/a"].includes(normalized)) {
    return unknownUnitByLocale[language];
  }
  if (normalized.includes("/")) {
    return normalized
      .split("/")
      .map((part) => localizeUnitPart(part, language))
      .join("/");
  }
  const code = unitAliases[normalized];
  if (!code) return raw;
  return unitByLocale[language][code];
}

const operationTypeByLocale: Record<string, Record<Language, string>> = {
  spraying: { ru: "Опрыскивание", kz: "Бүрку", en: "Spraying" },
  fertilizer_application: { ru: "Внесение удобрений", kz: "Тыңайтқыш енгізу", en: "Fertilizer application" },
  fertilization: { ru: "Внесение удобрений", kz: "Тыңайтқыш енгізу", en: "Fertilization" },
  planting: { ru: "Посев / посадка", kz: "Егу / отырғызу", en: "Seeding / planting" },
  seeding: { ru: "Посев", kz: "Егу", en: "Seeding" },
  irrigation: { ru: "Полив", kz: "Суару", en: "Irrigation" },
  harvesting: { ru: "Уборка", kz: "Жинау", en: "Harvesting" },
  soil_operation: { ru: "Работа с почвой", kz: "Топырақпен жұмыс", en: "Soil operation" },
};

const materialTypeByLocale: Record<string, Record<Language, string>> = {
  seed: { ru: "семена", kz: "тұқым", en: "seed" },
  fertilizer: { ru: "удобрение", kz: "тыңайтқыш", en: "fertilizer" },
  pesticide: { ru: "пестицид", kz: "пестицид", en: "pesticide" },
  produce: { ru: "урожай", kz: "өнім", en: "produce" },
};

export function localizeOperationType(value: unknown, language: Language): string {
  const raw = String(value || "").trim();
  return operationTypeByLocale[raw.toLowerCase()]?.[language] || raw || "—";
}

export function localizeMaterialType(value: unknown, language: Language): string {
  const raw = String(value || "").trim();
  return materialTypeByLocale[raw.toLowerCase()]?.[language] || raw || "—";
}

export function localizedName<T extends Record<string, unknown>>(
  row: T | null | undefined,
  language: Language,
  fallbackKeys: string[] = ["name", "title", "canonical_slug", "slug"]
): string {
  if (!row) return "";
  const localizedKeys =
    language === "kz"
      ? ["name_kz", "name_kk"]
      : [`name_${language}`];
  const preferredKeys = [
    ...localizedKeys,
    ...(language !== "ru" ? ["name_ru"] : []),
  ];
  const seenKeys = new Set<string>();
  for (const key of preferredKeys) {
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const value = String(row[key] || "").trim();
    if (value) return fallbackTranslateName(value, language);
  }

  for (const key of fallbackKeys) {
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const value = String(row[key] || "").trim();
    if (value) return fallbackTranslateName(value, language);
  }
  return "";
}

export function brandName<T extends Record<string, unknown>>(
  row: T | null | undefined,
  fallbackKeys: string[] = ["trade_name", "original_name", "name", "normalized_name"]
): string {
  if (!row) return "";
  for (const key of fallbackKeys) {
    const value = String(row[key] || "").trim();
    if (value) return value;
  }
  const aliases = row.aliases;
  if (Array.isArray(aliases)) {
    const alias = aliases.map((item) => String(item || "").trim()).find(Boolean);
    if (alias) return alias;
  }
  if (typeof aliases === "string") {
    const alias = aliases
      .split(/[;,]/)
      .map((item) => item.trim())
      .find(Boolean);
    if (alias) return alias;
  }
  return "";
}
