export type AgroMode = "erp_data" | "agro_knowledge" | "mixed";

const CROP_GROUPS: Record<string, string[]> = {
  зерновые: ["пшеница", "ячмень", "овес", "овёс", "кукуруза"],
  масличные: ["лен", "лён", "рапс", "подсолнечник", "соя"],
  овощные: ["картофель", "морковь", "лук"],
  кормовые: ["люцерна", "многолетние травы", "силос"],
  бобовые: ["горох", "нут", "чечевица", "соя"],
  технические: ["сахарная свекла", "табак", "хлопок", "лен", "лён"],
  "row crops": ["картофель", "морковь", "лук", "кукуруза"],
};

const CROP_ALIASES: Record<string, string> = {
  гала: "gala",
  gala: "gala",
  сорая: "soraya",
  soraya: "soraya",
  "балтик роуз": "baltic rose",
  "балтик-роуз": "baltic rose",
  "baltic rose": "baltic rose",
  азилит: "azilit",
  azilit: "azilit",
  коломбо: "colombo",
  colombo: "colombo",
  импала: "impala",
  impala: "impala",
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

export function findCropGroupsInText(value: string): string[] {
  const text = norm(value);
  if (!text) return [];
  return Object.keys(CROP_GROUPS).filter((group) => text.includes(group));
}

export function listCropsByGroup(group: string): string[] {
  const key = norm(group);
  return CROP_GROUPS[key] ? [...CROP_GROUPS[key]] : [];
}

export function isAgroKnowledgeQuestion(value: string): boolean {
  const text = norm(value);
  if (!text) return false;
  return /(болезн|фитофтор|вредител|fung|disease|междуряд|межсем|норма|риск|всход|урожайн|агроном|plant)/.test(
    text
  );
}

export function isErpDataQuestion(value: string): boolean {
  const text = norm(value);
  if (!text) return false;
  return /(остат|склад|парт|движен|провод|ledger|inventory|warehouse|batch|stock|balance|талон|весов|гсм|топлив|поле|посев|операц|урож)/.test(
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
  };
}
