import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const BASE_URL = "https://bossagro.kz";
export const ROOT_CATEGORY_URL = `${BASE_URL}/glossary/category/pesticides/`;
export const OUTPUT_DIR = path.join(process.cwd(), "data", "import", "bossagro_pesticides");
export const RAW_DIR = path.join(OUTPUT_DIR, "raw_pages");
export const PARSED_DIR = path.join(OUTPUT_DIR, "parsed");

export type LinkRow = {
  category_name: string;
  category_url: string;
  trade_name_from_list: string;
  product_url: string;
  slug: string;
};

export type ParsedProduct = {
  trade_name: string;
  original_name: string;
  normalized_name: string;
  product_url: string;
  source_name: "BossAgro";
  source_type: "reference_catalog";
  product_type: "pesticide";
  category: "pesticide";
  pesticide_type: string;
  source_categories: string[];
  additional_pesticide_types: string[];
  status_text: string;
  allowed_in_kazakhstan_from_source: "yes" | "no" | "unknown";
  published_date: string;
  short_description: string;
  active_ingredients: string;
  concentration_text: string;
  formulation: string;
  chemical_class: string;
  penetration_method: string;
  action_type: string;
  hazard_class_human: string;
  hazard_class_bees: string;
  crops_summary: string;
  target_objects_summary: string;
  manufacturer: string;
  storage_unit: string;
  issue_unit: string;
  default_rate_unit: string;
  default_dosing_type: string;
  source_url: string;
  confidence: string;
  import_status: string;
  raw_attributes_json: string;
  parse_status: "OK" | "BLOCKED";
};

export type UsageRule = {
  product_normalized_name: string;
  product_trade_name: string;
  application_rate: string;
  application_rate_unit: string;
  crop: string;
  treated_object: string;
  target_object: string;
  application_method: string;
  application_timing: string;
  restrictions: string;
  waiting_period_text: string;
  waiting_period_days: string;
  max_applications: string;
  source_url: string;
  source_name: "BossAgro";
  confidence: string;
  raw_usage_row_json: string;
};

export type ActiveIngredientRow = {
  name_ru: string;
  name_en: string;
  normalized_name: string;
  type: string;
  chemical_class: string;
  source_url: string;
  source_name: "BossAgro";
  confidence: string;
};

export type ProductActiveIngredientRow = {
  product_normalized_name: string;
  product_trade_name: string;
  active_ingredient_normalized_name: string;
  active_ingredient_name_ru: string;
  concentration_text: string;
  concentration_part: string;
  source_url: string;
  confidence: string;
  parse_status: string;
};

export type ParsedPageBundle = {
  product: ParsedProduct;
  activeIngredients: ActiveIngredientRow[];
  productActiveIngredients: ProductActiveIngredientRow[];
  usageRules: UsageRule[];
  usageWarnings: Record<string, string>[];
  blocked: Record<string, string>[];
};

export const CATEGORY_TYPE_MAP: Record<string, string> = {
  "Гербициды": "herbicide",
  "Десиканты": "desiccant",
  "Инсектициды и акарициды сельскохозяйственные": "insecticide_acaricide",
  "Моллюскоциды": "molluscicide",
  "Нематициды": "nematicide",
  "Репелленты": "repellent",
  "Родентициды": "rodenticide",
  "Феромоны": "pheromone",
  "Фумиганты": "fumigant",
  "Фунгициды": "fungicide",
  "Регуляторы роста растений": "growth_regulator",
};

const LIQUID_FORMS = [
  "ВР",
  "ВРК",
  "КЭ",
  "СК",
  "СЭ",
  "МКС",
  "МД",
  "МЭ",
  "ВСК",
  "ЭМВ",
  "ВЭ",
  "жидкость",
  "водный раствор",
  "концентрат эмульсии",
  "суспензионная эмульсия",
];

const DRY_FORMS = [
  "ВДГ",
  "СП",
  "РП",
  "Г",
  "П",
  "порошок",
  "гранулы",
  "водно-диспергируемые гранулы",
  "смачивающийся порошок",
  "таб",
];

