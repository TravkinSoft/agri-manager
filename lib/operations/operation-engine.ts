import type { OperationMaterialType, OperationMaterialUnit } from "@/lib/types/operation";

export type CanonicalOperationTypeSlug =
  | "soil_operation"
  | "planting"
  | "fertilizer_application"
  | "spraying"
  | "fertigation"
  | "irrigation"
  | "scouting"
  | "sampling"
  | "harvesting"
  | "transport"
  | "post_harvest"
  | "service_operation"
  | "logistics_operation"
  | "post_harvest_operation";

export type OperationPurposeSlug =
  | "weed_control"
  | "disease_control"
  | "insect_control"
  | "desiccation"
  | "defoliation"
  | "growth_regulation"
  | "foliar_feeding"
  | "anti_stress"
  | "base_fertilization"
  | "starter_fertilization"
  | "top_dressing"
  | "fertigation"
  | "seed_treatment"
  | "irrigation"
  | "harvest"
  | "transport"
  | "monitoring"
  | "other";

export type TankMixComponentType =
  | "seed"
  | "crop_protection"
  | "fertilizer"
  | "micro_fertilizer"
  | "biological"
  | "biostimulant"
  | "adjuvant"
  | "ph_corrector"
  | "antifoam"
  | "water"
  | "other";

export type FertilizerApplicationMethod = "broadcast" | "banded" | "liquid" | "foliar";

export type IrrigationType = "drip" | "sprinkler" | "dryland" | "unknown";

export type OperationTechniqueSlug =
  | "tractor_implement"
  | "ground_boom_sprayer"
  | "self_propelled_sprayer"
  | "uav"
  | "aircraft"
  | "spreader"
  | "applicator"
  | "seed_drill"
  | "precision_planter"
  | "potato_planter"
  | "combine"
  | "potato_harvester"
  | "truck"
  | "irrigation_system";

export type OperationTypeDefinition = {
  slug: CanonicalOperationTypeSlug;
  categorySlug: string;
  label: string;
  description: string;
  requiresCropStructure: boolean;
  requiresMachine: boolean;
  affectsWarehouse: boolean;
  affectsFieldHistory: boolean;
  supportsPurposes: boolean;
  supportsTankMix: boolean;
  supportsMaterials: boolean;
  defaultComponentType: TankMixComponentType;
  legacyCategorySlugs: string[];
  legacyTypeSlugs: string[];
  keywords: string[];
};

export type OperationSubtypeDefinition = {
  slug: string;
  categorySlug: CanonicalOperationTypeSlug;
  label: string;
};

export type OperationAvailabilityInput = {
  cropName?: string | null;
  varietyName?: string | null;
  cropGroup?: string | null;
  irrigationType?: IrrigationType | string | null;
  hasCropStructure?: boolean;
};

export type OperationAvailabilityResult = {
  allowed: boolean;
  reason: string | null;
};

export type OperationPurposeDefinition = {
  slug: OperationPurposeSlug;
  label: string;
  operationTypes: CanonicalOperationTypeSlug[];
};

export type OperationTechniqueDefinition = {
  slug: OperationTechniqueSlug;
  label: string;
  operationTypes: CanonicalOperationTypeSlug[];
};

export type TankMixComponentDefinition = {
  slug: TankMixComponentType;
  label: string;
  storageMaterialType: OperationMaterialType;
  defaultUnit: OperationMaterialUnit;
  productRequired: boolean;
};

