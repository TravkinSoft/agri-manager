export type KnowledgeExtractionConfidence = "low" | "medium" | "high";

export type KnowledgeExtractionDraft = {
  trade_name: string | null;
  manufacturer: string | null;
  product_type: "pesticide" | "fertilizer" | "additive" | "seed" | "unknown" | null;
  subcategory: string | null;
  physical_state: "liquid" | "solid" | "granule" | "powder" | "tablet" | "gel" | "unknown" | null;
  stock_unit: "l" | "ml" | "kg" | "g" | "pcs" | "unknown" | null;
  default_rate_type:
    | "per_ha"
    | "per_1000_l_solution"
    | "per_l_water"
    | "per_t_seed"
    | "per_100kg_seed"
    | "per_1000_seeds"
    | "manual"
    | null;
  default_rate_unit: string | null;
  active_ingredients: Array<{ name: string; concentration: string | null }>;
  crops: string[];
  targets: string[];
  restrictions: string[];
  human_description: string | null;
  application_rules: string[];
  admin_warnings: string[];
  missing_fields: string[];
  editable_card_title: string | null;
  confidence: KnowledgeExtractionConfidence;
  notes: string[];
};

export type KnowledgeSourceContext = {
  sourceId: string;
  sourceType: string;
  title: string | null;
  url: string | null;
  confidence: string | null;
  text: string;
};

export type ProductMetadataSuggestionRow = {
  run_id: string;
  product_id: string | null;
  field_name: string;
  current_value: unknown;
  suggested_value: unknown;
  confidence: KnowledgeExtractionConfidence;
  action_class: "NEED_REVIEW";
  source_id: string | null;
  reason: string;
  status: "draft";
};

export const KNOWLEDGE_EXTRACTION_TEXT_REQUIRED_ERROR =
  "Источник сохранён, но текст ещё не извлечён. Добавьте ручной текст или подключите crawler/PDF parser позже.";
export const KNOWLEDGE_OPENAI_MISSING_ENV_ERROR = "OpenAI extraction недоступен: не настроен ключ/модель";

const PRODUCT_TYPES = new Set(["pesticide", "fertilizer", "additive", "seed", "unknown"]);
const PHYSICAL_STATES = new Set(["liquid", "solid", "granule", "powder", "tablet", "gel", "unknown"]);
const STOCK_UNITS = new Set(["l", "ml", "kg", "g", "pcs", "unknown"]);
const RATE_TYPES = new Set([
  "per_ha",
  "per_1000_l_solution",
  "per_l_water",
  "per_t_seed",
  "per_100kg_seed",
  "per_1000_seeds",
  "manual",
]);
const CONFIDENCE_VALUES = new Set(["low", "medium", "high"]);

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    trade_name: { type: ["string", "null"] },
    manufacturer: { type: ["string", "null"] },
    product_type: {
      type: ["string", "null"],
      enum: ["pesticide", "fertilizer", "additive", "seed", "unknown", null],
    },
    subcategory: { type: ["string", "null"] },
    physical_state: {
      type: ["string", "null"],
      enum: ["liquid", "solid", "granule", "powder", "tablet", "gel", "unknown", null],
    },
    stock_unit: {
      type: ["string", "null"],
      enum: ["l", "ml", "kg", "g", "pcs", "unknown", null],
    },
    default_rate_type: {
      type: ["string", "null"],
      enum: [
        "per_ha",
        "per_1000_l_solution",
        "per_l_water",
        "per_t_seed",
        "per_100kg_seed",
        "per_1000_seeds",
        "manual",
        null,
      ],
    },
    default_rate_unit: { type: ["string", "null"] },
    active_ingredients: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          concentration: { type: ["string", "null"] },
        },
        required: ["name", "concentration"],
      },
    },
    crops: { type: "array", items: { type: "string" } },
    targets: { type: "array", items: { type: "string" } },
    restrictions: { type: "array", items: { type: "string" } },
    human_description: { type: ["string", "null"] },
    application_rules: { type: "array", items: { type: "string" } },
    admin_warnings: { type: "array", items: { type: "string" } },
    missing_fields: { type: "array", items: { type: "string" } },
    editable_card_title: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    notes: { type: "array", items: { type: "string" } },
  },
  required: [
    "trade_name",
    "manufacturer",
    "product_type",
    "subcategory",
    "physical_state",
    "stock_unit",
    "default_rate_type",
    "default_rate_unit",
    "active_ingredients",
    "crops",
    "targets",
    "restrictions",
    "human_description",
    "application_rules",
    "admin_warnings",
    "missing_fields",
    "editable_card_title",
    "confidence",
    "notes",
  ],
} as const;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function nullableText(value: unknown): string | null {
  const next = text(value);
  return next ? next : null;
}

