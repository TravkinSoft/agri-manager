import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { OperationDraft } from "@/lib/types/operation-draft";

type AssistantSettings = {
  system_prompt: string;
  allow_operation_creation: boolean;
  require_confirmation: boolean;
  enable_recommendations: boolean;
  use_warehouse_data: boolean;
  use_inventory_data: boolean;
  region: string;
  farm_type: string;
  main_crops: string;
};

type ProfileRole = "global_admin" | "company_admin" | "admin" | "agronomist" | "specialist" | "warehouse" | "weighman";

type UserContext = {
  companyId: string;
  role: ProfileRole | null;
};

type DataAvailabilitySummary = {
  fieldsCount: number;
  cropStructuresCount: number;
  operationsCount: number;
  warehousesCount: number;
  productsCount: number;
  pesticidesCount: number;
  herbicideLikeCount: number;
  inventoryCount: number;
  source: "company" | "legacy";
};

type InventoryBalanceItem = {
  warehouseName: string;
  productName: string;
  productType: string;
  unit: string;
  quantity: number;
};

type HerbicideStockItem = {
  productName: string;
  productType: string;
  unit: string;
  totalQuantity: number;
  warehouseBreakdown: Array<{ warehouseName: string; quantity: number }>;
};

type AssistantAttachment = {
  id?: string;
  name: string;
  type: string;
  size: number;
  kind: "image" | "file";
  imageDataUrl?: string;
  textContent?: string;
};

const DEFAULT_SETTINGS: AssistantSettings = {
  system_prompt: "",
  allow_operation_creation: true,
  require_confirmation: true,
  enable_recommendations: true,
  use_warehouse_data: true,
  use_inventory_data: true,
  region: "",
  farm_type: "",
  main_crops: "",
};

const BASE_SYSTEM_PROMPT = `You are AgroMind, an agricultural assistant inside a farm management system.

Core behavior:
- Always answer in the user's language (Russian, English, or Kazakh).
- Be concise, practical, and professional.
- Use real farm data from context whenever possible.
- Never claim you changed the database.
- Do not invent stock values. Use inventory context.

Operation draft workflow:
- Collect missing fields step-by-step and prepare draft only when enough data is available.
- Ask only ONE clarifying question per assistant message.
- Do not output a checklist of all missing questions at once.
- Do not ask again for data already present in chat history or DB context.
- If field is known, use field area from DB and do calculations automatically.
- Weather block is NOT required now.
- Comments are supported and must be saved into draft.
- Date/time rule: do not silently create a draft without confirmed date/time.
- If user did not provide date/time, ask exactly: "Когда проводить операцию?".
- You may propose current local date/time, but ask for explicit confirmation.
- Do not create final records. You only prepare a draft payload.

Question order for spraying draft (must follow this sequence):
1) field (field_id/field_name)
2) target (against what)
3) main chemical
4) chemical rate per hectare
5) additional chemicals (if any)
6) application norm / норма вылива
7) machine/equipment
8) responsible brigadier/specialist
9) operation date/time (near the end)
10) comments (last)

Responsible rule:
- Responsible assignee must be ONLY a user with role "specialist".
- If the named user exists but has another role, do not assign and explain that this user is not a specialist.

When preparing spraying operation draft, include:
1) operation_type
2) field (field_id/field_name)
3) crop
4) target (against what)
5) main chemical
6) chemical rate per hectare
7) additional chemicals / technical products / pH correctors
8) application norm / норма вылива (finished mixture volume per ha)
9) mixture composition:
   - total_mixture_volume
   - total_water_volume
   - total_product_volume
   - water_percentage
   - product_percentage
10) machine/equipment
11) responsible brigadier/specialist
12) operation date (and operation_datetime with minutes if available)
13) comments

Very important output rule:
- Never show raw JSON in normal conversational text.
- Do not print calculation formulas in regular assistant text when a draft payload is present.
- Keep calculations only in draft metadata/card.
- If a draft is ready, keep user-facing text natural and append machine payload at the end using this exact format:
<draft_json>{"draft": { ... }}</draft_json>

Draft payload target structure:
{
  "draft": {
    "operation_type": "spraying",
    "field_name": "Field 10",
    "field_id": "uuid if known",
    "crop_structure_id": "uuid if known",
    "crop_id": "uuid if known",
    "crop_name": "crop name if known",
    "date": "YYYY-MM-DD",
    "operation_datetime": "YYYY-MM-DDTHH:mm",
    "notes": "comments",
    "metadata": {
      "target": "against what",
      "product": "main product name",
      "product_id": "uuid if known",
      "rate_per_ha": "value with unit",
      "additional_products": "text list",
      "spray_volume_per_ha": "value with unit",
      "total_mixture_volume": "value with unit",
      "total_water_volume": "value with unit",
      "total_product_volume": "value with unit",
      "water_percentage": "value",
      "product_percentage": "value",
      "equipment": "equipment name",
      "equipment_id": "id if known",
      "responsible": "specialist name",
      "responsible_id": "uuid if known",
      "comments": "free text"
    }
  }
}`;

function getServiceClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase service credentials are not configured");
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function isStrictUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeAttachments(raw: unknown): AssistantAttachment[] {
  if (!Array.isArray(raw)) return [];
  const normalized: AssistantAttachment[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const kind = asString(row.kind);
    const name = asString(row.name);
    if (!kind || !name) continue;
    if (kind !== "image" && kind !== "file") continue;

    normalized.push({
      id: asString(row.id),
      name,
      type: asString(row.type) || "",
      size: Number(row.size || 0),
      kind,
      imageDataUrl: asString(row.imageDataUrl),
      textContent: asString(row.textContent),
    });
  }

  return normalized.slice(0, 8);
}

function normalizeLookupText(text: string): string {
  const charMap: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
    ә: "a", ғ: "g", қ: "k", ң: "n", ө: "o", ұ: "u", ү: "u", һ: "h", і: "i",
  };

  const lower = (text || "").toLowerCase();
  let transliterated = "";
  for (const ch of lower) {
    transliterated += charMap[ch] ?? ch;
  }

  return transliterated
    .replace(/[^a-z0-9.,\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value: string | undefined): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

function normalizeDateTime(value: string | undefined): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  const hh = String(parsed.getHours()).padStart(2, "0");
  const min = String(parsed.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function getCurrentLocalTimeInfo(): { isoMinute: string; localeString: string } {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return {
    isoMinute: `${yyyy}-${mm}-${dd}T${hh}:${min}`,
    localeString: now.toLocaleString("ru-RU"),
  };
}

function normalizeProfileRole(value: string | undefined): ProfileRole | null {
  if (!value) return null;
  const role = value.trim().toLowerCase();

  if (["global_admin"].includes(role)) return "global_admin";
  if (["company_admin", "admin", "owner", "superadmin", "super_admin"].includes(role)) return "company_admin";
  if (["agronomist", "agronom", "agronomer", "агроном"].includes(role)) return "agronomist";
  if (["specialist", "spec", "специалист"].includes(role)) return "specialist";
  if (["warehouse", "warehouseman", "storekeeper", "склад", "кладовщик"].includes(role)) return "warehouse";

  return null;
}

function hasFullAssistantAccess(role: ProfileRole | null): boolean {
  return role === "global_admin" || role === "company_admin" || role === "admin" || role === "agronomist";
}

async function resolveUserContext(
  supabase: SupabaseClient,
  requestedCompanyId: string | undefined,
  userId: string | undefined
): Promise<UserContext> {
  const safeRequestedCompanyId = asString(requestedCompanyId);
  const safeUserId = asString(userId);

  if (safeUserId && isStrictUuid(safeUserId)) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id, role")
      .eq("id", safeUserId)
      .maybeSingle();

    const profileCompanyId = asString(profile?.company_id);
    const rawRole = asString(profile?.role);
    const profileRole = normalizeProfileRole(rawRole);
    if (profileCompanyId && isUuidLike(profileCompanyId)) {
      return {
        companyId: profileCompanyId,
        role: profileRole,
      };
    }
  }

  if (safeRequestedCompanyId && isUuidLike(safeRequestedCompanyId)) {
    return {
      companyId: safeRequestedCompanyId,
      role: null,
    };
  }

  return {
    companyId: "",
    role: null,
  };
}

function getEffectiveSettingsForRole(
  settings: AssistantSettings,
  role: ProfileRole | null
): AssistantSettings {
  return {
    ...settings,
    allow_operation_creation: hasFullAssistantAccess(role),
    // Always keep farm read context enabled so assistant can see
    // warehouses, inventory, fields, and crop structure for all roles.
    use_warehouse_data: true,
    use_inventory_data: true,
  };
}

async function getWarehouseAccessSummary(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ warehousesCount: number; productsCount: number; inventoryCount: number }> {
  if (!companyId) {
    return { warehousesCount: 0, productsCount: 0, inventoryCount: 0 };
  }

  const settled = await Promise.allSettled([
    supabase
      .from("warehouses")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("archived", false),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("archived", false),
    supabase
      .from("inventory_transactions")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId),
  ]);

  const safeCount = (index: number): number => {
    const result = settled[index];
    if (result.status === "fulfilled") {
      return Number(result.value.count || 0);
    }
    return 0;
  };

  return {
    warehousesCount: safeCount(0),
    productsCount: safeCount(1),
    inventoryCount: safeCount(2),
  };
}

