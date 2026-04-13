export type GlobalCatalogEntity =
  | "crops"
  | "varieties"
  | "seed_reproductions"
  | "pesticides"
  | "fertilizers"
  | "machinery"
  | "implements"
  | "fleet";

export type FilterOption = { label: string; value: string };

export type CatalogColumn = {
  key: string;
  label: string;
};

export type CatalogFilter = {
  key: string;
  label: string;
  options: FilterOption[];
};

export type CatalogFormFieldType = "text" | "number" | "select" | "checkbox";

export type CatalogFormField = {
  key: string;
  label: string;
  type: CatalogFormFieldType;
  required?: boolean;
  placeholder?: string;
  options?: FilterOption[];
  optionsEntity?: GlobalCatalogEntity;
};

export type GlobalCatalogConfig = {
  entity: GlobalCatalogEntity;
  title: string;
  description: string;
  createLabel: string;
  searchPlaceholder: string;
  columns: CatalogColumn[];
  filters: CatalogFilter[];
  formFields: CatalogFormField[];
};

const pesticideCategoryOptions: FilterOption[] = [
  { label: "Гербицид", value: "herbicide" },
  { label: "Фунгицид", value: "fungicide" },
  { label: "Инсектицид", value: "insecticide" },
  { label: "Протравитель", value: "seed_treatment" },
  { label: "Десикант", value: "desiccant" },
  { label: "Регулятор роста", value: "growth_regulator" },
  { label: "Адъювант", value: "adjuvant" },
  { label: "Биопрепарат", value: "biological" },
  { label: "ПАВ", value: "surfactant" },
  { label: "Кондиционер воды", value: "water_conditioner" },
  { label: "pH-регулятор", value: "pH_regulator" },
  { label: "Антидрифтовый агент", value: "drift_reduction_agent" },
  { label: "Антивспениватель", value: "anti_foam" },
];

const fertilizerTypeOptions: FilterOption[] = [
  { label: "Азотное", value: "nitrogen" },
  { label: "Фосфорное", value: "phosphorus" },
  { label: "Калийное", value: "potassium" },
  { label: "NPK", value: "npk" },
  { label: "Микроэлементное", value: "micronutrient" },
  { label: "Листовое", value: "foliar" },
  { label: "Органическое", value: "organic" },
];

const activeFilterOptions: FilterOption[] = [
  { label: "Все", value: "all" },
  { label: "Активные", value: "true" },
  { label: "Неактивные", value: "false" },
];