export const OPERATION_TYPE_DEFINITIONS: OperationTypeDefinition[] = [
  {
    slug: "soil_operation",
    categorySlug: "soil_operation",
    label: "Почвообработка",
    description: "Механическая обработка почвы перед посевом или уходом за культурой.",
    requiresCropStructure: true,
    requiresMachine: true,
    affectsWarehouse: false,
    affectsFieldHistory: true,
    supportsPurposes: false,
    supportsTankMix: false,
    supportsMaterials: false,
    defaultComponentType: "other",
    legacyCategorySlugs: ["soil_preparation"],
    legacyTypeSlugs: ["soil_preparation", "tillage", "cultivation"],
    keywords: ["soil", "tillage", "cultivation", "диск", "культива", "борон", "почв"],
  },
  {
    slug: "planting",
    categorySlug: "planting",
    label: "Посев / посадка",
    description: "Посев или посадка культуры с семенами, удобрениями и протравителем в одной операции.",
    requiresCropStructure: true,
    requiresMachine: true,
    affectsWarehouse: true,
    affectsFieldHistory: true,
    supportsPurposes: true,
    supportsTankMix: false,
    supportsMaterials: true,
    defaultComponentType: "seed",
    legacyCategorySlugs: ["seeding_planting"],
    legacyTypeSlugs: ["seeding", "planting"],
    keywords: ["seed", "sow", "plant", "посев", "посад"],
  },
  {
    slug: "fertilizer_application",
    categorySlug: "fertilizer_application",
    label: "Внесение удобрений",
    description: "Разбрасывание, локальное, жидкое или листовое внесение. Через опрыскиватель оформляется как опрыскивание.",
    requiresCropStructure: true,
    requiresMachine: true,
    affectsWarehouse: true,
    affectsFieldHistory: true,
    supportsPurposes: false,
    supportsTankMix: false,
    supportsMaterials: true,
    defaultComponentType: "fertilizer",
    legacyCategorySlugs: ["fertilization"],
    legacyTypeSlugs: ["fertilizing", "fertilization"],
    keywords: ["fertiliz", "удобрен", "npk", "карбамид"],
  },
  {
    slug: "spraying",
    categorySlug: "spraying",
    label: "Опрыскивание",
    description: "Один проход опрыскивателя: несколько целей и несколько компонентов баковой смеси.",
    requiresCropStructure: true,
    requiresMachine: true,
    affectsWarehouse: true,
    affectsFieldHistory: true,
    supportsPurposes: true,
    supportsTankMix: true,
    supportsMaterials: true,
    defaultComponentType: "crop_protection",
    legacyCategorySlugs: ["plant_protection", "crop_care"],
    legacyTypeSlugs: ["spraying", "plant_protection", "crop_care"],
    keywords: ["spray", "spraying", "опрыск", "сзр", "гербиц", "фунгиц", "инсект"],
  },
  {
    slug: "fertigation",
    categorySlug: "fertigation",
    label: "Фертигация",
    description: "Внесение питания через поливную систему с раствором и компонентами смеси.",
    requiresCropStructure: true,
    requiresMachine: true,
    affectsWarehouse: true,
    affectsFieldHistory: true,
    supportsPurposes: true,
    supportsTankMix: true,
    supportsMaterials: true,
    defaultComponentType: "fertilizer",
    legacyCategorySlugs: ["irrigation"],
    legacyTypeSlugs: ["fertigation"],
    keywords: ["fertigation", "фертигац"],
  },
  {
    slug: "irrigation",
    categorySlug: "irrigation",
    label: "Полив",
    description: "Подача воды через систему орошения без питания или химизации.",
    requiresCropStructure: true,
    requiresMachine: true,
    affectsWarehouse: false,
    affectsFieldHistory: true,
    supportsPurposes: false,
    supportsTankMix: false,
    supportsMaterials: false,
    defaultComponentType: "water",
    legacyCategorySlugs: ["irrigation"],
    legacyTypeSlugs: ["irrigation"],
    keywords: ["irrigation", "полив", "орош"],
  },
  {
    slug: "scouting",
    categorySlug: "scouting",
    label: "Осмотр поля",
    description: "Мониторинг состояния поля, вредителей, болезней и развития культуры.",
    requiresCropStructure: true,
    requiresMachine: false,
    affectsWarehouse: false,
    affectsFieldHistory: true,
    supportsPurposes: true,
    supportsTankMix: false,
    supportsMaterials: false,
    defaultComponentType: "other",
    legacyCategorySlugs: ["monitoring", "crop_scouting"],
    legacyTypeSlugs: ["scouting", "monitoring"],
    keywords: ["scouting", "monitoring", "осмотр", "монитор"],
  },
  {
    slug: "sampling",
    categorySlug: "sampling",
    label: "Отбор проб",
    description: "Отбор почвенных, растительных или товарных проб.",
    requiresCropStructure: true,
    requiresMachine: false,
    affectsWarehouse: false,
    affectsFieldHistory: true,
    supportsPurposes: false,
    supportsTankMix: false,
    supportsMaterials: false,
    defaultComponentType: "other",
    legacyCategorySlugs: ["sampling"],
    legacyTypeSlugs: ["sampling"],
    keywords: ["sampling", "sample", "проб"],
  },
  {
    slug: "harvesting",
    categorySlug: "harvesting",
    label: "Уборка",
    description: "Уборка урожая с подготовкой связи с весовой и партиями.",
    requiresCropStructure: true,
    requiresMachine: true,
    affectsWarehouse: true,
    affectsFieldHistory: true,
    supportsPurposes: false,
    supportsTankMix: false,
    supportsMaterials: false,
    defaultComponentType: "other",
    legacyCategorySlugs: ["harvesting"],
    legacyTypeSlugs: ["harvesting"],
    keywords: ["harvest", "уборк", "комбайн"],
  },
  {
    slug: "service_operation",
    categorySlug: "service_operation",
    label: "Сервисная операция",
    description: "Ремонт, обслуживание или внутренняя производственная задача без привязки к crop structure.",
    requiresCropStructure: false,
    requiresMachine: false,
    affectsWarehouse: false,
    affectsFieldHistory: false,
    supportsPurposes: false,
    supportsTankMix: false,
    supportsMaterials: false,
    defaultComponentType: "other",
    legacyCategorySlugs: ["service", "service_operations"],
    legacyTypeSlugs: ["service"],
    keywords: ["service", "repair", "сервис", "ремонт"],
  },
  {
    slug: "transport",
    categorySlug: "transport",
    label: "Логистика",
    description: "Перевозка, перемещение или доставка без агрономического факта поля.",
    requiresCropStructure: false,
    requiresMachine: false,
    affectsWarehouse: false,
    affectsFieldHistory: false,
    supportsPurposes: false,
    supportsTankMix: false,
    supportsMaterials: false,
    defaultComponentType: "other",
    legacyCategorySlugs: ["logistics", "logistics_operation"],
    legacyTypeSlugs: ["transport", "transport_task"],
    keywords: ["transport", "logistics", "перевоз", "логист"],
  },
  {
    slug: "post_harvest_operation",
    categorySlug: "post_harvest_operation",
    label: "Послеуборочная доработка",
    description: "Очистка, сушка, сортировка или обработка урожая после уборки.",
    requiresCropStructure: false,
    requiresMachine: false,
    affectsWarehouse: true,
    affectsFieldHistory: false,
    supportsPurposes: false,
    supportsTankMix: false,
    supportsMaterials: false,
    defaultComponentType: "other",
    legacyCategorySlugs: ["post_harvest", "post_harvest_operation", "processing"],
    legacyTypeSlugs: ["post_harvest_processing"],
    keywords: ["post_harvest", "processing", "сушка", "очист", "доработ"],
  },
];

