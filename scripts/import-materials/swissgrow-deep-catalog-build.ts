import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

type Nutrients = Partial<
  Record<
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
    | "fulvic_acids",
    string
  >
>;

type RawProduct = {
  trade_name: string;
  product_type?: ProductType;
  fertilizer_type?: FertilizerType;
  additive_type?: AdditiveType;
  nutrients?: Nutrients;
  composition_text: string;
  formulation?: string;
  application_method: ApplicationMethod;
  application_rate: string;
  crops?: string;
  purpose: string;
  storage_unit?: string;
  issue_unit?: string;
  default_rate_unit?: string;
  default_dosing_type?: string;
  manufacturer?: string;
  source_url: string;
  source_name: string;
  confidence: "high" | "medium" | "low";
  import_status?: string;
  blocked_reason?: string;
  raw_notes?: Record<string, string>;
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
  crops: string;
  purpose: string;
  storage_unit: string;
  issue_unit: string;
  default_rate_unit: string;
  default_dosing_type: string;
  manufacturer: string;
  source_url: string;
  source_name: string;
  confidence: string;
  import_status: string;
  blocked_reason: string;
  existing_in_global_wave: string;
  global_wave_match: string;
  raw_attributes_json: string;
};

const OUTPUT_DIR = path.join(process.cwd(), "data", "import", "swissgrow_deep_catalog_2026");
const FIRST_WAVE_PRODUCTS = path.join(process.cwd(), "data", "import", "global_fertilizers_additives_2026", "products_catalog.csv");

const HEADERS = [
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
  "crops",
  "purpose",
  "storage_unit",
  "issue_unit",
  "default_rate_unit",
  "default_dosing_type",
  "manufacturer",
  "source_url",
  "source_name",
  "confidence",
  "import_status",
  "blocked_reason",
  "existing_in_global_wave",
  "global_wave_match",
  "raw_attributes_json",
];

const OFFICIAL_COM = "https://www.swissgrow.com";
const OFFICIAL_KZ = "https://swissgrow.kz/en";
const ELDALA_URL = "https://eldala.kz/dannye/kompanii/2390-swissgrow";
const TRADEWHEEL_URL = "https://www.tradewheel.com/co/swissgrow-llp-1024986/";

function normalizeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[®™©]/g, "")
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readFirstWaveSwissGrow() {
  let text = "";
  try {
    text = readFileSync(FIRST_WAVE_PRODUCTS, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return new Map<string, string>();
  }

  const rows = parseCsv(text);
  const result = new Map<string, string>();
  for (const row of rows) {
    if (String(row.source_name || "").toLowerCase() !== "swissgrow") continue;
    const name = String(row.trade_name || row.name || "");
    if (name) result.set(normalizeName(name), name);
  }
  return result;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [headers, ...body] = rows.filter((item) => item.some((cellValue) => cellValue.length > 0));
  if (!headers) return [];
  return body.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath: string, rows: Record<string, unknown>[], headers: string[]) {
  const body = [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
  writeFileSync(filePath, `\uFEFF${body}\n`, "utf8");
}

function writeMd(filePath: string, text: string) {
  writeFileSync(filePath, `\uFEFF${text.trim()}\n`, "utf8");
}

function row(raw: RawProduct, firstWave: Map<string, string>): ProductRow {
  const productType = raw.product_type || "fertilizer";
  const normalizedName = normalizeName(raw.trade_name);
  const existingMatch = firstWave.get(normalizedName) || "";
  const hasRequiredBasics = Boolean(raw.storage_unit && raw.default_rate_unit && raw.application_rate && raw.composition_text !== "unknown");
  const importStatus =
    raw.import_status ||
    (existingMatch
      ? "EXISTING_FIRST_WAVE"
      : hasRequiredBasics
      ? "IMPORT_READY"
      : raw.blocked_reason
      ? "BLOCKED"
      : "NEED_DATA_CHECK");

  const rawJson = {
    crops: raw.crops || "all plants",
    purpose: raw.purpose,
    source_name: raw.source_name,
    source_url: raw.source_url,
    confidence: raw.confidence,
    blocked_reason: raw.blocked_reason || "",
    notes: raw.raw_notes || {},
    collection_note: "SwissGrow deep catalog dry build only. No database import.",
  };

  return {
    trade_name: raw.trade_name,
    normalized_name: normalizedName,
    product_type: productType,
    category: productType,
    fertilizer_type: productType === "fertilizer" ? raw.fertilizer_type || "unknown" : "",
    additive_type: productType === "additive" ? raw.additive_type || "unknown" : "",
    N: raw.nutrients?.N || "",
    P: raw.nutrients?.P || "",
    K: raw.nutrients?.K || "",
    S: raw.nutrients?.S || "",
    Ca: raw.nutrients?.Ca || "",
    Mg: raw.nutrients?.Mg || "",
    B: raw.nutrients?.B || "",
    Zn: raw.nutrients?.Zn || "",
    Mn: raw.nutrients?.Mn || "",
    Cu: raw.nutrients?.Cu || "",
    Fe: raw.nutrients?.Fe || "",
    Mo: raw.nutrients?.Mo || "",
    amino_acids: raw.nutrients?.amino_acids || "",
    humic_acids: raw.nutrients?.humic_acids || "",
    fulvic_acids: raw.nutrients?.fulvic_acids || "",
    composition_text: raw.composition_text,
    formulation: raw.formulation || "unknown",
    application_method: raw.application_method,
    application_rate: raw.application_rate,
    crops: raw.crops || "all plants",
    purpose: raw.purpose,
    storage_unit: raw.storage_unit || "unknown",
    issue_unit: raw.issue_unit || raw.storage_unit || "unknown",
    default_rate_unit: raw.default_rate_unit || "unknown",
    default_dosing_type: raw.default_dosing_type || "rate_per_area",
    manufacturer: raw.manufacturer || "SwissGrow",
    source_url: raw.source_url,
    source_name: raw.source_name,
    confidence: raw.confidence,
    import_status: importStatus,
    blocked_reason: raw.blocked_reason || (existingMatch ? "Already present in first global fertilizers/additives wave." : ""),
    existing_in_global_wave: existingMatch ? "true" : "false",
    global_wave_match: existingMatch,
    raw_attributes_json: JSON.stringify(rawJson),
  };
}

function productData(): RawProduct[] {
  return [
    {
      trade_name: "Bio Natura Humika",
      fertilizer_type: "organic",
      nutrients: { N: "11", K: "5", humic_acids: "15", fulvic_acids: "15" },
      composition_text: "organic matter >75%; total humic + fulvic acids >15%; nitrogen 11%; potassium 5%; leonardite extract",
      application_method: "fertigation",
      application_rate: "drip 2-4 kg/da; foliar not specified",
      purpose: "soil conditioner, root development, stress resistance, soil physical/chemical/biological improvement",
      storage_unit: "кг",
      default_rate_unit: "кг/га",
      source_url: `${OFFICIAL_KZ}/product/bio-natura-humika/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Fulvimax",
      fertilizer_type: "organic",
      nutrients: { N: "11", K: "2.5", humic_acids: "15", fulvic_acids: "15" },
      composition_text: "high fulvic acid organic product; total humic + fulvic acids 15%; nitrogen 11%; potassium 2.5%",
      application_method: "fertigation",
      application_rate: "drip 1-2 L/da; foliar not specified",
      purpose: "root growth, organic chelation, nutrient uptake, abiotic stress resistance",
      storage_unit: "л",
      default_rate_unit: "л/га",
      source_url: `${OFFICIAL_KZ}/product/fulvimaks/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Sancrop",
      fertilizer_type: "biostimulant",
      nutrients: {},
      composition_text: "Ascophyllum nodosum seaweed extract; total organic matter 45%",
      application_method: "foliar",
      application_rate: "foliar 30-70 g/100 L; drip 50-100 g/da",
      purpose: "seaweed biostimulant, nutrient uptake, germination, growth, fruit quality, stress resistance",
      storage_unit: "кг",
      default_rate_unit: "г/100 л",
      source_url: `${OFFICIAL_KZ}/product/sankrop/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Algamina",
      fertilizer_type: "biostimulant",
      nutrients: { N: "9", P: "6", K: "21", Mg: "2", Fe: "0.2", Mn: "0.1", Zn: "0.02", Cu: "0.02" },
      composition_text:
        "animal-origin amino acids + marine algae; organic matter 20%; nitrogen 9%; P2O5 6%; K2O 21%; MgO 2%; EDTA/EDDHA Fe, Mn, Zn, Cu",
      application_method: "foliar",
      application_rate: "foliar 200-250 g/100 L; drip 2.4 kg/da",
      purpose: "fruit growth, quality support, nutrient mobility, biotic and abiotic stress support",
      storage_unit: "кг",
      default_rate_unit: "г/100 л",
      source_url: `${OFFICIAL_KZ}/product/algamina/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Alginamin",
      fertilizer_type: "biostimulant",
      nutrients: { N: "5", amino_acids: "3" },
      composition_text: "organic matter 45%; organic nitrogen 5%; total free amino acids 3%; seaweed extract; natural growth regulators",
      application_method: "foliar",
      application_rate: "foliar 25-50 ml/100 L; drip 50-200 ml/da",
      purpose: "high-efficiency organic biostimulant, flowering/fruit dilution/vegetative growth/fruit size depending on timing",
      storage_unit: "л",
      default_rate_unit: "мл/100 л",
      source_url: `${OFFICIAL_KZ}/product/alginamin/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Amin Alga",
      fertilizer_type: "biostimulant",
      nutrients: { N: "5", amino_acids: "2" },
      composition_text: "organic matter 45%; organic nitrogen 5%; total free amino acids 2%; Ascophyllum nodosum seaweed extract",
      application_method: "foliar",
      application_rate: "foliar 200-350 g/100 L; drip not specified",
      purpose: "foliar organic biostimulant, amino acids, seaweed extract, stress resistance, nutrient transport",
      storage_unit: "кг",
      default_rate_unit: "г/100 л",
      source_url: `${OFFICIAL_KZ}/product/amin-alga/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Bio Kraft",
      fertilizer_type: "biostimulant",
      nutrients: { N: "8", amino_acids: "8" },
      composition_text: "animal-origin amino acids and peptides; organic matter 45%; organic nitrogen 8%; total free amino acids 8%",
      application_method: "foliar",
      application_rate: "foliar 150-300 ml/100 L; drip 1-2 L/da",
      purpose: "biostimulant amino acid product, stress support, nutrient transport, yield and quality support",
      storage_unit: "л",
      default_rate_unit: "мл/100 л",
      source_url: `${OFFICIAL_KZ}/product/bio-kraft/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "BioKraft Plus",
      fertilizer_type: "biostimulant",
      nutrients: { amino_acids: "present" },
      composition_text: "Bio Kraft series plus formulation; official page provides dose but not full nutrient breakdown separately",
      application_method: "foliar",
      application_rate: "foliar 100-300 ml/100 L; drip 1-2 L/da",
      purpose: "biostimulant amino acid product",
      storage_unit: "л",
      default_rate_unit: "мл/100 л",
      source_url: `${OFFICIAL_KZ}/product/bio-kraft/`,
      source_name: "SwissGrow official KZ",
      confidence: "medium",
      import_status: "NEED_COMPOSITION_CHECK",
      blocked_reason: "Official page lists BioKraft Plus dosing but does not expose separate composition.",
    },
    {
      trade_name: "Bio Energy",
      fertilizer_type: "biostimulant",
      nutrients: { N: "5", amino_acids: "2.5" },
      composition_text: "organic matter 45%; organic nitrogen 5%; total free amino acids 2.5%",
      application_method: "unknown",
      application_rate: "not specified separately on page",
      purpose: "biostimulant amino acid product related to Bio Kraft series",
      storage_unit: "л",
      default_rate_unit: "unknown",
      source_url: `${OFFICIAL_KZ}/product/bio-kraft/`,
      source_name: "SwissGrow official KZ",
      confidence: "medium",
      import_status: "NEED_RATE_CHECK",
      blocked_reason: "Composition present, but separate dose/mode for Bio Energy not provided on official page.",
    },
    {
      trade_name: "Start Up",
      fertilizer_type: "biostimulant",
      nutrients: { N: "4", amino_acids: "2" },
      composition_text: "organic matter 35%; organic nitrogen 4%; total free amino acids 2%; animal-origin amino acids",
      application_method: "fertigation",
      application_rate: "drip 2-5 L/da; foliar not specified",
      purpose: "drip organic fertilizer, soil improvement, microbial life support, energy during growing season",
      storage_unit: "л",
      default_rate_unit: "л/га",
      source_url: `${OFFICIAL_KZ}/product/start-ap/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Agrumax",
      fertilizer_type: "foliar",
      nutrients: { N: "16", P: "5", Mg: "5", Fe: "2", Mn: "4", B: "0.2", Zn: "4" },
      composition_text: "water-soluble micro crystals; nitrogen 16%; P2O5 5%; Mg 5%; Fe 2%; Mn 4%; B 0.2%; Zn 4%; EDTA/EDDHA chelated micros",
      application_method: "foliar",
      application_rate: "foliar 200-250 g/100 L; drip 2.4 kg/da",
      purpose: "foliar macro/micro nutrient correction, vegetative growth support, multi-element deficiencies",
      storage_unit: "кг",
      default_rate_unit: "г/100 л",
      source_url: `${OFFICIAL_KZ}/product/agrumaks/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Vitta K",
      fertilizer_type: "macro",
      nutrients: { P: "5", K: "40" },
      composition_text: "potassium 40%; P2O5 5%; organic acids; chlorine-free potassium source",
      application_method: "foliar",
      application_rate: "foliar 150-250 ml/100 L; drip 0.5-1 L/da",
      purpose: "fruit/tuber growth and ripening, brix, color, taste, aroma improvement",
      storage_unit: "л",
      default_rate_unit: "мл/100 л",
      source_url: `${OFFICIAL_KZ}/product/vitta-k/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Growcal",
      fertilizer_type: "macro",
      nutrients: { Ca: "12" },
      composition_text: "calcium 12%; calcium chloride with organic compounds and polysaccharides",
      application_method: "foliar",
      application_rate: "foliar 300-400 g/100 L; drip not specified",
      purpose: "calcium nutrition, fruit quality, post-harvest strength, shelf life",
      storage_unit: "кг",
      default_rate_unit: "г/100 л",
      source_url: `${OFFICIAL_KZ}/product/groukal/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Sprayfert 243",
      fertilizer_type: "foliar",
      nutrients: { N: "14", P: "28", K: "21", Mn: "0.1", Zn: "0.1" },
      composition_text: "NPK foliar fertilizer 14-28-21 + Mn 0.1% + Zn 0.1%",
      application_method: "foliar",
      application_rate: "foliar 100-200 g/100 L; drip not specified",
      purpose: "root growth, early vegetation, pre-blossoming, flowering support",
      storage_unit: "кг",
      default_rate_unit: "г/100 л",
      source_url: `${OFFICIAL_KZ}/product/seriya-sprejfert/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Sprayfert 312",
      fertilizer_type: "foliar",
      nutrients: { N: "27", P: "9", K: "18" },
      composition_text: "NPK foliar fertilizer 27-9-18",
      application_method: "foliar",
      application_rate: "foliar 100-200 g/100 L; drip not specified",
      purpose: "vegetative growth and vegetative/generative balance",
      storage_unit: "кг",
      default_rate_unit: "г/100 л",
      source_url: `${OFFICIAL_KZ}/product/seriya-sprejfert/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Sprayfert 239",
      fertilizer_type: "foliar",
      nutrients: { N: "10", P: "15", K: "45" },
      composition_text: "NPK foliar fertilizer 10-15-45",
      application_method: "foliar",
      application_rate: "foliar 100-200 g/100 L; drip not specified",
      purpose: "fruit growth/ripening, generative growth, potassium-focused nutrition",
      storage_unit: "кг",
      default_rate_unit: "г/100 л",
      source_url: `${OFFICIAL_KZ}/product/seriya-sprejfert/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Dufour 7-13-33 + TE",
      fertilizer_type: "water_soluble",
      nutrients: { N: "7", P: "13", K: "33", Cu: "0.01", Mo: "0.005", Fe: "0.02", Zn: "0.01", Mn: "0.01", B: "0.01" },
      composition_text: "NPK 7-13-33 + TE; nitrate N 4.5; ammonium N 2.5; EDTA microelements; humic/fulvic acids and amino acids in Dufour series",
      application_method: "fertigation",
      application_rate: "not specified on official page",
      purpose: "drip/fertigation nutrient availability, chelation, root-zone performance",
      storage_unit: "кг",
      default_rate_unit: "unknown",
      source_url: `${OFFICIAL_KZ}/product/seriya-dyufur/`,
      source_name: "SwissGrow official KZ",
      confidence: "medium",
      import_status: "NEED_RATE_CHECK",
      blocked_reason: "Official Dufour page exposes composition but no dose/mode table.",
    },
    {
      trade_name: "Dufour 16-16-16 + TE",
      fertilizer_type: "water_soluble",
      nutrients: { N: "16", P: "16", K: "16", Cu: "0.01", Mo: "0.005", Fe: "0.02", Zn: "0.01", Mn: "0.01", B: "0.01" },
      composition_text: "Official page text labels second formula as 10-46-7 + TE, but nutrient table shows total N 16, P2O5 16%, K2O 16%; requires source confirmation",
      application_method: "fertigation",
      application_rate: "not specified on official page",
      purpose: "drip/fertigation nutrient availability, chelation, root-zone performance",
      storage_unit: "кг",
      default_rate_unit: "unknown",
      source_url: `${OFFICIAL_KZ}/product/seriya-dyufur/`,
      source_name: "SwissGrow official KZ",
      confidence: "low",
      import_status: "NEED_COMPOSITION_CHECK",
      blocked_reason: "Official page has internal mismatch: product label 10-46-7 but nutrient table shows 16-16-16.",
    },
    {
      trade_name: "Cabamin",
      fertilizer_type: "micro",
      nutrients: { B: "3", Ca: "12" },
      composition_text: "boron 3%; calcium 12%; calcium chloride + boron-ethanolamine with organic compounds",
      application_method: "foliar",
      application_rate: "foliar 250-350 ml/100 L; drip not specified",
      purpose: "calcium/boron nutrition, post-harvest durability, bitter pit/cracking/blossom end rot prevention",
      storage_unit: "л",
      default_rate_unit: "мл/100 л",
      source_url: `${OFFICIAL_KZ}/product/kabamin/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Ferromax",
      fertilizer_type: "micro",
      nutrients: { Fe: "6" },
      composition_text: "iron 6%; EDDHA chelated iron 6%; ortho-ortho isomer ratio 4.2",
      application_method: "fertigation",
      application_rate: "foliar 100-200 g/100 L; drip 0.2-2 kg/da",
      purpose: "iron deficiency/chlorosis correction, stable pH 4-10",
      storage_unit: "кг",
      default_rate_unit: "кг/га",
      source_url: `${OFFICIAL_KZ}/product/ferromaks/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Gemmastim",
      fertilizer_type: "micro",
      nutrients: { B: "5", Zn: "5" },
      composition_text: "boron 5%; zinc 5%; boron ethanolamine with organic compounds",
      application_method: "foliar",
      application_rate: "foliar 150-250 ml/100 L; drip 0.5-1 L/da",
      purpose: "flowering, fruit set, vegetative balance, boron/zinc correction",
      storage_unit: "л",
      default_rate_unit: "мл/100 л",
      source_url: `${OFFICIAL_KZ}/product/dragoczennyj-kamen/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Microlan",
      fertilizer_type: "micro",
      nutrients: { B: "4", Mn: "0.5", Zn: "0.5" },
      composition_text: "special kaolin combination + boron 4%, manganese 0.5%, zinc 0.5%",
      application_method: "foliar",
      application_rate: "foliar 250-300 g/100 L; drip not specified",
      purpose: "sunburn/rust protection, fruit surface temperature reduction, fruit firmness and shelf-life support",
      storage_unit: "кг",
      default_rate_unit: "г/100 л",
      source_url: `${OFFICIAL_KZ}/product/mikrolan/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Curamin Foliar",
      fertilizer_type: "micro",
      nutrients: { Cu: "3", amino_acids: "present" },
      composition_text: "chelated copper with animal-based amino acids; foliar formulation with copper 3%",
      application_method: "foliar",
      application_rate: "not specified on official page",
      purpose: "systemic copper nutrition, fungal/bacterial disease protection, stress resistance",
      storage_unit: "л",
      default_rate_unit: "unknown",
      source_url: `${OFFICIAL_KZ}/product/seriya-kuramin/`,
      source_name: "SwissGrow official KZ",
      confidence: "medium",
      import_status: "NEED_RATE_CHECK",
      blocked_reason: "Official Curamin page confirms composition/use split, but does not expose dose.",
    },
    {
      trade_name: "Curamin Drip",
      fertilizer_type: "micro",
      nutrients: { Cu: "6.2", amino_acids: "present" },
      composition_text: "chelated copper with animal-based amino acids; drip/soil formulation with copper 6.2%",
      application_method: "fertigation",
      application_rate: "not specified on official page",
      purpose: "systemic copper nutrition through drip/soil, fungal/bacterial disease protection, stress resistance",
      storage_unit: "л",
      default_rate_unit: "unknown",
      source_url: `${OFFICIAL_KZ}/product/seriya-kuramin/`,
      source_name: "SwissGrow official KZ",
      confidence: "medium",
      import_status: "NEED_RATE_CHECK",
      blocked_reason: "Official Curamin page confirms composition/use split, but does not expose dose.",
    },
    {
      trade_name: "Fosiram",
      fertilizer_type: "micro",
      nutrients: { P: "5", K: "20", Cu: "13" },
      composition_text: "phosphorus 5%; potassium 20%; copper 13%; copper-based fertilizer with fungicidal/bactericidal support",
      application_method: "foliar",
      application_rate: "foliar 200-300 g/100 L; drip 1-2 kg/da",
      purpose: "copper nutrition, fungal/bacterial disease support, Bordeaux slurry alternative",
      storage_unit: "кг",
      default_rate_unit: "г/100 л",
      source_url: `${OFFICIAL_KZ}/product/fosiram/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Phoskraft Cu",
      fertilizer_type: "micro",
      nutrients: { N: "11", P: "22", Cu: "4" },
      composition_text: "phosphite-series fertilizer; total nitrogen 11%; phosphorus 22%; copper 4%",
      application_method: "foliar",
      application_rate: "foliar 100-300 ml/100 L; drip 1-2 L/da",
      purpose: "nutrition, phosphite stimulation, disease support, stress resistance",
      storage_unit: "л",
      default_rate_unit: "мл/100 л",
      source_url: `${OFFICIAL_KZ}/product/seriya-foskraft/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Phoskraft S",
      fertilizer_type: "macro",
      nutrients: { N: "12", P: "27", K: "6", S: "30" },
      composition_text: "phosphite-series fertilizer; total N 12%; ammonium N 10%; urea N 2%; phosphorus 27%; potassium 6%; sulfur 30%",
      application_method: "foliar",
      application_rate: "foliar 100-300 ml/100 L; drip 1-2 L/da",
      purpose: "nutrition, phosphite stimulation, disease support, stress resistance",
      storage_unit: "л",
      default_rate_unit: "мл/100 л",
      source_url: `${OFFICIAL_KZ}/product/seriya-foskraft/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Phoskraft MKP",
      fertilizer_type: "macro",
      nutrients: { P: "35", K: "23" },
      composition_text: "phosphite-series fertilizer; phosphorus 35%; potassium 23%",
      application_method: "fertigation",
      application_rate: "drip 1-2 L/da; foliar dose not shown in KZ text",
      purpose: "phosphorus/potassium nutrition, phosphite stimulation, stress resistance",
      storage_unit: "л",
      default_rate_unit: "л/га",
      source_url: `${OFFICIAL_KZ}/product/seriya-foskraft/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Phoskraft NPK",
      fertilizer_type: "macro",
      nutrients: { N: "3", P: "27", K: "18", B: "0.01", Fe: "0.02", Zn: "0.02", Mn: "0.02", Cu: "0.02" },
      composition_text: "phosphite-series NPK 3-27-18 with B, Fe EDTA, Zn EDTA, Mn EDTA, Cu EDTA each 0.01-0.02%",
      application_method: "foliar",
      application_rate: "foliar 100-300 ml/100 L; drip 1-2 L/da",
      purpose: "fruit ripening, pre-blossoming, nutrition, phosphite stimulation, stress resistance",
      storage_unit: "л",
      default_rate_unit: "мл/100 л",
      source_url: `${OFFICIAL_KZ}/product/seriya-foskraft/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Phoskraft Mn-Zn",
      fertilizer_type: "micro",
      nutrients: { N: "3", P: "30", Mn: "5", Zn: "5" },
      composition_text: "phosphite-series fertilizer; total nitrogen 3%; phosphorus 30%; manganese 5%; zinc 5%",
      application_method: "foliar",
      application_rate: "foliar 100-300 ml/100 L; drip 1-2 L/da",
      purpose: "Mn/Zn nutrition, phosphite stimulation, disease support, stress resistance",
      storage_unit: "л",
      default_rate_unit: "мл/100 л",
      source_url: `${OFFICIAL_KZ}/product/seriya-foskraft/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Phoskraft Zn",
      fertilizer_type: "micro",
      nutrients: { N: "3", K: "33", Zn: "10" },
      composition_text: "phosphite-series fertilizer; total nitrogen 3%; potassium 33%; zinc 10%",
      application_method: "foliar",
      application_rate: "foliar 100-300 ml/100 L; drip 1-2 L/da",
      purpose: "Zn/K nutrition, phosphite stimulation, disease support, stress resistance",
      storage_unit: "л",
      default_rate_unit: "мл/100 л",
      source_url: `${OFFICIAL_KZ}/product/seriya-foskraft/`,
      source_name: "SwissGrow official KZ",
      confidence: "high",
    },
    {
      trade_name: "Ammosol",
      fertilizer_type: "macro",
      nutrients: { N: "12", S: "26" },
      composition_text: "TradeWheel showcase: high sulfur liquid nitrogen fertilizer; snippet states N 12%, SO3 65%",
      application_method: "unknown",
      application_rate: "not available from open source snippet",
      purpose: "liquid nitrogen/sulfur fertilizer",
      storage_unit: "л",
      default_rate_unit: "unknown",
      source_url: TRADEWHEEL_URL,
      source_name: "TradeWheel supplier showcase",
      confidence: "low",
      import_status: "NEED_SOURCE_DETAILS",
      blocked_reason: "Only distributor showcase snippet found; official composition/rates need confirmation.",
    },
    {
      trade_name: "Boramin",
      fertilizer_type: "micro",
      nutrients: { N: "0.5", B: "10" },
      composition_text: "TradeWheel showcase: liquid nitrogen boron fertilizer; snippet states N 0.5%, B 10%",
      application_method: "unknown",
      application_rate: "not available from open source snippet",
      purpose: "liquid boron/nitrogen fertilizer",
      storage_unit: "л",
      default_rate_unit: "unknown",
      source_url: TRADEWHEEL_URL,
      source_name: "TradeWheel supplier showcase",
      confidence: "low",
      import_status: "NEED_SOURCE_DETAILS",
      blocked_reason: "Only distributor showcase snippet found; official composition/rates need confirmation.",
    },
    {
      trade_name: "Biostim",
      fertilizer_type: "biostimulant",
      nutrients: { N: "1" },
      composition_text: "TradeWheel showcase: water-soluble nitrogen and carbon product; snippet states N 1%, C 3% (truncated)",
      application_method: "unknown",
      application_rate: "not available from open source snippet",
      purpose: "biostimulant / water-soluble organic product",
      storage_unit: "кг",
      default_rate_unit: "unknown",
      source_url: TRADEWHEEL_URL,
      source_name: "TradeWheel supplier showcase",
      confidence: "low",
      import_status: "NEED_SOURCE_DETAILS",
      blocked_reason: "Only distributor showcase snippet found; official composition/rates need confirmation.",
    },
    ...eldalaOnlyRows(),
  ];
}

function eldalaOnlyRows(): RawProduct[] {
  const names = [
    "Micrall",
    "Growbor",
    "Growfert",
    "Bio Start",
    "CN Calcium Nitrate",
    "K-Drip",
    "MAP Monoammonium Phosphate",
    "MKP Monopotassium Phosphate",
    "MN Magnesium Nitrate",
    "N-DRIP L",
    "Nitrokal",
    "NOP Potassium Nitrate",
  ];

  return names.map((name): RawProduct => ({
    trade_name: name,
    fertilizer_type: /bor|cn|map|mkp|mn|nitro|nop/i.test(name) ? "macro" : "unknown",
    nutrients: {},
    composition_text: "Listed by ElDala as SwissGrow product/line; detailed composition not available in collected public sources.",
    application_method: "unknown",
    application_rate: "not available",
    purpose: "SwissGrow product/line listed in Kazakhstan company profile",
    storage_unit: "unknown",
    default_rate_unit: "unknown",
    source_url: ELDALA_URL,
    source_name: "ElDala company profile",
    confidence: "low",
    import_status: "NEED_SOURCE_DETAILS",
    blocked_reason: "Only product/line name found in ElDala profile; official label/brochure needed before import.",
  }));
}

function buildDuplicates(rows: ProductRow[]) {
  const duplicateRows: Record<string, string>[] = [];
  for (const rowItem of rows) {
    if (rowItem.existing_in_global_wave === "true") {
      duplicateRows.push({
        review_type: "EXISTING_FIRST_WAVE",
        trade_name: rowItem.trade_name,
        normalized_name: rowItem.normalized_name,
        matched_name: rowItem.global_wave_match,
        recommendation: "Не импортировать как новую строку. Использовать уже собранную SwissGrow строку первой волны.",
        confidence: "high",
        source_url: rowItem.source_url,
      });
    }
  }

  const manualPairs: Array<[string, string, string]> = [
    ["Bio Start", "Start Up", "Возможный алиас/локальное название; нужна ручная сверка упаковки."],
    ["Curamin", "Curamin Foliar / Curamin Drip", "Линейка разбита на две формулы; общий Curamin не импортировать отдельно."],
    ["Dufour Series", "Dufour 7-13-33 + TE / Dufour 16-16-16 + TE", "Серия разбита на формулы; одна формула требует проверки состава."],
    ["Phoskraft Series", "Phoskraft Cu/S/MKP/NPK/Mn-Zn/Zn", "Серия разбита на шесть формул; общий продукт не импортировать отдельно."],
    ["MKP Monopotassium Phosphate", "Phoskraft MKP", "Generic MKP и брендовая Phoskraft MKP могут быть разными товарами."],
    ["Bio Energy", "Bio Kraft", "Одна страница описывает оба продукта; Bio Energy требует отдельной нормы применения."],
  ];
  for (const [left, right, note] of manualPairs) {
    duplicateRows.push({
      review_type: "POSSIBLE_ALIAS_OR_SERIES",
      trade_name: left,
      normalized_name: normalizeName(left),
      matched_name: right,
      recommendation: note,
      confidence: "medium",
      source_url: left === "Bio Energy" ? `${OFFICIAL_KZ}/product/bio-kraft/` : ELDALA_URL,
    });
  }

  return duplicateRows;
}

function makeStats(rows: ProductRow[], importReady: ProductRow[], blocked: ProductRow[], possibleDuplicates: Record<string, string>[]) {
  const sourceCounts = new Map<string, number>();
  for (const item of rows) {
    sourceCounts.set(item.source_name, (sourceCounts.get(item.source_name) || 0) + 1);
  }
  const sourceLines = Array.from(sourceCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source, count]) => `| ${source} | ${count} |`)
    .join("\n");

  const withStorage = rows.filter((item) => item.storage_unit !== "unknown").length;
  const withRate = rows.filter((item) => item.default_rate_unit !== "unknown").length;
  const existingFirstWave = rows.filter((item) => item.existing_in_global_wave === "true").length;

  return `# SwissGrow Deep Catalog 2026

Dry catalog build only. No database import, no Supabase writes.

## Summary

| Metric | Count |
| --- | ---: |
| total catalog rows | ${rows.length} |
| fertilizers | ${rows.filter((item) => item.product_type === "fertilizer").length} |
| additives | ${rows.filter((item) => item.product_type === "additive").length} |
| existing in first global fertilizer/additive wave | ${existingFirstWave} |
| import_ready new rows | ${importReady.length} |
| blocked / needs check | ${blocked.length} |
| possible duplicate / alias rows | ${possibleDuplicates.length} |
| rows with storage_unit | ${withStorage} |
| rows without storage_unit | ${rows.length - withStorage} |
| rows with default_rate_unit | ${withRate} |
| rows without default_rate_unit | ${rows.length - withRate} |

## By Source

| Source | Rows |
| --- | ---: |
${sourceLines}

## Notes

- The official SwissGrow Kazakhstan product catalog exposes more categories than the older .com product page: Bio, Biostimulants, Drip, Macro Specials, Micro Specials, Systemic.
- Product series were split into agronomically usable rows where the official page exposed separate formulas: Sprayfert, Phoskraft, Curamin.
- First-wave SwissGrow rows were not placed into import_ready to avoid duplicates.
- ElDala-only and TradeWheel-only rows are kept as blocked/reference leads until an official label, brochure, or full product card is found.
`;
}