function enumValue<T extends string>(value: unknown, allowed: Set<string>, fallback: T | null = null): T | null {
  const next = text(value).toLowerCase();
  return allowed.has(next) ? (next as T) : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

function activeIngredients(value: unknown): KnowledgeExtractionDraft["active_ingredients"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name = text(record.name);
      if (!name) return null;
      return {
        name,
        concentration: nullableText(record.concentration),
      };
    })
    .filter(Boolean) as KnowledgeExtractionDraft["active_ingredients"];
}

function normalizeRateUnit(value: unknown): string | null {
  const raw = nullableText(value);
  if (!raw) return null;
  return raw
    .replace(/per_t_solution/gi, "per_1000_l_solution")
    .replace(/\/t_solution/gi, "/1000_l_solution")
    .replace(/\/т\s*раствора/gi, "/1000_l_solution")
    .trim();
}

function uniqueTexts(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const next = text(value);
    if (!next || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

function addUniqueRule(values: string[], value: string) {
  if (!values.includes(value)) values.push(value);
}

function sourceTextIncludes(sources: KnowledgeSourceContext[], patterns: RegExp[]) {
  const sourceText = sources.map((source) => `${source.title || ""}\n${source.text}`).join("\n").toLowerCase();
  return patterns.some((pattern) => pattern.test(sourceText));
}

function localizeApplicationRule(value: string) {
  const normalized = value.trim().toLowerCase();
  if (/^used for seed treatment\.?$/.test(normalized)) return "Применяется для обработки семян.";
  if (/seed treatment/.test(normalized) && /used|appl/.test(normalized)) return "Применяется для обработки семян.";
  if (/l\/t seed|tonne of seed|ton of seed/.test(normalized)) return "Расход считается на 1000 кг семян.";
  if (/do not.*l\/ha|not.*per ha/.test(normalized)) return "Не считать как л/га.";
  return value.trim();
}

function enrichKnowledgeExtractionDraft(
  draft: KnowledgeExtractionDraft,
  sources: KnowledgeSourceContext[]
): KnowledgeExtractionDraft {
  const applicationRules = uniqueTexts(draft.application_rules.map(localizeApplicationRule));
  const adminWarnings = [...draft.admin_warnings];
  const missingFields = [...draft.missing_fields];
  const sourceMentionsSeedTreatment = sourceTextIncludes(sources, [
    /seed treatment/i,
    /обработк[аи]\s+семян/i,
    /протрав/i,
  ]);

  if (sourceMentionsSeedTreatment) {
    addUniqueRule(applicationRules, "Применяется для обработки семян.");
  }

  if (draft.default_rate_type === "per_t_seed" || /\/t_seed$/i.test(draft.default_rate_unit || "")) {
    addUniqueRule(applicationRules, "Расход считается на 1000 кг семян.");
    addUniqueRule(applicationRules, "Не считать как л/га.");
  }

  if (draft.default_rate_type === "per_1000_l_solution" || /\/1000_l_solution$/i.test(draft.default_rate_unit || "")) {
    addUniqueRule(applicationRules, "Расход считается на 1000 л рабочего раствора.");
  }

  if (draft.default_rate_type === "per_l_water" || /\/l_water$/i.test(draft.default_rate_unit || "")) {
    addUniqueRule(applicationRules, "Расход считается на 1 л воды.");
  }

  if (draft.default_rate_type === "per_ha" || /\/ha$/i.test(draft.default_rate_unit || "")) {
    addUniqueRule(applicationRules, "Расход считается на 1 га.");
  }

  addUniqueRule(applicationRules, "Использовать только по подтверждённой инструкции.");
  addUniqueRule(applicationRules, "Если данных нет в источнике, оставить поле пустым и проверить вручную.");

  if (draft.confidence !== "high") {
    addUniqueRule(adminWarnings, "Уверенность не высокая: проверьте источник вручную перед применением.");
  }

  if (!draft.product_type) addUniqueRule(missingFields, "Тип продукта");
  if (!draft.subcategory) addUniqueRule(missingFields, "Подтип");
  if (!draft.active_ingredients.length) addUniqueRule(missingFields, "Действующие вещества");
  if (!draft.crops.length) addUniqueRule(missingFields, "Культуры");
  if (!draft.targets.length) addUniqueRule(missingFields, "Объекты применения");

  return {
    ...draft,
    application_rules: applicationRules,
    admin_warnings: adminWarnings,
    missing_fields: missingFields,
  };
}

function isModelAccessError(message: string): boolean {
  return /model.*(does not exist|do not have access|not found|invalid)/i.test(message);
}

export function sanitizeKnowledgeExtractionDraft(value: unknown): KnowledgeExtractionDraft {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawRateType = text(record.default_rate_type).toLowerCase();
  const normalizedRateType = rawRateType === "per_t_solution" ? "per_1000_l_solution" : rawRateType;

  return {
    trade_name: nullableText(record.trade_name),
    manufacturer: nullableText(record.manufacturer),
    product_type: enumValue<KnowledgeExtractionDraft["product_type"] & string>(record.product_type, PRODUCT_TYPES),
    subcategory: nullableText(record.subcategory),
    physical_state: enumValue<KnowledgeExtractionDraft["physical_state"] & string>(record.physical_state, PHYSICAL_STATES),
    stock_unit: enumValue<KnowledgeExtractionDraft["stock_unit"] & string>(record.stock_unit, STOCK_UNITS),
    default_rate_type: enumValue<KnowledgeExtractionDraft["default_rate_type"] & string>(
      normalizedRateType,
      RATE_TYPES
    ),
    default_rate_unit: normalizeRateUnit(record.default_rate_unit),
    active_ingredients: activeIngredients(record.active_ingredients),
    crops: stringArray(record.crops),
    targets: stringArray(record.targets),
    restrictions: stringArray(record.restrictions),
    human_description: nullableText(record.human_description),
    application_rules: stringArray(record.application_rules),
    admin_warnings: stringArray(record.admin_warnings),
    missing_fields: stringArray(record.missing_fields),
    editable_card_title: nullableText(record.editable_card_title),
    confidence: enumValue<KnowledgeExtractionConfidence>(record.confidence, CONFIDENCE_VALUES, "low") || "low",
    notes: stringArray(record.notes),
  };
}

export function buildKnowledgeSourceContexts(sources: Array<Record<string, unknown>>): KnowledgeSourceContext[] {
  return sources
    .map((source) => {
      const sourceId = text(source.id);
      const sourceText = text(source.extracted_text_summary);
      if (!sourceId || !sourceText) return null;
      return {
        sourceId,
        sourceType: text(source.source_type) || "unknown",
        title: nullableText(source.source_title),
        url: nullableText(source.source_url),
        confidence: nullableText(source.source_confidence),
        text: sourceText,
      };
    })
    .filter(Boolean) as KnowledgeSourceContext[];
}

function buildExtractionPrompt(params: {
  runInput: string;
  runManufacturer: string | null;
  sources: KnowledgeSourceContext[];
}) {
  const sourceBlocks = params.sources
    .map(
      (source, index) => [
        `SOURCE ${index + 1}`,
        `type: ${source.sourceType}`,
        `title: ${source.title || "-"}`,
        `url: ${source.url || "-"}`,
        `confidence: ${source.confidence || "-"}`,
        "text:",
        source.text,
      ].join("\n")
    )
    .join("\n\n---\n\n");

  return [
    "You extract agrochemical product metadata from saved source text for TravkinFlow.",
    "OpenAI is only an extractor. Do not decide that data is true; do not update any database.",
    "Return JSON only using the provided schema.",
    "Rules:",
    "- If a value is not explicitly present in the source, use null or an empty array.",
    "- Do not guess manufacturer, product type, rate, active ingredients, crops, targets, registrations, or restrictions.",
    "- Never output per_t_solution. If the source says per tonne of working solution, normalize to per_1000_l_solution only when it clearly means 1000 l working solution; otherwise use null.",
    "- Map l/t seed or литр на тонну семян to default_rate_type per_t_seed and default_rate_unit l/t_seed.",
    "- Map l/ha or л/га to default_rate_type per_ha and default_rate_unit l/ha.",
    "- Map per 1000 l working solution or на 1000 л рабочего раствора to default_rate_type per_1000_l_solution and default_rate_unit l/1000_l_solution unless the unit is different.",
    "- Do not include dosage numbers unless the source text explicitly contains them.",
    "- human_description must be short, plain, and based only on the source text.",
    "- application_rules must be simple admin-review notes, not a replacement for the official label.",
    "- admin_warnings must list low-confidence or risky points that a human must verify.",
    "- missing_fields must list requested passport fields that are not present in the source.",
    "- Never claim the product is best, safest, guaranteed, or more effective than others.",
    "- If a field is not in the source, leave it null/empty and add it to missing_fields instead of guessing.",
    "- Write human_description, application_rules, admin_warnings, missing_fields, and notes in Russian for the UI. Keep trade names and manufacturer names unchanged.",
    "",
    `Input product: ${params.runInput || "-"}`,
    `Optional manufacturer hint: ${params.runManufacturer || "-"}`,
    "",
    sourceBlocks,
  ].join("\n");
}

export async function extractKnowledgeProductMetadataDraft(params: {
  runInput: string;
  runManufacturer: string | null;
  sources: KnowledgeSourceContext[];
}): Promise<KnowledgeExtractionDraft> {
  const apiKey = text(process.env.OPENAI_API_KEY);
  const configuredModel = text(process.env.OPENAI_ASSISTANT_MODEL);
  if (!apiKey || !configuredModel) {
    throw new Error(KNOWLEDGE_OPENAI_MISSING_ENV_ERROR);
  }
  if (!params.sources.length) {
    throw new Error(KNOWLEDGE_EXTRACTION_TEXT_REQUIRED_ERROR);
  }

  const models = uniqueTexts([
    configuredModel,
    process.env.OPENAI_ASSISTANT_FALLBACK_MODEL,
    process.env.OPENAI_ASSISTANT_FAST_MODEL,
    "gpt-4o-mini",
  ]);

  let payload: any = null;
  let lastError = "";
  for (const model of models) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a strict agricultural product label extraction engine. Extract only explicit facts from the provided source text and return valid JSON.",
          },
          {
            role: "user",
            content: buildExtractionPrompt(params),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "travkin_product_metadata_extraction_v0",
            strict: true,
            schema: EXTRACTION_SCHEMA,
          },
        },
        max_completion_tokens: 2600,
      }),
    });

    payload = await response.json().catch(() => ({}));
    if (response.ok) break;

    const message = text(payload?.error?.message) || `OpenAI request failed with status ${response.status}`;
    lastError = message;
    if (!isModelAccessError(message) || model === models[models.length - 1]) {
      throw new Error(message);
    }
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(lastError || "OpenAI extraction returned empty response");
  }

  let parsed: unknown;
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    throw new Error("OpenAI extraction returned invalid JSON");
  }

  return enrichKnowledgeExtractionDraft(sanitizeKnowledgeExtractionDraft(parsed), params.sources);
}

