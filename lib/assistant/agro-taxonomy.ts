export type AgroMode = "erp_data" | "agro_knowledge" | "mixed";

const CROP_GROUPS: Record<string, string[]> = {
  cereals: ["wheat", "barley", "oats", "corn"],
  oilseeds: ["flax", "rapeseed", "sunflower", "soy"],
  vegetables: ["potato", "carrot", "onion"],
  forage: ["alfalfa", "perennial grasses", "silage"],
  legumes: ["peas", "chickpea", "lentils", "soy"],
  technical: ["sugar beet", "tobacco", "cotton", "flax"],
  "row crops": ["potato", "carrot", "onion", "corn"],
  "\u0437\u0435\u0440\u043d\u043e\u0432\u044b\u0435": [
    "\u043f\u0448\u0435\u043d\u0438\u0446\u0430",
    "\u044f\u0447\u043c\u0435\u043d\u044c",
    "\u043e\u0432\u0435\u0441",
    "\u043e\u0432\u0451\u0441",
    "\u043a\u0443\u043a\u0443\u0440\u0443\u0437\u0430",
  ],
  "\u043c\u0430\u0441\u043b\u0438\u0447\u043d\u044b\u0435": [
    "\u043b\u0435\u043d",
    "\u043b\u0451\u043d",
    "\u0440\u0430\u043f\u0441",
    "\u043f\u043e\u0434\u0441\u043e\u043b\u043d\u0435\u0447\u043d\u0438\u043a",
    "\u0441\u043e\u044f",
  ],
  "\u043e\u0432\u043e\u0449\u043d\u044b\u0435": [
    "\u043a\u0430\u0440\u0442\u043e\u0444\u0435\u043b\u044c",
    "\u043c\u043e\u0440\u043a\u043e\u0432\u044c",
    "\u043b\u0443\u043a",
  ],
  "\u0431\u043e\u0431\u043e\u0432\u044b\u0435": [
    "\u0433\u043e\u0440\u043e\u0445",
    "\u043d\u0443\u0442",
    "\u0447\u0435\u0447\u0435\u0432\u0438\u0446\u0430",
    "\u0441\u043e\u044f",
  ],
};

const CROP_ALIASES: Record<string, string> = {
  gala: "gala",
  "\u0433\u0430\u043b\u0430": "gala",
  soraya: "soraya",
  "\u0441\u043e\u0440\u0430\u044f": "soraya",
  "baltic rose": "baltic rose",
  "\u0431\u0430\u043b\u0442\u0438\u043a \u0440\u043e\u0443\u0437": "baltic rose",
  "\u0431\u0430\u043b\u0442\u0438\u043a-\u0440\u043e\u0443\u0437": "baltic rose",
  azilit: "azilit",
  "\u0430\u0437\u0438\u043b\u0438\u0442": "azilit",
  colombo: "colombo",
  "\u043a\u043e\u043b\u043e\u043c\u0431\u043e": "colombo",
  impala: "impala",
  "\u0438\u043c\u043f\u0430\u043b\u0430": "impala",
  potato: "potato",
  "seed potato": "potato",
  "\u043a\u0430\u0440\u0442\u043e\u0444\u0435\u043b\u044c": "potato",
  "\u043a\u0430\u0440\u0442\u043e\u0448\u043a\u0430": "potato",
  "\u043a\u0430\u0440\u0442\u043e\u0444\u0435\u043b\u044f": "potato",
  "\u0441\u0435\u043c\u0435\u043d\u043d\u043e\u0439 \u043a\u0430\u0440\u0442\u043e\u0444\u0435\u043b\u044c": "potato",
  dap: "\u0434\u0438\u0430\u043c\u043c\u043e\u0444\u043e\u0441\u043a\u0430",
  "\u0434\u0438\u0430\u043c\u043e\u0444\u043e\u0441\u043a\u0430": "\u0434\u0438\u0430\u043c\u043c\u043e\u0444\u043e\u0441\u043a\u0430",
  "\u0434\u0438\u0430\u043c\u043c\u043e\u0444\u043e\u0441\u043a\u0430": "\u0434\u0438\u0430\u043c\u043c\u043e\u0444\u043e\u0441\u043a\u0430",
  wheat: "wheat",
  "\u043f\u0448\u0435\u043d\u0438\u0446\u0430": "wheat",
  barley: "barley",
  "\u044f\u0447\u043c\u0435\u043d\u044c": "barley",
  corn: "corn",
  "\u043a\u0443\u043a\u0443\u0440\u0443\u0437\u0430": "corn",
  carrot: "carrot",
  "\u043c\u043e\u0440\u043a\u043e\u0432\u044c": "carrot",
  onion: "onion",
  "\u043b\u0443\u043a": "onion",
  flax: "flax",
  "\u043b\u0435\u043d": "flax",
  "\u043b\u0451\u043d": "flax",
  oats: "oats",
  "\u043e\u0432\u0435\u0441": "oats",
  "\u043e\u0432\u0451\u0441": "oats",
};