function makeSourcesReport() {
  return `# SwissGrow Sources Report

## Used Sources

| Source | URL | Use | Confidence |
| --- | --- | --- | --- |
| SwissGrow official products page | https://www.swissgrow.com/products/ | Baseline categories from older official site | high |
| SwissGrow official KZ shop | https://swissgrow.kz/en/shop/ | Main deep-pass category list and product pages | high |
| SwissGrow official KZ Bio category | https://swissgrow.kz/en/product-category/bio/ | Bio product list | high |
| SwissGrow official KZ Biostimulants category | https://swissgrow.kz/en/product-category/biostimulyatory/ | Biostimulant product list | high |
| SwissGrow official KZ Drip category | https://swissgrow.kz/en/product-category/zhidkost/ | Drip/liquid product list | high |
| SwissGrow official KZ Macro category | https://swissgrow.kz/en/product-category/makro-predlozheniya/ | Macro product list | high |
| SwissGrow official KZ Micro category | https://swissgrow.kz/en/product-category/mikro-predlozheniya/ | Micro product list | high |
| SwissGrow official KZ Systemic category | https://swissgrow.kz/en/product-category/sistemnye/ | Systemic product list | high |
| ElDala SWISSGROW company profile | ${ELDALA_URL} | Additional product/line names not exposed as detailed product cards | low |
| TradeWheel SWISSGROW LLP profile | ${TRADEWHEEL_URL} | Additional showcase leads: Ammosol, Boramin, Biostim | low |

## Source Handling

- Official SwissGrow KZ product pages are treated as primary source for composition and rates.
- Official SwissGrow .com pages are used as cross-check where KZ pages match older official content.
- ElDala and TradeWheel rows are not import-ready unless a detailed SwissGrow product page is found.
- No legal/registration status is inferred from these sources.
`;
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const firstWave = readFirstWaveSwissGrow();
  const rows = productData()
    .map((raw) => row(raw, firstWave))
    .sort((left, right) => left.trade_name.localeCompare(right.trade_name));

  const fertilizers = rows.filter((item) => item.product_type === "fertilizer");
  const additives = rows.filter((item) => item.product_type === "additive");
  const importReady = rows.filter((item) => item.import_status === "IMPORT_READY" && item.existing_in_global_wave !== "true");
  const blocked = rows.filter((item) => item.import_status !== "IMPORT_READY" || item.existing_in_global_wave === "true");
  const possibleDuplicates = buildDuplicates(rows);

  writeCsv(path.join(OUTPUT_DIR, "swissgrow_products_catalog.csv"), rows, HEADERS);
  writeCsv(path.join(OUTPUT_DIR, "swissgrow_fertilizers.csv"), fertilizers, HEADERS);
  writeCsv(path.join(OUTPUT_DIR, "swissgrow_additives.csv"), additives, HEADERS);
  writeCsv(path.join(OUTPUT_DIR, "swissgrow_import_ready.csv"), importReady, HEADERS);
  writeCsv(path.join(OUTPUT_DIR, "swissgrow_blocked.csv"), blocked, HEADERS);
  writeCsv(path.join(OUTPUT_DIR, "swissgrow_possible_duplicates.csv"), possibleDuplicates, [
    "review_type",
    "trade_name",
    "normalized_name",
    "matched_name",
    "recommendation",
    "confidence",
    "source_url",
  ]);
  writeMd(path.join(OUTPUT_DIR, "swissgrow_sources_report.md"), makeSourcesReport());
  writeMd(path.join(OUTPUT_DIR, "swissgrow_catalog_stats.md"), makeStats(rows, importReady, blocked, possibleDuplicates));

  console.log(`SwissGrow deep catalog written to ${OUTPUT_DIR}`);
  console.log(
    JSON.stringify(
      {
        total: rows.length,
        fertilizers: fertilizers.length,
        additives: additives.length,
        importReady: importReady.length,
        blocked: blocked.length,
        possibleDuplicates: possibleDuplicates.length,
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