async function getDataAvailabilitySummary(
  supabase: SupabaseClient,
  companyId: string,
  userId?: string
): Promise<DataAvailabilitySummary> {
  const settled = await Promise.allSettled([
    supabase
      .from("fields")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("archived", false),
    supabase
      .from("crop_structure")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("archived", false),
    supabase
      .from("operations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("archived", false),
    supabase
      .from("warehouses")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("archived", false),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("archived", false),
    supabase
      .from("products")
      .select("name, type")
      .eq("company_id", companyId)
      .eq("archived", false),
    supabase
      .from("inventory_transactions")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId),
  ]);

  const safeCount = (index: number): number => {
    const result = settled[index];
    if (result.status === "fulfilled") {
      return Number(result.value.count || 0);
    }
    return 0;
  };

  const productRowsCompany =
    settled[5]?.status === "fulfilled"
      ? (((settled[5] as PromiseFulfilledResult<any>).value?.data as any[]) || [])
      : [];
  const pesticidesCountCompany = productRowsCompany.filter((p) => p?.type === "pesticide").length;
  const herbicideLikeCountCompany = productRowsCompany.filter((p) =>
    /herbic|гербиц|глифос|раундап|2,4-d|2\.4-d/i.test(String(p?.name || ""))
  ).length;

  const companySummary: DataAvailabilitySummary = {
    fieldsCount: safeCount(0),
    cropStructuresCount: safeCount(1),
    operationsCount: safeCount(2),
    warehousesCount: safeCount(3),
    productsCount: safeCount(4),
    pesticidesCount: pesticidesCountCompany,
    herbicideLikeCount: herbicideLikeCountCompany,
    inventoryCount: safeCount(6),
    source: "company",
  };

  const hasCompanyData =
    companySummary.fieldsCount > 0 ||
    companySummary.cropStructuresCount > 0 ||
    companySummary.operationsCount > 0 ||
    companySummary.warehousesCount > 0 ||
    companySummary.productsCount > 0 ||
    companySummary.inventoryCount > 0 ||
    companySummary.pesticidesCount > 0;

  if (hasCompanyData || !userId || !isStrictUuid(userId)) {
    return companySummary;
  }

  const legacySettled = await Promise.allSettled([
    supabase
      .from("fields")
      .select("id", { count: "exact", head: true })
      .is("company_id", null)
      .eq("user_id", userId)
      .eq("archived", false),
    supabase
      .from("crop_structure")
      .select("id", { count: "exact", head: true })
      .is("company_id", null)
      .eq("user_id", userId)
      .eq("archived", false),
    supabase
      .from("operations")
      .select("id", { count: "exact", head: true })
      .is("company_id", null)
      .eq("user_id", userId)
      .eq("archived", false),
    supabase
      .from("warehouses")
      .select("id", { count: "exact", head: true })
      .is("company_id", null)
      .eq("user_id", userId)
      .eq("archived", false),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .is("company_id", null)
      .eq("user_id", userId)
      .eq("archived", false),
    supabase
      .from("products")
      .select("name, type")
      .is("company_id", null)
      .eq("user_id", userId)
      .eq("archived", false),
    supabase
      .from("inventory_transactions")
      .select("id", { count: "exact", head: true })
      .is("company_id", null)
      .eq("user_id", userId),
  ]);

  const legacyCount = (index: number): number => {
    const result = legacySettled[index];
    if (result.status === "fulfilled") {
      return Number(result.value.count || 0);
    }
    return 0;
  };

  const productRowsLegacy =
    legacySettled[5]?.status === "fulfilled"
      ? (((legacySettled[5] as PromiseFulfilledResult<any>).value?.data as any[]) || [])
      : [];
  const pesticidesCountLegacy = productRowsLegacy.filter((p) => p?.type === "pesticide").length;
  const herbicideLikeCountLegacy = productRowsLegacy.filter((p) =>
    /herbic|гербиц|глифос|раундап|2,4-d|2\.4-d/i.test(String(p?.name || ""))
  ).length;

  return {
    fieldsCount: legacyCount(0),
    cropStructuresCount: legacyCount(1),
    operationsCount: legacyCount(2),
    warehousesCount: legacyCount(3),
    productsCount: legacyCount(4),
    pesticidesCount: pesticidesCountLegacy,
    herbicideLikeCount: herbicideLikeCountLegacy,
    inventoryCount: legacyCount(6),
    source: "legacy",
  };
}

async function getLegacyWarehouseAccessSummary(
  supabase: SupabaseClient,
  userId: string
): Promise<{ warehousesCount: number; productsCount: number; inventoryCount: number }> {
  const settled = await Promise.allSettled([
    supabase
      .from("warehouses")
      .select("id", { count: "exact", head: true })
      .is("company_id", null)
      .eq("user_id", userId)
      .eq("archived", false),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .is("company_id", null)
      .eq("user_id", userId)
      .eq("archived", false),
    supabase
      .from("inventory_transactions")
      .select("id", { count: "exact", head: true })
      .is("company_id", null)
      .eq("user_id", userId),
  ]);

  const safeCount = (index: number): number => {
    const result = settled[index];
    if (result.status === "fulfilled") {
      return Number(result.value.count || 0);
    }
    return 0;
  };

  return {
    warehousesCount: safeCount(0),
    productsCount: safeCount(1),
    inventoryCount: safeCount(2),
  };
}

function isHerbicideProduct(productName: string, productType: string): boolean {
  const normalized = normalizeLookupText(`${productName} ${productType}`);
  return /(herbic|gerbic|glyphos|glifos|roundup|raundap|dicamba|dikamba|metribuzin|2,4-d|2.4-d|24d|weed)/i.test(
    normalized
  );
}

function aggregateInventoryBalances(rows: any[]): InventoryBalanceItem[] {
  const byWarehouseProduct = new Map<string, InventoryBalanceItem>();

  rows.forEach((tx) => {
    const warehouseName = tx?.warehouses?.name || "unknown warehouse";
    const productName = tx?.products?.name || "unknown product";
    const productType = tx?.products?.type || "";
    const unit = tx?.products?.unit || tx?.unit || "";
    const qty = Number(tx?.quantity || 0);
    if (!Number.isFinite(qty) || qty === 0) return;

    const sign = tx?.transaction_type === "out" ? -1 : 1;
    const key = `${warehouseName}:::${productName}`;

    if (!byWarehouseProduct.has(key)) {
      byWarehouseProduct.set(key, {
        warehouseName,
        productName,
        productType,
        unit,
        quantity: 0,
      });
    }

    const row = byWarehouseProduct.get(key)!;
    row.quantity += sign * qty;
  });

  return Array.from(byWarehouseProduct.values()).filter((r) => Math.abs(r.quantity) > 0.000001);
}

function toHerbicideStock(items: InventoryBalanceItem[]): HerbicideStockItem[] {
  const byProduct = new Map<string, HerbicideStockItem>();

  items
    .filter((row) => isHerbicideProduct(row.productName, row.productType))
    .forEach((row) => {
      const key = row.productName;
      if (!byProduct.has(key)) {
        byProduct.set(key, {
          productName: row.productName,
          productType: row.productType,
          unit: row.unit,
          totalQuantity: 0,
          warehouseBreakdown: [],
        });
      }

      const product = byProduct.get(key)!;
      product.totalQuantity += row.quantity;
      product.warehouseBreakdown.push({
        warehouseName: row.warehouseName,
        quantity: row.quantity,
      });
    });

  return Array.from(byProduct.values())
    .map((p) => ({
      ...p,
      warehouseBreakdown: p.warehouseBreakdown
        .filter((w) => Math.abs(w.quantity) > 0.000001)
        .sort((a, b) => Math.abs(b.quantity) - Math.abs(a.quantity)),
    }))
    .filter((p) => Math.abs(p.totalQuantity) > 0.000001)
    .sort((a, b) => Math.abs(b.totalQuantity) - Math.abs(a.totalQuantity));
}

async function getHerbicideStockSnapshot(
  supabase: SupabaseClient,
  companyId: string,
  userId?: string
): Promise<HerbicideStockItem[]> {
  const readRows = async (legacy: boolean): Promise<any[]> => {
    if (legacy) {
      if (!userId || !isStrictUuid(userId)) return [];
      const { data } = await supabase
        .from("inventory_transactions")
        .select(`
          quantity,
          transaction_type,
          warehouses:warehouse_id(name),
          products:product_id(name, type)
        `)
        .is("company_id", null)
        .eq("user_id", userId);
      return data || [];
    }

    if (!companyId) return [];
    const { data } = await supabase
      .from("inventory_transactions")
      .select(`
        quantity,
        transaction_type,
        warehouses:warehouse_id(name),
        products:product_id(name, type)
      `)
      .eq("company_id", companyId);
    return data || [];
  };

  const companyRows = await readRows(false);
  const companyBalances = aggregateInventoryBalances(companyRows);
  const companyHerbicides = toHerbicideStock(companyBalances);
  if (companyHerbicides.length > 0) return companyHerbicides;

  const legacyRows = await readRows(true);
  const legacyBalances = aggregateInventoryBalances(legacyRows);
  return toHerbicideStock(legacyBalances);
}