export const OPERATION_SUBTYPE_DEFINITIONS: OperationSubtypeDefinition[] = [
  { categorySlug: "soil_operation", slug: "plant_residue_shredding", label: "Измельчение растительных остатков" },
  { categorySlug: "soil_operation", slug: "stubble_peeling", label: "Лущение" },
  { categorySlug: "soil_operation", slug: "disking", label: "Дискование" },
  { categorySlug: "soil_operation", slug: "heavy_disking", label: "Тяжелая дисковка" },
  { categorySlug: "soil_operation", slug: "cultivation", label: "Культивация" },
  { categorySlug: "soil_operation", slug: "interrow_cultivation", label: "Междурядная культивация" },
  { categorySlug: "soil_operation", slug: "deep_ripping", label: "Глубокое рыхление" },
  { categorySlug: "soil_operation", slug: "chiseling", label: "Чизелевание" },
  { categorySlug: "soil_operation", slug: "plowing", label: "Вспашка" },
  { categorySlug: "soil_operation", slug: "harrowing", label: "Боронование" },
  { categorySlug: "soil_operation", slug: "leveling", label: "Выравнивание" },
  { categorySlug: "soil_operation", slug: "rolling", label: "Прикатывание" },
  { categorySlug: "soil_operation", slug: "rotary_tilling", label: "Фрезерование" },
  { categorySlug: "soil_operation", slug: "ridge_forming", label: "Формирование гребней" },
  { categorySlug: "soil_operation", slug: "hilling", label: "Окучивание" },
  { categorySlug: "soil_operation", slug: "ridge_forming_with_drip_tape", label: "Гребнеобразование + укладка ленты" },
  { categorySlug: "soil_operation", slug: "furrow_cutting", label: "Нарезка борозд" },

  { categorySlug: "planting", slug: "seeding", label: "Посев" },
  { categorySlug: "planting", slug: "planting_generic", label: "Посадка" },
  { categorySlug: "planting", slug: "potato_planting", label: "Посадка картофеля" },
  { categorySlug: "planting", slug: "seeding_with_fertilizer", label: "Посев с удобрением" },
  { categorySlug: "planting", slug: "seeding_with_microgranules", label: "Посев с микрогранулятом" },
  { categorySlug: "planting", slug: "reseeding", label: "Пересев" },
  { categorySlug: "planting", slug: "overseeding", label: "Подсев" },

  { categorySlug: "spraying", slug: "herbicide_treatment", label: "Гербицидная обработка" },
  { categorySlug: "spraying", slug: "fungicide_treatment", label: "Фунгицидная обработка" },
  { categorySlug: "spraying", slug: "insecticide_treatment", label: "Инсектицидная обработка" },
  { categorySlug: "spraying", slug: "complex_tank_mix_treatment", label: "Комплексная баковая обработка" },
  { categorySlug: "spraying", slug: "desiccation_treatment", label: "Десикация" },
  { categorySlug: "spraying", slug: "defoliation", label: "Дефолиация" },
  { categorySlug: "spraying", slug: "growth_regulator_treatment", label: "Регулятор роста" },
  { categorySlug: "spraying", slug: "foliar_fertilization", label: "Листовая подкормка" },

  { categorySlug: "fertilizer_application", slug: "mineral_fertilizer_broadcast", label: "Разбрасывание минеральных удобрений" },
  { categorySlug: "fertilizer_application", slug: "organic_application", label: "Внесение органики" },
  { categorySlug: "fertilizer_application", slug: "localized_application", label: "Локальное внесение" },
  { categorySlug: "fertilizer_application", slug: "starter_fertilizer_application", label: "Припосевное внесение" },
  { categorySlug: "fertilizer_application", slug: "uas_application", label: "Внесение КАС" },
  { categorySlug: "fertilizer_application", slug: "liquid_fertilizer_application", label: "Внесение ЖКУ" },

  { categorySlug: "fertigation", slug: "fertigation_application", label: "Фертигация" },
  { categorySlug: "fertigation", slug: "drip_fertigation", label: "Фертигация через каплю" },
  { categorySlug: "fertigation", slug: "chemigation", label: "Химизация через полив" },

  { categorySlug: "irrigation", slug: "irrigation_cycle", label: "Полив" },
  { categorySlug: "irrigation", slug: "drip_irrigation", label: "Капельный полив" },
  { categorySlug: "irrigation", slug: "sprinkler_irrigation", label: "Дождевальный полив" },
  { categorySlug: "scouting", slug: "field_scouting", label: "Осмотр поля" },
  { categorySlug: "sampling", slug: "soil_sampling", label: "Отбор проб почвы" },
  { categorySlug: "sampling", slug: "plant_sampling", label: "Отбор проб растений" },

  { categorySlug: "harvesting", slug: "direct_combining", label: "Прямое комбайнирование" },
  { categorySlug: "harvesting", slug: "windrow_mowing", label: "Скашивание в валок" },
  { categorySlug: "harvesting", slug: "separate_harvesting", label: "Раздельная уборка" },
  { categorySlug: "harvesting", slug: "potato_lifting", label: "Подкоп картофеля" },
  { categorySlug: "harvesting", slug: "potato_harvesting", label: "Уборка картофеля" },
  { categorySlug: "harvesting", slug: "vegetable_harvesting", label: "Уборка овощей" },
  { categorySlug: "harvesting", slug: "grain_harvesting", label: "Уборка зерновых" },
  { categorySlug: "harvesting", slug: "windrow_pickup", label: "Подбор валков" },
  { categorySlug: "harvesting", slug: "tuber_harvesting", label: "Уборка клубнеплодов" },
  { categorySlug: "harvesting", slug: "silage_harvesting", label: "Уборка на силос" },
  { categorySlug: "harvesting", slug: "forage_mowing", label: "Кошение кормовых культур" },
  { categorySlug: "harvesting", slug: "tedding", label: "Ворошение" },
  { categorySlug: "harvesting", slug: "raking", label: "Сгребание" },
  { categorySlug: "harvesting", slug: "baling", label: "Прессование" },
  { categorySlug: "harvesting", slug: "straw_collection", label: "Сбор соломы" },

  { categorySlug: "service_operation", slug: "haulm_topping", label: "Удаление ботвы" },
  { categorySlug: "service_operation", slug: "drip_tape_collection", label: "Сбор капельной ленты" },
  { categorySlug: "service_operation", slug: "service_task", label: "Сервисная задача" },
  { categorySlug: "transport", slug: "transport_task", label: "Перевозка" },
  { categorySlug: "post_harvest_operation", slug: "post_harvest_tillage", label: "Послеуборочная обработка поля" },
  { categorySlug: "post_harvest_operation", slug: "tape_residue_collection", label: "Сбор остатков ленты" },
  { categorySlug: "post_harvest_operation", slug: "post_harvest_processing", label: "Послеуборочная доработка" },
];