export async function ensureDirs() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(PARSED_DIR, { recursive: true });
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomDelay(min = 300, max = 800) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function absoluteUrl(href: string) {
  return new URL(href, BASE_URL).toString();
}

export function safeAbsoluteUrl(href: string) {
  try {
    return absoluteUrl(href.trim());
  } catch {
    return null;
  }
}

export function slugFromUrl(input: string) {
  const url = new URL(input, BASE_URL);
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] || "index";
}

export function isProductGlossaryUrl(input: string) {
  const url = new URL(input, BASE_URL);
  const parts = url.pathname.split("/").filter(Boolean);
  return url.hostname === "bossagro.kz" && parts.length === 2 && parts[0] === "glossary";
}

export function isCategoryUrl(input: string) {
  const url = new URL(input, BASE_URL);
  const parts = url.pathname.split("/").filter(Boolean);
  return url.hostname === "bossagro.kz" && parts.length === 3 && parts[0] === "glossary" && parts[1] === "category";
}

export async function fetchText(url: string, attempts = 3): Promise<{ status: number; text: string }> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": "TravkinFlow data preparation bot (read-only catalog build; contact: local project owner)",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      const text = await res.text();
      if (res.ok) return { status: res.status, text };
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await sleep(500 * attempt);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function decodeHtml(input: string) {
  const named: Record<string, string> = {
    nbsp: " ",
    amp: "&",
    quot: "\"",
    apos: "'",
    lt: "<",
    gt: ">",
    mdash: "—",
    ndash: "–",
    laquo: "«",
    raquo: "»",
    hellip: "…",
    times: "×",
  };
  return input
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (full, name) => named[name] ?? full);
}