const GROUP_ALIASES: Record<string, string> = {
  grain: "cereals",
  grains: "cereals",
  cereals: "cereals",
  oilseeds: "oilseeds",
  vegetables: "vegetables",
  forage: "forage",
  legumes: "legumes",
  technical: "technical",
  industrial: "technical",
  "row crops": "row crops",
  "row crop": "row crops",
  rowcrops: "row crops",
  "\u0437\u0435\u0440\u043d\u043e\u0432\u044b\u0435": "\u0437\u0435\u0440\u043d\u043e\u0432\u044b\u0435",
  "\u0437\u0435\u0440\u043d\u043e\u0432\u044b\u043c": "\u0437\u0435\u0440\u043d\u043e\u0432\u044b\u0435",
  "\u0437\u0435\u0440\u043d\u043e\u0432\u044b\u0445": "\u0437\u0435\u0440\u043d\u043e\u0432\u044b\u0435",
  "\u043c\u0430\u0441\u043b\u0438\u0447\u043d\u044b\u0435": "\u043c\u0430\u0441\u043b\u0438\u0447\u043d\u044b\u0435",
  "\u043c\u0430\u0441\u043b\u0438\u0447\u043d\u044b\u043c": "\u043c\u0430\u0441\u043b\u0438\u0447\u043d\u044b\u0435",
  "\u043c\u0430\u0441\u043b\u0438\u0447\u043d\u044b\u0445": "\u043c\u0430\u0441\u043b\u0438\u0447\u043d\u044b\u0435",
  "\u043e\u0432\u043e\u0449\u043d\u044b\u0435": "\u043e\u0432\u043e\u0449\u043d\u044b\u0435",
  "\u043e\u0432\u043e\u0449\u043d\u044b\u043c": "\u043e\u0432\u043e\u0449\u043d\u044b\u0435",
  "\u043e\u0432\u043e\u0449\u043d\u044b\u0445": "\u043e\u0432\u043e\u0449\u043d\u044b\u0435",
  "\u0431\u043e\u0431\u043e\u0432\u044b\u0435": "\u0431\u043e\u0431\u043e\u0432\u044b\u0435",
  "\u0431\u043e\u0431\u043e\u0432\u044b\u043c": "\u0431\u043e\u0431\u043e\u0432\u044b\u0435",
  "\u0431\u043e\u0431\u043e\u0432\u044b\u0445": "\u0431\u043e\u0431\u043e\u0432\u044b\u0435",
  "\u0440\u044f\u0434\u043a\u043e\u0432\u044b\u0435 \u043a\u0443\u043b\u044c\u0442\u0443\u0440\u044b": "row crops",
};

function norm(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[.,!?;:()"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCropAlias(value: string): string | null {
  const key = norm(value);
  if (!key) return null;
  return CROP_ALIASES[key] || key;
}

export function resolveKnownCropAlias(value: string): string | null {
  const key = norm(value);
  if (!key) return null;
  return CROP_ALIASES[key] || null;
}

export function findCropAliasesInText(value: string): string[] {
  const text = ` ${norm(value)} `;
  if (!text.trim()) return [];
  const found = new Set<string>();

  Object.entries(CROP_ALIASES).forEach(([alias, canonical]) => {
    if (text.includes(` ${alias} `)) {
      found.add(canonical);
    }
  });

  return Array.from(found);
}

export function findCropGroupsInText(value: string): string[] {
  const text = ` ${norm(value)} `;
  if (!text.trim()) return [];
  const found = new Set<string>();

  Object.entries(GROUP_ALIASES).forEach(([alias, group]) => {
    if (text.includes(` ${alias} `)) {
      found.add(group);
    }
  });

  return Array.from(found);
}

export function listCropsByGroup(group: string): string[] {
  const key = GROUP_ALIASES[norm(group)] || norm(group);
  return CROP_GROUPS[key] ? [...CROP_GROUPS[key]] : [];
}

export function isAgroKnowledgeQuestion(value: string): boolean {
  const text = norm(value);
  if (!text) return false;
  return /(\u0431\u043e\u043b\u0435\u0437\u043d|\u0444\u0438\u0442\u043e\u0444\u0442\u043e\u0440|\u0432\u0440\u0435\u0434\u0438\u0442\u0435\u043b|\u043c\u0435\u0436\u0434\u0443\u0440\u044f\u0434|\u043c\u0435\u0436\u0441\u0435\u043c|\u043d\u043e\u0440\u043c\u0430|\u0440\u0438\u0441\u043a|\u0432\u0441\u0445\u043e\u0434|\u0443\u0440\u043e\u0436\u0430\u0439\u043d|\u0430\u0433\u0440\u043e\u043d\u043e\u043c|fung|disease|plant)/.test(
    text
  );
}

export function isErpDataQuestion(value: string): boolean {
  const text = norm(value);
  if (!text) return false;
  return /(\u043e\u0441\u0442\u0430\u0442|\u0441\u043a\u043b\u0430\u0434|\u043f\u0430\u0440\u0442|\u0434\u0432\u0438\u0436\u0435\u043d|\u043f\u0440\u043e\u0432\u043e\u0434|ledger|inventory|warehouse|batch|stock|balance|\u0442\u0430\u043b\u043e\u043d|\u0432\u0435\u0441\u043e\u0432|\u0433\u0441\u043c|\u0442\u043e\u043f\u043b\u0438\u0432|\u043f\u043e\u043b\u0435|\u043f\u043e\u0441\u0435\u0432|\u043e\u043f\u0435\u0440\u0430\u0446|\u0443\u0440\u043e\u0436)/.test(
    text
  );
}

export function resolveAssistantMode(message: string): AgroMode {
  const erp = isErpDataQuestion(message);
  const agro = isAgroKnowledgeQuestion(message);
  if (erp && agro) return "mixed";
  if (agro) return "agro_knowledge";
  return "erp_data";
}

export function getAgroTaxonomySnapshot() {
  return {
    groups: { ...CROP_GROUPS },
    aliases: { ...CROP_ALIASES },
    groupAliases: { ...GROUP_ALIASES },
  };
}
