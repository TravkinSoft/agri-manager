import { Language } from "@/lib/i18n/translations";

export type UnitCode = "kg" | "l" | "ha" | "pcs" | "t";

const unitByLocale: Record<Language, Record<UnitCode, string>> = {
  ru: { kg: "кг", l: "л", ha: "га", pcs: "шт", t: "т" },
  kz: { kg: "кг", l: "л", ha: "га", pcs: "дана", t: "т" },
  en: { kg: "kg", l: "l", ha: "ha", pcs: "pcs", t: "t" },
};

const unitAliases: Record<string, UnitCode> = {
  kg: "kg",
  кг: "kg",
  kilogram: "kg",
  kilograms: "kg",
  l: "l",
  л: "l",
  liter: "l",
  liters: "l",
  ha: "ha",
  га: "ha",
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
  ton: "t",
  tons: "t",
};

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
  const normalized = String(unit || "")
    .trim()
    .toLowerCase();
  const code = unitAliases[normalized];
  if (!code) return String(unit || "");
  return unitByLocale[language][code];
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