export const OPERATION_PURPOSE_DEFINITIONS: OperationPurposeDefinition[] = [
  { slug: "weed_control", label: "Контроль сорняков", operationTypes: ["spraying"] },
  { slug: "disease_control", label: "Защита от болезней", operationTypes: ["spraying", "fertigation"] },
  { slug: "insect_control", label: "Защита от вредителей", operationTypes: ["spraying"] },
  { slug: "desiccation", label: "Десикация", operationTypes: ["spraying"] },
  { slug: "defoliation", label: "Дефолиация", operationTypes: ["spraying"] },
  { slug: "growth_regulation", label: "Регуляция роста", operationTypes: ["spraying"] },
  { slug: "foliar_feeding", label: "Листовая подкормка", operationTypes: ["spraying", "fertigation", "fertilizer_application"] },
  { slug: "anti_stress", label: "Антистресс", operationTypes: ["spraying", "fertigation"] },
  { slug: "base_fertilization", label: "Основное питание", operationTypes: ["fertilizer_application", "fertigation"] },
  { slug: "starter_fertilization", label: "Стартовое питание", operationTypes: ["fertilizer_application"] },
  { slug: "top_dressing", label: "Подкормка", operationTypes: ["fertilizer_application", "fertigation"] },
  { slug: "fertigation", label: "Фертигация", operationTypes: ["fertigation"] },
  { slug: "seed_treatment", label: "Протравливание семян", operationTypes: ["planting"] },
  { slug: "irrigation", label: "Полив", operationTypes: ["irrigation"] },
  { slug: "harvest", label: "Уборка", operationTypes: ["harvesting"] },
  { slug: "transport", label: "Перевозка", operationTypes: ["transport"] },
  { slug: "monitoring", label: "Мониторинг", operationTypes: ["scouting"] },
  { slug: "other", label: "Другая задача", operationTypes: ["fertilizer_application", "spraying", "fertigation", "scouting"] },
];

