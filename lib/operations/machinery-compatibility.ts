type AssetKind = "machine" | "equipment";

export type MachineryAssetLike = {
  id?: string | null;
  name?: string | null;
  type?: string | null;
  category?: string | null;
  machine_category?: string | null;
  machinery_type?: string | null;
  equipment_category?: string | null;
  equipment_type?: string | null;
  global_model?: Record<string, unknown> | Record<string, unknown>[] | null;
};

type CompatibilityRule = {
  machine: string[];
  equipment: string[];
};

const RULES: Record<string, CompatibilityRule> = {
  spraying: {
    machine: ["tractor", "sprayer", "self_propelled_sprayer", "spraying_drone", "drone"],
    equipment: ["sprayer", "boom_sprayer", "mounted_sprayer", "trailed_sprayer", "spraying"],
  },
  harvesting: {
    machine: ["combine", "harvester", "potato_harvester"],
    equipment: ["harvester", "potato_harvester", "header"],
  },
  planting: {
    machine: ["tractor", "planter", "seeder", "potato_planter"],
    equipment: ["planter", "seeder", "potato_planter"],
  },
  seeding: {
    machine: ["tractor", "planter", "seeder", "potato_planter"],
    equipment: ["planter", "seeder", "potato_planter"],
  },
  soil_operation: {
    machine: ["tractor"],
    equipment: ["plow", "disc", "harrow", "cultivator", "chisel", "tillage", "subsoiler"],
  },
  irrigation: {
    machine: ["tractor", "irrigation"],
    equipment: ["irrigation", "sprinkler", "pump", "drip"],
  },
  fertilization: {
    machine: ["tractor", "spreader", "self_propelled_sprayer"],
    equipment: ["spreader", "fertilizer", "applicator", "sprayer"],
  },
};

function normalizeToken(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function globalModel(asset: MachineryAssetLike): Record<string, unknown> | null {
  if (Array.isArray(asset.global_model)) return asset.global_model[0] || null;
  return asset.global_model || null;
}

export function machineryCategoryTokens(asset: MachineryAssetLike): string[] {
  const model = globalModel(asset);
  return Array.from(
    new Set(
      [
        asset.type,
        asset.category,
        asset.machine_category,
        asset.machinery_type,
        asset.equipment_category,
        asset.equipment_type,
        model?.type,
        model?.category,
        model?.machine_category,
        model?.machinery_type,
        model?.equipment_category,
        model?.equipment_type,
      ]
        .map(normalizeToken)
        .filter(Boolean)
    )
  );
}

function canonicalRuleKey(operationCategory: unknown, operationType: unknown): string | null {
  const category = normalizeToken(operationCategory);
  const type = normalizeToken(operationType);
  if (RULES[type]) return type;
  if (RULES[category]) return category;
  if (category === "sowing" || type.includes("seed") || type.includes("plant")) return "planting";
  if (category.includes("harvest") || type.includes("harvest")) return "harvesting";
  if (category.includes("spray") || type.includes("spray")) return "spraying";
  if (category.includes("soil") || type.includes("tillage")) return "soil_operation";
  if (category.includes("irrig") || type.includes("irrig")) return "irrigation";
  if (category.includes("fertil") || type.includes("fertil")) return "fertilization";
  return null;
}

export function isMachineryCompatible(params: {
  operationCategory?: unknown;
  operationType?: unknown;
  assetKind: AssetKind;
  asset: MachineryAssetLike;
}): boolean {
  const ruleKey = canonicalRuleKey(params.operationCategory, params.operationType);
  if (!ruleKey) return true;
  const allowed = RULES[ruleKey][params.assetKind];
  const tokens = machineryCategoryTokens(params.asset);
  if (tokens.length === 0) return false;
  return tokens.some((token) =>
    allowed.some((allowedToken) => token === allowedToken || token.includes(allowedToken))
  );
}

export function machineryCompatibilityMessage(assetKind: AssetKind): string {
  return assetKind === "machine"
    ? "Выбранная машина несовместима с этой работой"
    : "Выбранное оборудование несовместимо с этой работой";
}
