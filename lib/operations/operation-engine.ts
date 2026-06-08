import type { OperationMaterialType, OperationMaterialUnit } from "@/lib/types/operation";

export type CanonicalOperationTypeSlug =
  | "soil_operation"
  | "planting"
  | "fertilizer_application"
  | "spraying"
  | "fertigation"
  | "harvesting"
  | "service_operation"
  | "logistics_operation"
  | "post_harvest_operation";

export type OperationPurposeSlug =
  | "fungicide_protection"
  | "insect_control"
  | "herbicide_control"
  | "foliar_feeding"
  | "anti_stress"
  | "desiccation"
  | "growth_regulation"
  | "seed_treatment"
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

export type OperationPurposeDefinition = {
  slug: OperationPurposeSlug;
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
    supportsPurposes: true,
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
    slug: "logistics_operation",
    categorySlug: "logistics_operation",
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
    legacyCategorySlugs: ["logistics"],
    legacyTypeSlugs: ["transport"],
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
    legacyCategorySlugs: ["post_harvest", "processing"],
    legacyTypeSlugs: ["post_harvest_processing"],
    keywords: ["post_harvest", "processing", "сушка", "очист", "доработ"],
  },
];

export const OPERATION_SUBTYPE_DEFINITIONS: OperationSubtypeDefinition[] = [
  { categorySlug: "soil_operation", slug: "stubble_peeling", label: "Лущение стерни" },
  { categorySlug: "soil_operation", slug: "disking", label: "Дисковка" },
  { categorySlug: "soil_operation", slug: "heavy_disking", label: "Тяжелая дисковка" },
  { categorySlug: "soil_operation", slug: "cultivation", label: "Культивация" },
  { categorySlug: "soil_operation", slug: "deep_ripping", label: "Глубокорыхление" },
  { categorySlug: "soil_operation", slug: "chiseling", label: "Чизелевание" },
  { categorySlug: "soil_operation", slug: "plowing", label: "Вспашка" },
  { categorySlug: "soil_operation", slug: "harrowing", label: "Боронование" },
  { categorySlug: "soil_operation", slug: "leveling", label: "Выравнивание" },
  { categorySlug: "soil_operation", slug: "rolling", label: "Прикатывание" },
  { categorySlug: "soil_operation", slug: "ridge_forming", label: "Формирование гребней" },
  { categorySlug: "soil_operation", slug: "furrow_cutting", label: "Нарезка борозд" },

  { categorySlug: "planting", slug: "grain_seeding", label: "Посев зерновых" },
  { categorySlug: "planting", slug: "oilseed_seeding", label: "Посев масличных" },
  { categorySlug: "planting", slug: "legume_seeding", label: "Посев бобовых" },
  { categorySlug: "planting", slug: "potato_planting", label: "Посадка картофеля" },
  { categorySlug: "planting", slug: "seeding_with_fertilizer", label: "Посев с внесением удобрений" },
  { categorySlug: "planting", slug: "seeding_with_microgranules", label: "Посев с микрогранулятом" },

  { categorySlug: "spraying", slug: "herbicide_treatment", label: "Гербицидная обработка" },
  { categorySlug: "spraying", slug: "fungicide_treatment", label: "Фунгицидная обработка" },
  { categorySlug: "spraying", slug: "insecticide_treatment", label: "Инсектицидная обработка" },
  { categorySlug: "spraying", slug: "complex_tank_mix_treatment", label: "Комплексная баковая обработка" },
  { categorySlug: "spraying", slug: "desiccation_treatment", label: "Десикация" },
  { categorySlug: "spraying", slug: "defoliation", label: "Дефолиация" },
  { categorySlug: "spraying", slug: "drone_treatment", label: "Дрон-обработка" },
  { categorySlug: "spraying", slug: "aerial_treatment", label: "Авиаобработка" },

  { categorySlug: "fertilizer_application", slug: "mineral_fertilizer_broadcast", label: "Разбрасывание минеральных удобрений" },
  { categorySlug: "fertilizer_application", slug: "organic_application", label: "Внесение органики" },
  { categorySlug: "fertilizer_application", slug: "localized_application", label: "Локальное внесение" },
  { categorySlug: "fertilizer_application", slug: "starter_fertilizer_application", label: "Припосевное внесение" },
  { categorySlug: "fertilizer_application", slug: "uas_application", label: "Внесение КАС" },
  { categorySlug: "fertilizer_application", slug: "liquid_fertilizer_application", label: "Внесение ЖКУ" },
  { categorySlug: "fertilizer_application", slug: "foliar_fertilization", label: "Листовая подкормка" },

  { categorySlug: "fertigation", slug: "fertigation", label: "Фертигация" },
  { categorySlug: "fertigation", slug: "chemigation", label: "Химизация через полив" },

  { categorySlug: "harvesting", slug: "direct_combining", label: "Прямое комбайнирование" },
  { categorySlug: "harvesting", slug: "separate_harvesting", label: "Раздельная уборка" },
  { categorySlug: "harvesting", slug: "potato_harvesting", label: "Уборка картофеля" },
  { categorySlug: "harvesting", slug: "vegetable_harvesting", label: "Уборка овощей" },
  { categorySlug: "harvesting", slug: "grain_harvesting", label: "Уборка зерновых" },
  { categorySlug: "harvesting", slug: "windrow_pickup", label: "Подбор валков" },

  { categorySlug: "service_operation", slug: "service_task", label: "Сервисная задача" },
  { categorySlug: "logistics_operation", slug: "transport_task", label: "Перевозка" },
  { categorySlug: "post_harvest_operation", slug: "post_harvest_processing", label: "Послеуборочная доработка" },
];

export const OPERATION_PURPOSE_DEFINITIONS: OperationPurposeDefinition[] = [
  { slug: "fungicide_protection", label: "Защита от болезней", operationTypes: ["spraying", "fertigation"] },
  { slug: "insect_control", label: "Контроль вредителей", operationTypes: ["spraying"] },
  { slug: "herbicide_control", label: "Контроль сорняков", operationTypes: ["spraying"] },
  { slug: "foliar_feeding", label: "Листовое питание", operationTypes: ["spraying", "fertigation", "fertilizer_application"] },
  { slug: "anti_stress", label: "Антистресс", operationTypes: ["spraying", "fertigation"] },
  { slug: "desiccation", label: "Десикация", operationTypes: ["spraying", "harvesting"] },
  { slug: "growth_regulation", label: "Регуляция роста", operationTypes: ["spraying"] },
  { slug: "seed_treatment", label: "Протравливание семян", operationTypes: ["planting", "spraying"] },
  {
    slug: "other",
    label: "Другая цель",
    operationTypes: ["planting", "fertilizer_application", "spraying", "fertigation", "harvesting"],
  },
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
  return Array.from(
    new Set(source.map((value) => String(value || "").trim()).filter((value): value is OperationPurposeSlug => allowed.has(value as OperationPurposeSlug)))
  );
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