export const OPERATION_TECHNIQUE_DEFINITIONS: OperationTechniqueDefinition[] = [
  { slug: "tractor_implement", label: "Трактор + агрегат", operationTypes: ["soil_operation"] },
  { slug: "seed_drill", label: "Сеялка", operationTypes: ["planting"] },
  { slug: "precision_planter", label: "Точная сеялка", operationTypes: ["planting"] },
  { slug: "potato_planter", label: "Картофелесажалка", operationTypes: ["planting"] },
  { slug: "ground_boom_sprayer", label: "Штанговый опрыскиватель", operationTypes: ["spraying"] },
  { slug: "self_propelled_sprayer", label: "Самоходный опрыскиватель", operationTypes: ["spraying"] },
  { slug: "uav", label: "Дрон", operationTypes: ["spraying", "scouting"] },
  { slug: "aircraft", label: "Авиация", operationTypes: ["spraying"] },
  { slug: "spreader", label: "Разбрасыватель", operationTypes: ["fertilizer_application"] },
  { slug: "applicator", label: "Аппликатор", operationTypes: ["fertilizer_application"] },
  { slug: "irrigation_system", label: "Система полива", operationTypes: ["fertigation", "irrigation"] },
  { slug: "combine", label: "Комбайн", operationTypes: ["harvesting"] },
  { slug: "potato_harvester", label: "Картофелеуборочный комбайн", operationTypes: ["harvesting"] },
  { slug: "truck", label: "Грузовой транспорт", operationTypes: ["transport", "harvesting"] },
];