function extractProductHintFromQuery(normalizedQuery: string): string | null {
  const hints = [
    "glyphosate",
    "glifosat",
    "dicamba",
    "dikamba",
    "metribuzin",
    "roundup",
    "raundap",
    "24d",
    "2,4-d",
    "2.4-d",
  ];

  for (const h of hints) {
    if (normalizedQuery.includes(h)) return h;
  }
  return null;
}

function normalizeRecentHistory(chatHistory: unknown): string {
  if (!Array.isArray(chatHistory)) return "";

  const raw = chatHistory
    .slice(-10)
    .map((msg) => asString((msg as any)?.content) || "")
    .filter(Boolean)
    .join(" ");

  return normalizeLookupText(raw);
}

function extractProductHintFromHistory(
  snapshot: HerbicideStockItem[],
  chatHistory: unknown
): string | null {
  if (snapshot.length === 0) return null;
  const normalizedHistory = normalizeRecentHistory(chatHistory);
  if (!normalizedHistory) return null;

  const directHint = extractProductHintFromQuery(normalizedHistory);
  if (directHint) return directHint;

  for (const item of snapshot) {
    const normalizedProduct = normalizeLookupText(item.productName);
    if (!normalizedProduct) continue;
    if (normalizedHistory.includes(normalizedProduct)) return normalizedProduct;

    const tokens = normalizedProduct
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 5 && !/^\d+$/.test(token));

    for (const token of tokens) {
      if (normalizedHistory.includes(token)) return token;
    }
  }

  return null;
}

function hasHerbicideContextInHistory(
  chatHistory: unknown,
  snapshot: HerbicideStockItem[]
): boolean {
  const normalizedHistory = normalizeRecentHistory(chatHistory);
  if (!normalizedHistory) return false;

  if (isHerbicideRelatedText(normalizedHistory)) return true;
  return extractProductHintFromHistory(snapshot, chatHistory) !== null;
}

function pickHerbicideSnapshotForQuery(
  snapshot: HerbicideStockItem[],
  userMessage: string,
  chatHistory?: unknown
): HerbicideStockItem[] {
  if (snapshot.length === 0) return [];
  const normalizedQuery = normalizeLookupText(userMessage);
  const hint =
    extractProductHintFromQuery(normalizedQuery) ||
    extractProductHintFromHistory(snapshot, chatHistory);
  if (!hint) return snapshot.slice(0, 10);

  const filtered = snapshot.filter((item) =>
    normalizeLookupText(item.productName).includes(hint)
  );
  return filtered.length > 0 ? filtered : snapshot.slice(0, 10);
}

function buildHerbicideStockResponse(
  userMessage: string,
  snapshot: HerbicideStockItem[],
  chatHistory?: unknown,
  preferredLanguage?: "ru" | "en" | "kz"
): string | null {
  if (snapshot.length === 0) return null;
  const language = detectReplyLanguage(userMessage, preferredLanguage);
  const list = pickHerbicideSnapshotForQuery(snapshot, userMessage, chatHistory);
  if (list.length === 0) return null;

  if (language === "en") {
    const lines = list.map((item) => {
      const unit = item.unit ? ` ${item.unit}` : "";
      const warehouses = item.warehouseBreakdown
        .map((w) => `${w.warehouseName}: ${w.quantity.toFixed(2)}${unit}`)
        .join("; ");
      return `- ${item.productName}: total ${item.totalQuantity.toFixed(2)}${unit} (${warehouses})`;
    });
    return `Current herbicide stock by warehouse:\n${lines.join("\n")}`;
  }

  const lines = list.map((item) => {
    const unit = item.unit ? ` ${item.unit}` : "";
    const warehouses = item.warehouseBreakdown
      .map((w) => `${w.warehouseName}: ${w.quantity.toFixed(2)}${unit}`)
      .join("; ");
    return `- ${item.productName}: всего ${item.totalQuantity.toFixed(2)}${unit} (${warehouses})`;
  });
  return `Текущие остатки гербицидов по складам:\n${lines.join("\n")}`;
}

async function loadAssistantSettings(
  supabase: SupabaseClient,
  userId: string,
  companyId: string
): Promise<{ settings: AssistantSettings; knowledgeFiles: Array<{ filename: string; extracted_text: string }> }> {
  if (!userId || !isStrictUuid(userId)) {
    return { settings: DEFAULT_SETTINGS, knowledgeFiles: [] };
  }

  try {
    const [settingsByCompany, settingsByUser] = await Promise.all([
      companyId && isStrictUuid(companyId)
        ? supabase.from("assistant_settings").select("*").eq("company_id", companyId).maybeSingle()
        : Promise.resolve({ data: null } as any),
      supabase.from("assistant_settings").select("*").eq("user_id", userId).maybeSingle(),
    ]);

    let knowledgeFiles: Array<{ filename: string; extracted_text: string }> = [];
    let globalBaseIds: string[] = [];

    if (companyId && isStrictUuid(companyId)) {
      try {
        const globalBasesResult = await supabase
          .from("knowledge_bases")
          .select("id")
          .eq("company_id", companyId)
          .eq("scope_type", "global")
          .eq("archived", false)
          .limit(3);
        globalBaseIds = Array.isArray(globalBasesResult?.data)
          ? globalBasesResult.data
              .map((row: any) => asString(row?.id))
              .filter((id): id is string => Boolean(id))
          : [];
      } catch (error) {
        console.warn("Global knowledge base tables are unavailable, fallback to legacy assistant files", error);
      }
    }

    if (globalBaseIds.length > 0) {
      const { data: globalDocs, error: globalDocsError } = await supabase
        .from("knowledge_documents")
        .select("filename, extracted_text")
        .eq("company_id", companyId)
        .in("knowledge_base_id", globalBaseIds)
        .eq("archived", false)
        .order("created_at", { ascending: false })
        .limit(5);
      if (!globalDocsError && Array.isArray(globalDocs) && globalDocs.length > 0) {
        knowledgeFiles = globalDocs;
      }
    }

    if (knowledgeFiles.length === 0) {
      const { data: legacyKnowledgeByCompany, error: legacyCompanyError } = companyId
        ? await supabase
            .from("assistant_knowledge_files")
            .select("filename, extracted_text")
            .eq("company_id", companyId)
            .order("uploaded_at", { ascending: false })
            .limit(5)
        : ({ data: [], error: null } as any);

      if (!legacyCompanyError && Array.isArray(legacyKnowledgeByCompany) && legacyKnowledgeByCompany.length > 0) {
        knowledgeFiles = legacyKnowledgeByCompany;
      } else {
        const { data: legacyKnowledgeByUser, error: legacyUserError } = await supabase
          .from("assistant_knowledge_files")
          .select("filename, extracted_text")
          .eq("user_id", userId)
          .order("uploaded_at", { ascending: false })
          .limit(3);
        if (!legacyUserError && Array.isArray(legacyKnowledgeByUser)) {
          knowledgeFiles = legacyKnowledgeByUser;
        }
      }
    }

    return {
      settings: {
        ...DEFAULT_SETTINGS,
        ...(settingsByUser?.data || {}),
        ...(settingsByCompany?.data || {}),
      },
      knowledgeFiles,
    };
  } catch (error) {
    console.error("Failed to load assistant settings:", error);
    return { settings: DEFAULT_SETTINGS, knowledgeFiles: [] };
  }
}

