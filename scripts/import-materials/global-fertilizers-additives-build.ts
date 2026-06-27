import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

type ProductType = "fertilizer" | "additive";
type FertilizerType =
  | "macro"
  | "micro"
  | "foliar"
  | "water_soluble"
  | "organic"
  | "organomineral"
  | "biostimulant"
  | "unknown";
type AdditiveType =
  | "adjuvant"
  | "sticker"
  | "pH_corrector"
  | "antifoam"
  | "water_conditioner"
  | "anti_salt"
  | "other"
  | "unknown";
type ApplicationMethod = "soil" | "foliar" | "fertigation" | "seed_treatment" | "unknown";

type RawProduct = {
  trade_name: string;
  product_type: ProductType;
  source_name: string;
  source_url: string;
  manufacturer?: string;
  fertilizer_type?: FertilizerType;
  additive_type?: AdditiveType;
  composition_text?: string;
  formulation?: string;
  application_method?: ApplicationMethod;
  application_rate?: string;
  storage_unit?: string;
  issue_unit?: string;
  default_rate_unit?: string;
  default_dosing_type?: string;
  confidence?: string;
  import_status?: string;
  nutrients?: Partial<Record<NutrientKey, string>>;
};

type ProductRow = {
  trade_name: string;
  normalized_name: string;
  product_type: ProductType;
  category: ProductType;
  fertilizer_type: FertilizerType | "";
  additive_type: AdditiveType | "";
  N: string;
  P: string;
  K: string;
  S: string;
  Ca: string;
  Mg: string;
  B: string;
  Zn: string;
  Mn: string;
  Cu: string;
  Fe: string;
  Mo: string;
  amino_acids: string;
  humic_acids: string;
  fulvic_acids: string;
  composition_text: string;
  formulation: string;
  application_method: ApplicationMethod;
  application_rate: string;
  storage_unit: string;
  issue_unit: string;
  default_rate_unit: string;
  default_dosing_type: string;
  manufacturer: string;
  source_url: string;
  source_name: string;
  confidence: string;
  import_status: string;
  raw_attributes_json: string;
};

type NutrientKey =
  | "N"
  | "P"
  | "K"
  | "S"
  | "Ca"
  | "Mg"
  | "B"
  | "Zn"
  | "Mn"
  | "Cu"
  | "Fe"
  | "Mo"
  | "amino_acids"
  | "humic_acids"
  | "fulvic_acids";

const OUTPUT_DIR = path.join(process.cwd(), "data", "import", "global_fertilizers_additives_2026");
const ALLOWED_UNITS = new Set(["л", "кг", "г", "мл", "л/га", "кг/га", "г/га", "мл/га", "мл/100 л", "л/1000 л", "кг/1000 л", "unknown"]);

const SOURCE_URLS: Record<string, string> = {
  AlemAgro: "https://alemagro.com/en/catalog/soil",
  AgriTecno: "https://agritecno.com.ua/en/",
  SwissGrow: "https://www.swissgrow.com/products/",
  Tradecorp: "https://www.rovensanext.com/en/agricultural-bionutrition/tradecorp-cu/",
  Miller: "https://www.millerchemical.com/products",
  Valagro: "https://www.syngentabiologicals.com/media/filer_public/f4/a7/f4a72344-2c83-41f2-b575-d8f2a759b23e/catalogo_valagro_2023_web.pdf",
  Yara: "https://www.yara.us/crop-nutrition/fertilizer-products/",
  EuroChem: "https://www.eurochemgroup.com/products/agricultural-products/",
  Kazphosphate: "https://www.kpp.kz/en",
  KazAzot: "https://kazazot.kz/",
  EcoSave: "NEED_SOURCE_CHECK",
  AgroMart: "https://agromartgroup.com/products/",
};

function normalizeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[®™©]/g, "")
    .replace(/\b\d+\s*[xх*]\s*\d+\s*(л|l|кг|kg|г|g|ml|мл)\b/giu, "")
    .replace(/\b\d+\s*(л|l|кг|kg|г|g|ml|мл)\b/giu, "")
    .replace(/\b(can|bag|мешок|канистра)\b/giu, "")
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function writeCsv(filePath: string, rows: Record<string, unknown>[], headers: string[]) {
  const body = [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
  writeFileSync(filePath, `${body}\n`, "utf8");
}

function cleanUnit(unit: string | undefined, fallback: string) {
  const normalized = String(unit || fallback || "unknown")
    .replace(/\bl\b/gi, "л")
    .replace(/\bkg\b/gi, "кг")
    .replace(/\bg\b/gi, "г")
    .replace(/\bml\b/gi, "мл")
    .replace(/L/gi, "л")
    .replace(/ha/gi, "га")
    .replace(/1000\s*л/gi, "1000 л")
    .trim();
  return ALLOWED_UNITS.has(normalized) ? normalized : "unknown";
}

function inferStorageUnit(raw: RawProduct) {
  if (raw.storage_unit) return cleanUnit(raw.storage_unit, "unknown");
  const text = `${raw.trade_name} ${raw.formulation || ""} ${raw.composition_text || ""}`.toLowerCase();
  if (/(жид|liquid|вк|вр|sl|sc|ке|л\/|концентрат|эмульс|solution|suspension|flow|fluid)/i.test(text)) return "л";
  if (raw.product_type === "additive") return "л";
  if (/(microgranule|гранул|granul|крист|crystal|powder|wdg|таб|таблет|сух|dry|npk|map|dap|mop|sop|urea|nitrate|аммофос|селитр|карбамид)/i.test(text)) return "кг";
  return "unknown";
}

function inferRateUnit(raw: RawProduct, storageUnit: string) {
  if (raw.default_rate_unit) return cleanUnit(raw.default_rate_unit, "unknown");
  if (raw.additive_type === "water_conditioner" || raw.additive_type === "pH_corrector" || raw.additive_type === "antifoam") return "мл/100 л";
  if (storageUnit === "л") return "л/га";
  if (storageUnit === "кг") return "кг/га";
  if (storageUnit === "г") return "г/га";
  if (storageUnit === "мл") return "мл/га";
  return "unknown";
}

function extractNpk(name: string, composition = "") {
  const target = `${name} ${composition}`;
  const match = target.match(/(\d{1,2}(?:[.,]\d+)?)\s*[-:]\s*(\d{1,2}(?:[.,]\d+)?)\s*[-:]\s*(\d{1,2}(?:[.,]\d+)?)/);
  if (!match) return {};
  return {
    N: match[1].replace(",", "."),
    P: match[2].replace(",", "."),
    K: match[3].replace(",", "."),
  };
}

function inferNutrients(raw: RawProduct): Partial<Record<NutrientKey, string>> {
  const text = `${raw.trade_name} ${raw.composition_text || ""}`;
  const nutrients: Partial<Record<NutrientKey, string>> = { ...extractNpk(raw.trade_name, raw.composition_text), ...(raw.nutrients || {}) };
  const patterns: Array<[NutrientKey, RegExp]> = [
    ["N", /(?:^|\b)(?:N|nitrogen|азот)[^\d]*(\d{1,2}(?:[.,]\d+)?)/i],
    ["P", /(?:^|\b)(?:P|P2O5|phosphorus|фосфор)[^\d]*(\d{1,2}(?:[.,]\d+)?)/i],
    ["K", /(?:^|\b)(?:K|K2O|potassium|калий)[^\d]*(\d{1,2}(?:[.,]\d+)?)/i],
    ["S", /(?:^|\b)(?:S|sulfur|sulphur|сера)[^\d]*(\d{1,2}(?:[.,]\d+)?)/i],
    ["Ca", /(?:Ca|calcium|кальций)[^\d]*(\d{1,2}(?:[.,]\d+)?)/i],
    ["Mg", /(?:Mg|magnesium|магний)[^\d]*(\d{1,2}(?:[.,]\d+)?)/i],
    ["B", /(?:B|boron|бор)[^\d]*(\d{1,2}(?:[.,]\d+)?)/i],
    ["Zn", /(?:Zn|zinc|цинк)[^\d]*(\d{1,2}(?:[.,]\d+)?)/i],
    ["Mn", /(?:Mn|manganese|марганец)[^\d]*(\d{1,2}(?:[.,]\d+)?)/i],
    ["Cu", /(?:Cu|copper|медь)[^\d]*(\d{1,2}(?:[.,]\d+)?)/i],
    ["Fe", /(?:Fe|iron|железо)[^\d]*(\d{1,2}(?:[.,]\d+)?)/i],
    ["Mo", /(?:Mo|molybdenum|молибден)[^\d]*(\d{1,2}(?:[.,]\d+)?)/i],
  ];
  for (const [key, pattern] of patterns) {
    const match = text.match(pattern);
    if (match && !nutrients[key]) nutrients[key] = match[1].replace(",", ".");
  }
  if (/amino|амино/i.test(text)) nutrients.amino_acids = nutrients.amino_acids || "present";
  if (/humic|гум/i.test(text)) nutrients.humic_acids = nutrients.humic_acids || "present";
  if (/fulvic|фульв/i.test(text)) nutrients.fulvic_acids = nutrients.fulvic_acids || "present";
  return nutrients;
}

function makeRow(raw: RawProduct): ProductRow {
  const storageUnit = inferStorageUnit(raw);
  const defaultRateUnit = inferRateUnit(raw, storageUnit);
  const importStatus = raw.import_status || (storageUnit === "unknown" || defaultRateUnit === "unknown" ? "NEED_UNIT_CHECK" : "IMPORT_READY");
  const nutrients = inferNutrients(raw);
  const rawJson = {
    source_name: raw.source_name,
    source_url: raw.source_url,
    original_product_type: raw.product_type,
    source_confidence: raw.confidence || "medium",
    collection_note: "Dry catalog build only. No database import.",
  };
  return {
    trade_name: raw.trade_name,
    normalized_name: normalizeName(raw.trade_name),
    product_type: raw.product_type,
    category: raw.product_type,
    fertilizer_type: raw.product_type === "fertilizer" ? raw.fertilizer_type || inferFertilizerType(raw) : "",
    additive_type: raw.product_type === "additive" ? raw.additive_type || inferAdditiveType(raw) : "",
    N: nutrients.N || "",
    P: nutrients.P || "",
    K: nutrients.K || "",
    S: nutrients.S || "",
    Ca: nutrients.Ca || "",
    Mg: nutrients.Mg || "",
    B: nutrients.B || "",
    Zn: nutrients.Zn || "",
    Mn: nutrients.Mn || "",
    Cu: nutrients.Cu || "",
    Fe: nutrients.Fe || "",
    Mo: nutrients.Mo || "",
    amino_acids: nutrients.amino_acids || "",
    humic_acids: nutrients.humic_acids || "",
    fulvic_acids: nutrients.fulvic_acids || "",
    composition_text: raw.composition_text || "unknown",
    formulation: raw.formulation || inferFormulation(raw),
    application_method: raw.application_method || inferApplicationMethod(raw),
    application_rate: raw.application_rate || "unknown",
    storage_unit: storageUnit,
    issue_unit: cleanUnit(raw.issue_unit, storageUnit),
    default_rate_unit: defaultRateUnit,
    default_dosing_type: raw.default_dosing_type || (raw.product_type === "additive" ? "per_tank_or_ha" : "per_ha"),
    manufacturer: raw.manufacturer || raw.source_name,
    source_url: raw.source_url,
    source_name: raw.source_name,
    confidence: raw.confidence || "medium",
    import_status: importStatus,
    raw_attributes_json: JSON.stringify(rawJson),
  };
}

function inferFertilizerType(raw: RawProduct): FertilizerType {
  const text = `${raw.trade_name} ${raw.composition_text || ""}`.toLowerCase();
  if (/biostimul|amino|humic|fulvic|seaweed|экстракт|yieldon|megafol|tecamin|agriful|radifarm|viva/i.test(text)) return "biostimulant";
  if (/water|soluble|aqua|tera|krist|aqualeaf|solub|fertigation|drip/i.test(text)) return "water_soluble";
  if (/micro|микро|zn|zinc|mn|cu|fe|bor|b\b|mo|brexil|tecnokel|tradecorp/i.test(text)) return "micro";
  if (/foliar|лист|vita|plantafol|foli/i.test(text)) return "foliar";
  if (/organic|орган|bio natura|humika/i.test(text)) return "organic";
  if (/npk|map|dap|mop|sop|urea|nitrate|аммофос|карбамид|селитр|asn|uan|can|an\b|np\b|nk\b/i.test(text)) return "macro";
  return "unknown";
}

function inferAdditiveType(raw: RawProduct): AdditiveType {
  const text = `${raw.trade_name} ${raw.composition_text || ""}`.toLowerCase();
  if (/ph|pH|кислот|control|power|acid/i.test(text)) return "pH_corrector";
  if (/foam|пена|antifoam/i.test(text)) return "antifoam";
  if (/salt|anti-salt|антисоль|retrosal/i.test(text)) return "anti_salt";
  if (/sticker|film|spodnam|pod ceal|прилип/i.test(text)) return "sticker";
  if (/water|conditioner|calfa|cal\.f\.a/i.test(text)) return "water_conditioner";
  if (/adjuvant|surfact|пав|aide|hybrid|exit|sustain/i.test(text)) return "adjuvant";
  return "other";
}

function inferFormulation(raw: RawProduct) {
  const text = `${raw.trade_name} ${raw.composition_text || ""}`.toLowerCase();
  if (/таб|tab/.test(text)) return "tablet";
  if (/granul|гранул|npk|map|dap|mop|sop|urea|nitrate|аммофос|селитр|карбамид/.test(text)) return "granule";
  if (/crystal|крист|solub|krista|kristalon|aqualeaf/.test(text)) return "crystal";
  if (/powder|порош|wdg|вдг/.test(text)) return "powder";
  if (/жид|liquid|solution|концентрат|flow|fluid|sl|sc/.test(text)) return "liquid";
  return "unknown";
}

function inferApplicationMethod(raw: RawProduct): ApplicationMethod {
  const text = `${raw.trade_name} ${raw.composition_text || ""}`.toLowerCase();
  if (/seed|семян|протрав|start/i.test(text)) return "seed_treatment";
  if (/foliar|vita|plantafol|megafol|tecamin|лист/i.test(text)) return "foliar";
  if (/drip|fertigation|aqua|tera|solub|krist|aqualeaf|unileaf/i.test(text)) return "fertigation";
  if (/soil|granul|npk|map|dap|mop|sop|urea|nitrate|аммофос|селитр|карбамид/i.test(text)) return "soil";
  return "unknown";
}

function fertilizer(tradeName: string, sourceName: string, options: Partial<RawProduct> = {}): RawProduct {
  return {
    trade_name: tradeName,
    product_type: "fertilizer",
    source_name: sourceName,
    source_url: options.source_url || SOURCE_URLS[sourceName] || "unknown",
    ...options,
  };
}

function additive(tradeName: string, sourceName: string, options: Partial<RawProduct> = {}): RawProduct {
  return {
    trade_name: tradeName,
    product_type: "additive",
    source_name: sourceName,
    source_url: options.source_url || SOURCE_URLS[sourceName] || "unknown",
    ...options,
  };
}

function npkRows(sourceName: string, names: string[], options: Partial<RawProduct> = {}) {
  return names.map((name) =>
    fertilizer(name, sourceName, {
      fertilizer_type: /solub|krista|crystal|aqualeaf|tera|aqualis/i.test(name) ? "water_soluble" : "macro",
      storage_unit: "кг",
      default_rate_unit: "кг/га",
      application_method: /solub|krista|crystal|aqualeaf|tera|aqualis/i.test(name) ? "fertigation" : "soil",
      formulation: /solub|krista|crystal|aqualeaf|tera|aqualis/i.test(name) ? "crystal" : "granule",
      ...options,
    })
  );
}

const rows: RawProduct[] = [
  // AlemAgro visible fertilizer catalog entries.
  fertilizer("Qadam Ferti Boromax", "AlemAgro", { manufacturer: "QADAMFerti", fertilizer_type: "micro", storage_unit: "л", default_rate_unit: "л/га" }),
  additive("Меро ПАВ", "AlemAgro", { manufacturer: "AlemAgro", additive_type: "adjuvant", storage_unit: "л", default_rate_unit: "мл/100 л" }),
  additive("Qadam Ferti pH Control", "AlemAgro", { manufacturer: "QADAMFerti", additive_type: "pH_corrector", storage_unit: "л", default_rate_unit: "мл/100 л" }),
  ...npkRows("AlemAgro", ["Qadam Ferti Aqualeaf 10-10-40", "Qadam Ferti Aqualeaf 20-20-20", "Qadam Ferti Aqualeaf 10-52-10", "Qadam Ferti Aqualeaf 20-5-5"], { manufacturer: "QADAMFerti", source_url: SOURCE_URLS.AlemAgro }),
  fertilizer("Текнокель Амино Микс", "AlemAgro", { manufacturer: "AgriTecno", fertilizer_type: "micro", storage_unit: "кг", default_rate_unit: "кг/га", composition_text: "amino-chelated micronutrients" }),
  fertilizer("Tecamin Brix", "AlemAgro", { manufacturer: "AgriTecno", fertilizer_type: "biostimulant", storage_unit: "л", default_rate_unit: "л/га", composition_text: "amino acids and potassium biostimulant" }),
  fertilizer("Qadam Ferti Start", "AlemAgro", { manufacturer: "QADAMFerti", fertilizer_type: "biostimulant", storage_unit: "л", default_rate_unit: "л/га" }),
  fertilizer("QadamFerti Unileaf", "AlemAgro", { manufacturer: "QADAMFerti", fertilizer_type: "biostimulant", storage_unit: "кг", default_rate_unit: "кг/га", application_method: "foliar" }),
  fertilizer("YieldON", "AlemAgro", { manufacturer: "Valagro", fertilizer_type: "biostimulant", storage_unit: "л", default_rate_unit: "л/га" }),
  fertilizer("Silimax", "AlemAgro", { manufacturer: "QADAMFerti", fertilizer_type: "micro", storage_unit: "л", default_rate_unit: "л/га", composition_text: "silicon micronutrient" }),
  fertilizer("FERTIGRAIN BETA", "AlemAgro", { manufacturer: "AgriTecno", fertilizer_type: "biostimulant", storage_unit: "л", default_rate_unit: "л/га" }),
  additive("Карамба Турбо", "AlemAgro", { additive_type: "pH_corrector", storage_unit: "л", default_rate_unit: "мл/100 л" }),
  additive("Control DMP", "AlemAgro", { manufacturer: "Valagro", additive_type: "pH_corrector", storage_unit: "л", default_rate_unit: "мл/100 л", source_url: "https://alemagro.com/en/catalog/soil/product/37" }),
  additive("Текнофит РН", "AlemAgro", { manufacturer: "AgriTecno", additive_type: "pH_corrector", storage_unit: "л", default_rate_unit: "мл/100 л", source_url: "https://alemagro.com/en/catalog/soil/category%3Dph-korrektory-10" }),
  fertilizer("Fertigrain Start", "AlemAgro", { manufacturer: "AgriTecno", fertilizer_type: "biostimulant", storage_unit: "л", default_rate_unit: "л/га", application_method: "seed_treatment" }),
  fertilizer("FERTIGRAIN START СоМо", "AlemAgro", { manufacturer: "AgriTecno", fertilizer_type: "biostimulant", storage_unit: "л", default_rate_unit: "л/га", composition_text: "Co Mo seed treatment biostimulant", nutrients: { Mo: "present" } }),
  fertilizer("Tecamin Max 15*1l/can", "AlemAgro", { manufacturer: "AgriTecno", fertilizer_type: "biostimulant", storage_unit: "л", default_rate_unit: "л/га" }),
  fertilizer("Текнокель Амино Цинк-Марганец ZnMn", "AlemAgro", { manufacturer: "AgriTecno", fertilizer_type: "micro", storage_unit: "кг", default_rate_unit: "кг/га", nutrients: { Zn: "present", Mn: "present" } }),
  fertilizer("Megafol 1000L", "AlemAgro", { manufacturer: "Valagro", fertilizer_type: "biostimulant", storage_unit: "л", default_rate_unit: "л/га" }),
  additive("Retrosal", "AlemAgro", { manufacturer: "Valagro", additive_type: "anti_salt", storage_unit: "л", default_rate_unit: "л/га" }),
  fertilizer("Radifarm", "AlemAgro", { manufacturer: "Valagro", fertilizer_type: "biostimulant", storage_unit: "л", default_rate_unit: "л/га" }),
  fertilizer("Benefit PZ", "AlemAgro", { manufacturer: "Valagro", fertilizer_type: "biostimulant", storage_unit: "л", default_rate_unit: "л/га" }),
  fertilizer("Sweet", "AlemAgro", { manufacturer: "Valagro", fertilizer_type: "biostimulant", storage_unit: "л", default_rate_unit: "л/га" }),
  fertilizer("MC Extra", "AlemAgro", { manufacturer: "Valagro", fertilizer_type: "micro", storage_unit: "кг", default_rate_unit: "кг/га" }),
  fertilizer("MC Cream", "AlemAgro", { manufacturer: "Valagro", fertilizer_type: "micro", storage_unit: "кг", default_rate_unit: "кг/га" }),
  fertilizer("MC Set", "AlemAgro", { manufacturer: "Valagro", fertilizer_type: "micro", storage_unit: "кг", default_rate_unit: "кг/га" }),
  fertilizer("Actiwave", "AlemAgro", { manufacturer: "Valagro", fertilizer_type: "biostimulant", storage_unit: "л", default_rate_unit: "л/га" }),
  fertilizer("Viva", "AlemAgro", { manufacturer: "Valagro", fertilizer_type: "biostimulant", storage_unit: "л", default_rate_unit: "л/га" }),
  fertilizer("Plantafol 20-20-20", "AlemAgro", { manufacturer: "Valagro", fertilizer_type: "water_soluble", storage_unit: "кг", default_rate_unit: "кг/га" }),

  // AgriTecno / Agritecno Ukraine product families.
  ...["Agriful", "Agriful Anti-salt", "Agriful Plus", "Tecamin Max", "Tecamin Flower", "Tecamin Brix", "Tecamin Raiz", "Tecamin Star", "Tecamin Aminoquelant Ca", "Tecamin Aminoquelant Zn-Mn", "Tecnokel Amino Mix", "Tecnokel Amino Ca", "Tecnokel Amino B", "Tecnokel Amino Zn", "Tecnokel Amino Mg", "Tecnokel Zn-Mn", "Tecnokel N", "Fertigrain Foliar", "Fertigrain Start", "Fertigrain Complet", "Fertigrain Beta", "Fertigrain Start CoMo", "Delfan Plus", "Controlphyt Cu", "Controlphyt PK", "Controlphyt Si", "Final K", "Actium", "Raykat Start", "Raykat Growth", "Raykat Engorde"].map((name) =>
    fertilizer(name, "AgriTecno", {
      manufacturer: "AgriTecno",
      fertilizer_type: /tecnokel|controlphyt|aminoquelant/i.test(name) ? "micro" : "biostimulant",
      storage_unit: /tecnokel/i.test(name) ? "кг" : "л",
      default_rate_unit: /tecnokel/i.test(name) ? "кг/га" : "л/га",
      source_url: SOURCE_URLS.AgriTecno,
    })
  ),

  // SwissGrow visible categories/products.
  ...["Bio Natura Humika", "Fulvimax", "Sancrop"].map((name) =>
    fertilizer(name, "SwissGrow", { manufacturer: "SwissGrow", fertilizer_type: "organic", storage_unit: "л", default_rate_unit: "л/га", source_url: "https://www.swissgrow.com/product-category/bio/" })
  ),
  ...["Cabamin", "Ferromax", "Gemmastim", "Microlan"].map((name) =>
    fertilizer(name, "SwissGrow", { manufacturer: "SwissGrow", fertilizer_type: "micro", storage_unit: "л", default_rate_unit: "л/га", source_url: "https://www.swissgrow.com/product-category/micro-specials/" })
  ),

  // Tradecorp / Rovensa Next bionutrition names.
  ...["Tradecorp AZ", "Tradecorp AZ Fresco", "Tradecorp Cu", "Tradecorp Fe", "Tradecorp Mn", "Tradecorp Zn", "Tradecorp Mg", "Tradecorp Ca", "Tradecorp B", "Tradecorp Mo", "Tradecorp Mix", "Tradecorp 18-18-18", "Tradecorp 13-40-13", "Tradecorp 20-20-20", "Tradecorp 15-5-30", "Drip Sol 20-20-20", "Drip Sol 13-40-13", "Drip Sol 15-5-30", "Humistar", "Phylgreen", "Delfan Plus", "Ruter AA", "Florone", "Turbo Root", "Folur", "Kelik Potassium"].map((name) =>
    fertilizer(name, "Tradecorp", {
      manufacturer: "Tradecorp",
      fertilizer_type: /tradecorp (az|cu|fe|mn|zn|mg|ca|b|mo|mix)/i.test(name) ? "micro" : /drip|13-40|20-20|15-5|18-18/i.test(name) ? "water_soluble" : "biostimulant",
      storage_unit: /tradecorp (az|cu|fe|mn|zn|mg|ca|b|mo|mix)|drip|13-40|20-20|15-5|18-18/i.test(name) ? "кг" : "л",
      default_rate_unit: /tradecorp (az|cu|fe|mn|zn|mg|ca|b|mo|mix)|drip|13-40|20-20|15-5|18-18/i.test(name) ? "кг/га" : "л/га",
      source_url: SOURCE_URLS.Tradecorp,
    })
  ),

  // Miller products.
  ...["Foam Fighter", "Mist-Control", "Nu-Film 17", "Nu-Film P", "Sustain", "Spray-Aide", "Exit", "Hybrid", "Hot Sauce", "Pod Ceal", "Spodnam", "Nu-Lure", "Radiara", "Reflections", "Spur Shield", "Vapor Gard"].map((name) =>
    additive(name, "Miller", { manufacturer: "Miller Chemical", source_url: SOURCE_URLS.Miller, storage_unit: "л", default_rate_unit: /foam/i.test(name) ? "мл/100 л" : "л/га" })
  ),
  ...["BioVive", "C.A.L.F.A.", "C.F.O", "Citoleaf", "Cytokin", "Cytoplex", "Greenstim", "Millerplex", "Soline", "Strexxa"].map((name) =>
    additive(name, "Miller", {
      manufacturer: "Miller Chemical",
      additive_type: /calfa/i.test(name) ? "water_conditioner" : "other",
      storage_unit: "л",
      default_rate_unit: /calfa/i.test(name) ? "мл/100 л" : "л/га",
      source_url: SOURCE_URLS.Miller,
    })
  ),
  ...["Vitrient", "Miller Boro Zinc", "Calcium Chelate", "Ferriplus", "Microplex", "ZMC Express", "Citrus Mix"].map((name) =>
    fertilizer(name, "Miller", {
      manufacturer: "Miller Chemical",
      fertilizer_type: /vitrient|boro|calcium|ferri|microplex|zmc|citrus/i.test(name) ? "micro" : "biostimulant",
      storage_unit: /vitrient|boro|calcium|ferri|microplex|zmc|citrus/i.test(name) ? "кг" : "л",
      default_rate_unit: /vitrient|boro|calcium|ferri|microplex|zmc|citrus/i.test(name) ? "кг/га" : "л/га",
      source_url: SOURCE_URLS.Miller,
    })
  ),

  // Valagro / Syngenta Biologicals.
  ...["Megafol", "YieldON", "Viva", "Radifarm", "Benefit PZ", "Sweet", "Actiwave", "MC Extra", "MC Cream", "MC Set", "Plantafol 20-20-20", "Plantafol 30-10-10", "Plantafol 10-54-10", "Plantafol 5-15-45", "Brexil Mix", "Brexil Zn", "Brexil Mn", "Brexil Fe", "Brexil Ca", "Brexil Combi", "Master 20-20-20", "Master 13-40-13", "Master 15-5-30", "Master 18-18-18", "Master Supreme 20-20-20", "Master Supreme 10-52-10", "Kendal", "Kendal Te", "Talete", "Erger", "BoroPlus", "Calbit C", "Maxicrop Cream", "Valagro EDTA Fe", "Valagro EDTA Zn", "Valagro EDTA Mn", "Valagro EDTA Cu", "Valagro Fetrilon Combi"].map((name) =>
    fertilizer(name, "Valagro", {
      manufacturer: "Valagro",
      fertilizer_type: /plantafol|master/i.test(name) ? "water_soluble" : /brexil|edta|boroplus|calbit|fetrilon|mc /i.test(name) ? "micro" : "biostimulant",
      storage_unit: /plantafol|master|brexil|edta|fetrilon|mc /i.test(name) ? "кг" : "л",
      default_rate_unit: /plantafol|master|brexil|edta|fetrilon|mc /i.test(name) ? "кг/га" : "л/га",
      source_url: SOURCE_URLS.Valagro,
    })
  ),
  additive("Retrosal", "Valagro", { manufacturer: "Valagro", additive_type: "anti_salt", storage_unit: "л", default_rate_unit: "л/га", source_url: SOURCE_URLS.Valagro }),
  ...["Kendal", "Kendal Te", "Talete", "Erger", "Maxicrop Cream"].map((name) =>
    additive(name, "Valagro", { manufacturer: "Valagro", additive_type: "other", storage_unit: "л", default_rate_unit: "л/га", source_url: SOURCE_URLS.Valagro })
  ),

  // Additive/plant-aid profiles from bionutrition lines. These are kept reviewable through dedupe reports if a same-name fertilizer profile also exists.
  ...["Agriful Anti-salt", "Agriful Plus", "Tecamin Max", "Tecamin Raiz", "Tecamin Star", "Actium", "Tecnophyt pH+"].map((name) =>
    additive(name, "AgriTecno", {
      manufacturer: "AgriTecno",
      additive_type: /anti-salt/i.test(name) ? "anti_salt" : /ph/i.test(name) ? "pH_corrector" : "other",
      storage_unit: "л",
      default_rate_unit: /ph/i.test(name) ? "мл/100 л" : "л/га",
      source_url: /ph/i.test(name) ? "https://agritecno.com.ua/en/products_category/adjuvant-for-agrochemical-mixtures/" : SOURCE_URLS.AgriTecno,
    })
  ),
  ...["Tecamin Vigor", "Agriful Antisal", "Tecnophyt Complex", "Tecno Gel Amino 8-4-28 Development", "Tecno Gel Amino 15-15-15 Balanced"].map((name) =>
    additive(name, "AgriTecno", {
      manufacturer: "AgriTecno",
      additive_type: /antisal/i.test(name) ? "anti_salt" : /phyt/i.test(name) ? "pH_corrector" : "other",
      storage_unit: "л",
      default_rate_unit: /phyt/i.test(name) ? "мл/100 л" : "л/га",
      source_url: "https://agritecno.com.ua/en/products_category/all_products_en/page/2/",
    })
  ),
  ...["Humistar", "Phylgreen", "Delfan Plus", "Ruter AA", "Florone", "Turbo Root", "Folur", "Kelik Potassium"].map((name) =>
    additive(name, "Tradecorp", { manufacturer: "Tradecorp", additive_type: "other", storage_unit: "л", default_rate_unit: "л/га", source_url: SOURCE_URLS.Tradecorp })
  ),
  ...["Kendal Nem", "Releaseed", "Seavolution G", "Kendal Root", "Benefit Kiwi", "Vitaseve", "Micro NP"].map((name) =>
    additive(name, "Valagro", {
      manufacturer: "Valagro",
      additive_type: "other",
      storage_unit: "л",
      default_rate_unit: "л/га",
      source_url: "https://www.syngentabiologicals.com/usa/en-us/products/farm/biostimulants/",
    })
  ),
  ...["YaraAmplix NRHIZO", "YaraAmplix SEEDLIFT PLUS", "YaraAmplix PROCOTE OPTIMIZE", "YaraAmplix OPTITRAC"].map((name) =>
    additive(name, "Yara", {
      manufacturer: "Yara",
      additive_type: "other",
      storage_unit: "л",
      default_rate_unit: "л/га",
      source_url: "https://www.yara.us/crop-nutrition/fertilizer-products/yaraamplix/",
    })
  ),

  // Yara product families and common commercial grades.
  ...npkRows("Yara", ["YaraMila 15-15-15", "YaraMila 16-16-16", "YaraMila 12-11-18", "YaraMila 21-7-14", "YaraMila 7-20-28", "YaraMila 9-12-25", "YaraMila 14-14-21", "YaraMila 8-24-24", "YaraMila Complex", "YaraMila Cropcare", "YaraMila Actyva", "YaraMila Unik"], { manufacturer: "Yara", source_url: SOURCE_URLS.Yara }),
  ...["YaraLiva Calcinit", "YaraLiva Tropicote", "YaraLiva Nitrabor", "YaraLiva CN-9", "YaraBela Sulfan", "YaraBela Extran", "YaraBela Axan", "YaraBela CAN", "YaraVera Amidas", "YaraVera Urea", "YaraVera UreaS", "YaraVera Nitrabor", "YaraRega 15-5-30", "YaraRega 18-18-18", "YaraRega 20-20-20", "YaraRega 13-40-13", "YaraRega 10-5-40"].map((name) =>
    fertilizer(name, "Yara", { manufacturer: "Yara", fertilizer_type: /rega/i.test(name) ? "water_soluble" : "macro", storage_unit: "кг", default_rate_unit: "кг/га", source_url: SOURCE_URLS.Yara })
  ),
  ...["YaraTera Kristalon Brown 3-11-38", "YaraTera Kristalon Scarlet 7.5-12-36", "YaraTera Kristalon Red 12-12-36", "YaraTera Kristalon Orange 6-12-36", "YaraTera Kristalon Yellow 13-40-13", "YaraTera Kristalon Blue 19-6-20", "YaraTera Kristalon Green 18-18-18", "YaraTera Kristalon White 15-5-30", "YaraTera Calcinit", "YaraTera Krista K", "YaraTera Krista MAP", "YaraTera Krista MKP", "YaraTera Krista SOP", "YaraTera Krista MgS", "YaraTera Rexolin Q15", "YaraTera Rexolin APN", "YaraTera Rexolin D12", "YaraTera Rexolin X60", "YaraTera Rexolin Mn13", "YaraTera Rexolin Zn15"].map((name) =>
    fertilizer(name, "Yara", { manufacturer: "Yara", fertilizer_type: /rexolin/i.test(name) ? "micro" : "water_soluble", storage_unit: "кг", default_rate_unit: "кг/га", application_method: "fertigation", source_url: SOURCE_URLS.Yara })
  ),
  ...["YaraVita Bortrac 150", "YaraVita Brassitrel Pro", "YaraVita Bud Builder", "YaraVita Coptrel 500", "YaraVita Croplift Pro", "YaraVita Frutrel", "YaraVita Gramitrel", "YaraVita Mancozin", "YaraVita Mantrac Pro", "YaraVita Molytrac 250", "YaraVita Photrel Pro", "YaraVita Rexolin ABC", "YaraVita Stopit", "YaraVita Thiotrac 300", "YaraVita Zintrac 700", "YaraVita Safe-N 300", "YaraVita Biotrac"].map((name) =>
    fertilizer(name, "Yara", { manufacturer: "Yara", fertilizer_type: /biotrac/i.test(name) ? "biostimulant" : "foliar", storage_unit: "л", default_rate_unit: "л/га", application_method: "foliar", source_url: SOURCE_URLS.Yara })
  ),

  // EuroChem agricultural product families.
  ...["EuroChem MAP", "EuroChem ASN 26-0-0 13S", "EuroChem Urea 46-0-0", "EuroChem AN 34.4-0-0", "EuroChem CAN 27-0-0", "EuroChem UAN 32", "EuroChem AS 21-0-0 24S", "EuroChem NP 20-20", "EuroChem DAP 18-46-0", "EuroChem MOP 0-0-60", "EuroChem NP(S)", "EuroChem NK", "EuroChem UAS", "EuroChem SOP-based NPK", "EuroChem MOP-based NPK", "EuroChem UTEC", "EuroChem ENTEC", "Nitrophoska 15-15-15", "Nitrophoska Perfect", "Nitrophoska Special", "Aqualis ENTEC Solub", "Aqualis UP Solub", "Aqualis SOP Solub", "Aqualis MAP Solub", "Aqualis CN Solub", "Aqualis NOP Solub", "Aqualis Water-soluble NPK 20-20-20", "Aqualis Water-soluble NPK 13-40-13", "Aqualis Water-soluble NPK 15-5-30"].map((name) =>
    fertilizer(name, "EuroChem", {
      manufacturer: "EuroChem",
      fertilizer_type: /aqualis|solub|water-soluble/i.test(name) ? "water_soluble" : "macro",
      storage_unit: /uan/i.test(name) ? "л" : "кг",
      default_rate_unit: /uan/i.test(name) ? "л/га" : "кг/га",
      application_method: /aqualis|solub|water-soluble/i.test(name) ? "fertigation" : "soil",
      source_url: SOURCE_URLS.EuroChem,
    })
  ),

  // Kazakhstan producers.
  fertilizer("Kazphosphate Ammophos", "Kazphosphate", { manufacturer: "Kazphosphate", fertilizer_type: "macro", storage_unit: "кг", default_rate_unit: "кг/га", composition_text: "phosphate-nitrogen fertilizer" }),
  fertilizer("Kazphosphate Sulfoammophos", "Kazphosphate", { manufacturer: "Kazphosphate", fertilizer_type: "macro", storage_unit: "кг", default_rate_unit: "кг/га", composition_text: "phosphate-nitrogen fertilizer with sulfur" }),
  fertilizer("Kazphosphate Phosphogypsum", "Kazphosphate", { manufacturer: "Kazphosphate", fertilizer_type: "macro", storage_unit: "кг", default_rate_unit: "кг/га", composition_text: "calcium sulfate soil amendment", nutrients: { Ca: "present", S: "present" } }),
  fertilizer("Kazphosphate Tricalcium Phosphate", "Kazphosphate", { manufacturer: "Kazphosphate", fertilizer_type: "macro", storage_unit: "кг", default_rate_unit: "кг/га", composition_text: "phosphate feed/fertilizer material" }),
  fertilizer("KazAzot Ammonium Nitrate", "KazAzot", { manufacturer: "KazAzot", fertilizer_type: "macro", storage_unit: "кг", default_rate_unit: "кг/га", composition_text: "ammonium nitrate", nutrients: { N: "34.4" }, source_url: SOURCE_URLS.KazAzot, confidence: "low" }),
  fertilizer("KazAzot Urea", "KazAzot", { manufacturer: "KazAzot", fertilizer_type: "macro", storage_unit: "кг", default_rate_unit: "кг/га", composition_text: "urea", nutrients: { N: "46" }, source_url: SOURCE_URLS.KazAzot, confidence: "low" }),
  fertilizer("KazAzot UAN", "KazAzot", { manufacturer: "KazAzot", fertilizer_type: "macro", storage_unit: "л", default_rate_unit: "л/га", composition_text: "urea ammonium nitrate solution", nutrients: { N: "32" }, source_url: SOURCE_URLS.KazAzot, confidence: "low" }),

  // AgroMart generic crop nutrition categories. Product-level names are blocked until SKU source is confirmed.
  fertilizer("AgroMart conventional NPK blend", "AgroMart", { manufacturer: "AgroMart", fertilizer_type: "macro", storage_unit: "unknown", default_rate_unit: "unknown", import_status: "NEED_UNIT_CHECK;NEED_SOURCE_PRODUCT_SKU", confidence: "low", source_url: SOURCE_URLS.AgroMart }),
  fertilizer("AgroMart specialty horticultural mix", "AgroMart", { manufacturer: "AgroMart", fertilizer_type: "unknown", storage_unit: "unknown", default_rate_unit: "unknown", import_status: "NEED_UNIT_CHECK;NEED_SOURCE_PRODUCT_SKU", confidence: "low", source_url: SOURCE_URLS.AgroMart }),
  additive("EcoSave source catalog unresolved", "EcoSave", { manufacturer: "EcoSave", additive_type: "unknown", storage_unit: "unknown", default_rate_unit: "unknown", import_status: "NEED_SOURCE_CHECK;NEED_UNIT_CHECK", confidence: "low", source_url: SOURCE_URLS.EcoSave }),
];

function similarity(a: string, b: string) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const tokensA = new Set(a.split(" "));
  const tokensB = new Set(b.split(" "));
  const shared = Array.from(tokensA).filter((token) => tokensB.has(token)).length;
  const total = new Set([...Array.from(tokensA), ...Array.from(tokensB)]).size;
  return total ? shared / total : 0;
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const rawCatalog = rows.map(makeRow);

  const exactGroups = new Map<string, ProductRow[]>();
  for (const row of rawCatalog) {
    exactGroups.set(row.normalized_name, [...(exactGroups.get(row.normalized_name) ?? []), row]);
  }

  const exactDuplicateRows: Record<string, unknown>[] = [];
  const dedupeDecisionRows: Record<string, unknown>[] = [];
  const skipExact = new Set<ProductRow>();
  for (const [normalizedName, group] of Array.from(exactGroups.entries())) {
    if (group.length <= 1) continue;
    group.forEach((row: ProductRow, index: number) => {
      exactDuplicateRows.push({
        duplicate_key: normalizedName,
        duplicate_count: group.length,
        decision: index === 0 ? "KEEP_CANONICAL" : "SKIP_EXACT_DUPLICATE",
        trade_name: row.trade_name,
        source_name: row.source_name,
        manufacturer: row.manufacturer,
        source_url: row.source_url,
      });
      dedupeDecisionRows.push({
        duplicate_key: normalizedName,
        trade_name: row.trade_name,
        source_name: row.source_name,
        decision: index === 0 ? "KEEP_CANONICAL" : "SKIP_EXACT_DUPLICATE",
        reason: "Exact normalized_name duplicate.",
      });
      if (index > 0) skipExact.add(row);
    });
  }

  const productsCatalog = rawCatalog.filter((row) => !skipExact.has(row));
  const possibleDuplicateRows: Record<string, unknown>[] = [];
  for (let i = 0; i < productsCatalog.length; i += 1) {
    for (let j = i + 1; j < productsCatalog.length; j += 1) {
      const a = productsCatalog[i];
      const b = productsCatalog[j];
      if (a.normalized_name === b.normalized_name) continue;
      const sameMakerComposition =
        a.manufacturer &&
        b.manufacturer &&
        a.manufacturer.toLowerCase() === b.manufacturer.toLowerCase() &&
        a.composition_text !== "unknown" &&
        a.composition_text === b.composition_text;
      const score = similarity(a.normalized_name, b.normalized_name);
      if (sameMakerComposition || score >= 0.72) {
        possibleDuplicateRows.push({
          product_a: a.trade_name,
          source_a: a.source_name,
          product_b: b.trade_name,
          source_b: b.source_name,
          reason: sameMakerComposition ? "same manufacturer + composition_text" : "similar normalized_name",
          confidence: sameMakerComposition ? "high" : score >= 0.82 ? "medium" : "low",
          similarity: score.toFixed(2),
        });
      }
    }
  }

  const fertilizers = productsCatalog.filter((row) => row.product_type === "fertilizer");
  const additives = productsCatalog.filter((row) => row.product_type === "additive");
  const importReady = productsCatalog.filter((row) => row.import_status === "IMPORT_READY");
  const blocked = productsCatalog.filter((row) => row.import_status !== "IMPORT_READY");

  const productHeaders = [
    "trade_name",
    "normalized_name",
    "product_type",
    "category",
    "fertilizer_type",
    "additive_type",
    "N",
    "P",
    "K",
    "S",
    "Ca",
    "Mg",
    "B",
    "Zn",
    "Mn",
    "Cu",
    "Fe",
    "Mo",
    "amino_acids",
    "humic_acids",
    "fulvic_acids",
    "composition_text",
    "formulation",
    "application_method",
    "application_rate",
    "storage_unit",
    "issue_unit",
    "default_rate_unit",
    "default_dosing_type",
    "manufacturer",
    "source_url",
    "source_name",
    "confidence",
    "import_status",
    "raw_attributes_json",
  ];

  await writeCsv(path.join(OUTPUT_DIR, "fertilizers_catalog.csv"), fertilizers, productHeaders);
  await writeCsv(path.join(OUTPUT_DIR, "additives_catalog.csv"), additives, productHeaders);
  await writeCsv(path.join(OUTPUT_DIR, "products_catalog.csv"), productsCatalog, productHeaders);
  await writeCsv(path.join(OUTPUT_DIR, "import_ready_products.csv"), importReady, productHeaders);
  await writeCsv(path.join(OUTPUT_DIR, "blocked_products.csv"), blocked, productHeaders);
  await writeCsv(path.join(OUTPUT_DIR, "exact_duplicates.csv"), exactDuplicateRows, [
    "duplicate_key",
    "duplicate_count",
    "decision",
    "trade_name",
    "source_name",
    "manufacturer",
    "source_url",
  ]);
  await writeCsv(path.join(OUTPUT_DIR, "possible_duplicates.csv"), possibleDuplicateRows, [
    "product_a",
    "source_a",
    "product_b",
    "source_b",
    "reason",
    "confidence",
    "similarity",
  ]);
  await writeCsv(path.join(OUTPUT_DIR, "dedupe_decisions.csv"), dedupeDecisionRows, [
    "duplicate_key",
    "trade_name",
    "source_name",
    "decision",
    "reason",
  ]);

  const sourceCounts = Array.from(new Set(productsCatalog.map((row) => row.source_name))).sort().map((source) => ({
    source,
    rows: productsCatalog.filter((row) => row.source_name === source).length,
    import_ready: importReady.filter((row) => row.source_name === source).length,
    blocked: blocked.filter((row) => row.source_name === source).length,
  }));
  const stats = [
    "# Global fertilizers/additives 2026 dry catalog stats",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Scope",
    "",
    "- Dry catalog build only.",
    "- No Supabase, SQL, company data, warehouses, balances, ledger, batches, or operations were touched.",
    "- BossAgro pesticides scope is closed and not used here.",
    "",
    "## Counts",
    "",
    `- total products: ${productsCatalog.length}`,
    `- fertilizers count: ${fertilizers.length}`,
    `- additives count: ${additives.length}`,
    `- import_ready: ${importReady.length}`,
    `- blocked: ${blocked.length}`,
    `- exact_duplicates: ${exactDuplicateRows.length}`,
    `- possible_duplicates: ${possibleDuplicateRows.length}`,
    `- with storage_unit: ${productsCatalog.filter((row) => row.storage_unit !== "unknown").length}`,
    `- without storage_unit: ${productsCatalog.filter((row) => row.storage_unit === "unknown").length}`,
    `- with default_rate_unit: ${productsCatalog.filter((row) => row.default_rate_unit !== "unknown").length}`,
    `- without default_rate_unit: ${productsCatalog.filter((row) => row.default_rate_unit === "unknown").length}`,
    "",
    "## By Source",
    "",
    "| source | rows | import_ready | blocked |",
    "| --- | ---: | ---: | ---: |",
    ...sourceCounts.map((row) => `| ${row.source} | ${row.rows} | ${row.import_ready} | ${row.blocked} |`),
  ].join("\n");
  writeFileSync(path.join(OUTPUT_DIR, "catalog_stats.md"), `${stats}\n`, "utf8");

  const notes = [
    "# Global fertilizers/additives 2026 import notes",
    "",
    "This is a dry catalog build for review. Nothing was inserted into the database.",
    "",
    "## Source handling",
    "",
    "- AlemAgro, AgriTecno, SwissGrow, Miller, Yara, EuroChem and Kazphosphate were checked against public pages available during collection.",
    "- Tradecorp and Valagro rows are prepared under their current public brand/catalog references under Rovensa Next / Syngenta Biologicals.",
    "- KazAzot rows are low-confidence until a product-level public catalog is confirmed.",
    "- EcoSave did not have a resolved product-level source in this pass; it is blocked for source review.",
    "- AgroMart public source is product-category level, not SKU-level; generic rows are blocked.",
    "",
    "## Unit policy",
    "",
    "- Only Russian units were used: л, кг, г, мл, л/га, кг/га, г/га, мл/га, мл/100 л, л/1000 л, кг/1000 л, unknown.",
    "- Rows with unknown storage or rate unit are marked NEED_UNIT_CHECK.",
    "",
    "## Dedupe policy",
    "",
    "- Exact normalized_name duplicates are identified in exact_duplicates.csv and skipped from import_ready after keeping the first canonical row.",
    "- Similar names and manufacturer/composition overlaps are reported in possible_duplicates.csv for manual review.",
  ].join("\n");
  writeFileSync(path.join(OUTPUT_DIR, "import_notes.md"), `${notes}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        total_products: productsCatalog.length,
        fertilizers: fertilizers.length,
        additives: additives.length,
        import_ready: importReady.length,
        blocked: blocked.length,
        exact_duplicates: exactDuplicateRows.length,
        possible_duplicates: possibleDuplicateRows.length,
        output_dir: OUTPUT_DIR,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