export const TANK_MIX_COMPONENT_DEFINITIONS: TankMixComponentDefinition[] = [
  { slug: "seed", label: "Семена / посадочный материал", storageMaterialType: "seed", defaultUnit: "kg", productRequired: true },
  { slug: "crop_protection", label: "СЗР", storageMaterialType: "pesticide", defaultUnit: "l", productRequired: true },
  { slug: "fertilizer", label: "Удобрение", storageMaterialType: "fertilizer", defaultUnit: "kg", productRequired: true },
  { slug: "micro_fertilizer", label: "Микроудобрение", storageMaterialType: "fertilizer", defaultUnit: "l", productRequired: true },
  { slug: "biological", label: "Биология", storageMaterialType: "biological", defaultUnit: "l", productRequired: true },
  { slug: "biostimulant", label: "Биостимулятор", storageMaterialType: "biological", defaultUnit: "l", productRequired: true },
  { slug: "adjuvant", label: "Адъювант / прилипатель", storageMaterialType: "adjuvant", defaultUnit: "l", productRequired: true },
  { slug: "ph_corrector", label: "pH-корректор", storageMaterialType: "ph_corrector", defaultUnit: "l", productRequired: true },
  { slug: "antifoam", label: "Пеногаситель", storageMaterialType: "defoamer", defaultUnit: "l", productRequired: true },
  { slug: "water", label: "Вода", storageMaterialType: "water", defaultUnit: "l", productRequired: false },
  { slug: "other", label: "Другое", storageMaterialType: "other", defaultUnit: "kg", productRequired: true },
];

export const FERTILIZER_APPLICATION_METHODS: Array<{
  slug: FertilizerApplicationMethod;
  label: string;
  hint: string;
}> = [
  { slug: "broadcast", label: "Разбрасывание", hint: "Разбрасыватель или аппликатор." },
  { slug: "banded", label: "Локальное внесение", hint: "В рядок, лентой или прикорневое." },
  { slug: "liquid", label: "Жидкое внесение", hint: "ЖКУ/КАС аппликатором, не опрыскивателем." },
  { slug: "foliar", label: "Листовое питание", hint: "Если через опрыскиватель, выберите тип Опрыскивание." },
];

export function getOperationTypeDefinition(slug: string | null | undefined): OperationTypeDefinition | null {
  const normalized = String(slug || "").trim().toLowerCase();
  if (!normalized) return null;
  return OPERATION_TYPE_DEFINITIONS.find((item) => item.slug === normalized) || null;
}

export function resolveCanonicalOperationType(input: {
  categorySlug?: string | null;
  typeSlug?: string | null;
  operationType?: string | null;
}): OperationTypeDefinition | null {
  const category = String(input.categorySlug || "").trim().toLowerCase();
  const type = String(input.typeSlug || "").trim().toLowerCase();
  const label = String(input.operationType || "").trim().toLowerCase();
  const direct = getOperationTypeDefinition(type) || getOperationTypeDefinition(category);
  if (direct) return direct;

  return (
    OPERATION_TYPE_DEFINITIONS.find(
      (item) =>
        item.legacyCategorySlugs.includes(category) ||
        item.legacyTypeSlugs.includes(type) ||
        item.keywords.some((token) => `${category} ${type} ${label}`.includes(token))
    ) || null
  );
}

export function getPurposeDefinitionsForOperation(
  slug: CanonicalOperationTypeSlug | string | null | undefined
): OperationPurposeDefinition[] {
  const canonical = getOperationTypeDefinition(slug)?.slug;
  if (!canonical) return [];
  return OPERATION_PURPOSE_DEFINITIONS.filter((item) => item.operationTypes.includes(canonical));
}

export function getTechniqueDefinitionsForOperation(
  slug: CanonicalOperationTypeSlug | string | null | undefined
): OperationTechniqueDefinition[] {
  const canonical = getOperationTypeDefinition(slug)?.slug;
  if (!canonical) return [];
  return OPERATION_TECHNIQUE_DEFINITIONS.filter((item) => item.operationTypes.includes(canonical));
}

export function getTankMixComponentDefinition(
  slug: TankMixComponentType | string | null | undefined
): TankMixComponentDefinition {
  const raw = String(slug || "").trim().toLowerCase();
  const normalized =
    raw === "pesticide"
      ? "crop_protection"
      : raw === "defoamer"
        ? "antifoam"
        : raw === "organic"
          ? "biological"
          : raw;
  return (
    TANK_MIX_COMPONENT_DEFINITIONS.find((item) => item.slug === normalized) ||
    TANK_MIX_COMPONENT_DEFINITIONS[TANK_MIX_COMPONENT_DEFINITIONS.length - 1]
  );
}

export function toStorageMaterialType(componentType: string | null | undefined): OperationMaterialType {
  return getTankMixComponentDefinition(componentType).storageMaterialType;
}

export function getDefaultUnitForComponent(componentType: string | null | undefined): OperationMaterialUnit {
  return getTankMixComponentDefinition(componentType).defaultUnit;
}