export function stripTags(input: string) {
  return cleanText(
    input
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

export function cleanText(input: string) {
  return decodeHtml(input)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractAnchors(html: string) {
  return Array.from(html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))
    .map((match) => {
      const href = safeAbsoluteUrl(match[1]);
      return href ? { href, text: stripTags(match[2]) } : null;
    })
    .filter((anchor): anchor is { href: string; text: string } => Boolean(anchor));
}

export function extractMeta(html: string, nameOrProp: string) {
  const escaped = nameOrProp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexes = [
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
  ];
  for (const regex of regexes) {
    const match = html.match(regex);
    if (match) return cleanText(match[1]);
  }
  return "";
}

export function extractJsonLdDates(html: string) {
  const scripts = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  for (const script of scripts) {
    try {
      const json = JSON.parse(cleanText(script[1]));
      const graph = Array.isArray(json["@graph"]) ? json["@graph"] : [json];
      for (const node of graph) {
        if (node?.datePublished || node?.dateModified) {
          return {
            published: String(node.datePublished ?? ""),
            modified: String(node.dateModified ?? ""),
          };
        }
      }
    } catch {
      // Ignore malformed schema fragments.
    }
  }
  return { published: "", modified: "" };
}

export function extractTables(html: string) {
  return Array.from(html.matchAll(/<table\b[\s\S]*?<\/table>/gi)).map((tableMatch) => {
    const tableHtml = tableMatch[0];
    return Array.from(tableHtml.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)).map((rowMatch) =>
      Array.from(rowMatch[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((cellMatch) =>
        stripTags(cellMatch[1])
      )
    );
  });
}

export function extractArticleHtml(html: string) {
  const start = html.indexOf('<div class="article"');
  if (start < 0) return html;
  const endMarkers = ["<div class=\"sidebar", "<footer", "</body>"];
  let end = html.length;
  for (const marker of endMarkers) {
    const idx = html.indexOf(marker, start + 1);
    if (idx > start && idx < end) end = idx;
  }
  return html.slice(start, end);
}

export function normalizeName(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"']/g, "")
    .replace(/\bк\s*[.]?\s*с\s*[.]?\b/gi, "кс")
    .replace(/\bв\s*[.]?\s*д\s*[.]?\s*г\s*[.]?\b/gi, "вдг")
    .replace(/\bв\s*[.]?\s*р\s*[.]?\b/gi, "вр")
    .replace(/\bк\s*[.]?\s*э\s*[.]?\b/gi, "кэ")
    .replace(/\bс\s*[.]?\s*э\s*[.]?\b/gi, "сэ")
    .replace(/\bс\s*[.]?\s*к\s*[.]?\b/gi, "ск")
    .replace(/[.,;:]+/g, " ")
    .replace(/[^0-9a-zа-я%+-]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mapPesticideType(categoryName: string) {
  return CATEGORY_TYPE_MAP[categoryName] ?? "unknown";
}

export function choosePesticideTypes(categories: string[]) {
  const typed = categories
    .filter((category) => category !== "Пестициды")
    .map((category) => mapPesticideType(category))
    .filter((type) => type !== "unknown");
  const first = typed[0] ?? "unknown";
  return {
    primary: first,
    additional: Array.from(new Set(typed.slice(1).filter((type) => type !== first))),
  };
}

export function splitParts(value: string) {
  const text = cleanText(value);
  if (!text || text === "unknown") return [];
  return text
    .split(/\s+\+\s+|\s*;\s*|\s+\/\s+|\s+и\s+|,(?!\d)/i)
    .map((part) => cleanText(part))
    .filter(Boolean);
}

export function splitConcentration(value: string) {
  return cleanText(value)
    .split(/\s+\+\s+|\s*;\s*|\s+\/\s+|,(?!\d)/i)
    .map((part) => cleanText(part))
    .filter(Boolean);
}

export function inferStorageUnit(formulation: string) {
  const form = cleanText(formulation).toLowerCase();
  if (!form || form === "unknown") return "unknown";
  if (LIQUID_FORMS.some((item) => form.includes(item.toLowerCase()))) return "л";
  if (DRY_FORMS.some((item) => form.includes(item.toLowerCase()))) return "кг";
  return "unknown";
}

export function inferRateUnit(rate: string, header = "", formulation = "") {
  const combined = cleanText(`${rate} ${header}`).toLowerCase();
  const explicit = [
    "мл/100 л",
    "л/1000 л",
    "кг/1000 л",
    "кг/га",
    "л/га",
    "г/га",
    "мл/га",
    "г/т",
    "л/т",
    "мл/т",
    "кг/т",
  ];
  for (const unit of explicit) {
    if (combined.includes(unit)) return unit;
  }
  if (combined.includes("л/га") && combined.includes("кг/га")) {
    const storage = inferStorageUnit(formulation);
    if (storage === "л") return "л/га";
    if (storage === "кг") return "кг/га";
  }
  return "unknown";
}

export function dosingType(rateUnit: string) {
  if (["л/га", "кг/га", "г/га", "мл/га"].includes(rateUnit)) return "per_ha";
  if (["г/т", "л/т", "мл/т", "кг/т"].includes(rateUnit)) return "per_t_material";
  if (rateUnit === "мл/100 л") return "per_100_l_solution";
  if (["л/1000 л", "кг/1000 л"].includes(rateUnit)) return "per_1000_l_solution";
  return "unknown";
}

export function parseWaitingPeriod(value: string) {
  const text = cleanText(value) || "unknown";
  const daysMatch = text.match(/^\s*(\d+)/);
  const appsMatch = text.match(/\((\d+)\)/);
  return {
    text,
    days: daysMatch ? daysMatch[1] : "unknown",
    maxApplications: appsMatch ? appsMatch[1] : "unknown",
  };
}

export function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function writeCsv(filePath: string, rows: Record<string, unknown>[], headers: string[]) {
  const content = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  await writeFile(filePath, `${content}\n`, "utf8");
}

export async function readCsv(filePath: string): Promise<Record<string, string>[]> {
  const text = await readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function parseCsvLine(line: string) {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export async function safeJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function listHtmlFiles(dir: string) {
  try {
    const names = await readdir(dir);
    const files: string[] = [];
    for (const name of names) {
      const fullPath = path.join(dir, name);
      const info = await stat(fullPath);
      if (info.isFile() && name.endsWith(".html")) files.push(fullPath);
    }
    return files.sort();
  } catch {
    return [];
  }
}

export function levenshtein(a: string, b: string) {
  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const curr = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

export function similarity(a: string, b: string) {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}