function currentValue(product: Record<string, unknown> | null, field: string): unknown {
  if (!product) return null;
  return product[field] ?? null;
}

function scalarSuggestion(
  draft: KnowledgeExtractionDraft,
  field: keyof Pick<
    KnowledgeExtractionDraft,
    | "trade_name"
    | "manufacturer"
    | "product_type"
    | "subcategory"
    | "physical_state"
    | "stock_unit"
    | "default_rate_type"
    | "default_rate_unit"
  >
): unknown {
  return draft[field] ?? null;
}

export function buildProductMetadataSuggestionRows(params: {
  runId: string;
  productId: string | null;
  sourceId: string | null;
  sourceIds: string[];
  sourceUrl: string | null;
  currentProduct: Record<string, unknown> | null;
  draft: KnowledgeExtractionDraft;
}): ProductMetadataSuggestionRow[] {
  const rows: ProductMetadataSuggestionRow[] = [];
  const scalarFields: Array<keyof Pick<
    KnowledgeExtractionDraft,
    | "trade_name"
    | "manufacturer"
    | "product_type"
    | "subcategory"
    | "physical_state"
    | "stock_unit"
    | "default_rate_type"
    | "default_rate_unit"
  >> = [
    "trade_name",
    "manufacturer",
    "product_type",
    "subcategory",
    "physical_state",
    "stock_unit",
    "default_rate_type",
    "default_rate_unit",
  ];

  for (const field of scalarFields) {
    const value = scalarSuggestion(params.draft, field);
    if (value === null || value === "") continue;
    rows.push({
      run_id: params.runId,
      product_id: params.productId,
      field_name: field,
      current_value: { value: currentValue(params.currentProduct, field) },
      suggested_value: { value },
      confidence: params.draft.confidence,
      action_class: "NEED_REVIEW",
      source_id: params.sourceId,
      reason: "OpenAI extraction draft from saved source. Admin review required; products are unchanged.",
      status: "draft",
    });
  }

  if (params.sourceUrl) {
    rows.push({
      run_id: params.runId,
      product_id: params.productId,
      field_name: "metadata_source_url",
      current_value: { value: currentValue(params.currentProduct, "metadata_source_url") },
      suggested_value: { value: params.sourceUrl },
      confidence: params.draft.confidence,
      action_class: "NEED_REVIEW",
      source_id: params.sourceId,
      reason: "Source URL captured for admin review. Products are unchanged.",
      status: "draft",
    });
  }

  rows.push({
    run_id: params.runId,
    product_id: params.productId,
    field_name: "metadata_confidence",
    current_value: { value: currentValue(params.currentProduct, "metadata_confidence") },
    suggested_value: { value: params.draft.confidence },
    confidence: params.draft.confidence,
    action_class: "NEED_REVIEW",
    source_id: params.sourceId,
    reason: "Extraction confidence from OpenAI draft. Admin review required.",
    status: "draft",
  });

  rows.push({
    run_id: params.runId,
    product_id: params.productId,
    field_name: "metadata_review_required",
    current_value: { value: currentValue(params.currentProduct, "metadata_review_required") },
    suggested_value: { value: true },
    confidence: params.draft.confidence,
    action_class: "NEED_REVIEW",
    source_id: params.sourceId,
    reason: `OpenAI extraction created ${rows.length} field-level draft suggestions from ${params.sourceIds.length} source(s). Admin review required; products are unchanged.`,
    status: "draft",
  });

  return rows;
}