export function normalizePurposeList(values: unknown): OperationPurposeSlug[] {
  const source = Array.isArray(values) ? values : [];
  const allowed = new Set(OPERATION_PURPOSE_DEFINITIONS.map((item) => item.slug));
  const aliases: Record<string, OperationPurposeSlug> = {
    herbicide_control: "weed_control",
    fungicide_protection: "disease_control",
    insect_control: "insect_control",
    foliar_feeding: "foliar_feeding",
    anti_stress: "anti_stress",
    desiccation: "desiccation",
    growth_regulation: "growth_regulation",
    seed_treatment: "seed_treatment",
  };
  return Array.from(
    new Set(
      source
        .map((value) => String(value || "").trim())
        .map((value) => aliases[value] || value)
        .filter((value): value is OperationPurposeSlug => allowed.has(value as OperationPurposeSlug))
    )
  );
}

const POTATO_TEMPLATES = new Set([
  "potato_planting",
  "planting_generic",
  "ridge_forming_with_drip_tape",
  "drip_irrigation",
  "sprinkler_irrigation",
  "drip_fertigation",
  "drip_tape_collection",
  "tape_residue_collection",
  "potato_lifting",
  "potato_harvesting",
  "haulm_topping",
]);

const DRIP_ONLY_TEMPLATES = new Set([
  "ridge_forming_with_drip_tape",
  "drip_irrigation",
  "drip_fertigation",
  "drip_tape_collection",
  "tape_residue_collection",
]);

const SPRINKLER_ONLY_TEMPLATES = new Set(["sprinkler_irrigation"]);

const IRRIGATION_TEMPLATES = new Set(["irrigation_cycle", "drip_irrigation", "sprinkler_irrigation"]);

export function normalizeIrrigationType(value: IrrigationType | string | null | undefined): IrrigationType {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "drip") return "drip";
  if (normalized === "sprinkler") return "sprinkler";
  if (normalized === "dryland") return "dryland";
  return "unknown";
}

export function getIrrigationTypeLabel(value: IrrigationType | string | null | undefined): string {
  const normalized = normalizeIrrigationType(value);
  if (normalized === "drip") return "Капельное";
  if (normalized === "sprinkler") return "Дождевание";
  if (normalized === "dryland") return "Богара";
  return "Не указано";
}

const POTATO_CONTEXT_KEYWORDS = [
  "\u043a\u0430\u0440\u0442\u043e\u0444",
  "potato",
  "\u0433\u0430\u043b\u0430",
  "gala",
  "\u0440\u0435\u0434 \u0441\u043a\u0430\u0440\u043b\u0435\u0442",
  "red scarlet",
  "red scarlett",
  "\u0441\u0430\u043d\u0442\u044d",
  "sante",
  "\u0441\u0430\u043d\u0442\u0435",
  "\u0440\u0438\u0432\u044c\u0435\u0440\u0430",
  "riviera",
  "\u0430\u0434\u0440\u0435\u0442\u0442\u0430",
  "adretta",
  "\u043a\u043e\u043b\u043e\u043c\u0431\u043e",
  "colombo",
  "\u043d\u0435\u0432\u0441\u043a\u0438\u0439",
  "nevsky",
  "\u0430\u0440\u0438\u0437\u043e\u043d\u0430",
  "arizona",
];

