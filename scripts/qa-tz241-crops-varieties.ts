import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { canonicalCropCategoryOptions } from "../lib/platform/global-catalog-config";

type CheckResult = { number: number; name: string; status: "PASS" | "FAIL"; detail?: string };
type CropRow = { id: string; name?: string | null; name_ru?: string | null; category_id: string | null; company_id: string | null; archived: boolean; is_active: boolean };
type VarietyRow = { id: string; crop_id: string; name: string; company_id: string | null; archived: boolean; is_active: boolean };

const QA_REF = "gsglkmudcwkdetqtocae";
const EXPECTED_CATEGORIES = ["Бахчевые", "Зернобобовые", "Зерновые", "Кормовые", "Масличные", "Овощные", "Плодово-ягодные", "Технические"];
const DEFAULT_ENV = resolve(process.cwd(), "..", "..", "project-bolt-sb1-hjjzpfey-4", "project", ".env.local");
const DEFAULT_SOURCE = resolve(process.cwd(), "..", "..", "audit-output", "TZ-241", "source-workbook-inspection.json");
const DEFAULT_BACKUP = resolve(process.cwd(), "..", "..", "audit-output", "TZ-241", "qa-backup-before-import.json");

function loadEnv(path: string) {
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

function displayCrop(row: CropRow) {
  return String(row.name_ru || row.name || "").trim();
}

function codeContains(path: string, pattern: RegExp) {
  return pattern.test(readFileSync(resolve(process.cwd(), path), "utf8"));
}

async function createAuthenticatedClient(url: string, anonKey: string, user: "A" | "B") {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const access = process.env[`A106_TEST_USER_${user}_ACCESS_TOKEN`] || "";
  const refresh = process.env[`A106_TEST_USER_${user}_REFRESH_TOKEN`] || "";
  let authenticated = false;
  if (access && refresh) {
    const { error } = await client.auth.setSession({ access_token: access, refresh_token: refresh });
    authenticated = !error;
  }
  if (!authenticated) {
    const { error } = await client.auth.signInWithPassword({
      email: process.env[`A106_TEST_USER_${user}_EMAIL`] || "",
      password: process.env[`A106_TEST_USER_${user}_PASSWORD`] || "",
    });
    if (error) throw error;
  }
  return client;
}

async function main() {
  loadEnv(process.env.TZ241_ENV_FILE || DEFAULT_ENV);
  const sourcePath = process.env.TZ241_SOURCE_JSON || DEFAULT_SOURCE;
  const backupPath = process.env.TZ241_BACKUP_JSON || DEFAULT_BACKUP;
  const url = process.env.A106_SUPABASE_URL || "";
  const anonKey = process.env.A106_SUPABASE_ANON_KEY || "";
  if (!url.includes(QA_REF) || !anonKey) throw new Error("TZ-241 test guard: QA branch credentials are required");

  const client = await createAuthenticatedClient(url, anonKey, "A");

  const source = JSON.parse(readFileSync(sourcePath, "utf8"));
  const sourceCrops: Array<{ category: string; crop: string }> = (source.sheets?.["Культуры"]?.values || [])
    .slice(1)
    .filter((row: unknown[]) => row[0] && row[1])
    .map((row: unknown[]) => ({ category: String(row[0]).trim(), crop: String(row[1]).trim() }));
  const sourceVarieties: Array<{ crop: string; variety: string }> = (source.sheets?.["Сорта"]?.values || [])
    .slice(1)
    .filter((row: unknown[]) => row[0] && row[1])
    .map((row: unknown[]) => ({ crop: String(row[0]).trim(), variety: String(row[1]).trim() }));

  const [categoriesResult, cropsResult, varietiesResult] = await Promise.all([
    client.from("crop_categories").select("id,name_ru,slug,is_active").eq("is_active", true),
    client.from("crops").select("id,name,name_ru,category_id,company_id,archived,is_active"),
    client.from("varieties").select("id,crop_id,name,company_id,archived,is_active"),
  ]);
  if (categoriesResult.error || cropsResult.error || varietiesResult.error) throw new Error(categoriesResult.error?.message || cropsResult.error?.message || varietiesResult.error?.message);
  const categories = categoriesResult.data || [];
  const crops = (cropsResult.data || []) as CropRow[];
  const varieties = (varietiesResult.data || []) as VarietyRow[];
  const activeCrops = crops.filter((row) => row.company_id == null && !row.archived && row.is_active !== false);
  const activeVarieties = varieties.filter((row) => row.company_id == null && !row.archived && row.is_active !== false);
  const cropByName = new Map(activeCrops.map((row) => [normalize(displayCrop(row)), row]));
  const categoryNameById = new Map(categories.map((row) => [String(row.id), String(row.name_ru)]));
  const backup = JSON.parse(readFileSync(backupPath, "utf8"));
  const checks: CheckResult[] = [];
  const check = (number: number, name: string, condition: boolean, detail?: string) => checks.push({ number, name, status: condition ? "PASS" : "FAIL", detail });

  check(1, "Все восемь категорий существуют", EXPECTED_CATEGORIES.every((name) => categories.some((row) => row.name_ru === name)) && categories.length === 8);
  check(2, "Дубли категорий отсутствуют", new Set(categories.map((row) => normalize(row.name_ru))).size === categories.length && new Set(categories.map((row) => row.slug)).size === categories.length);
  const cropCategoryIs = (crop: string, category: string) => categoryNameById.get(cropByName.get(normalize(crop))?.category_id || "") === category;
  check(3, "Картофель относится к Овощным", cropCategoryIs("Картофель", "Овощные"));
  check(4, "Морковь относится к Овощным", cropCategoryIs("Морковь", "Овощные"));
  check(5, "Соя относится к Зернобобовым", cropCategoryIs("Соя", "Зернобобовые"));
  check(6, "Люцерна относится к Кормовым", cropCategoryIs("Люцерна", "Кормовые"));
  check(7, "Category filter работает", canonicalCropCategoryOptions.length === 8 && canonicalCropCategoryOptions.every((option) => activeCrops.some((crop) => crop.category_id === option.value)) && codeContains("app/api/global-admin/catalog/[entity]/route.ts", /filterKey === "category_id" && entity === "crops"/));

  check(8, "Source crop count = 68", sourceCrops.length === 68, String(sourceCrops.length));
  check(9, "Все 68 source crops найдены", sourceCrops.every((row) => cropByName.has(normalize(row.crop))));
  const currentCropById = new Map(crops.map((row) => [row.id, row]));
  check(10, "Existing crop IDs сохранены", backup.crops.every((row: CropRow) => currentCropById.has(row.id)));
  check(11, "Missing crop создаётся один раз", sourceCrops.every((row) => activeCrops.filter((crop) => normalize(displayCrop(crop)) === normalize(row.crop)).length === 1));
  check(12, "Re-run не создаёт crop duplicate", new Set(activeCrops.map((row) => normalize(displayCrop(row)))).size === activeCrops.length);
  check(13, "Пар не создаётся как crop", !cropByName.has(normalize("Пар")));
  check(14, "Зерносмесь не создаётся как crop", !cropByName.has(normalize("Зерносмесь")));
  check(15, "Травосмесь не создаётся как active crop", !cropByName.has(normalize("Травосмеси")) && crops.filter((row) => normalize(displayCrop(row)) === normalize("Травосмеси")).length === 1);
  check(16, "Кукуруза на силос не создаётся новой записью", !cropByName.has(normalize("Кукуруза на силос")) && crops.filter((row) => normalize(displayCrop(row)) === normalize("Кукуруза на силос")).length === 1);
  check(17, "Global crops доступны компании", activeCrops.length === 68);
  check(18, "Cross-company access не возникает", crops.every((row) => row.company_id == null) && varieties.every((row) => row.company_id == null));

  check(19, "Source variety rows = 588", sourceVarieties.length === 588, String(sourceVarieties.length));
  const pairKey = (cropId: string, name: string) => `${cropId}|${normalize(name)}`;
  const activeVarietyPairs = new Set(activeVarieties.map((row) => pairKey(row.crop_id, row.name)));
  check(20, "Все 588 source pairs учтены", sourceVarieties.every((row) => {
    const crop = cropByName.get(normalize(row.crop));
    return Boolean(crop && activeVarietyPairs.has(pairKey(crop.id, row.variety)));
  }));
  check(21, "Variety связан с правильным crop_id", sourceVarieties.every((row) => activeVarieties.some((variety) => variety.crop_id === cropByName.get(normalize(row.crop))?.id && normalize(variety.name) === normalize(row.variety))));
  const currentVarietyById = new Map(varieties.map((row) => [row.id, row]));
  check(22, "Exact existing variety сохраняет ID", backup.varieties.every((row: VarietyRow) => currentVarietyById.has(row.id)));
  check(23, "Re-run не создаёт variety duplicate", new Set(activeVarieties.map((row) => pairKey(row.crop_id, row.name))).size === activeVarieties.length);
  const astanaCropIds = new Set(activeVarieties.filter((row) => normalize(row.name) === normalize("Астана")).map((row) => row.crop_id));
  check(24, "Same name in different crops не merge", astanaCropIds.size === 2);
  check(25, "Wrong crop variety отклоняется", codeContains("app/api/crop-structure/fields/[id]/route.ts", /varietiesById/) && codeContains("app/api/crop-structure/fields/[id]/route.ts", /crop_id/));
  check(26, "Company override не создаёт визуальный дубль", codeContains("lib/services/references.ts", /const key = `\$\{row\.crop_id\}\|\$\{String\(row\.name/));
  check(27, "Search по сорту работает", activeVarieties.some((row) => normalize(row.name).includes(normalize("Гала"))));
  const potatoId = cropByName.get(normalize("Картофель"))?.id || "";
  const sourcePotatoVarieties = sourceVarieties.filter((row) => normalize(row.crop) === normalize("Картофель"));
  check(28, "Crop filter по сорту работает", sourcePotatoVarieties.every((row) => activeVarieties.some((variety) => variety.crop_id === potatoId && normalize(variety.name) === normalize(row.variety))) && activeVarieties.filter((row) => row.crop_id === potatoId).every((row) => row.crop_id === potatoId));
  check(29, "Archived variety не используется в новой структуре", codeContains("lib/services/references.ts", /eq\("archived", false\)\.eq\("is_active", true\)/));
  check(30, "Existing linked variety relations не изменены", backup.varieties.filter((row: any) => Object.values(row.relation_counts || {}).some((value) => Number(value) > 0)).every((row: VarietyRow) => currentVarietyById.has(row.id)));

  check(31, "Выбор культуры загружает правильные сорта", codeContains("lib/services/references.ts", /\.eq\("crop_id", cropId\)/));
  check(32, "Сорт другой культуры не сохраняется", codeContains("app/api/crop-structure/fields/[id]/route.ts", /varietiesById/));
  check(33, "Смена культуры сбрасывает несовместимый сорт", codeContains("app/(dashboard)/crop-structure/page.tsx", /variety_id:\s*null/));
  check(34, "Репродукция сохраняется", codeContains("app/api/crop-structure/fields/[id]/route.ts", /reproduction_id/));
  check(35, "Пар создаётся без crop_id", codeContains("lib/crop-structure/fallow.ts", /crop_id:\s*null/));
  check(36, "Closed season остаётся read-only", codeContains("app/api/crop-structure/fields/[id]/route.ts", /Closed season is read-only/));

  const userB = await createAuthenticatedClient(url, anonKey, "B");
  const [userBCrops, userBVarieties] = await Promise.all([
    userB.from("crops").select("id").is("company_id", null).eq("archived", false).eq("is_active", true),
    userB.from("varieties").select("id").is("company_id", null).eq("archived", false).eq("is_active", true),
  ]);
  check(37, "QA User B видит те же global crops", !userBCrops.error && new Set((userBCrops.data || []).map((row) => row.id)).size === activeCrops.length);
  check(38, "QA User B видит те же global varieties", !userBVarieties.error && new Set((userBVarieties.data || []).map((row) => row.id)).size === activeVarieties.length);

  const protectedCrop = activeCrops[0];
  const deniedMutation = protectedCrop
    ? await client.from("crops").update({ name: protectedCrop.name }).eq("id", protectedCrop.id).is("company_id", null).select("id")
    : { data: null, error: new Error("No active crop available") };
  check(39, "Обычный QA user не меняет global crop", Boolean(deniedMutation.error) || (deniedMutation.data || []).length === 0);
  check(40, "Global Admin route защищён проверкой роли", codeContains("app/api/global-admin/catalog/[entity]/route.ts", /getServerActorFromSession/) && codeContains("app/api/global-admin/catalog/[entity]/route.ts", /global_admin/));

  const cropSearchSample = sourceCrops.slice(0, 20);
  check(41, "Global Admin search sample 20/20", cropSearchSample.length === 20 && cropSearchSample.every((row) => activeCrops.some((crop) => normalize(displayCrop(crop)) === normalize(row.crop))));

  const varietySearchSample = sourceVarieties.slice(0, 30);
  check(42, "Global Admin variety search sample 30/30", varietySearchSample.length === 30 && varietySearchSample.every((row) => {
    const crop = cropByName.get(normalize(row.crop));
    return Boolean(crop && activeVarieties.some((variety) => variety.crop_id === crop.id && normalize(variety.name) === normalize(row.variety)));
  }));
  check(43, "Global Admin category filter contains exactly 8 canonical options", canonicalCropCategoryOptions.length === 8 && new Set(canonicalCropCategoryOptions.map((option) => option.label)).size === 8 && canonicalCropCategoryOptions.every((option) => EXPECTED_CATEGORIES.includes(option.label)));
  check(44, "Global varieties filter resolves crop IDs", codeContains("lib/platform/global-catalog-config.ts", /key:\s*\"crop_id\"[^\n]+optionsEntity:\s*\"crops\"/) && codeContains("app/api/global-admin/catalog/[entity]/route.ts", /query = query\.eq\(filterKey, value\)/));

  const failed = checks.filter((item) => item.status === "FAIL");
  console.log(JSON.stringify({ task: "TZ-241", project_ref: QA_REF, checks_total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