async function fetchFarmContext(
  supabase: SupabaseClient,
  companyId: string,
  settings: AssistantSettings,
  userId?: string
): Promise<string> {
  if (!companyId) {
    return "COMPANY CONTEXT: unavailable (missing company_id). Ask user to reload and ensure profile is loaded.";
  }

  try {
    const includeWarehouseData = settings.use_warehouse_data;
    const includeInventoryData = settings.use_inventory_data;

    const settled = await Promise.allSettled([
      supabase
        .from("fields")
        .select("id, name, area, soil_type")
        .eq("company_id", companyId)
        .eq("archived", false)
        .order("name", { ascending: true }),
      supabase
        .from("seasons")
        .select("id, year, name")
        .eq("company_id", companyId)
        .eq("archived", false)
        .order("year", { ascending: false }),
      supabase
        .from("crops")
        .select("id, name")
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .eq("archived", false)
        .order("name", { ascending: true }),
      supabase
        .from("crop_structure")
        .select(`
          id,
          area,
          fields(name, area),
          seasons(year, name),
          crops(name)
        `)
        .eq("company_id", companyId)
        .eq("archived", false),
      supabase
        .from("operations")
        .select(`
          id,
          operation_type,
          date,
          notes,
          fields(name),
          crop_structure(crops(name))
        `)
        .eq("company_id", companyId)
        .eq("archived", false)
        .order("date", { ascending: false })
        .limit(25),
      includeWarehouseData
        ? supabase
            .from("warehouses")
            .select("id, name")
            .eq("company_id", companyId)
            .eq("archived", false)
            .order("name", { ascending: true })
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from("products")
        .select("id, name, type")
        .eq("company_id", companyId)
        .eq("archived", false)
        .order("name", { ascending: true }),
      includeInventoryData
        ? supabase
            .from("inventory_transactions")
            .select(`
              id,
              date,
              transaction_type,
              quantity,
              warehouses(name),
              products(name, type)
            `)
            .eq("company_id", companyId)
            .order("date", { ascending: false })
            .limit(25)
        : Promise.resolve({ data: [] as any[] }),
      includeInventoryData
        ? supabase
            .from("inventory_transactions")
            .select(`
              warehouse_id,
              product_id,
              quantity,
              transaction_type,
              date,
              warehouses:warehouse_id(name),
              products:product_id(name, type)
            `)
            .eq("company_id", companyId)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const extractData = (index: number): any[] => {
      const result = settled[index];
      if (result.status === "fulfilled") {
        return ((result as PromiseFulfilledResult<any>).value?.data as any[]) || [];
      }
      console.error(`Farm context query failed at index ${index}:`, result.reason);
      return [];
    };

    const fields = extractData(0);
    const seasons = extractData(1);
    const crops = extractData(2);
    const cropStructures = extractData(3);
    const operations = extractData(4);
    const warehouses = extractData(5);
    const products = extractData(6);
    const inventoryTransactions = extractData(7);
    const inventoryBalanceRows = extractData(8);

    const hasNoCompanyData =
      fields.length === 0 &&
      seasons.length === 0 &&
      cropStructures.length === 0 &&
      operations.length === 0 &&
      warehouses.length === 0 &&
      products.length === 0 &&
      inventoryTransactions.length === 0;

    if (hasNoCompanyData && userId && isStrictUuid(userId)) {
      const legacySettled = await Promise.allSettled([
        supabase
          .from("fields")
          .select("id, name, area, soil_type")
          .is("company_id", null)
          .eq("user_id", userId)
          .eq("archived", false)
          .order("name", { ascending: true }),
        supabase
          .from("seasons")
          .select("id, year, name")
          .is("company_id", null)
          .eq("user_id", userId)
          .eq("archived", false)
          .order("year", { ascending: false }),
        supabase
          .from("crop_structure")
          .select(`
            id,
            area,
            fields(name, area),
            seasons(year, name),
            crops(name)
          `)
          .is("company_id", null)
          .eq("user_id", userId)
          .eq("archived", false),
        supabase
          .from("operations")
          .select(`
            id,
            operation_type,
            date,
            notes,
            fields(name),
            crop_structure(crops(name))
          `)
          .is("company_id", null)
          .eq("user_id", userId)
          .eq("archived", false)
          .order("date", { ascending: false })
          .limit(25),
        includeWarehouseData
          ? supabase
              .from("warehouses")
              .select("id, name")
              .is("company_id", null)
              .eq("user_id", userId)
              .eq("archived", false)
              .order("name", { ascending: true })
          : Promise.resolve({ data: [] as any[] }),
        supabase
          .from("products")
          .select("id, name, type")
          .is("company_id", null)
          .eq("user_id", userId)
          .eq("archived", false)
          .order("name", { ascending: true }),
        includeInventoryData
          ? supabase
              .from("inventory_transactions")
              .select(`
                id,
                date,
                transaction_type,
                quantity,
                warehouses(name),
                products(name, type)
              `)
              .is("company_id", null)
              .eq("user_id", userId)
              .order("date", { ascending: false })
              .limit(25)
          : Promise.resolve({ data: [] as any[] }),
        includeInventoryData
          ? supabase
              .from("inventory_transactions")
              .select(`
                warehouse_id,
                product_id,
                quantity,
                transaction_type,
                date,
                warehouses:warehouse_id(name),
                products:product_id(name, type)
              `)
              .is("company_id", null)
              .eq("user_id", userId)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const legacyData = (index: number): any[] => {
        const result = legacySettled[index];
        if (result.status === "fulfilled") {
          return ((result as PromiseFulfilledResult<any>).value?.data as any[]) || [];
        }
        return [];
      };

      return buildContextSummary({
        fields: legacyData(0),
        seasons: legacyData(1),
        crops,
        cropStructures: legacyData(2),
        operations: legacyData(3),
        warehouses: legacyData(4),
        products: legacyData(5),
        inventoryTransactions: legacyData(6),
        inventoryBalanceRows: legacyData(7),
      });
    }

    return buildContextSummary({
      fields,
      seasons,
      crops,
      cropStructures,
      operations,
      warehouses,
      products,
      inventoryTransactions,
      inventoryBalanceRows,
    });
  } catch (error) {
    console.error("Error fetching farm context:", error);
    return "FARM CONTEXT: failed to load due to data access error.";
  }
}

function buildContextSummary(context: {
  fields: any[];
  seasons: any[];
  crops: any[];
  cropStructures: any[];
  operations: any[];
  warehouses: any[];
  products: any[];
  inventoryTransactions: any[];
  inventoryBalanceRows: any[];
}): string {
  const parts: string[] = [];
  const totalArea = context.fields.reduce((sum, field) => sum + Number(field.area || 0), 0);

  parts.push("=== FARM DATA CONTEXT ===");
  parts.push(`Fields: ${context.fields.length}`);
  parts.push(`Total field area: ${totalArea.toFixed(2)} ha`);
  parts.push(`Seasons: ${context.seasons.length}`);
  parts.push(`Crops: ${context.crops.length}`);
  parts.push("");

  parts.push("Fields list:");
  if (context.fields.length === 0) {
    parts.push("- none");
  } else {
    context.fields.slice(0, 100).forEach((field) => {
      parts.push(`- ${field.name}: ${Number(field.area || 0).toFixed(2)} ha`);
    });
  }

  parts.push("");
  parts.push("Seasons:");
  if (context.seasons.length === 0) {
    parts.push("- none");
  } else {
    context.seasons.slice(0, 20).forEach((season) => {
      const seasonName = season.name ? ` (${season.name})` : "";
      parts.push(`- ${season.year}${seasonName}`);
    });
  }

  parts.push("");
  parts.push("Crop distribution by season:");
  if (context.cropStructures.length === 0) {
    parts.push("- none");
  } else {
    const grouped = context.cropStructures.reduce((acc: Record<string, Record<string, number>>, row: any) => {
      const seasonKey = String(row.seasons?.year || "unknown");
      const cropName = row.crops?.name || "unknown";
      const area = Number(row.area || row.fields?.area || 0);
      if (!acc[seasonKey]) acc[seasonKey] = {};
      if (!acc[seasonKey][cropName]) acc[seasonKey][cropName] = 0;
      acc[seasonKey][cropName] += area;
      return acc;
    }, {});

    Object.entries(grouped).forEach(([season, crops]) => {
      parts.push(`- Season ${season}:`);
      Object.entries(crops).forEach(([crop, area]) => {
        parts.push(`  - ${crop}: ${area.toFixed(2)} ha`);
      });
    });
  }

  parts.push("");
  parts.push("Field crop structure:");
  if (context.cropStructures.length === 0) {
    parts.push("- none");
  } else {
    context.cropStructures.slice(0, 80).forEach((row) => {
      const fieldName = row.fields?.name || "unknown field";
      const cropName = row.crops?.name || "unknown crop";
      const seasonYear = row.seasons?.year ? String(row.seasons.year) : "unknown";
      const seasonName = row.seasons?.name ? ` (${row.seasons.name})` : "";
      const area = Number(row.area || row.fields?.area || 0);
      parts.push(`- ${fieldName}: ${cropName}, season ${seasonYear}${seasonName}, area ${area.toFixed(2)} ha`);
    });
  }

  parts.push("");
  parts.push("Recent operations:");
  if (context.operations.length === 0) {
    parts.push("- none");
  } else {
    context.operations.slice(0, 15).forEach((op) => {
      const fieldName = op.fields?.name || "unknown field";
      const cropName = op.crop_structure?.crops?.name;
      const cropSuffix = cropName ? ` (${cropName})` : "";
      const notes = asString(op.notes);
      const notesSuffix = notes ? ` - ${notes}` : "";
      parts.push(`- ${op.date}: ${op.operation_type} on ${fieldName}${cropSuffix}${notesSuffix}`);
    });
  }

  parts.push("");
  parts.push("Warehouses:");
  if (context.warehouses.length === 0) {
    parts.push("- none");
  } else {
    context.warehouses.slice(0, 30).forEach((w) => parts.push(`- ${w.name}`));
  }

  parts.push("");
  parts.push("Products:");
  if (context.products.length === 0) {
    parts.push("- none");
  } else {
    context.products.slice(0, 50).forEach((p) => parts.push(`- ${p.name}${p.type ? ` (${p.type})` : ""}`));
  }

  parts.push("");
  parts.push("Recent inventory transactions:");
  if (context.inventoryTransactions.length === 0) {
    parts.push("- none");
  } else {
    context.inventoryTransactions.slice(0, 15).forEach((tx) => {
      const unitSuffix = tx.unit ? ` ${tx.unit}` : "";
      parts.push(
        `- ${tx.date}: ${tx.transaction_type} ${tx.quantity}${unitSuffix} of ${tx.products?.name || "unknown product"} at ${tx.warehouses?.name || "unknown warehouse"}`
      );
    });
  }

  const balanceMap = new Map<
    string,
    {
      warehouseName: string;
      productName: string;
      productType: string;
      unit: string;
      quantity: number;
      lastUpdated: string;
    }
  >();

  context.inventoryBalanceRows.forEach((tx) => {
    const warehouseId = asString(tx.warehouse_id) || "unknown-warehouse";
    const productId = asString(tx.product_id) || "unknown-product";
    const key = `${warehouseId}:${productId}`;

    if (!balanceMap.has(key)) {
      balanceMap.set(key, {
        warehouseName: tx.warehouses?.name || "unknown warehouse",
        productName: tx.products?.name || "unknown product",
        productType: tx.products?.type || "",
        unit: tx.unit || "",
        quantity: 0,
        lastUpdated: tx.date || "",
      });
    }

    const row = balanceMap.get(key)!;
    const qty = Number(tx.quantity || 0);
    if (!Number.isFinite(qty) || qty === 0) return;

    row.quantity += tx.transaction_type === "in" ? qty : -qty;
    if (tx.date && tx.date > row.lastUpdated) {
      row.lastUpdated = tx.date;
    }
  });

  const balances = Array.from(balanceMap.values())
    .filter((row) => Math.abs(row.quantity) > 0.000001)
    .sort((a, b) => Math.abs(b.quantity) - Math.abs(a.quantity));

  parts.push("");
  parts.push("Current inventory balances:");
  if (balances.length === 0) {
    parts.push("- none");
  } else {
    balances.slice(0, 40).forEach((row) => {
      const productTypeSuffix = row.productType ? ` (${row.productType})` : "";
      const unitSuffix = row.unit ? ` ${row.unit}` : "";
      const updatedSuffix = row.lastUpdated ? `, updated ${row.lastUpdated}` : "";
      parts.push(
        `- ${row.warehouseName}: ${row.productName}${productTypeSuffix} = ${row.quantity.toFixed(2)}${unitSuffix}${updatedSuffix}`
      );
    });
  }

  parts.push("=== END OF FARM DATA ===");
  return parts.join("\n");
}

function extractJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function tryParseDraftContainer(candidate: string): OperationDraft | null {
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object") return null;

    const draftObject =
      parsed && typeof parsed.draft === "object" && parsed.draft !== null
        ? (parsed.draft as Record<string, unknown>)
        : (parsed as Record<string, unknown>);

    return normalizeDraft(draftObject);
  } catch {
    return null;
  }
}

function normalizeDraft(rawDraft: Record<string, unknown>): OperationDraft | null {
  const operationType = asString(rawDraft.operation_type) || asString(rawDraft.operationType);
  if (!operationType) return null;

  const metadata =
    typeof rawDraft.metadata === "object" && rawDraft.metadata !== null && !Array.isArray(rawDraft.metadata)
      ? { ...(rawDraft.metadata as Record<string, unknown>) }
      : {};

  const keysToKeepInMetadata = [
    "crop",
    "area",
    "target",
    "product",
    "product_id",
    "rate",
    "rate_per_ha",
    "additional_products",
    "additional_products_list",
    "spray_volume_per_ha",
    "total_amount",
    "water_rate",
    "total_water",
    "total_mixture_volume",
    "total_water_volume",
    "total_product_volume",
    "water_percentage",
    "product_percentage",
    "mixture_composition",
    "equipment",
    "equipment_id",
    "responsible",
    "responsible_id",
    "performer",
    "comments",
  ];

  keysToKeepInMetadata.forEach((key) => {
    if (rawDraft[key] !== undefined && metadata[key] === undefined) {
      metadata[key] = rawDraft[key];
    }
  });

  if (metadata.performer && !metadata.responsible) {
    metadata.responsible = metadata.performer;
  }
  if (metadata.rate && !metadata.rate_per_ha) {
    metadata.rate_per_ha = metadata.rate;
  }
  if (metadata.water_rate && !metadata.spray_volume_per_ha) {
    metadata.spray_volume_per_ha = metadata.water_rate;
  }
  if (metadata.total_amount && !metadata.total_product_volume) {
    metadata.total_product_volume = metadata.total_amount;
  }
  if (metadata.total_water && !metadata.total_water_volume) {
    metadata.total_water_volume = metadata.total_water;
  }
  if (metadata.comments === undefined && asString(rawDraft.notes)) {
    metadata.comments = asString(rawDraft.notes);
  }

  const aliasPairs: Array<{ from: string; to: string }> = [
    { from: "main_product", to: "product" },
    { from: "main_product_id", to: "product_id" },
    { from: "target_object", to: "target" },
    { from: "spray_volume", to: "spray_volume_per_ha" },
    { from: "spray_volume_ha", to: "spray_volume_per_ha" },
    { from: "mix_total", to: "total_mixture_volume" },
    { from: "water_total", to: "total_water_volume" },
    { from: "product_total", to: "total_product_volume" },
    { from: "machine", to: "equipment" },
    { from: "brigadier", to: "responsible" },
    { from: "specialist", to: "responsible" },
    { from: "comment", to: "comments" },
  ];

  aliasPairs.forEach(({ from, to }) => {
    if (metadata[to] === undefined && rawDraft[from] !== undefined) {
      metadata[to] = rawDraft[from];
    }
  });

  const operationDate =
    normalizeDate(asString(rawDraft.date)) ||
    normalizeDate(asString(rawDraft.operation_date)) ||
    normalizeDate(asString(rawDraft.operation_datetime)) ||
    normalizeDate(asString(rawDraft.datetime));

  const operationDateTime =
    normalizeDateTime(asString(rawDraft.operation_datetime)) ||
    normalizeDateTime(asString(rawDraft.datetime)) ||
    normalizeDateTime(asString(rawDraft.date));

  return {
    operation_type: operationType,
    field_id: asString(rawDraft.field_id),
    field_name: asString(rawDraft.field_name),
    crop_structure_id: asString(rawDraft.crop_structure_id),
    crop_id: asString(rawDraft.crop_id),
    crop_name: asString(rawDraft.crop_name),
    operation_datetime: operationDateTime || undefined,
    date: operationDate,
    notes: asString(rawDraft.notes) || asString(metadata.comments) || "",
    metadata,
  };
}

function stripDraftPayloadFromText(text: string): string {
  let clean = text;
  clean = clean.replace(/<draft_json>[\s\S]*?<\/draft_json>/gi, "");
  clean = clean.replace(/```(?:json)?[\s\S]*?"draft"[\s\S]*?```/gi, "");
  clean = clean.replace(/\{[\s\S]*?"draft"[\s\S]*?\}/gi, "");
  clean = clean.trim();
  return clean;
}

function detectReplyLanguage(text: string, preferredLanguage?: "ru" | "en" | "kz"): "ru" | "en" | "kz" {
  if (preferredLanguage === "ru" || preferredLanguage === "en" || preferredLanguage === "kz") {
    return preferredLanguage;
  }
  if (/[әіңғүұқөһ]/i.test(text)) return "kz";
  if (/\p{Script=Cyrillic}/u.test(text)) return "ru";
  if (/[а-яё]/i.test(text)) return "ru";
  return "en";
}

function isWarehouseRelatedText(text: string): boolean {
  const n = normalizeLookupText(text);
  return /(warehouse|stock|inventory|product|pesticide|herbicide|sklad|nalich|inventar|preparat|gerbic)/i.test(n);
}

function isHerbicideRelatedText(text: string): boolean {
  const n = normalizeLookupText(text);
  return /(herbic|weed|glyphos|glifos|roundup|raundap|dicamba|dikamba|metribuzin|24d|2,4-d|2.4-d|gerbic)/i.test(n);
}

function isFieldRelatedText(text: string): boolean {
  const n = normalizeLookupText(text);
  return /(field|fields|crop\s*structure|season|pole|uchastok|posev|struktur)/i.test(n);
}

function containsNoRecordsClaim(text: string): boolean {
  const n = normalizeLookupText(text);
  return /(no\s+records|no\s+data|not\s+found|there\s+are\s+no|net\s+zapis|net\s+informac|net\s+dann|otsutstv|konkretn.*ne\s+ukazan)/i.test(
    n
  );
}

function containsUncertainStockClaim(text: string): boolean {
  const n = normalizeLookupText(text);
  return /(konkretn.*ne\s+ukazan|specific.*not|dont\s+have\s+specific|cannot\s+specify|unknown\s+quantity|ne\s+mogu\s+utochnit)/i.test(
    n
  );
}

function isStockAvailabilityQuery(text: string): boolean {
  const n = normalizeLookupText(text);
  return /(skolko|nalich|ostat|sklad|in\s+stock|available|availability|how\s+much|quantity|qty)/i.test(
    n
  );
}

function containsAccessDeniedClaim(text: string): boolean {
  const n = normalizeLookupText(text);
  return /(no\s+access|dont\s+have\s+access|cannot\s+access|cant\s+access|not\s+available|net\s+dostup|ne\s+imeyu\s+dostup)/i.test(
    n
  );
}

function hasConfirmedOperationDateTime(draft: OperationDraft | null): boolean {
  if (!draft) return false;
  const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(String(draft.date || ""));
  const hasDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(draft.operation_datetime || ""));
  return hasDate || hasDateTime;
}

function isZeroLike(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const str = String(value).replace(",", ".").trim();
  if (!str) return true;
  const numeric = Number(str.match(/-?\d+(\.\d+)?/)?.[0] ?? NaN);
  return !Number.isFinite(numeric) || numeric <= 0;
}

function pickDraftReadyMessage(userMessage: string, preferredLanguage?: "ru" | "en" | "kz"): string {
  const language = detectReplyLanguage(userMessage, preferredLanguage);
  if (language === "en") {
    return "Draft operation prepared. Please review and confirm below.";
  }
  if (language === "kz") {
    return "Операция черновигі дайын. Төменде тексеріп, растаңыз.";
  }
  return "Черновик операции подготовлен. Проверьте и подтвердите ниже.";
}

async function enrichDraftWithCompanyData(
  supabase: SupabaseClient,
  draft: OperationDraft,
  companyId: string,
  userId: string
): Promise<OperationDraft> {
  const safeCompanyId = asString(companyId);
  if (!safeCompanyId) return draft;

  const metadata: Record<string, unknown> =
    draft.metadata && typeof draft.metadata === "object" ? { ...draft.metadata } : {};

  const fieldIdCandidate = asString(draft.field_id);
  const fieldNameCandidate = asString(draft.field_name);
  let resolvedField: { id: string; name: string | null; area: number | null } | null = null;

  if (fieldIdCandidate && isUuidLike(fieldIdCandidate)) {
    const { data } = await supabase
      .from("fields")
      .select("id, name, area")
      .eq("id", fieldIdCandidate)
      .eq("company_id", safeCompanyId)
      .eq("archived", false)
      .maybeSingle();
    resolvedField = data || null;
  }

  if (!resolvedField && fieldNameCandidate) {
    const { data } = await supabase
      .from("fields")
      .select("id, name, area")
      .eq("company_id", safeCompanyId)
      .eq("archived", false)
      .ilike("name", fieldNameCandidate)
      .limit(1)
      .maybeSingle();
    resolvedField = data || null;
  }

  if (!resolvedField && userId && isStrictUuid(userId)) {
    if (fieldIdCandidate && isUuidLike(fieldIdCandidate)) {
      const { data } = await supabase
        .from("fields")
        .select("id, name, area")
        .eq("id", fieldIdCandidate)
        .is("company_id", null)
        .eq("user_id", userId)
        .eq("archived", false)
        .maybeSingle();
      resolvedField = data || null;
    }

    if (!resolvedField && fieldNameCandidate) {
      const { data } = await supabase
        .from("fields")
        .select("id, name, area")
        .is("company_id", null)
        .eq("user_id", userId)
        .eq("archived", false)
        .ilike("name", fieldNameCandidate)
        .limit(1)
        .maybeSingle();
      resolvedField = data || null;
    }
  }

  if (isZeroLike(metadata.area) && resolvedField?.area !== null && resolvedField?.area !== undefined) {
    metadata.area = String(resolvedField.area);
  }

  const rawResponsibleId = asString(metadata.responsible_id);
  const rawResponsibleText = asString(metadata.responsible) || asString(metadata.performer) || "";
  let resolvedResponsibleId = "";
  let resolvedResponsibleEmail = "";
  let responsibleRoleError = "";

  if (rawResponsibleId && isUuidLike(rawResponsibleId)) {
    const { data: responsibleById } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, status")
      .eq("id", rawResponsibleId)
      .eq("company_id", safeCompanyId)
      .eq("status", "active")
      .maybeSingle();
    if (responsibleById?.id && (responsibleById as any).role === "specialist") {
      resolvedResponsibleId = String(responsibleById.id);
      resolvedResponsibleEmail = asString(responsibleById.email) || "";
      metadata.responsible = asString((responsibleById as any).full_name) || asString(metadata.responsible) || "";
    } else if (responsibleById?.id) {
      responsibleRoleError = "Нельзя назначить задачу на этого пользователя: он не специалист.";
    }
  }

  if (!resolvedResponsibleId && !responsibleRoleError && rawResponsibleText) {
    const emailMatch = rawResponsibleText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const normalizedEmail = (emailMatch?.[0] || rawResponsibleText).trim().toLowerCase();
    if (normalizedEmail && normalizedEmail.includes("@")) {
      const { data: responsibleByEmail } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, status")
        .eq("company_id", safeCompanyId)
        .eq("status", "active")
        .ilike("email", normalizedEmail)
        .limit(1)
        .maybeSingle();
      if (responsibleByEmail?.id && (responsibleByEmail as any).role === "specialist") {
        resolvedResponsibleId = String(responsibleByEmail.id);
        resolvedResponsibleEmail = asString(responsibleByEmail.email) || "";
        metadata.responsible = asString((responsibleByEmail as any).full_name) || asString(metadata.responsible) || "";
      } else if (responsibleByEmail?.id) {
        responsibleRoleError = "Такого специалиста нет. Этот пользователь есть в системе, но его роль не подходит для выполнения полевых задач.";
      }
    }
  }

  if (!resolvedResponsibleId && !responsibleRoleError && rawResponsibleText && !rawResponsibleText.includes("@")) {
    const normalizedFullName = rawResponsibleText.replace(/\s+/g, " ").trim();
    const { data: responsibleByName } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, status")
      .eq("company_id", safeCompanyId)
      .eq("status", "active")
      .ilike("full_name", normalizedFullName)
      .limit(1)
      .maybeSingle();

    if (responsibleByName?.id && (responsibleByName as any).role === "specialist") {
      resolvedResponsibleId = String(responsibleByName.id);
      resolvedResponsibleEmail = asString((responsibleByName as any).email) || "";
      metadata.responsible = asString((responsibleByName as any).full_name) || normalizedFullName;
    } else if (responsibleByName?.id) {
      responsibleRoleError = "Нельзя назначить задачу на этого пользователя: он не специалист.";
    }
  }

  if (resolvedResponsibleId) {
    metadata.responsible_id = resolvedResponsibleId;
    if (!asString(metadata.responsible)) {
      metadata.responsible = resolvedResponsibleEmail || rawResponsibleText;
    }
  }
  if (responsibleRoleError) {
    metadata.responsible_validation_error = responsibleRoleError;
    delete (metadata as any).responsible_id;
  }

  let normalizedCropStructureId = asString(draft.crop_structure_id);
  if (normalizedCropStructureId && isUuidLike(normalizedCropStructureId)) {
    let cropStructureFound = false;
    const { data: companyCropStructure } = await supabase
      .from("crop_structure")
      .select("id")
      .eq("id", normalizedCropStructureId)
      .eq("company_id", safeCompanyId)
      .eq("archived", false)
      .maybeSingle();
    cropStructureFound = Boolean(companyCropStructure?.id);

    if (!cropStructureFound && userId && isStrictUuid(userId)) {
      const { data: legacyCropStructure } = await supabase
        .from("crop_structure")
        .select("id")
        .eq("id", normalizedCropStructureId)
        .is("company_id", null)
        .eq("user_id", userId)
        .eq("archived", false)
        .maybeSingle();
      cropStructureFound = Boolean(legacyCropStructure?.id);
    }

    if (!cropStructureFound) {
      normalizedCropStructureId = undefined;
    }
  } else {
    normalizedCropStructureId = undefined;
  }

  return {
    ...draft,
    field_id: draft.field_id || resolvedField?.id || undefined,
    field_name: draft.field_name || resolvedField?.name || undefined,
    crop_structure_id: normalizedCropStructureId,
    metadata,
  };
}

function buildWarehouseFallbackMessage(
  language: "ru" | "en" | "kz",
  summary: { warehousesCount: number; productsCount: number; inventoryCount: number }
): string {
  if (language === "en") {
    if (summary.warehousesCount === 0 && summary.productsCount === 0 && summary.inventoryCount === 0) {
      return "I do have warehouse access. In your current company data there are no warehouse/inventory records yet.";
    }
    return `I do have warehouse access. Current records: warehouses ${summary.warehousesCount}, products ${summary.productsCount}, inventory transactions ${summary.inventoryCount}.`;
  }

  if (language === "kz") {
    if (summary.warehousesCount === 0 && summary.productsCount === 0 && summary.inventoryCount === 0) {
      return "Менде қойма деректеріне қолжетімділік бар. Бірақ компания деректерінде қойма/қор жазбалары әлі жоқ.";
    }
    return `Менде қойма деректеріне қолжетімділік бар. Қазіргі жазбалар: қоймалар ${summary.warehousesCount}, өнімдер ${summary.productsCount}, қозғалыстар ${summary.inventoryCount}.`;
  }

  if (summary.warehousesCount === 0 && summary.productsCount === 0 && summary.inventoryCount === 0) {
    return "У меня есть доступ к складам. В данных вашей компании сейчас нет записей по складам/остаткам.";
  }

  return `У меня есть доступ к складам. Текущие записи: складов ${summary.warehousesCount}, продуктов ${summary.productsCount}, движений по складу ${summary.inventoryCount}.`;
}

function enforceWarehouseMessaging(
  assistantText: string,
  userMessage: string,
  summary: { warehousesCount: number; productsCount: number; inventoryCount: number },
  preferredLanguage?: "ru" | "en" | "kz"
): string {
  if (!assistantText) return assistantText;

  const combined = `${assistantText}\n${userMessage}`;
  if (!isWarehouseRelatedText(combined)) return assistantText;
  if (!containsAccessDeniedClaim(assistantText)) return assistantText;

  const language = detectReplyLanguage(userMessage || assistantText, preferredLanguage);
  const fallback = buildWarehouseFallbackMessage(language, summary);

  if (language === "en") {
    return `${fallback}\n\nIf you want, I can list products and recent warehouse movements for your spraying task.`;
  }

  if (language === "kz") {
    return `${fallback}\n\nҚаласаңыз, осы өңдеу жұмысына арналған өнімдер мен соңғы қойма қозғалыстарын шығарып беремін.`;
  }

  return `${fallback}\n\nЕсли хотите, могу сразу вывести список подходящих препаратов и последние движения по складам под вашу задачу.`;
}

function enforceDataPresenceMessaging(
  assistantText: string,
  userMessage: string,
  summary: DataAvailabilitySummary,
  preferredLanguage?: "ru" | "en" | "kz"
): string {
  if (!assistantText) return assistantText;
  if (!containsNoRecordsClaim(assistantText)) return assistantText;

  const language = detectReplyLanguage(userMessage || assistantText, preferredLanguage);

  if (
    isWarehouseRelatedText(userMessage) &&
    (summary.warehousesCount > 0 || summary.productsCount > 0 || summary.inventoryCount > 0)
  ) {
    if (isHerbicideRelatedText(userMessage) && summary.pesticidesCount > 0) {
      if (language === "en") {
        return `I found plant-protection products in stock data: pesticides ${summary.pesticidesCount} (herbicide-like names ${summary.herbicideLikeCount}). I can list them now with balances by warehouse.`;
      }
      return `В складских данных есть СЗР: пестицидов ${summary.pesticidesCount} (из них с названиями, похожими на гербициды: ${summary.herbicideLikeCount}). Могу сразу вывести список и остатки по складам.`;
    }

    if (language === "en") {
      return `I found warehouse data: warehouses ${summary.warehousesCount}, products ${summary.productsCount}, inventory transactions ${summary.inventoryCount}. Tell me what exactly to show: balances, product list, or latest movements.`;
    }
    return `Нашёл складские данные: складов ${summary.warehousesCount}, продуктов ${summary.productsCount}, движений ${summary.inventoryCount}. Уточните, что вывести: остатки, список препаратов или последние движения.`;
  }

  if (
    isFieldRelatedText(userMessage) &&
    (summary.fieldsCount > 0 || summary.cropStructuresCount > 0)
  ) {
    if (language === "en") {
      return `I found field data: fields ${summary.fieldsCount}, crop structure records ${summary.cropStructuresCount}, operations ${summary.operationsCount}. I can list fields now or show crop structure by season.`;
    }
    return `Нашёл данные по полям: полей ${summary.fieldsCount}, записей структуры ${summary.cropStructuresCount}, операций ${summary.operationsCount}. Могу сразу вывести список полей или структуру посевов по сезонам.`;
  }

  return assistantText;
}

function extractDraftAndCleanResponse(rawResponse: string): { draft: OperationDraft | null; cleanResponse: string } {
  let draft: OperationDraft | null = null;
  let consumedSnippet = "";

  const tagMatch = rawResponse.match(/<draft_json>([\s\S]*?)<\/draft_json>/i);
  if (tagMatch?.[1]) {
    const parsedFromTag = tryParseDraftContainer(tagMatch[1]);
    if (parsedFromTag) {
      draft = parsedFromTag;
      consumedSnippet = tagMatch[0];
    }
  }

  if (!draft) {
    const codeBlocks = Array.from(rawResponse.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi));
    for (const block of codeBlocks) {
      const candidate = block[1];
      const parsed = tryParseDraftContainer(candidate);
      if (parsed) {
        draft = parsed;
        consumedSnippet = block[0];
        break;
      }
    }
  }

  if (!draft) {
    const whole = tryParseDraftContainer(rawResponse);
    if (whole) {
      draft = whole;
      consumedSnippet = rawResponse;
    }
  }

  if (!draft) {
    const jsonObjects = extractJsonObjects(rawResponse);
    for (const objectSnippet of jsonObjects) {
      if (!/"draft"\s*:/i.test(objectSnippet) && !/"operation_type"\s*:/i.test(objectSnippet)) {
        continue;
      }
      const parsed = tryParseDraftContainer(objectSnippet);
      if (parsed) {
        draft = parsed;
        consumedSnippet = objectSnippet;
        break;
      }
    }
  }

  let clean = rawResponse;
  if (consumedSnippet) {
    clean = clean.replace(consumedSnippet, "");
  }
  clean = stripDraftPayloadFromText(clean);

  if (clean) {
    // Remove leftover standalone JSON objects that still contain a draft marker.
    const leftovers = extractJsonObjects(clean);
    leftovers.forEach((snippet) => {
      if (/"draft"\s*:/i.test(snippet)) {
        clean = clean.replace(snippet, "").trim();
      }
    });
  }

  if (!clean && draft) {
    clean = "Draft operation prepared. Please review and confirm below.";
  }

  return { draft, cleanResponse: clean };
}

export async function POST(request: NextRequest) {
  try {
    const { message, chatHistory, chatId, companyId, userId, locale, attachments } = await request.json();
    const preferredLanguage =
      locale === "ru" || locale === "en" || locale === "kz" ? (locale as "ru" | "en" | "kz") : undefined;
    const normalizedAttachments = normalizeAttachments(attachments);

    const safeMessage = asString(message);
    if (!safeMessage) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    const supabase = getServiceClient();
    const safeUserId = asString(userId) || "";
    const { companyId: resolvedCompanyId, role } = await resolveUserContext(
      supabase,
      asString(companyId),
      safeUserId
    );

    const { settings, knowledgeFiles } = await loadAssistantSettings(
      supabase,
      safeUserId,
      resolvedCompanyId
    );
    const effectiveSettings = getEffectiveSettingsForRole(settings, role);
    const accessMode = hasFullAssistantAccess(role) ? "full" : "limited";
    const farmContext = await fetchFarmContext(
      supabase,
      resolvedCompanyId,
      effectiveSettings,
      safeUserId
    );
    const dataSummary = await getDataAvailabilitySummary(
      supabase,
      resolvedCompanyId,
      safeUserId
    );
    const herbicideSnapshot = await getHerbicideStockSnapshot(
      supabase,
      resolvedCompanyId,
      safeUserId
    );
    const warehouseAccessSummaryPrimary = await getWarehouseAccessSummary(
      supabase,
      resolvedCompanyId
    );
    const currentLocalTime = getCurrentLocalTimeInfo();
    const hasPrimaryWarehouseData =
      warehouseAccessSummaryPrimary.warehousesCount > 0 ||
      warehouseAccessSummaryPrimary.productsCount > 0 ||
      warehouseAccessSummaryPrimary.inventoryCount > 0;
    const warehouseAccessSummary =
      !hasPrimaryWarehouseData && safeUserId && isStrictUuid(safeUserId)
        ? await getLegacyWarehouseAccessSummary(supabase, safeUserId)
        : warehouseAccessSummaryPrimary;

    const systemMessages: Array<{ role: "system"; content: string }> = [
      { role: "system", content: BASE_SYSTEM_PROMPT },
      { role: "system", content: farmContext },
    ];

    systemMessages.push({
      role: "system",
      content: accessMode === "full"
        ? "ROLE ACCESS: full farm access is enabled for this user, including warehouses and inventory."
        : "ROLE ACCESS: read-only farm access is enabled, including warehouses and inventory. Do not create draft payloads.",
    });

    systemMessages.push({
      role: "system",
      content: `CHAT ISOLATION: current chat_id=${asString(chatId) || "unknown"}. Use only facts from current chat history in this request. Do not carry assumptions from other chats.`,
    });
    systemMessages.push({
      role: "system",
      content:
        "CONTEXT LAYERS: (1) global knowledge base documents, (2) current project/chat history only, (3) current user message attachments. Prefer this order and never mix facts from unrelated chats.",
    });

    systemMessages.push({
      role: "system",
      content: `CURRENT LOCAL TIME: ${currentLocalTime.isoMinute} (local), ${currentLocalTime.localeString}. Use this for operation scheduling down to minutes.`,
    });
    if (normalizedAttachments.length > 0) {
      systemMessages.push({
        role: "system",
        content: `ATTACHMENTS: user sent ${normalizedAttachments.length} attachment(s). Use them as context in this answer.`,
      });
    }
    if (preferredLanguage) {
      systemMessages.push({
        role: "system",
        content: `RESPONSE LANGUAGE: Always answer in locale "${preferredLanguage}".`,
      });
    }

    systemMessages.push({
      role: "system",
      content: [
        "MVP RESOURCES STRUCTURE:",
        "- Machines/tractors/drones are reference resources (nomenclature).",
        "- Equipment/aggregates are reference resources.",
        "- Specialists/brigadiers are reference resources.",
        "- Physical stock quantities must come only from warehouse/inventory records.",
      ].join("\n"),
    });

    systemMessages.push({
      role: "system",
      content: [
        "IMPORTANT WAREHOUSE RULE:",
        "You DO have warehouse/inventory read access for this user role.",
        `Available counts -> warehouses: ${warehouseAccessSummary.warehousesCount}, products: ${warehouseAccessSummary.productsCount}, inventory transactions: ${warehouseAccessSummary.inventoryCount}.`,
        "Do NOT say 'I have no access to warehouse data'.",
        "If counts are zero, say there are currently no records, not that access is denied.",
      ].join("\n"),
    });

    systemMessages.push({
      role: "system",
      content: `DATA COUNTS: fields=${dataSummary.fieldsCount}, crop_structure=${dataSummary.cropStructuresCount}, operations=${dataSummary.operationsCount}, warehouses=${dataSummary.warehousesCount}, products=${dataSummary.productsCount}, pesticides=${dataSummary.pesticidesCount}, herbicide_like_names=${dataSummary.herbicideLikeCount}, inventory_transactions=${dataSummary.inventoryCount}, source=${dataSummary.source}. If counts are > 0, do not answer with 'no records'.`,
    });

    if (herbicideSnapshot.length > 0) {
      const herbicideLines = herbicideSnapshot.slice(0, 12).map((item) => {
        const unit = item.unit ? ` ${item.unit}` : "";
        const byWarehouse = item.warehouseBreakdown
          .map((w) => `${w.warehouseName}: ${w.quantity.toFixed(2)}${unit}`)
          .join("; ");
        return `- ${item.productName}: total ${item.totalQuantity.toFixed(2)}${unit}; ${byWarehouse}`;
      });

      systemMessages.push({
        role: "system",
        content: `HERBICIDE STOCK (server-calculated, use exact values):\n${herbicideLines.join("\n")}`,
      });
    }

    if (effectiveSettings.system_prompt) {
      systemMessages.push({
        role: "system",
        content: `CUSTOM INSTRUCTIONS:\n${effectiveSettings.system_prompt}`,
      });
    }

    if (effectiveSettings.region || effectiveSettings.farm_type || effectiveSettings.main_crops) {
      const profileParts: string[] = [];
      if (effectiveSettings.region) profileParts.push(`Region: ${effectiveSettings.region}`);
      if (effectiveSettings.farm_type) profileParts.push(`Farm type: ${effectiveSettings.farm_type}`);
      if (effectiveSettings.main_crops) profileParts.push(`Main crops: ${effectiveSettings.main_crops}`);
      systemMessages.push({
        role: "system",
        content: `AGRONOMIC PROFILE:\n${profileParts.join("\n")}`,
      });
    }

    if (!effectiveSettings.allow_operation_creation) {
      systemMessages.push({
        role: "system",
        content: "Operation draft creation is disabled. Do not produce draft payloads.",
      });
    }

    if (!effectiveSettings.enable_recommendations) {
      systemMessages.push({
        role: "system",
        content: "Agronomic recommendations are disabled. Provide factual analysis only.",
      });
    }

    if (knowledgeFiles.length > 0) {
      const knowledgeContext = knowledgeFiles
        .map((file) => {
          const safeText = asString(file.extracted_text) || "";
          const shortened = safeText.length > 2500 ? `${safeText.slice(0, 2500)}...` : safeText;
          return `--- ${file.filename} ---\n${shortened}`;
        })
        .join("\n\n");

      if (knowledgeContext.trim()) {
        systemMessages.push({
          role: "system",
          content: `KNOWLEDGE BASE:\n${knowledgeContext}`,
        });
      }
    }

    const conversationMessages: Array<{ role: "user" | "assistant"; content: any }> = [];
    if (Array.isArray(chatHistory) && chatHistory.length > 0) {
      chatHistory.slice(-16).forEach((msg: any) => {
        const role = msg?.role === "assistant" ? "assistant" : msg?.role === "user" ? "user" : null;
        const content = asString(msg?.content);
        if (!role || !content) return;
        conversationMessages.push({
          role,
          content: stripDraftPayloadFromText(content),
        });
      });
    }

    if (normalizedAttachments.length === 0) {
      conversationMessages.push({ role: "user", content: safeMessage });
    } else {
      const userParts: any[] = [
        { type: "text", text: safeMessage },
      ];

      const fileContextLines: string[] = [];
      for (const attachment of normalizedAttachments) {
        if (attachment.kind === "image" && attachment.imageDataUrl) {
          userParts.push({
            type: "image_url",
            image_url: {
              url: attachment.imageDataUrl,
            },
          });
          continue;
        }

        const descriptor = `file: ${attachment.name} (${attachment.type || "unknown"})`;
        if (attachment.textContent) {
          fileContextLines.push(`${descriptor}\n${attachment.textContent.slice(0, 12000)}`);
        } else {
          fileContextLines.push(`${descriptor}\nNo inline text preview available.`);
        }
      }

      if (fileContextLines.length > 0) {
        userParts.push({
          type: "text",
          text: `Attached documents context:\n${fileContextLines.join("\n\n---\n\n")}`,
        });
      }

      conversationMessages.push({ role: "user", content: userParts });
    }

    const assistantModel = process.env.OPENAI_ASSISTANT_MODEL || "gpt-4.1-mini";
    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: assistantModel,
        temperature: 0.3,
        max_tokens: 1500,
        messages: [...systemMessages, ...conversationMessages],
      }),
    });

    if (!openAiResponse.ok) {
      const errorPayload = await openAiResponse.json();
      console.error("OpenAI API error:", errorPayload);
      throw new Error(errorPayload?.error?.message || "OpenAI API request failed");
    }

    const data = await openAiResponse.json();
    const assistantRaw = asString(data?.choices?.[0]?.message?.content) || "";
    let { draft, cleanResponse } = extractDraftAndCleanResponse(assistantRaw);
    if (draft) {
      draft = await enrichDraftWithCompanyData(supabase, draft, resolvedCompanyId, safeUserId);
      const draftMetadata =
        draft?.metadata && typeof draft.metadata === "object"
          ? (draft.metadata as Record<string, unknown>)
          : {};
      const responsibleValidationError = asString(draftMetadata.responsible_validation_error);
      if (responsibleValidationError) {
        draft = null;
        cleanResponse = responsibleValidationError;
      }
    }
    let finalResponse = cleanResponse || "I can help with farm analysis and operation planning.";

    if (draft && !hasConfirmedOperationDateTime(draft)) {
      draft = null;
      finalResponse = "Когда проводить операцию? Укажите дату и время (до минут).";
    }

    if (draft) {
      // Draft card is the only UX surface once draft is ready.
      // Keep assistant bubble empty to avoid duplicate summary/calculation text.
      finalResponse = "";
    }

    finalResponse = enforceWarehouseMessaging(
      finalResponse,
      safeMessage,
      warehouseAccessSummary,
      preferredLanguage
    );
    finalResponse = enforceDataPresenceMessaging(
      finalResponse,
      safeMessage,
      dataSummary,
      preferredLanguage
    );

    const hasHerbicideContext =
      isHerbicideRelatedText(safeMessage) ||
      hasHerbicideContextInHistory(chatHistory, herbicideSnapshot);

    const herbicideDirectResponse =
      isWarehouseRelatedText(safeMessage) && hasHerbicideContext
        ? buildHerbicideStockResponse(safeMessage, herbicideSnapshot, chatHistory, preferredLanguage)
        : null;

    if (
      herbicideDirectResponse &&
      (containsUncertainStockClaim(finalResponse) || isStockAvailabilityQuery(safeMessage))
    ) {
      finalResponse = herbicideDirectResponse;
    }

    const debug =
      process.env.NODE_ENV !== "production"
        ? {
            resolvedRole: role,
            accessMode,
            companyId: resolvedCompanyId || null,
            warehouseAccessSummary,
            dataSummary,
            herbicideSnapshotCount: herbicideSnapshot.length,
            herbicideContextDetected: hasHerbicideContext,
            stockQueryDetected: isStockAvailabilityQuery(safeMessage),
            attachmentsCount: normalizedAttachments.length,
            chatId: asString(chatId) || null,
            effectiveSettings: {
              allow_operation_creation: effectiveSettings.allow_operation_creation,
              use_warehouse_data: effectiveSettings.use_warehouse_data,
              use_inventory_data: effectiveSettings.use_inventory_data,
            },
          }
        : undefined;

    return NextResponse.json({
      response: finalResponse,
      draft,
      ...(debug ? { debug } : {}),
    });
  } catch (error) {
    console.error("Assistant API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
