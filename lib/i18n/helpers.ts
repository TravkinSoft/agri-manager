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
  lentils: { ru: "Чечевица", kz: "Жасымық", en: "Lentils" },
  lucerne: { ru: "Люцерна", kz: "Жоңышқа", en: "Lucerne" },
  oats: { ru: "Овес", kz: "Сұлы", en: "Oats" },
  "oats/grass mix": { ru: "Овес/травосмесь", kz: "Сұлы/шөп қоспасы", en: "Oats/Grass Mix" },
  pea: { ru: "Горох", kz: "Бұршақ", en: "Pea" },
  peas: { ru: "Горох", kz: "Бұршақ", en: "Peas" },
  potatoes: { ru: "Картофель", kz: "Картоп", en: "Potatoes" },
  soybeans: { ru: "Соя", kz: "Соя", en: "Soybeans" },
  sunflower: { ru: "Подсолнечник", kz: "Күнбағыс", en: "Sunflower" },
  wheat: { ru: "Пшеница", kz: "Бидай", en: "Wheat" },
  vegetables: { ru: "Овощи", kz: "Көкөністер", en: "Vegetables" },
  "perennial grass": { ru: "Многолетние травы", kz: "Көпжылдық шөптер", en: "Perennial grass" },
  "sudan grass": { ru: "Суданская трава", kz: "Судан шөбі", en: "Sudan grass" },

  // Warehouses
  "main storage facility": { ru: "Основной склад", kz: "Негізгі қойма", en: "Main Storage Facility" },
  "pesticide storage": { ru: "Склад пестицидов", kz: "Пестицид қоймасы", en: "Pesticide Storage" },
  "fertilizer warehouse": { ru: "Склад удобрений", kz: "Тыңайтқыш қоймасы", en: "Fertilizer Warehouse" },
  "seed warehouse": { ru: "Склад семян", kz: "Тұқым қоймасы", en: "Seed Warehouse" },

  // Products
  "ammonium nitrate": { ru: "Аммиачная селитра", kz: "Аммиак селитрасы", en: "Ammonium Nitrate" },
  "ammophos 12-52": { ru: "Аммофос 12-52", kz: "Аммофос 12-52", en: "Ammophos 12-52" },
  "urea 46%": { ru: "Карбамид 46%", kz: "Карбамид 46%", en: "Urea 46%" },
  "fertilizer npk 15-15-15": { ru: "Удобрение NPK 15-15-15", kz: "Тыңайтқыш NPK 15-15-15", en: "Fertilizer NPK 15-15-15" },
  "herbicide glyphosate 360": { ru: "Гербицид Глифосат 360", kz: "Гербицид Глифосат 360", en: "Herbicide Glyphosate 360" },
  "glyphosate 480": { ru: "Глифосат 480", kz: "Глифосат 480", en: "Glyphosate 480" },
  dicamba: { ru: "Дикамба", kz: "Дикамба", en: "Dicamba" },
  metribuzin: { ru: "Метрибузин", kz: "Метрибузин", en: "Metribuzin" },
  "seed potato - russet burbank": { ru: "Семенной картофель — Russet Burbank", kz: "Тұқымдық картоп — Russet Burbank", en: "Seed Potato - Russet Burbank" },
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
  fallbackKeys: string[] = ["name", "title"]
): string {
  if (!row) return "";
  const localizedKey = `name_${language}`;
  const localizedValue = String(row[localizedKey] || "").trim();
  if (localizedValue) return localizedValue;

  for (const key of fallbackKeys) {
    const value = String(row[key] || "").trim();
    if (value) return fallbackTranslateName(value, language);
  }
  return "";
}