export function isPotatoCropContext(
  cropName: string | null | undefined,
  varietyName?: string | null | undefined
): boolean {
  const normalized = `${cropName || ""} ${varietyName || ""}`.trim().toLowerCase();
  return POTATO_CONTEXT_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function isPotatoCropName(value: string | null | undefined): boolean {
  return isPotatoCropContext(value);
}

export function isPlantedCropContext(
  cropName: string | null | undefined,
  varietyName?: string | null | undefined
): boolean {
  return isPotatoCropContext(cropName, varietyName);
}

export function isPotatoTemplate(slug: string | null | undefined): boolean {
  return POTATO_TEMPLATES.has(String(slug || "").trim().toLowerCase());
}

export function isDripTapeTemplate(slug: string | null | undefined): boolean {
  return DRIP_ONLY_TEMPLATES.has(String(slug || "").trim().toLowerCase());
}

export function getOperationTemplateAvailability(
  input: OperationAvailabilityInput & {
    categorySlug?: string | null;
    typeSlug?: string | null;
    operationType?: string | null;
  }
): OperationAvailabilityResult {
  if (!input.hasCropStructure) return { allowed: true, reason: null };

  const category = String(input.categorySlug || "").trim().toLowerCase();
  const template = String(input.typeSlug || "").trim().toLowerCase();
  const canonical = resolveCanonicalOperationType({
    categorySlug: input.categorySlug,
    typeSlug: input.typeSlug,
    operationType: input.operationType,
  });
  const irrigationType = normalizeIrrigationType(input.irrigationType);
  const isPotato = isPotatoCropContext(input.cropName, input.varietyName);

  if (template === "planting_generic" && !isPlantedCropContext(input.cropName, input.varietyName)) {
    return { allowed: false, reason: "Для выбранной культуры используется посев, а не посадка." };
  }

  if ((template === "seeding" || template === "overseeding") && isPlantedCropContext(input.cropName, input.varietyName)) {
    return { allowed: false, reason: "Для выбранной культуры используется посадка, а не посев." };
  }

  if (POTATO_TEMPLATES.has(template) && !isPotato) {
    return { allowed: false, reason: "Работа относится к картофельной технологии." };
  }

  if (canonical?.slug === "fertigation" && irrigationType !== "drip") {
    return { allowed: false, reason: "Фертигация доступна только для капельного орошения." };
  }

  if (canonical?.slug === "irrigation" && irrigationType === "dryland") {
    return { allowed: false, reason: "Для богарного поля поливные операции недоступны." };
  }

  if (irrigationType === "dryland" && DRIP_ONLY_TEMPLATES.has(template)) {
    return { allowed: false, reason: "Для богарного поля капельная лента и фертигация недоступны." };
  }

  if (irrigationType === "sprinkler" && DRIP_ONLY_TEMPLATES.has(template)) {
    return { allowed: false, reason: "Для дождевания капельная лента и фертигация через каплю недоступны." };
  }

  if (irrigationType === "drip" && SPRINKLER_ONLY_TEMPLATES.has(template)) {
    return { allowed: false, reason: "Для капельного орошения дождевальный полив недоступен." };
  }

  if (irrigationType === "unknown") {
    if (DRIP_ONLY_TEMPLATES.has(template)) {
      return { allowed: false, reason: "Тип орошения не указан, поэтому капельные операции скрыты." };
    }
    if (SPRINKLER_ONLY_TEMPLATES.has(template)) {
      return { allowed: false, reason: "Тип орошения не указан, поэтому дождевальный полив скрыт." };
    }
  }

  if (irrigationType === "drip" && template === "ridge_forming") {
    return { allowed: true, reason: null };
  }

  if (irrigationType === "drip" && template === "irrigation_cycle") {
    return { allowed: false, reason: "Для капельного орошения используйте капельный полив." };
  }

  if (irrigationType === "sprinkler" && template === "irrigation_cycle") {
    return { allowed: false, reason: "Для дождевания используйте дождевальный полив." };
  }

  if ((category === "post_harvest" || category === "post_harvest_operation") && template === "post_harvest_processing") {
    return { allowed: true, reason: null };
  }

  return { allowed: true, reason: null };
}

export function getHiddenOperationTemplates(
  input: OperationAvailabilityInput
): Array<{ slug: string; label: string; reason: string }> {
  return OPERATION_SUBTYPE_DEFINITIONS
    .map((definition) => {
      const result = getOperationTemplateAvailability({
        ...input,
        categorySlug: definition.categorySlug,
        typeSlug: definition.slug,
        operationType: definition.label,
      });
      return result.allowed ? null : { slug: definition.slug, label: definition.label, reason: result.reason || "" };
    })
    .filter(Boolean) as Array<{ slug: string; label: string; reason: string }>;
}

export function shouldWarnUnknownIrrigation(input: OperationAvailabilityInput): boolean {
  return Boolean(input.hasCropStructure && normalizeIrrigationType(input.irrigationType) === "unknown");
}

export function isIrrigationTemplate(slug: string | null | undefined): boolean {
  return IRRIGATION_TEMPLATES.has(String(slug || "").trim().toLowerCase());
}

export function buildWarehouseWorkflowMetadata() {
  return {
    steps: [
      "operation_plan",
      "material_requirement",
      "warehouse_issue",
      "execution",
      "actual_consumption",
      "return",
      "field_history",
    ],
    issue_is_consumption: false,
  };
}

export function buildExecutionFactModelMetadata() {
  return {
    required_fields: ["issued_qty", "actual_qty", "returned_qty", "loss_qty", "comment"],
    issue_is_consumption: false,
  };
}