export const GLOBAL_CATALOG_CONFIGS: Record<GlobalCatalogEntity, GlobalCatalogConfig> = {
  crops: {
    entity: "crops",
    title: "Глобальный каталог культур",
    description: "Единый мастер-справочник культур для всех компаний платформы.",
    createLabel: "Добавить культуру",
    searchPlaceholder: "Поиск по названию, категории, подкатегории...",
    columns: [
      { key: "name", label: "Название" },
      { key: "name_en", label: "Английское название" },
      { key: "crop_category", label: "Категория" },
      { key: "crop_subcategory", label: "Подкатегория" },
      { key: "is_common_in_kz", label: "Распространена в РК" },
      { key: "priority_level", label: "Приоритет" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [
      { key: "crop_category", label: "Категория", options: [{ label: "Все", value: "all" }] },
      { key: "crop_subcategory", label: "Подкатегория", options: [{ label: "Все", value: "all" }] },
      { key: "is_common_in_kz", label: "Распространена в РК", options: [{ label: "Все", value: "all" }, { label: "Да", value: "true" }, { label: "Нет", value: "false" }] },
      { key: "is_active", label: "Активность", options: activeFilterOptions },
    ],
    formFields: [
      { key: "name", label: "Название", type: "text", required: true },
      { key: "name_en", label: "Английское название", type: "text" },
      { key: "crop_category", label: "Категория", type: "text" },
      { key: "crop_subcategory", label: "Подкатегория", type: "text" },
      { key: "is_common_in_kz", label: "Распространена в РК", type: "checkbox" },
      { key: "priority_level", label: "Приоритет", type: "number" },
      { key: "is_active", label: "Активна", type: "checkbox" },
    ],
  },
  varieties: {
    entity: "varieties",
    title: "Глобальный каталог сортов",
    description: "Сорта с обязательной связью к культуре.",
    createLabel: "Добавить сорт",
    searchPlaceholder: "Поиск по сорту, культуре, стране...",
    columns: [
      { key: "name", label: "Сорт" },
      { key: "crop_name", label: "Культура" },
      { key: "origin_country", label: "Страна / оригинатор" },
      { key: "variety_type", label: "Тип" },
      { key: "is_common_in_kz", label: "Распространена в РК" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [
      { key: "crop_id", label: "Культура", options: [{ label: "Все", value: "all" }] },
      { key: "origin_country", label: "Страна", options: [{ label: "Все", value: "all" }] },
      { key: "is_common_in_kz", label: "Распространена в РК", options: [{ label: "Все", value: "all" }, { label: "Да", value: "true" }, { label: "Нет", value: "false" }] },
      { key: "is_active", label: "Активность", options: activeFilterOptions },
    ],
    formFields: [
      { key: "name", label: "Сорт", type: "text", required: true },
      { key: "crop_id", label: "Культура", type: "select", required: true, optionsEntity: "crops" },
      { key: "origin_country", label: "Страна / оригинатор", type: "text" },
      { key: "variety_type", label: "Тип", type: "text" },
      { key: "is_common_in_kz", label: "Распространена в РК", type: "checkbox" },
      { key: "is_active", label: "Активен", type: "checkbox" },
    ],
  },
  seed_reproductions: {
    entity: "seed_reproductions",
    title: "Глобальный каталог репродукций",
    description: "Уровни репродукций семян и их приоритет.",
    createLabel: "Добавить репродукцию",
    searchPlaceholder: "Поиск по названию, описанию...",
    columns: [
      { key: "name", label: "Название" },
      { key: "level_order", label: "Порядок уровня" },
      { key: "description", label: "Описание" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [
      { key: "is_active", label: "Активность", options: activeFilterOptions },
    ],
    formFields: [
      { key: "name", label: "Название", type: "text", required: true },
      { key: "level_order", label: "Порядок уровня", type: "number" },
      { key: "description", label: "Описание", type: "text" },
      { key: "is_active", label: "Активна", type: "checkbox" },
    ],
  },
  pesticides: {
    entity: "pesticides",
    title: "Глобальный каталог пестицидов",
    description: "Мастер-список СЗР, доступный для подключения компаниями.",
    createLabel: "Добавить пестицид",
    searchPlaceholder: "Поиск по названию, ДВ, формуляции, производителю...",
    columns: [
      { key: "display_name", label: "Торговое название" },
      { key: "active_ingredient", label: "ДВ" },
      { key: "pesticide_category", label: "Категория" },
      { key: "pesticide_subcategory", label: "Подкатегория" },
      { key: "formulation", label: "Формуляция" },
      { key: "manufacturer", label: "Производитель" },
      { key: "status", label: "Статус" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [
      { key: "pesticide_category", label: "Категория", options: [{ label: "Все", value: "all" }, ...pesticideCategoryOptions] },
      { key: "pesticide_subcategory", label: "Подкатегория", options: [{ label: "Все", value: "all" }, ...pesticideCategoryOptions] },
      { key: "manufacturer", label: "Производитель", options: [{ label: "Все", value: "all" }] },
      { key: "is_active", label: "Активность", options: activeFilterOptions },
    ],
    formFields: [
      { key: "name", label: "Название", type: "text", required: true },
      { key: "trade_name", label: "Торговое название", type: "text" },
      { key: "active_ingredient", label: "Действующее вещество", type: "text", required: true },
      { key: "pesticide_category", label: "Категория", type: "select", required: true, options: pesticideCategoryOptions },
      { key: "pesticide_subcategory", label: "Подкатегория", type: "select", options: pesticideCategoryOptions },
      { key: "formulation", label: "Формуляция", type: "text" },
      { key: "manufacturer", label: "Производитель", type: "text" },
      { key: "default_unit", label: "Ед. учета", type: "select", options: [{ label: "л", value: "l" }, { label: "кг", value: "kg" }, { label: "г", value: "g" }] },
      { key: "is_active", label: "Активен", type: "checkbox" },
    ],
  },
  fertilizers: {
    entity: "fertilizers",
    title: "Глобальный каталог удобрений",
    description: "Мастер-список удобрений платформы AgriManager.",
    createLabel: "Добавить удобрение",
    searchPlaceholder: "Поиск по названию, составу, производителю...",
    columns: [
      { key: "display_name", label: "Название" },
      { key: "fertilizer_type", label: "Тип" },
      { key: "pesticide_subcategory", label: "Подкатегория" },
      { key: "active_ingredient", label: "Состав" },
      { key: "formulation", label: "Формуляция" },
      { key: "manufacturer", label: "Производитель" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [
      { key: "fertilizer_type", label: "Тип", options: [{ label: "Все", value: "all" }, ...fertilizerTypeOptions] },
      { key: "manufacturer", label: "Производитель", options: [{ label: "Все", value: "all" }] },
      { key: "is_active", label: "Активность", options: activeFilterOptions },
    ],
    formFields: [
      { key: "name", label: "Название", type: "text", required: true },
      { key: "trade_name", label: "Торговое название", type: "text" },
      { key: "active_ingredient", label: "Состав", type: "text", required: true },
      { key: "fertilizer_type", label: "Тип", type: "select", required: true, options: fertilizerTypeOptions },
      { key: "pesticide_subcategory", label: "Подкатегория", type: "text" },
      { key: "formulation", label: "Формуляция", type: "text" },
      { key: "manufacturer", label: "Производитель", type: "text" },
      { key: "default_unit", label: "Ед. учета", type: "select", options: [{ label: "кг", value: "kg" }, { label: "т", value: "t" }, { label: "л", value: "l" }] },
      { key: "is_active", label: "Активно", type: "checkbox" },
    ],
  },
  machinery: {
    entity: "machinery",
    title: "Глобальный каталог техники",
    description: "Машинный двор: техника для выполнения полевых операций.",
    createLabel: "Добавить технику",
    searchPlaceholder: "Поиск по названию, бренду, модели...",
    columns: [
      { key: "full_name", label: "Полное название" },
      { key: "brand", label: "Бренд" },
      { key: "series", label: "Серия" },
      { key: "model", label: "Модель" },
      { key: "machine_category", label: "Категория" },
      { key: "machine_type", label: "Тип" },
      { key: "key_parameter", label: "Ключевой параметр" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [
      { key: "machine_category", label: "Категория", options: [{ label: "Все", value: "all" }] },
      { key: "brand", label: "Бренд", options: [{ label: "Все", value: "all" }] },
      { key: "machine_type", label: "Тип", options: [{ label: "Все", value: "all" }] },
      { key: "is_active", label: "Активность", options: activeFilterOptions },
    ],
    formFields: [
      { key: "full_name", label: "Полное название", type: "text", required: true },
      { key: "name", label: "Короткое название", type: "text" },
      { key: "brand", label: "Бренд", type: "text" },
      { key: "series", label: "Серия", type: "text" },
      { key: "model", label: "Модель", type: "text" },
      { key: "machine_category", label: "Категория", type: "text" },
      { key: "machine_type", label: "Тип", type: "text" },
      { key: "key_parameter", label: "Ключевой параметр", type: "text" },
      { key: "is_active", label: "Активна", type: "checkbox" },
    ],
  },
  implements: {
    entity: "implements",
    title: "Глобальный каталог агрегатов",
    description: "Оборудование и агрегаты машинного двора.",
    createLabel: "Добавить агрегат",
    searchPlaceholder: "Поиск по названию, бренду, назначению...",
    columns: [
      { key: "full_name", label: "Название" },
      { key: "brand", label: "Бренд" },
      { key: "series", label: "Серия" },
      { key: "model", label: "Модель" },
      { key: "equipment_category", label: "Категория" },
      { key: "purpose", label: "Назначение" },
      { key: "key_parameter", label: "Ключевой параметр" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [
      { key: "equipment_category", label: "Категория", options: [{ label: "Все", value: "all" }] },
      { key: "brand", label: "Бренд", options: [{ label: "Все", value: "all" }] },
      { key: "is_active", label: "Активность", options: activeFilterOptions },
    ],
    formFields: [
      { key: "full_name", label: "Название", type: "text", required: true },
      { key: "name", label: "Короткое название", type: "text" },
      { key: "brand", label: "Бренд", type: "text" },
      { key: "series", label: "Серия", type: "text" },
      { key: "model", label: "Модель", type: "text" },
      { key: "equipment_category", label: "Категория", type: "text" },
      { key: "purpose", label: "Назначение", type: "text" },
      { key: "key_parameter", label: "Ключевой параметр", type: "text" },
      { key: "is_active", label: "Активно", type: "checkbox" },
    ],
  },
  fleet: {
    entity: "fleet",
    title: "Глобальный каталог автопарка",
    description: "Шаблоны транспортных единиц для логистики.",
    createLabel: "Добавить транспорт",
    searchPlaceholder: "Поиск по названию, бренду, модели...",
    columns: [
      { key: "full_name", label: "Полное название" },
      { key: "brand", label: "Бренд" },
      { key: "series", label: "Серия" },
      { key: "model", label: "Модель" },
      { key: "fleet_type", label: "Тип" },
      { key: "capacity_kg", label: "Грузоподъёмность" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [
      { key: "fleet_type", label: "Тип", options: [{ label: "Все", value: "all" }] },
      { key: "brand", label: "Бренд", options: [{ label: "Все", value: "all" }] },
      { key: "is_active", label: "Активность", options: activeFilterOptions },
    ],
    formFields: [
      { key: "full_name", label: "Полное название", type: "text", required: true },
      { key: "name", label: "Короткое название", type: "text" },
      { key: "brand", label: "Бренд", type: "text" },
      { key: "series", label: "Серия", type: "text" },
      { key: "model", label: "Модель", type: "text" },
      { key: "fleet_type", label: "Тип", type: "text" },
      { key: "capacity_kg", label: "Грузоподъёмность (кг)", type: "number" },
      { key: "is_active", label: "Активен", type: "checkbox" },
    ],
  },
};

export function getCatalogConfig(entity: GlobalCatalogEntity): GlobalCatalogConfig {
  return GLOBAL_CATALOG_CONFIGS[entity];
}
