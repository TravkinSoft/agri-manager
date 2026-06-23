export type GlobalCatalogEntity =
  | "crops"
  | "varieties"
  | "seed_originators"
  | "seed_reproductions"
  | "seeds"
  | "diseases"
  | "pesticides"
  | "fertilizers"
  | "additives"
  | "growth_regulators"
  | "pesticide_categories"
  | "active_ingredients"
  | "agrochem_manufacturers"
  | "agrochem_formulations"
  | "agrochem_mode_of_actions"
  | "agricultural_machine_models"
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
  optionsEntity?: GlobalCatalogEntity;
  multi?: boolean;
};

export type CatalogFormFieldType = "text" | "number" | "select" | "checkbox" | "multiselect";

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

const activeFilterOptions: FilterOption[] = [
  { label: "Все", value: "all" },
  { label: "Активные", value: "true" },
  { label: "Неактивные", value: "false" },
];

const seedUnitOptions: FilterOption[] = [
  { label: "кг", value: "kg" },
  { label: "т", value: "t" },
  { label: "шт", value: "pcs" },
];

const diseaseTypeOptions: FilterOption[] = [
  { label: "Листовая", value: "foliar" },
  { label: "Почвенная", value: "soil_borne" },
  { label: "Клубневая / хранение", value: "tuber_storage" },
  { label: "Сосудистая", value: "vascular" },
  { label: "Вирусная", value: "viral" },
  { label: "Физиологическая", value: "physiological" },
  { label: "Другое", value: "other" },
  { label: "Неизвестно", value: "unknown" },
];

const diseaseTypeFilterOptions: FilterOption[] = [
  { label: "Все", value: "all" },
  ...diseaseTypeOptions,
];

const pathogenTypeOptions: FilterOption[] = [
  { label: "Гриб", value: "fungus" },
  { label: "Бактерия", value: "bacteria" },
  { label: "Вирус", value: "virus" },
  { label: "Оомицет", value: "oomycete" },
  { label: "Физиология", value: "physiological" },
  { label: "Неизвестно", value: "unknown" },
];

const pathogenTypeFilterOptions: FilterOption[] = [
  { label: "Все", value: "all" },
  ...pathogenTypeOptions,
];

const confidenceOptions: FilterOption[] = [
  { label: "Низкая", value: "low" },
  { label: "Средняя", value: "medium" },
  { label: "Высокая", value: "high" },
];

const confidenceFilterOptions: FilterOption[] = [
  { label: "Все", value: "all" },
  ...confidenceOptions,
];

const agriculturalMachineCategoryOptions: FilterOption[] = [
  { label: "Комбайн", value: "combine_harvester" },
  { label: "Кормоуборочный комбайн", value: "forage_harvester" },
  { label: "Самоходный опрыскиватель", value: "self_propelled_sprayer" },
  { label: "Самоходная сеялка", value: "self_propelled_seeder" },
  { label: "Самоходный разбрасыватель", value: "self_propelled_spreader" },
  { label: "Самоходная жатка", value: "self_propelled_windrower" },
  { label: "Самоходная косилка", value: "self_propelled_mower" },
  { label: "Прицепной опрыскиватель", value: "trailed_sprayer" },
  { label: "Навесной опрыскиватель", value: "mounted_sprayer" },
  { label: "Картофелесажалка", value: "potato_planter" },
  { label: "Картофелеуборочная техника", value: "potato_harvester" },
  { label: "Сажалка", value: "planter" },
  { label: "Сеялка", value: "seeder" },
  { label: "Культиватор", value: "cultivator" },
  { label: "Плуг", value: "plow" },
  { label: "Дисковая борона", value: "disc_harrow" },
  { label: "Разбрасыватель удобрений", value: "fertilizer_spreader" },
  { label: "Погрузчик", value: "loader" },
  { label: "Телескопический погрузчик", value: "telehandler" },
  { label: "Прицеп", value: "trailer" },
  { label: "Трактор", value: "tractor" },
  { label: "Прочее", value: "other" },
];

