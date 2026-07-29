import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanHumanText, isCropParserFragment } from "../lib/glbd/human-pesticide-card";

const EXPECTED_BRANCH_REF = "gsglkmudcwkdetqtocae";
const OUTPUT_DIR = resolve(process.env.TZ237_OUTPUT_DIR || "../audit-output/TZ-237");
const ENV_FILE = resolve(
  process.env.TZ237_ENV_FILE
    || "../project-bolt-sb1-hjjzpfey-4/project/.env.local",
);

type Row = Record<string, any>;
type Action = "SAFE_APPLY" | "DISPLAY_RAW_ONLY" | "NEED_REVIEW" | "PARSER_FRAGMENT" | "NO_MATCH";

type CropReview = {
  usage_rule_id: string;
  product_id: string;
  trade_name: string;
  raw_crop: string;
  proposed_crop_id: string;
  proposed_crop_name: string;
  qualifier: string;
  match_method: string;
  confidence: string;
  action: Action;
};

type TargetReview = {
  usage_rule_id: string;
  product_id: string;
  trade_name: string;
  raw_target: string;
  proposed_target_ids: string;
  target_type: string;
  match_method: string;
  confidence: string;
  action: Action;
};

function parseEnv(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function required(env: Record<string, string>, key: string): string {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(`Missing ${key} in ignored QA env file`);
  return value;
}

function normalize(value: unknown): string {
  return cleanHumanText(value)
    ?.toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[–—−]/g, "-")
    .replace(/[«»"]/g, "")
    .replace(/\s+/g, " ")
    .trim() || "";
}

function unique(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = cleanHumanText(value);
    if (!text) continue;
    const key = normalize(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function flatten(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (value && typeof value === "object") {
    const row = value as Row;
    return [row.name_ru, row.name_en, row.name, row.label, row.value, row.target].flatMap(flatten);
  }
  const text = cleanHumanText(value);
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      return flatten(JSON.parse(text));
    } catch {
      return [text];
    }
  }
  return [text];
}

async function fetchAll(client: SupabaseClient, table: string, select = "*"): Promise<Row[]> {
  const pageSize = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data || []) as Row[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function csv<T extends Row>(rows: T[], headers: Array<keyof T>): string {
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}

function sqlLiteral(value: unknown): string {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function cropRaw(rule: Row): string | null {
  return cleanHumanText(rule.crop_name_raw)
    || cleanHumanText(rule.crop_name_original)
    || cleanHumanText(rule.crop_group_raw);
}

function cropBaseCandidates(raw: string): Array<{ value: string; method: string; confidence: number }> {
  const normalized = normalize(raw);
  const candidates: Array<{ value: string; method: string; confidence: number }> = [
    { value: normalized, method: "EXACT_NORMALIZED", confidence: 1 },
  ];
  const withoutParentheses = normalized.replace(/\s*\([^)]*\)\s*$/g, "").trim();
  if (withoutParentheses && withoutParentheses !== normalized) {
    candidates.push({ value: withoutParentheses, method: "UNAMBIGUOUS_QUALIFIER", confidence: 0.99 });
  }
  const knownSingleCropForms: Array<[RegExp, string]> = [
    [/^пшеница(?:\s+(?:яровая|озимая)|\s+яровая\s+и\s+озимая)?$/, "пшеница"],
    [/^ячмень(?:\s+(?:яровой|озимый)|\s+яровой\s+и\s+озимый)?$/, "ячмень"],
    [/^рапс(?:\s+(?:яровой|озимый)|\s+яровой\s+и\s+озимый)?$/, "рапс"],
    [/^лен(?:\s+(?:масличный|долгунец))?$/, "лен"],
    [/^свекла\s+сахарная$/, "сахарная свекла"],
    [/^кукуруза(?:\s+на\s+(?:зерно|силос))?$/, "кукуруза"],
    [/^подсолнечник(?:\s+на\s+семена)?$/, "подсолнечник"],
    [/^картофель$/, "картофель"],
    [/^соя$/, "соя"],
    [/^горох$/, "горох"],
    [/^нут$/, "нут"],
    [/^чечевица$/, "чечевица"],
  ];
  for (const [pattern, value] of knownSingleCropForms) {
    if (pattern.test(withoutParentheses || normalized)) {
      candidates.push({ value, method: "UNAMBIGUOUS_MORPHOLOGY", confidence: 0.99 });
    }
  }
  return candidates.filter((candidate, index, list) => (
    candidate.value
    && list.findIndex((item) => item.value === candidate.value) === index
  ));
}

function isAmbiguousCropGroup(raw: string): boolean {
  const normalized = normalize(raw);
  if (/^(?:пшеница|рапс|ячмень)\s+\S+\s+и\s+\S+$/.test(normalized)) return false;
  return /[,;/]|\s(?:и|или)\s/.test(normalized);
}

function cropQualifier(raw: string, canonicalName: string): string {
  return normalize(raw) === normalize(canonicalName) ? "" : raw;
}

function buildCropReview(rules: Row[], products: Map<string, Row>, crops: Row[]): CropReview[] {
  const cropIndex = new Map<string, Row[]>();
  for (const crop of crops) {
    const names = unique([
      crop.name_ru,
      crop.name_en,
      crop.name,
      ...flatten(crop.aliases),
    ]);
    for (const name of names) {
      const key = normalize(name);
      cropIndex.set(key, [...(cropIndex.get(key) || []), crop]);
    }
  }

  return rules
    .filter((rule) => !rule.crop_id && cropRaw(rule))
    .map((rule): CropReview => {
      const raw = cropRaw(rule) || "";
      const product = products.get(String(rule.product_id));
      const base = {
        usage_rule_id: String(rule.id),
        product_id: String(rule.product_id),
        trade_name: cleanHumanText(product?.trade_name) || cleanHumanText(product?.name) || "",
        raw_crop: raw,
        proposed_crop_id: "",
        proposed_crop_name: "",
        qualifier: "",
        match_method: "",
        confidence: "",
      };

      if (isCropParserFragment(raw)) {
        return { ...base, match_method: "PARSER_FRAGMENT", action: "PARSER_FRAGMENT" };
      }
      if (isAmbiguousCropGroup(raw)) {
        return { ...base, match_method: "MULTI_CROP_OR_GROUP", action: "DISPLAY_RAW_ONLY" };
      }

      for (const candidate of cropBaseCandidates(raw)) {
        const matches = cropIndex.get(candidate.value) || [];
        const uniqueMatches = Array.from(new Map(matches.map((row) => [row.id, row])).values());
        if (uniqueMatches.length === 1) {
          const crop = uniqueMatches[0];
          const name = cleanHumanText(crop.name_ru) || cleanHumanText(crop.name_en) || cleanHumanText(crop.name) || "";
          return {
            ...base,
            proposed_crop_id: String(crop.id),
            proposed_crop_name: name,
            qualifier: cropQualifier(raw, name),
            match_method: candidate.method,
            confidence: candidate.confidence.toFixed(2),
            action: "SAFE_APPLY",
          };
        }
        if (uniqueMatches.length > 1) {
          return {
            ...base,
            match_method: "AMBIGUOUS_CANONICAL_MATCH",
            confidence: "0.00",
            action: "NEED_REVIEW",
          };
        }
      }

      return { ...base, match_method: "NO_CANONICAL_MATCH", confidence: "0.00", action: "NO_MATCH" };
    });
}

function targetRaw(rule: Row): string | null {
  const values = unique([
    rule.target_text_original,
    ...flatten(rule.target_names_raw),
    rule.target_text,
  ]);
  return values.length ? values.join(", ") : null;
}

function targetNames(row: Row): string[] {
  return unique([
    row.name_ru,
    row.name_en,
    row.name,
    row.common_name,
    ...flatten(row.aliases),
  ]);
}

function buildTargetReview(
  rules: Row[],
  products: Map<string, Row>,
  targets: Array<{ type: "disease" | "pest" | "weed"; row: Row }>,
): TargetReview[] {
  const index = new Map<string, Array<{ type: "disease" | "pest" | "weed"; row: Row }>>();
  for (const target of targets) {
    for (const name of targetNames(target.row)) {
      const key = normalize(name);
      index.set(key, [...(index.get(key) || []), target]);
    }
  }

  return rules
    .filter((rule) => !rule.disease_id && !rule.pest_id && !rule.weed_id && targetRaw(rule))
    .map((rule): TargetReview => {
      const raw = targetRaw(rule) || "";
      const product = products.get(String(rule.product_id));
      const base = {
        usage_rule_id: String(rule.id),
        product_id: String(rule.product_id),
        trade_name: cleanHumanText(product?.trade_name) || cleanHumanText(product?.name) || "",
        raw_target: raw,
        proposed_target_ids: "",
        target_type: "",
        match_method: "",
        confidence: "",
      };
      const rawParts = unique([
        rule.target_text_original,
        ...flatten(rule.target_names_raw),
        rule.target_text,
      ]);
      if (rawParts.length !== 1 || /[,;/]|\s(?:и|или)\s/i.test(raw)) {
        return { ...base, match_method: "TARGET_GROUP_OR_LIST", action: "DISPLAY_RAW_ONLY" };
      }
      const matches = index.get(normalize(rawParts[0])) || [];
      const uniqueMatches = Array.from(new Map(matches.map((target) => [`${target.type}:${target.row.id}`, target])).values());
      if (uniqueMatches.length === 1) {
        const target = uniqueMatches[0];
        return {
          ...base,
          proposed_target_ids: String(target.row.id),
          target_type: target.type,
          match_method: "EXACT_CANONICAL_NAME",
          confidence: "1.00",
          action: "SAFE_APPLY",
        };
      }
      if (uniqueMatches.length > 1) {
        return {
          ...base,
          match_method: "AMBIGUOUS_TARGET_TYPE_OR_ID",
          confidence: "0.00",
          action: "NEED_REVIEW",
        };
      }
      return { ...base, match_method: "NO_CANONICAL_MATCH", confidence: "0.00", action: "NO_MATCH" };
    });
}

async function writeArtifact(name: string, content: string): Promise<void> {
  await writeFile(resolve(OUTPUT_DIR, name), content, "utf8");
}

async function main() {
  const env = parseEnv(await readFile(ENV_FILE, "utf8"));
  const url = required(env, "A106_SUPABASE_URL");
  const anon = required(env, "A106_SUPABASE_ANON_KEY");
  const branchRef = required(env, "A106_BRANCH_REF");
  if (branchRef !== EXPECTED_BRANCH_REF || !url.includes(EXPECTED_BRANCH_REF)) {
    throw new Error(`STOP: expected QA branch ${EXPECTED_BRANCH_REF}, received ${branchRef}`);
  }

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const auth = await client.auth.signInWithPassword({
    email: required(env, "A106_TEST_USER_A_EMAIL"),
    password: required(env, "A106_TEST_USER_A_PASSWORD"),
  });
  if (auth.error || !auth.data.session) throw new Error(`QA sign-in failed: ${auth.error?.message || "session missing"}`);

  const [products, rules, crops, diseases, pests, weeds] = await Promise.all([
    fetchAll(client, "products", "id,trade_name,name,type,company_id"),
    fetchAll(client, "glbd_product_usage_rules"),
    fetchAll(client, "crops"),
    fetchAll(client, "diseases"),
    fetchAll(client, "pests"),
    fetchAll(client, "weeds"),
  ]);
  const pesticideProducts = products.filter((row) => row.type === "pesticide" && row.company_id === null);
  if (pesticideProducts.length !== 852) {
    throw new Error(`STOP: expected 852 QA pesticides, received ${pesticideProducts.length}`);
  }

  const productsById = new Map(pesticideProducts.map((row) => [String(row.id), row]));
  const cropReview = buildCropReview(rules, productsById, crops);
  const targetReview = buildTargetReview(rules, productsById, [
    ...diseases.map((row) => ({ type: "disease" as const, row })),
    ...pests.map((row) => ({ type: "pest" as const, row })),
    ...weeds.map((row) => ({ type: "weed" as const, row })),
  ]);
  const safeCrops = cropReview.filter((row) => row.action === "SAFE_APPLY");
  const safeTargets = targetReview.filter((row) => row.action === "SAFE_APPLY");
  const affectedIds = new Set([
    ...safeCrops.map((row) => row.usage_rule_id),
    ...safeTargets.map((row) => row.usage_rule_id),
  ]);
  const backupRows = rules.filter((rule) => affectedIds.has(String(rule.id)));

  const cropSql = safeCrops.map((row) => (
    `update public.glbd_product_usage_rules set crop_id = ${sqlLiteral(row.proposed_crop_id)}, updated_at = now() `
    + `where id = ${sqlLiteral(row.usage_rule_id)} and crop_id is null;`
  ));
  const targetSql = safeTargets.map((row) => {
    const column = row.target_type === "disease" ? "disease_id" : row.target_type === "pest" ? "pest_id" : "weed_id";
    return `update public.glbd_product_usage_rules set ${column} = ${sqlLiteral(row.proposed_target_ids)}, target_type = ${sqlLiteral(row.target_type)}, updated_at = now() `
      + `where id = ${sqlLiteral(row.usage_rule_id)} and disease_id is null and pest_id is null and weed_id is null;`;
  });
  const applySql = [
    "-- TZ-237 QA-only exact mapping preview.",
    "-- Branch guard must be verified externally before execution.",
    "begin;",
    ...cropSql,
    ...targetSql,
    "commit;",
    "",
  ].join("\n");
  const rollbackSql = [
    "-- TZ-237 QA-only exact rollback. Restores every touched mapping and timestamp.",
    "begin;",
    ...backupRows.map((row) => (
      `update public.glbd_product_usage_rules set crop_id = ${row.crop_id ? sqlLiteral(row.crop_id) : "null"}, `
      + `disease_id = ${row.disease_id ? sqlLiteral(row.disease_id) : "null"}, `
      + `pest_id = ${row.pest_id ? sqlLiteral(row.pest_id) : "null"}, `
      + `weed_id = ${row.weed_id ? sqlLiteral(row.weed_id) : "null"}, `
      + `target_type = ${row.target_type ? sqlLiteral(row.target_type) : "null"}, `
      + `updated_at = ${row.updated_at ? sqlLiteral(row.updated_at) : "now()"} `
      + `where id = ${sqlLiteral(row.id)};`
    )),
    "commit;",
    "",
  ].join("\n");

  const summary = {
    generatedAt: new Date().toISOString(),
    branchRef,
    products: pesticideProducts.length,
    usageRules: rules.length,
    rawCropUnlinked: cropReview.length,
    cropActions: Object.fromEntries(
      ["SAFE_APPLY", "DISPLAY_RAW_ONLY", "NEED_REVIEW", "PARSER_FRAGMENT", "NO_MATCH"].map((action) => [
        action,
        cropReview.filter((row) => row.action === action).length,
      ]),
    ),
    rawTargetUnlinked: targetReview.length,
    targetActions: Object.fromEntries(
      ["SAFE_APPLY", "DISPLAY_RAW_ONLY", "NEED_REVIEW", "PARSER_FRAGMENT", "NO_MATCH"].map((action) => [
        action,
        targetReview.filter((row) => row.action === action).length,
      ]),
    ),
    affectedUsageRuleRows: affectedIds.size,
    sourceRawOverwrites: 0,
    productionConnections: 0,
    writes: 0,
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeArtifact(
    "crop-mapping-review.csv",
    csv(cropReview, [
      "usage_rule_id",
      "product_id",
      "trade_name",
      "raw_crop",
      "proposed_crop_id",
      "proposed_crop_name",
      "qualifier",
      "match_method",
      "confidence",
      "action",
    ]),
  );
  await writeArtifact(
    "target-mapping-review.csv",
    csv(targetReview, [
      "usage_rule_id",
      "product_id",
      "trade_name",
      "raw_target",
      "proposed_target_ids",
      "target_type",
      "match_method",
      "confidence",
      "action",
    ]),
  );
  await writeArtifact("qa-backup.json", JSON.stringify({ branchRef, rows: backupRows }, null, 2) + "\n");
  await writeArtifact("apply-preview.sql", applySql);
  await writeArtifact("rollback.sql", rollbackSql);
  await writeArtifact("mapping-summary.json", JSON.stringify(summary, null, 2) + "\n");

  const artifactNames = [
    "crop-mapping-review.csv",
    "target-mapping-review.csv",
    "qa-backup.json",
    "apply-preview.sql",
    "rollback.sql",
    "mapping-summary.json",
  ];
  const manifestLines: string[] = [];
  for (const name of artifactNames) {
    const content = await readFile(resolve(OUTPUT_DIR, name));
    manifestLines.push(`${createHash("sha256").update(content).digest("hex")}  ${name}`);
  }
  await writeArtifact("manifest.sha256", manifestLines.join("\n") + "\n");
  await mkdir(dirname(resolve(OUTPUT_DIR, "manifest.sha256")), { recursive: true });

  console.log(JSON.stringify(summary, null, 2));
  console.log(`OUTPUT_DIR=${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