const agriculturalMachineCategoryFilterOptions: FilterOption[] = [
  { label: "Все", value: "all" },
  ...agriculturalMachineCategoryOptions,
];

const machineryAssetGroupOptions: FilterOption[] = [
  { label: "Самоходная техника", value: "self_propelled_machine" },
  { label: "Агрегат", value: "implement" },
  { label: "Прицеп", value: "trailer" },
  { label: "Транспорт", value: "truck" },
];

const machineryAssetGroupFilterOptions: FilterOption[] = [
  { label: "Все", value: "all" },
  ...machineryAssetGroupOptions,
];

const productTypeFilterOptions: FilterOption[] = [
  { label: "Все", value: "all" },
  { label: "Пестициды", value: "pesticide" },
  { label: "Удобрения", value: "fertilizer" },
  { label: "Регуляторы роста", value: "growth_regulator" },
  { label: "Адъюванты", value: "adjuvant" },
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

const additiveSubtypeOptions: FilterOption[] = [
  { label: "Адъювант", value: "adjuvant" },
  { label: "Прилипатель", value: "sticker" },
  { label: "Корректор pH", value: "pH_corrector" },
  { label: "Пеногаситель", value: "antifoam" },
  { label: "Кондиционер воды", value: "water_conditioner" },
  { label: "Антисоль", value: "anti_salt" },
  { label: "Другое", value: "other" },
];

const additiveColumns: CatalogColumn[] = [
  { key: "trade_name", label: "Торговое название" },
  { key: "subcategory", label: "Подтип" },
  { key: "formulation", label: "Формуляция" },
  { key: "manufacturer", label: "Производитель" },
  { key: "default_unit", label: "Ед. учета" },
  { key: "status", label: "Статус" },
  { key: "is_active", label: "Активность" },
];

const additiveFilters: CatalogFilter[] = [
  { key: "subcategory", label: "Подтип", options: [{ label: "Все", value: "all" }, ...additiveSubtypeOptions] },
  { key: "formulation_id", label: "Формуляция", options: [{ label: "Все", value: "all" }], optionsEntity: "agrochem_formulations" },
  { key: "manufacturer_id", label: "Производитель", options: [{ label: "Все", value: "all" }], optionsEntity: "agrochem_manufacturers" },
  { key: "is_active", label: "Активность", options: activeFilterOptions },
];

const additiveFormFields: CatalogFormField[] = [
  { key: "name", label: "Название", type: "text", required: true },
  { key: "trade_name", label: "Торговое название", type: "text" },
  { key: "subcategory", label: "Подтип", type: "select", required: true, options: additiveSubtypeOptions },
  { key: "formulation_id", label: "Формуляция", type: "select", optionsEntity: "agrochem_formulations" },
  { key: "manufacturer_id", label: "Производитель", type: "select", optionsEntity: "agrochem_manufacturers" },
  {
    key: "default_unit",
    label: "Ед. учета",
    type: "select",
    options: [
      { label: "л", value: "l" },
      { label: "кг", value: "kg" },
      { label: "г", value: "g" },
      { label: "мл", value: "ml" },
    ],
  },
  { key: "notes", label: "Заметки", type: "text" },
  { key: "is_active", label: "Активен", type: "checkbox" },
];

const activeIngredientTypeOptions: FilterOption[] = [
  { label: "Пестицидное ДВ", value: "pesticide_ai" },
  { label: "Компонент адъюванта", value: "adjuvant_component" },
  { label: "Биологический агент", value: "biological_agent" },
];

const defaultAgrochemColumns: CatalogColumn[] = [
  { key: "trade_name", label: "Торговое название" },
  { key: "active_ingredients", label: "ДВ" },
  { key: "pesticide_category", label: "Категория" },
  { key: "mode_of_action_type", label: "Тип действия" },
  { key: "formulation", label: "Формуляция" },
  { key: "manufacturer", label: "Производитель" },
  { key: "status", label: "Статус" },
  { key: "is_active", label: "Активность" },
];

const defaultAgrochemFilters: CatalogFilter[] = [
  { key: "product_type", label: "Тип продукта", options: productTypeFilterOptions },
  { key: "category_id", label: "Категория", options: [{ label: "Все", value: "all" }], optionsEntity: "pesticide_categories" },
  { key: "active_ingredient_ids", label: "Действующие вещества", options: [{ label: "Все", value: "all" }], optionsEntity: "active_ingredients", multi: true },
  { key: "mode_of_action_type_id", label: "Тип действия", options: [{ label: "Все", value: "all" }], optionsEntity: "agrochem_mode_of_actions" },
  { key: "formulation_id", label: "Формуляция", options: [{ label: "Все", value: "all" }], optionsEntity: "agrochem_formulations" },
  { key: "manufacturer_id", label: "Производитель", options: [{ label: "Все", value: "all" }], optionsEntity: "agrochem_manufacturers" },
  { key: "is_active", label: "Активность", options: activeFilterOptions },
];

const defaultAgrochemFormFields: CatalogFormField[] = [
  { key: "name", label: "Название", type: "text", required: true },
  { key: "trade_name", label: "Торговое название", type: "text" },
  { key: "active_ingredient_ids", label: "Действующие вещества", type: "multiselect", required: true, optionsEntity: "active_ingredients" },
  { key: "category_id", label: "Категория", type: "select", required: true, optionsEntity: "pesticide_categories" },
  { key: "formulation_id", label: "Формуляция", type: "select", optionsEntity: "agrochem_formulations" },
  { key: "mode_of_action_type_id", label: "Тип действия", type: "select", optionsEntity: "agrochem_mode_of_actions" },
  { key: "manufacturer_id", label: "Производитель", type: "select", optionsEntity: "agrochem_manufacturers" },
  {
    key: "default_unit",
    label: "Ед. учета",
    type: "select",
    options: [
      { label: "л", value: "l" },
      { label: "кг", value: "kg" },
      { label: "г", value: "g" },
      { label: "т", value: "t" },
    ],
  },
  { key: "notes", label: "Заметки", type: "text" },
  { key: "is_active", label: "Активен", type: "checkbox" },
];

export const GLOBAL_CATALOG_CONFIGS: Record<GlobalCatalogEntity, GlobalCatalogConfig> = {
  crops: {
    entity: "crops",
    title: "Глобальный каталог культур",
    description: "Единый мастер-справочник культур.",
    createLabel: "Добавить культуру",
    searchPlaceholder: "Поиск по названию, категории, подкатегории...",
    columns: [
      { key: "name_ru", label: "Название" },
      { key: "name_en", label: "Английское название" },
      { key: "category", label: "Категория" },
      { key: "subcategory", label: "Подкатегория" },
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
      { key: "name_ru", label: "Название", type: "text", required: true },
      { key: "name_en", label: "Английское название", type: "text" },
      { key: "slug", label: "Slug", type: "text", required: true },
      { key: "category", label: "Категория", type: "text", required: true },
      { key: "subcategory", label: "Подкатегория", type: "text" },
      { key: "is_common_in_kz", label: "Распространена в РК", type: "checkbox" },
      { key: "priority_level", label: "Приоритет", type: "text" },
      { key: "is_active", label: "Активна", type: "checkbox" },
    ],
  },
  varieties: {
    entity: "varieties",
    title: "Глобальный каталог сортов",
    description: "Сорта с привязкой к культуре и оригинатору.",
    createLabel: "Добавить сорт",
    searchPlaceholder: "Поиск по сорту, культуре, оригинатору, назначению...",
    columns: [
      { key: "name", label: "Сорт" },
      { key: "crop_name", label: "Культура" },
      { key: "originator_name", label: "Оригинатор" },
      { key: "origin_country", label: "Страна" },
      { key: "variety_type", label: "Тип" },
      { key: "maturity_group", label: "Группа спелости" },
      { key: "purpose", label: "Назначение" },
      { key: "is_common_in_kz", label: "Распространена в РК" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [
      { key: "crop_id", label: "Культура", options: [{ label: "Все", value: "all" }] },
      { key: "originator_id", label: "Оригинатор", options: [{ label: "Все", value: "all" }], optionsEntity: "seed_originators" },
      { key: "origin_country", label: "Страна", options: [{ label: "Все", value: "all" }] },
      { key: "is_common_in_kz", label: "Распространена в РК", options: [{ label: "Все", value: "all" }, { label: "Да", value: "true" }, { label: "Нет", value: "false" }] },
      { key: "is_active", label: "Активность", options: activeFilterOptions },
    ],
    formFields: [
      { key: "name", label: "Сорт", type: "text", required: true },
      { key: "crop_id", label: "Культура", type: "select", required: true, optionsEntity: "crops" },
      { key: "originator_id", label: "Оригинатор", type: "select", optionsEntity: "seed_originators" },
      { key: "origin_country", label: "Страна", type: "text" },
      { key: "variety_type", label: "Тип", type: "text" },
      { key: "maturity_group", label: "Группа спелости", type: "text" },
      { key: "purpose", label: "Назначение", type: "text" },
      { key: "skin_color", label: "Цвет кожуры", type: "text" },
      { key: "flesh_color", label: "Цвет мякоти", type: "text" },
      { key: "storage_quality", label: "Лёжкость", type: "text" },
      { key: "source_url", label: "Источник", type: "text" },
      { key: "notes", label: "Заметки", type: "text" },
      { key: "is_common_in_kz", label: "Распространена в РК", type: "checkbox" },
      { key: "is_active", label: "Активен", type: "checkbox" },
    ],
  },
  seed_originators: {
    entity: "seed_originators",
    title: "Глобальный каталог оригинаторов",
    description: "Оригинаторы и селекционные компании сортов. Это не поставщики семян.",
    createLabel: "Добавить оригинатора",
    searchPlaceholder: "Поиск по названию, стране, сайту...",
    columns: [
      { key: "name", label: "Оригинатор" },
      { key: "country", label: "Страна" },
      { key: "website", label: "Сайт" },
      { key: "notes", label: "Заметки" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [
      { key: "country", label: "Страна", options: [{ label: "Все", value: "all" }] },
      { key: "is_active", label: "Активность", options: activeFilterOptions },
    ],
    formFields: [
      { key: "name", label: "Оригинатор", type: "text", required: true },
      { key: "country", label: "Страна", type: "text" },
      { key: "website", label: "Сайт", type: "text" },
      { key: "notes", label: "Заметки", type: "text" },
      { key: "is_active", label: "Активен", type: "checkbox" },
    ],
  },
  seed_reproductions: {
    entity: "seed_reproductions",
    title: "Глобальный каталог репродукций",
    description: "Уровни репродукций семян.",
    createLabel: "Добавить репродукцию",
    searchPlaceholder: "Поиск по названию, описанию...",
    columns: [
      { key: "name", label: "Название" },
      { key: "level_order", label: "Порядок уровня" },
      { key: "description", label: "Описание" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [{ key: "is_active", label: "Активность", options: activeFilterOptions }],
    formFields: [
      { key: "name", label: "Название", type: "text", required: true },
      { key: "level_order", label: "Порядок уровня", type: "number", required: true },
      { key: "description", label: "Описание", type: "text" },
      { key: "is_active", label: "Активна", type: "checkbox" },
    ],
  },
  seeds: {
    entity: "seeds",
    title: "Глобальный каталог семян",
    description: "Каталог семенных товаров без локальных складских остатков.",
    createLabel: "Добавить семена",
    searchPlaceholder: "Поиск по названию, культуре, сорту, репродукции...",
    columns: [
      { key: "name", label: "Товар" },
      { key: "crop_name", label: "Культура" },
      { key: "variety_name", label: "Сорт" },
      { key: "originator_name", label: "Оригинатор" },
      { key: "reproduction_name", label: "Репродукция" },
      { key: "unit", label: "Ед. учета" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [
      { key: "crop_id", label: "Культура", options: [{ label: "Все", value: "all" }], optionsEntity: "crops" },
      { key: "variety_id", label: "Сорт", options: [{ label: "Все", value: "all" }], optionsEntity: "varieties" },
      { key: "seed_reproduction_id", label: "Репродукция", options: [{ label: "Все", value: "all" }], optionsEntity: "seed_reproductions" },
      { key: "is_active", label: "Активность", options: activeFilterOptions },
    ],
    formFields: [
      { key: "name", label: "Название семян", type: "text", required: true },
      { key: "crop_id", label: "Культура", type: "select", required: true, optionsEntity: "crops" },
      { key: "variety_id", label: "Сорт", type: "select", optionsEntity: "varieties" },
      { key: "seed_reproduction_id", label: "Репродукция", type: "select", optionsEntity: "seed_reproductions" },
      { key: "unit", label: "Ед. учета", type: "select", options: seedUnitOptions },
      { key: "base_uom", label: "Базовая ед.", type: "select", options: seedUnitOptions },
      { key: "manufacturer", label: "Бренд / производитель", type: "text" },
      { key: "notes", label: "Заметки", type: "text" },
      { key: "is_active", label: "Активны", type: "checkbox" },
    ],
  },
  diseases: {
    entity: "diseases",
    title: "Глобальный каталог болезней",
    description: "Справочник болезней культур. Вредители, сорняки и связи с препаратами ведутся отдельно.",
    createLabel: "Добавить болезнь",
    searchPlaceholder: "Поиск по названию, латинскому названию, симптомам...",
    columns: [
      { key: "name_ru", label: "Название" },
      { key: "name_en", label: "Название EN" },
      { key: "latin_name", label: "Латинское название" },
      { key: "disease_type", label: "Тип болезни" },
      { key: "pathogen_type", label: "Тип патогена" },
      { key: "risk_stage", label: "Фаза риска" },
      { key: "confidence", label: "Достоверность" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [
      { key: "disease_type", label: "Тип болезни", options: diseaseTypeFilterOptions },
      { key: "pathogen_type", label: "Тип патогена", options: pathogenTypeFilterOptions },
      { key: "confidence", label: "Достоверность", options: confidenceFilterOptions },
      { key: "is_active", label: "Активность", options: activeFilterOptions },
    ],
    formFields: [
      { key: "name_ru", label: "Название RU", type: "text", required: true },
      { key: "name_en", label: "Название EN", type: "text" },
      { key: "latin_name", label: "Латинское название", type: "text" },
      { key: "disease_type", label: "Тип болезни", type: "select", required: true, options: diseaseTypeOptions },
      { key: "pathogen_type", label: "Тип патогена", type: "select", required: true, options: pathogenTypeOptions },
      { key: "symptoms", label: "Симптомы", type: "text" },
      { key: "development_conditions", label: "Условия развития", type: "text" },
      { key: "risk_stage", label: "Фаза риска", type: "text" },
      { key: "source_url", label: "Источник", type: "text" },
      { key: "confidence", label: "Достоверность", type: "select", options: confidenceOptions },
      { key: "image_url", label: "Основное изображение", type: "text" },
      { key: "notes", label: "Заметки", type: "text" },
      { key: "is_active", label: "Активна", type: "checkbox" },
    ],
  },
  pesticides: {
    entity: "pesticides",
    title: "Глобальный каталог пестицидов",
    description: "Мастер-список СЗР, доступный для компаний.",
    createLabel: "Добавить пестицид",
    searchPlaceholder: "Поиск по названию, ДВ, формуляции, производителю...",
    columns: defaultAgrochemColumns,
    filters: defaultAgrochemFilters,
    formFields: defaultAgrochemFormFields,
  },
  fertilizers: {
    entity: "fertilizers",
    title: "Глобальный каталог удобрений",
    description: "Мастер-список удобрений платформы.",
    createLabel: "Добавить удобрение",
    searchPlaceholder: "Поиск по названию, ДВ, формуляции, производителю...",
    columns: [
      ...defaultAgrochemColumns.slice(0, 4),
      { key: "fertilizer_type", label: "Тип удобрения" },
      ...defaultAgrochemColumns.slice(4),
    ],
    filters: [
      ...defaultAgrochemFilters,
      { key: "fertilizer_type", label: "Тип удобрения", options: [{ label: "Все", value: "all" }, ...fertilizerTypeOptions] },
    ],
    formFields: [
      ...defaultAgrochemFormFields,
      { key: "fertilizer_type", label: "Тип удобрения", type: "select", required: true, options: fertilizerTypeOptions },
    ],
  },
  additives: {
    entity: "additives",
    title: "Глобальный каталог добавок",
    description: "Адъюванты, корректоры pH, кондиционеры воды и прочие вспомогательные материалы.",
    createLabel: "Добавить добавку",
    searchPlaceholder: "Поиск по названию, подтипу, формуляции, производителю...",
    columns: additiveColumns,
    filters: additiveFilters,
    formFields: additiveFormFields,
  },
  growth_regulators: {
    entity: "growth_regulators",
    title: "Глобальный каталог регуляторов роста",
    description: "Мастер-список регуляторов роста.",
    createLabel: "Добавить регулятор роста",
    searchPlaceholder: "Поиск по названию, ДВ, формуляции, производителю...",
    columns: defaultAgrochemColumns,
    filters: defaultAgrochemFilters,
    formFields: defaultAgrochemFormFields,
  },
  pesticide_categories: {
    entity: "pesticide_categories",
    title: "Категории пестицидов",
    description: "Справочник категорий агрохимии.",
    createLabel: "Добавить категорию",
    searchPlaceholder: "Поиск по названию, slug, описанию...",
    columns: [
      { key: "name_ru", label: "Название (RU)" },
      { key: "name_en", label: "Название (EN)" },
      { key: "slug", label: "Slug" },
      { key: "description", label: "Описание" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [{ key: "is_active", label: "Активность", options: activeFilterOptions }],
    formFields: [
      { key: "name_ru", label: "Название (RU)", type: "text", required: true },
      { key: "name_en", label: "Название (EN)", type: "text" },
      { key: "slug", label: "Slug", type: "text", required: true },
      { key: "description", label: "Описание", type: "text" },
      { key: "is_active", label: "Активна", type: "checkbox" },
    ],
  },
  active_ingredients: {
    entity: "active_ingredients",
    title: "Действующие вещества",
    description: "Справочник действующих веществ.",
    createLabel: "Добавить ДВ",
    searchPlaceholder: "Поиск по названию, slug...",
    columns: [
      { key: "name_ru", label: "Название (RU)" },
      { key: "name_en", label: "Название (EN)" },
      { key: "slug", label: "Slug" },
      { key: "ingredient_type", label: "Тип" },
      { key: "description", label: "Описание" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [
      { key: "ingredient_type", label: "Тип", options: [{ label: "Все", value: "all" }, ...activeIngredientTypeOptions] },
      { key: "is_active", label: "Активность", options: activeFilterOptions },
    ],
    formFields: [
      { key: "name_ru", label: "Название (RU)", type: "text", required: true },
      { key: "name_en", label: "Название (EN)", type: "text" },
      { key: "slug", label: "Slug", type: "text", required: true },
      { key: "ingredient_type", label: "Тип", type: "select", required: true, options: activeIngredientTypeOptions },
      { key: "description", label: "Описание", type: "text" },
      { key: "is_active", label: "Активно", type: "checkbox" },
    ],
  },
  agrochem_manufacturers: {
    entity: "agrochem_manufacturers",
    title: "Производители",
    description: "Справочник производителей агрохимии.",
    createLabel: "Добавить производителя",
    searchPlaceholder: "Поиск по названию...",
    columns: [
      { key: "name", label: "Название" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [{ key: "is_active", label: "Активность", options: activeFilterOptions }],
    formFields: [
      { key: "name", label: "Название", type: "text", required: true },
      { key: "is_active", label: "Активно", type: "checkbox" },
    ],
  },
  agrochem_formulations: {
    entity: "agrochem_formulations",
    title: "Формуляции",
    description: "Справочник формуляций (SL, EC, SC, WG).",
    createLabel: "Добавить формуляцию",
    searchPlaceholder: "Поиск по коду и названию...",
    columns: [
      { key: "code", label: "Код" },
      { key: "name_ru", label: "Название" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [{ key: "is_active", label: "Активность", options: activeFilterOptions }],
    formFields: [
      { key: "code", label: "Код", type: "text", required: true },
      { key: "name_ru", label: "Название", type: "text", required: true },
      { key: "is_active", label: "Активно", type: "checkbox" },
    ],
  },
  agrochem_mode_of_actions: {
    entity: "agrochem_mode_of_actions",
    title: "Типы действия",
    description: "Справочник типов действия препаратов.",
    createLabel: "Добавить тип действия",
    searchPlaceholder: "Поиск по названию...",
    columns: [
      { key: "name_ru", label: "Название" },
      { key: "slug", label: "Slug" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [{ key: "is_active", label: "Активность", options: activeFilterOptions }],
    formFields: [
      { key: "name_ru", label: "Название", type: "text", required: true },
      { key: "slug", label: "Slug", type: "text", required: true },
      { key: "is_active", label: "Активно", type: "checkbox" },
    ],
  },
  agricultural_machine_models: {
    entity: "agricultural_machine_models",
    title: "Глобальный каталог сельхозмашин",
    description: "Глобальный мастер-каталог самоходной техники, картофельной техники и агрегатов.",
    createLabel: "Добавить модель",
    searchPlaceholder: "Поиск по полному названию, бренду, серии, модели...",
    columns: [
      { key: "full_name", label: "Полное название" },
      { key: "asset_group", label: "Группа" },
      { key: "category", label: "Категория" },
      { key: "brand", label: "Бренд" },
      { key: "series", label: "Серия" },
      { key: "model", label: "Модель" },
      { key: "power_hp", label: "Мощность (л.с.)" },
      { key: "required_power_hp", label: "Требуемая мощность" },
      { key: "working_width_m", label: "Ширина (м)" },
      { key: "grain_tank_l", label: "Бункер (л)" },
      { key: "tank_volume_l", label: "Бак (л)" },
      { key: "tank_capacity_l", label: "Ёмкость бака (л)" },
      { key: "rows_count", label: "Рядов" },
      { key: "capacity", label: "Производительность" },
      { key: "power_class", label: "Класс мощности" },
      { key: "dealer_name", label: "Дилер" },
      { key: "presence_in_kz", label: "Наличие в РК" },
      { key: "source_type", label: "Источник" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [
      {
        key: "category",
        label: "Категория",
        options: agriculturalMachineCategoryFilterOptions,
      },
      { key: "asset_group", label: "Группа", options: machineryAssetGroupFilterOptions },
      { key: "brand", label: "Бренд", options: [{ label: "Все", value: "all" }] },
      { key: "series", label: "Серия", options: [{ label: "Все", value: "all" }] },
      { key: "is_active", label: "Активность", options: activeFilterOptions },
    ],
    formFields: [
      {
        key: "category",
        label: "Категория",
        type: "select",
        required: true,
        options: agriculturalMachineCategoryOptions,
      },
      {
        key: "asset_group",
        label: "Группа техники",
        type: "select",
        required: true,
        options: machineryAssetGroupOptions,
      },
      { key: "brand", label: "Бренд", type: "text", required: true },
      { key: "series", label: "Серия", type: "text" },
      { key: "model", label: "Модель", type: "text", required: true },
      { key: "power_hp", label: "Мощность (л.с.)", type: "number" },
      { key: "required_power_hp", label: "Требуемая мощность трактора (л.с.)", type: "number" },
      { key: "engine", label: "Двигатель", type: "text" },
      { key: "transmission", label: "Трансмиссия", type: "text" },
      { key: "weight_kg", label: "Масса (кг)", type: "number" },
      { key: "fuel_tank_l", label: "Топливный бак (л)", type: "number" },
      { key: "tank_volume_l", label: "Объем бака (л)", type: "number" },
      { key: "tank_capacity_l", label: "Ёмкость бака / бункера (л)", type: "number" },
      { key: "grain_tank_l", label: "Объем зернобункера (л)", type: "number" },
      { key: "working_width_m", label: "Рабочая ширина (м)", type: "number" },
      { key: "rows_count", label: "Количество рядов", type: "number" },
      { key: "capacity", label: "Производительность / вместимость", type: "text" },
      { key: "power_class", label: "Класс мощности", type: "text" },
      { key: "dealer_name", label: "Дилер в РК", type: "text" },
      { key: "presence_in_kz", label: "Есть на рынке РК", type: "checkbox" },
      {
        key: "source_type",
        label: "Тип источника",
        type: "select",
        options: [
          { label: "Производитель", value: "manufacturer" },
          { label: "Официальный дилер", value: "official_dealer" },
          { label: "Реестр", value: "registry" },
          { label: "Импорт данных", value: "import_feed" },
          { label: "Ручной ввод", value: "manual" },
        ],
      },
      { key: "source_url", label: "Ссылка на источник", type: "text" },
      { key: "notes", label: "Примечания", type: "text" },
      { key: "is_active", label: "Активна", type: "checkbox" },
    ],
  },
  machinery: {
    entity: "machinery",
    title: "Каталог техники",
    description: "Машинный двор: техника для работ.",
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
      { key: "model", label: "Модель", type: "text", required: true },
      { key: "machine_category", label: "Категория", type: "text" },
      { key: "machine_type", label: "Тип", type: "text" },
      { key: "key_parameter", label: "Ключевой параметр", type: "text" },
      { key: "is_active", label: "Активна", type: "checkbox" },
    ],
  },
  implements: {
    entity: "implements",
    title: "Каталог агрегатов",
    description: "Оборудование и агрегаты.",
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
    title: "Каталог автопарка",
    description: "Шаблоны транспортных единиц.",
    createLabel: "Добавить транспорт",
    searchPlaceholder: "Поиск по названию, бренду, модели...",
    columns: [
      { key: "full_name", label: "Полное название" },
      { key: "brand", label: "Бренд" },
      { key: "series", label: "Серия" },
      { key: "model", label: "Модель" },
      { key: "category", label: "Категория" },
      { key: "engine", label: "Двигатель" },
      { key: "dealer_name", label: "Дилер" },
      { key: "presence_in_kz", label: "Наличие в РК" },
      { key: "notes", label: "Примечание" },
      { key: "is_active", label: "Активность" },
    ],
    filters: [
      { key: "category", label: "Категория", options: [{ label: "Все", value: "all" }, { label: "Легковой транспорт", value: "light_vehicle" }, { label: "Грузовик", value: "truck" }, { label: "Седельный тягач", value: "tractor_unit" }, { label: "Прицеп", value: "trailer" }, { label: "Автобус", value: "bus" }, { label: "Спецтранспорт", value: "special_vehicle" }] },
      { key: "brand", label: "Бренд", options: [{ label: "Все", value: "all" }] },
      { key: "is_active", label: "Активность", options: activeFilterOptions },
    ],
    formFields: [
      { key: "brand", label: "Бренд", type: "text" },
      { key: "series", label: "Серия", type: "text" },
      { key: "model", label: "Модель", type: "text" },
      { key: "category", label: "Категория", type: "select", required: true, options: [{ label: "Легковой транспорт", value: "light_vehicle" }, { label: "Грузовик", value: "truck" }, { label: "Седельный тягач", value: "tractor_unit" }, { label: "Прицеп", value: "trailer" }, { label: "Автобус", value: "bus" }, { label: "Спецтранспорт", value: "special_vehicle" }] },
      { key: "engine", label: "Двигатель", type: "text" },
      { key: "dealer_name", label: "Дилер", type: "text" },
      { key: "presence_in_kz", label: "Наличие в РК", type: "checkbox" },
      { key: "notes", label: "Примечание", type: "text" },
      { key: "is_active", label: "Активен", type: "checkbox" },
    ],
  },
};

export function getCatalogConfig(entity: GlobalCatalogEntity): GlobalCatalogConfig {
  return GLOBAL_CATALOG_CONFIGS[entity];
}
