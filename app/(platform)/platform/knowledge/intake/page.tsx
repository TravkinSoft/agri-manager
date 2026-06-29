"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Link2,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  KNOWLEDGE_RECOMMENDATION_COPY,
  formatKnowledgeConfidence,
  formatKnowledgeConsumptionType,
  formatKnowledgeMatchReason,
  formatKnowledgeMatchType,
  formatKnowledgePhysicalState,
  formatKnowledgeProductType,
  formatKnowledgeRunStatus,
  formatKnowledgeStockUnit,
  formatKnowledgeSubcategory,
} from "@/lib/knowledge/display-labels";
import type { KnowledgeExtractionDraft } from "@/lib/knowledge/extraction";
import type { KnowledgeRecommendation } from "@/lib/knowledge/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CompactStat,
  EmptyState,
  GlassCard,
  GlassPanel,
  GlassToolbar,
  StatusPill,
} from "@/components/ui/glass";

type IntakeInputType = "text" | "url";

type IntakeRun = {
  id: string;
  input_type?: IntakeInputType;
  input_value?: string;
  input_manufacturer?: string | null;
  status?: string;
  created_at?: string;
};

type IntakeMatch = {
  id?: string;
  product_id: string;
  display_name: string;
  trade_name: string;
  manufacturer: string | null;
  product_type: string | null;
  subcategory: string | null;
  stock_unit: string | null;
  default_rate_type: string | null;
  default_rate_unit: string | null;
  metadata_review_required: boolean;
  match_type: string;
  confidence: number;
  reason: string;
};

type SourceType =
  | "manufacturer_page"
  | "manufacturer_pdf"
  | "registration_database"
  | "distributor_page"
  | "manual";

type IntakeSource = {
  id: string;
  run_id: string;
  source_type: SourceType | string;
  source_url: string | null;
  source_title: string | null;
  source_confidence: "low" | "medium" | "high" | string;
  extracted_text_summary: string | null;
  created_at: string;
};

type MetadataSuggestion = {
  id: string;
  run_id: string;
  product_id: string | null;
  field_name: string;
  current_value: unknown;
  suggested_value: unknown;
  confidence: "low" | "medium" | "high" | string;
  action_class: string;
  source_id: string | null;
  reason: string | null;
  status: string;
  created_at: string;
};

type IntakeResult = {
  run: IntakeRun;
  matches: IntakeMatch[];
  sources?: IntakeSource[];
  suggestions?: MetadataSuggestion[];
  extraction?: KnowledgeExtractionDraft | null;
  recommendation: KnowledgeRecommendation;
};

const SOURCE_TYPE_OPTIONS: Array<{ value: SourceType; label: string; requiresUrl: boolean }> = [
  { value: "manufacturer_page", label: "Страница производителя", requiresUrl: true },
  { value: "manufacturer_pdf", label: "PDF производителя", requiresUrl: true },
  { value: "distributor_page", label: "Страница дистрибьютора", requiresUrl: true },
  { value: "registration_database", label: "Регистрационная база", requiresUrl: true },
  { value: "manual", label: "Ручной текст", requiresUrl: false },
];

const SOURCE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  SOURCE_TYPE_OPTIONS.map((option) => [option.value, option.label])
);

const SOURCE_CONFIDENCE_LABELS: Record<string, string> = {
  low: "Низкая",
  medium: "Средняя",
  high: "Высокая",
};

function safeText(value: unknown, fallback = "—") {
  const next = String(value ?? "").trim();
  return next || fallback;
}

function formatConfidence(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${Math.round(number * 100)}%`;
}

function getRecommendationTone(recommendation: KnowledgeRecommendation | null) {
  if (!recommendation) return "neutral" as const;
  return KNOWLEDGE_RECOMMENDATION_COPY[recommendation]?.tone || "neutral";
}

function normalizeMatches(matches: unknown): IntakeMatch[] {
  return Array.isArray(matches) ? (matches as IntakeMatch[]) : [];
}

function normalizeSources(sources: unknown): IntakeSource[] {
  return Array.isArray(sources) ? (sources as IntakeSource[]) : [];
}

function normalizeSuggestions(suggestions: unknown): MetadataSuggestion[] {
  return Array.isArray(suggestions) ? (suggestions as MetadataSuggestion[]) : [];
}

function isUrlSource(source: IntakeSource) {
  return Boolean(source.source_url) && source.source_type !== "manual";
}

function hasExtractedSourceText(source: IntakeSource) {
  return String(source.extracted_text_summary || "").trim().length > 0;
}

function sourceTextPreview(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > 900 ? `${text.slice(0, 900).trim()}...` : text;
}

function countSignals(value: string, signals: string[]) {
  return signals.reduce((count, signal) => (value.includes(signal) ? count + 1 : count), 0);
}

function detectSourceKindFromText(value: string | null | undefined) {
  const normalized = String(value || "").toLocaleLowerCase("ru-RU");
  if (!normalized) return "unknown";

  const productSignals = [
    "действующее вещество",
    "норма расхода",
    "регламент применения",
    "препаративная форма",
    "класс опасности",
    "срок ожидания",
    "л/га",
    "г/л",
    "фунгицид",
    "гербицид",
    "инсектицид",
  ];
  const programSignals = [
    "программа защиты",
    "комплексная программа",
    "схема защиты",
    "система защиты",
    "защита зерновых",
    "зерновых культур",
    "вредные объекты",
    "до посева",
    "начало вегетации",
    "середина вегетации",
    "конец вегетации",
    "bbch",
    "фаза развития",
  ];

  const productScore = countSignals(normalized, productSignals);
  const programScore = countSignals(normalized, programSignals);

  if (programScore >= 3 && programScore >= productScore) return "crop_care_program";
  if (productScore >= 2) return "product_leaflet";
  if (programScore >= 2) return "crop_care_program";
  return "unknown";
}

function isPdfSource(source: IntakeSource) {
  return source.source_type === "manufacturer_pdf";
}

function sourceFetchButtonLabel(source: IntakeSource) {
  if (isPdfSource(source)) return hasExtractedSourceText(source) ? "Обновить текст PDF" : "Извлечь текст PDF";
  return hasExtractedSourceText(source) ? "Обновить текст" : "Извлечь текст источника";
}

function valueRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function suggestionValue(suggestion: MetadataSuggestion): unknown {
  const record = valueRecord(suggestion.suggested_value);
  return Object.prototype.hasOwnProperty.call(record, "value") ? record.value : suggestion.suggested_value;
}

function buildExtractionDraftFromSuggestions(suggestions: MetadataSuggestion[]): KnowledgeExtractionDraft | null {
  const draftRecord = suggestions
    .filter((suggestion) => suggestion.status === "draft")
    .map((suggestion) => valueRecord(suggestion.suggested_value))
    .find((record) => record.extraction_draft && typeof record.extraction_draft === "object");

  if (draftRecord?.extraction_draft && typeof draftRecord.extraction_draft === "object") {
    return draftRecord.extraction_draft as KnowledgeExtractionDraft;
  }

  if (!suggestions.length) return null;

  const draft: KnowledgeExtractionDraft = {
    trade_name: null,
    manufacturer: null,
    product_type: null,
    subcategory: null,
    physical_state: null,
    stock_unit: null,
    default_rate_type: null,
    default_rate_unit: null,
    active_ingredients: [],
    crops: [],
    targets: [],
    restrictions: [],
    human_description: null,
    application_rules: [],
    admin_warnings: [],
    missing_fields: [],
    editable_card_title: null,
    confidence: "low",
    notes: [],
  };

  for (const suggestion of suggestions) {
    const value = suggestionValue(suggestion);
    if (suggestion.field_name === "trade_name") draft.trade_name = String(value || "").trim() || null;
    if (suggestion.field_name === "manufacturer") draft.manufacturer = String(value || "").trim() || null;
    if (suggestion.field_name === "product_type") draft.product_type = (String(value || "").trim() || null) as KnowledgeExtractionDraft["product_type"];
    if (suggestion.field_name === "subcategory") draft.subcategory = String(value || "").trim() || null;
    if (suggestion.field_name === "physical_state") draft.physical_state = (String(value || "").trim() || null) as KnowledgeExtractionDraft["physical_state"];
    if (suggestion.field_name === "stock_unit") draft.stock_unit = (String(value || "").trim() || null) as KnowledgeExtractionDraft["stock_unit"];
    if (suggestion.field_name === "default_rate_type") draft.default_rate_type = (String(value || "").trim() || null) as KnowledgeExtractionDraft["default_rate_type"];
    if (suggestion.field_name === "default_rate_unit") draft.default_rate_unit = String(value || "").trim() || null;
    if (suggestion.field_name === "metadata_confidence") {
      draft.confidence = (String(value || "").trim() || "low") as KnowledgeExtractionDraft["confidence"];
    }
  }

  return draft;
}

function formatSourceType(value: unknown) {
  const key = String(value || "").trim();
  return SOURCE_TYPE_LABELS[key] || key || "—";
}

function formatSourceConfidence(value: unknown) {
  const key = String(value || "").trim();
  return SOURCE_CONFIDENCE_LABELS[key] || key || "—";
}

function formatDateTime(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDraftList(values: string[] | null | undefined) {
  return values?.length ? values.join(", ") : "—";
}

function formatActiveIngredients(values: KnowledgeExtractionDraft["active_ingredients"]) {
  if (!values.length) return "—";
  return values.map((item) => (item.concentration ? `${item.name} (${item.concentration})` : item.name)).join(", ");
}

function cloneExtractionDraft(draft: KnowledgeExtractionDraft): KnowledgeExtractionDraft {
  return {
    ...draft,
    active_ingredients: draft.active_ingredients.map((item) => ({ ...item })),
    crops: [...draft.crops],
    targets: [...draft.targets],
    restrictions: [...draft.restrictions],
    application_rules: [...(draft.application_rules || [])],
    admin_warnings: [...(draft.admin_warnings || [])],
    missing_fields: [...(draft.missing_fields || [])],
    notes: [...draft.notes],
  };
}

function listToText(values: string[] | null | undefined) {
  return values?.length ? values.join("\n") : "";
}

function textToList(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function activeIngredientsToText(values: KnowledgeExtractionDraft["active_ingredients"]) {
  return values.map((item) => (item.concentration ? `${item.name} | ${item.concentration}` : item.name)).join("\n");
}

function textToActiveIngredients(value: string): KnowledgeExtractionDraft["active_ingredients"] {
  return value
    .split(/\r?\n/)
    .map((line) => {
      const raw = line.trim();
      if (!raw) return null;
      const [namePart, ...concentrationParts] = raw.split(/\s*\|\s*/);
      const name = String(namePart || "").trim();
      if (!name) return null;
      const concentration = concentrationParts.join(" | ").trim();
      return { name, concentration: concentration || null };
    })
    .filter(Boolean) as KnowledgeExtractionDraft["active_ingredients"];
}

function selectValue(value: unknown) {
  return String(value || "");
}

const PRODUCT_TYPE_OPTIONS = [
  { value: "", label: "Не указано" },
  { value: "pesticide", label: "Пестицид" },
  { value: "fertilizer", label: "Удобрение" },
  { value: "additive", label: "Добавка" },
  { value: "seed", label: "Семена" },
  { value: "unknown", label: "Неизвестно" },
] as const;

const PHYSICAL_STATE_OPTIONS = [
  { value: "", label: "Не указано" },
  { value: "liquid", label: "Жидкость" },
  { value: "solid", label: "Твёрдое" },
  { value: "granule", label: "Гранулы" },
  { value: "powder", label: "Порошок" },
  { value: "tablet", label: "Таблетка" },
  { value: "gel", label: "Гель" },
  { value: "unknown", label: "Неизвестно" },
] as const;

const STOCK_UNIT_OPTIONS = [
  { value: "", label: "Не указано" },
  { value: "l", label: "литр" },
  { value: "ml", label: "миллилитр" },
  { value: "kg", label: "килограмм" },
  { value: "g", label: "грамм" },
  { value: "pcs", label: "штука" },
  { value: "unknown", label: "Неизвестно" },
] as const;

const RATE_TYPE_OPTIONS = [
  { value: "", label: "Не указано" },
  { value: "per_ha", label: "на 1 га" },
  { value: "per_1000_l_solution", label: "на 1000 л рабочего раствора" },
  { value: "per_l_water", label: "на 1 л воды" },
  { value: "per_t_seed", label: "на 1000 кг семян" },
  { value: "per_100kg_seed", label: "на 100 кг семян" },
  { value: "per_1000_seeds", label: "на 1000 семян" },
  { value: "manual", label: "вручную" },
] as const;

const CONFIDENCE_OPTIONS = [
  { value: "low", label: "Низкая" },
  { value: "medium", label: "Средняя" },
  { value: "high", label: "Высокая" },
] as const;

const consoleNotice = {
  error: "rounded-none border border-[#b95b5b] bg-[#fff1f1] px-3 py-2 text-sm font-medium text-[#7f1d1d]",
  success: "rounded-none border border-[#5e8d74] bg-[#edf8f1] px-3 py-2 text-sm font-medium text-[#064e3b]",
  warning: "rounded-none border border-[#9f8f55] bg-[#fff8d8] px-3 py-2 text-xs leading-5 text-[#4f3d00]",
  danger: "rounded-none border border-[#b95b5b] bg-[#fff1f1] px-3 py-3 text-sm font-semibold text-[#7f1d1d]",
  info: "rounded-none border border-[#7d96b3] bg-[#eef5ff] px-3 py-3 text-sm leading-6 text-[#10243d]",
  infoSmall: "mt-3 rounded-none border border-[#9aa8ba] bg-[#f4f7fb] px-3 py-2 text-xs leading-5 text-[#243247]",
  sourceCard: "rounded-none border border-[#c3ccd8] bg-[#f8fafc] px-3 py-3 text-[#111827]",
  sourceSummary: "mt-2 rounded-none border border-[#d1d8e2] bg-[#eef1f5] px-3 py-2 text-xs leading-5 text-[#243247]",
  draftPanel: "mt-4 rounded-none border border-[#9aa8ba] bg-[#f8fafc] p-4 text-[#111827]",
  draftSubCard: "rounded-none border border-[#c3ccd8] bg-white px-3 py-2 text-[#111827]",
  disabledAction: "mt-4 rounded-none border-[#9aa8ba] bg-[#eef1f5] text-[#42566f] opacity-100 disabled:opacity-100",
};

export default function KnowledgeIntakePage() {
  const { profile, loading: authLoading } = useAuth();
  const [inputType, setInputType] = useState<IntakeInputType>("text");
  const [inputValue, setInputValue] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [sourceType, setSourceType] = useState<SourceType>("manufacturer_page");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [manualText, setManualText] = useState("");
  const [sourceSubmitting, setSourceSubmitting] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceSuccess, setSourceSuccess] = useState<string | null>(null);
  const [fetchingSourceId, setFetchingSourceId] = useState<string | null>(null);
  const [sourceFetchError, setSourceFetchError] = useState<string | null>(null);
  const [sourceFetchSuccess, setSourceFetchSuccess] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractSuccess, setExtractSuccess] = useState<string | null>(null);
  const [editableDraft, setEditableDraft] = useState<KnowledgeExtractionDraft | null>(null);

  const recommendation = result?.recommendation || null;
  const recommendationCopy = recommendation ? KNOWLEDGE_RECOMMENDATION_COPY[recommendation] : null;
  const matches = result?.matches || [];
  const sources = result?.sources || [];
  const hasReadySourceText = sources.some(hasExtractedSourceText);
  const suggestions = result?.suggestions || [];
  const extractionDraft = useMemo(
    () => result?.extraction || buildExtractionDraftFromSuggestions(suggestions),
    [result?.extraction, suggestions]
  );
  const isManualSource = sourceType === "manual";

  useEffect(() => {
    setEditableDraft(extractionDraft ? cloneExtractionDraft(extractionDraft) : null);
  }, [extractionDraft]);

  const canSubmit = useMemo(() => inputValue.trim().length > 0 && !submitting, [inputValue, submitting]);
  const canSubmitSource = useMemo(() => {
    if (!result?.run?.id || sourceSubmitting) return false;
    if (isManualSource) return manualText.trim().length > 0;
    return sourceUrl.trim().length > 0;
  }, [isManualSource, manualText, result?.run?.id, sourceSubmitting, sourceUrl]);
  const canExtract = useMemo(
    () => Boolean(result?.run?.id && hasReadySourceText && !extracting),
    [extracting, hasReadySourceText, result?.run?.id]
  );

  const patchEditableDraft = (patch: Partial<KnowledgeExtractionDraft>) => {
    setEditableDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const loadRun = async (runId: string, fallback: IntakeResult): Promise<IntakeResult> => {
    const headers = await buildClientAuthHeaders();
    const response = await fetch(`/api/knowledge/intake-runs/${runId}`, {
      headers,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || "Не удалось загрузить результат проверки.");
    }
    return {
      ...payload,
      matches: normalizeMatches(payload?.matches),
      sources: normalizeSources(payload?.sources),
      suggestions: normalizeSuggestions(payload?.suggestions),
      extraction: fallback.extraction || null,
      recommendation: fallback.recommendation,
    };
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    setResult(null);
    setExtractError(null);
    setExtractSuccess(null);

    try {
      const headers = await buildClientAuthHeaders("json");
      const response = await fetch("/api/knowledge/intake-runs", {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({
          input_type: inputType,
          input_value: inputValue.trim(),
          manufacturer: manufacturer.trim() || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Не удалось выполнить проверку препарата.");
      }

      const initialResult: IntakeResult = {
        run: payload.run,
        matches: normalizeMatches(payload.matches),
        sources: [],
        suggestions: [],
        recommendation: payload.recommendation,
      };

      if (payload?.run?.id) {
        try {
          setResult(await loadRun(String(payload.run.id), initialResult));
        } catch {
          setResult(initialResult);
        }
      } else {
        setResult(initialResult);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Не удалось выполнить проверку препарата.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSourceSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!result?.run?.id || !canSubmitSource) return;

    setSourceSubmitting(true);
    setSourceError(null);
    setSourceSuccess(null);
    setSourceFetchError(null);
    setSourceFetchSuccess(null);
    setExtractError(null);
    setExtractSuccess(null);

    try {
      const headers = await buildClientAuthHeaders("json");
      const response = await fetch(`/api/knowledge/intake-runs/${result.run.id}/sources`, {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({
          source_type: sourceType,
          source_url: isManualSource ? undefined : sourceUrl.trim(),
          source_title: sourceTitle.trim() || undefined,
          manual_text: isManualSource ? manualText.trim() : undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Не удалось сохранить источник.");
      }

      setResult(await loadRun(result.run.id, result));
      setSourceSuccess("Источник сохранён. Изменений в каталоге не сделано.");
      setSourceUrl("");
      setSourceTitle("");
      setManualText("");
    } catch (submitError) {
      setSourceError(submitError instanceof Error ? submitError.message : "Не удалось сохранить источник.");
    } finally {
      setSourceSubmitting(false);
    }
  };

  const handleFetchSourceText = async (source: IntakeSource) => {
    if (!result?.run?.id || !source?.id || fetchingSourceId) return;

    setFetchingSourceId(source.id);
    setSourceFetchError(null);
    setSourceFetchSuccess(null);
    setExtractError(null);
    setExtractSuccess(null);

    try {
      const headers = await buildClientAuthHeaders("json");
      const response = await fetch(`/api/knowledge/intake-runs/${result.run.id}/sources/${source.id}/fetch-text`, {
        method: "POST",
        headers,
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Не удалось извлечь текст источника.");
      }

      setResult(await loadRun(result.run.id, result));
      const sourceKindNotice =
        payload?.source_kind === "crop_care_program"
          ? " Источник похож на программу защиты; создание схемы будет отдельным этапом."
          : "";
      setSourceFetchSuccess(`Текст источника извлечён: ${Number(payload?.extracted_text_length || 0)} символов.${sourceKindNotice}`);
    } catch (fetchError) {
      setSourceFetchError(fetchError instanceof Error ? fetchError.message : "Не удалось извлечь текст источника.");
    } finally {
      setFetchingSourceId(null);
    }
  };

  const handleExtractSubmit = async () => {
    if (!result?.run?.id || !canExtract) return;

    setExtracting(true);
    setExtractError(null);
    setExtractSuccess(null);

    try {
      const headers = await buildClientAuthHeaders("json");
      const response = await fetch(`/api/knowledge/intake-runs/${result.run.id}/extract`, {
        method: "POST",
        headers,
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Не удалось извлечь данные из источников.");
      }

      const fallback: IntakeResult = {
        ...result,
        run: payload?.run || result.run,
        suggestions: normalizeSuggestions(payload?.suggestions),
        extraction: (payload?.extraction || null) as KnowledgeExtractionDraft | null,
      };
      setResult(await loadRun(result.run.id, fallback));
      setExtractSuccess("Черновик паспорта создан. Препарат в каталоге не изменён.");
    } catch (submitError) {
      setExtractError(submitError instanceof Error ? submitError.message : "Не удалось извлечь данные из источников.");
    } finally {
      setExtracting(false);
    }
  };

  if (authLoading) {
    return (
      <GlassPanel className="flex min-h-[420px] items-center justify-center bg-[#0F172A] text-slate-200">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#E0B100]" />
        Загрузка доступа...
      </GlassPanel>
    );
  }

  if (profile?.role !== "global_admin") {
    return (
      <GlassPanel className="bg-[#0F172A] p-6 text-slate-100">
        <StatusPill tone="danger">Доступ закрыт</StatusPill>
        <h1 className="mt-4 text-2xl font-semibold">Проверка препарата</h1>
        <p className="mt-2 text-sm text-slate-300">Раздел доступен только global admin.</p>
      </GlassPanel>
    );
  }

  return (
    <div className="space-y-3 text-[#111827] [&_.text-slate-100]:!text-[#111827] [&_.text-slate-200]:!text-[#1f2937] [&_.text-slate-300]:!text-[#374151] [&_.text-slate-400]:!text-[#536276] [&_.text-slate-500]:!text-[#69788d] [&_input]:!rounded-none [&_input]:!border-[#9aa8ba] [&_input]:!bg-white [&_input]:!text-[#111827] [&_select]:!rounded-none [&_select]:!border-[#9aa8ba] [&_select]:!bg-white [&_select]:!text-[#111827] [&_textarea]:!rounded-none [&_textarea]:!border-[#9aa8ba] [&_textarea]:!bg-white [&_textarea]:!text-[#111827]">
      <GlassToolbar className="rounded-none border-[#6e7f95] bg-[#0f2946] px-4 py-3 shadow-[1px_1px_0_rgba(255,255,255,0.12)_inset]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-semibold uppercase tracking-[0.12em]">Knowledge Intake Console</h1>
              <StatusPill tone="accent" className="rounded-none">V0 — без записи в каталог</StatusPill>
            </div>
            <p className="max-w-3xl text-[12px] leading-5 text-slate-300">
              Введите название препарата, ссылку или будущий источник. Сейчас V0 проверяет только название и ищет
              совпадения в глобальном каталоге.
            </p>
          </div>
          <StatusPill tone="success" className="w-fit gap-2 rounded-none">
            <ShieldCheck className="h-3.5 w-3.5" />
            Только проверка
          </StatusPill>
        </div>
      </GlassToolbar>

      <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.4fr)]">
        <GlassPanel className="rounded-none border-[#9aa8ba] bg-white p-3 text-[#111827] shadow-[1px_1px_0_rgba(255,255,255,0.9)_inset]">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="intake-input-type" className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#42566f]">
                Тип входа
              </Label>
              <select
                id="intake-input-type"
                value={inputType}
                onChange={(event) => setInputType(event.target.value as IntakeInputType)}
                className="h-10 w-full rounded-lg border border-white/10 bg-[#020617] px-3 text-sm text-slate-100 outline-none transition focus:border-[#E0B100]"
              >
                <option value="text">Название</option>
                <option value="url">Ссылка</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="knowledge-intake-input" className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#42566f]">
                Название или источник
              </Label>
              <Input
                id="knowledge-intake-input"
                data-testid="knowledge-intake-input"
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                placeholder="Например: Селест Топ, Phomazin, Curamin Foliar, TechnoFit pH"
                className="border-white/10 bg-[#020617] text-slate-100 placeholder:text-slate-500 focus-visible:ring-[#E0B100]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="knowledge-intake-manufacturer" className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#42566f]">
                Производитель, если известен
              </Label>
              <Input
                id="knowledge-intake-manufacturer"
                value={manufacturer}
                onChange={(event) => setManufacturer(event.target.value)}
                placeholder="Например: Syngenta, SG, SwissGrow"
                className="border-white/10 bg-[#020617] text-slate-100 placeholder:text-slate-500 focus-visible:ring-[#E0B100]"
              />
            </div>

            {error ? (
              <div className={consoleNotice.error}>
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              data-testid="knowledge-intake-submit"
              disabled={!canSubmit}
              className="h-8 w-full gap-2 rounded-none bg-[#15395f] text-[12px] text-white hover:bg-[#0f2946]"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Проверить препарат
            </Button>
          </form>

          <div className="mt-4 border border-[#9f8f55] bg-[#fff8d8] p-3 text-[12px] text-[#4f3d00]">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              Safety Notice
            </div>
            <p className="mt-2 leading-6">
              Travkin Knowledge Engine не записывает изменения в каталог автоматически. Любое создание или обновление
              препарата будет проходить через подтверждение Global Admin.
            </p>
          </div>
        </GlassPanel>

        <GlassPanel className="rounded-none border-[#9aa8ba] bg-white p-3 text-[#111827] shadow-[1px_1px_0_rgba(255,255,255,0.9)_inset]">
          {!result ? (
            <EmptyState className="flex min-h-[360px] flex-col items-center justify-center text-center">
              <Sparkles className="mb-3 h-8 w-8 text-[#E0B100]" />
              <div className="text-base font-semibold text-slate-100">Готов к проверке</div>
              <p className="mt-2 max-w-lg text-sm leading-6 text-slate-400">
                Введите препарат слева. V0 сверит название с глобальным каталогом и покажет безопасную рекомендацию.
              </p>
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Карточка проверки</div>
                  <h2 className="mt-1 text-xl font-semibold">Проверка препарата</h2>
                </div>
                <StatusPill tone={getRecommendationTone(recommendation)} data-testid="knowledge-intake-recommendation">
                  {recommendationCopy?.label || recommendation || "—"}
                </StatusPill>
              </div>

              <div>
                <div className="text-sm font-semibold text-slate-100">Результат проверки</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Краткий итог intake run: статус, совпадения, источники и рекомендация.
                </p>
              </div>

              <div className="grid gap-2 md:grid-cols-4">
                <CompactStat
                  label="Run ID"
                  value={
                    <span className="block max-w-[180px] truncate" data-testid="knowledge-intake-run-id">
                      {safeText(result.run?.id)}
                    </span>
                  }
                />
                <CompactStat label="Status" value={formatKnowledgeRunStatus(result.run?.status)} />
                <CompactStat
                  label="Matches"
                  value={<span data-testid="knowledge-intake-match-count">{matches.length}</span>}
                />
                <CompactStat label="Sources" value={Array.isArray(result.sources) ? result.sources.length : 0} />
              </div>

              {recommendationCopy ? (
                <GlassCard className="rounded-none border-[#9f8f55] bg-[#fff8d8] p-4 text-[#4f3d00]">
                  <div className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-[#7a5c00]" />
                    <div>
                      <div className="font-semibold text-[#4f3d00]">{recommendationCopy.label}</div>
                      <p className="mt-1 text-sm leading-6 text-[#5c4a16]">{recommendationCopy.message}</p>
                    </div>
                  </div>
                </GlassCard>
              ) : null}

              <GlassCard className="order-4 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-lg font-semibold">
                      <FileText className="h-5 w-5 text-[#E0B100]" />
                      Источники для анализа
                    </div>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                      После проверки совпадений добавьте ссылку на препарат, PDF или ручной текст с этикетки. Сейчас источник только сохраняется
                      в Knowledge Engine и не меняет каталог.
                    </p>
                  </div>
                  <StatusPill tone="accent">Следующий шаг</StatusPill>
                </div>

                <form className="mt-4 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]" onSubmit={handleSourceSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="knowledge-source-type" className="text-slate-200">
                      Тип источника
                    </Label>
                    <select
                      id="knowledge-source-type"
                      data-testid="knowledge-source-type"
                      value={sourceType}
                      onChange={(event) => {
                        setSourceType(event.target.value as SourceType);
                        setSourceError(null);
                        setSourceSuccess(null);
                      }}
                      className="h-10 w-full rounded-lg border border-white/10 bg-[#020617] px-3 text-sm text-slate-100 outline-none transition focus:border-[#E0B100]"
                    >
                      {SOURCE_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-3">
                    {!isManualSource ? (
                      <div className="space-y-2">
                        <Label htmlFor="knowledge-source-url" className="text-slate-200">
                          URL источника
                        </Label>
                        <Input
                          id="knowledge-source-url"
                          data-testid="knowledge-source-url"
                          value={sourceUrl}
                          onChange={(event) => setSourceUrl(event.target.value)}
                          placeholder="https://..."
                          className="border-white/10 bg-[#020617] text-slate-100 placeholder:text-slate-500 focus-visible:ring-[#E0B100]"
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="knowledge-source-manual-text" className="text-slate-200">
                          Ручной текст
                        </Label>
                        <Textarea
                          id="knowledge-source-manual-text"
                          data-testid="knowledge-source-manual-text"
                          value={manualText}
                          onChange={(event) => setManualText(event.target.value)}
                          placeholder="Текст с этикетки или инструкции..."
                          className="min-h-[120px] border-white/10 bg-[#020617] text-slate-100 placeholder:text-slate-500 focus-visible:ring-[#E0B100]"
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="knowledge-source-title" className="text-slate-200">
                        Заголовок / название источника
                      </Label>
                      <Input
                        id="knowledge-source-title"
                        data-testid="knowledge-source-title"
                        value={sourceTitle}
                        onChange={(event) => setSourceTitle(event.target.value)}
                        placeholder="Например: TechnoFit pH source"
                        className="border-white/10 bg-[#020617] text-slate-100 placeholder:text-slate-500 focus-visible:ring-[#E0B100]"
                      />
                    </div>

                    {sourceError ? (
                      <div className={consoleNotice.error}>
                        {sourceError}
                      </div>
                    ) : null}
                    {sourceSuccess ? (
                      <div className={consoleNotice.success}>
                        {sourceSuccess}
                      </div>
                    ) : null}
                    {sourceFetchError ? (
                      <div className={consoleNotice.error}>
                        {sourceFetchError}
                      </div>
                    ) : null}
                    {sourceFetchSuccess ? (
                      <div className={consoleNotice.success}>
                        {sourceFetchSuccess}
                      </div>
                    ) : null}

                    <Button
                      type="submit"
                      data-testid="knowledge-source-submit"
                      disabled={!canSubmitSource}
                      className="gap-2 bg-[#E0B100] text-slate-950 hover:bg-[#F2C300]"
                    >
                      {sourceSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Добавить источник
                    </Button>
                  </div>
                </form>

                <div className="mt-4 space-y-2" data-testid="knowledge-intake-sources">
                  {sources.length ? (
                    sources.map((source) => {
                      const detectedSourceKind = isPdfSource(source)
                        ? detectSourceKindFromText(source.extracted_text_summary)
                        : "unknown";

                      return (
                      <div
                        key={source.id}
                        className={consoleNotice.sourceCard}
                      >
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusPill tone="accent">{formatSourceType(source.source_type)}</StatusPill>
                              <StatusPill tone={source.source_confidence === "high" ? "success" : source.source_confidence === "low" ? "warning" : "neutral"}>
                                {formatSourceConfidence(source.source_confidence)}
                              </StatusPill>
                            </div>
                            <div className="mt-2 truncate text-sm font-semibold text-slate-100">
                              {source.source_title || source.source_url || "Ручной источник"}
                            </div>
                            {source.source_url ? (
                              <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-slate-400">
                                <Link2 className="h-3.5 w-3.5 flex-none" />
                                <span className="truncate">{source.source_url}</span>
                              </div>
                            ) : null}
                            {source.extracted_text_summary ? (
                              <div className={consoleNotice.sourceSummary}>
                                {sourceTextPreview(source.extracted_text_summary)}
                              </div>
                            ) : null}
                            {detectedSourceKind === "crop_care_program" ? (
                              <div className={consoleNotice.warning}>
                                Источник похож на программу защиты, а не на карточку одного препарата. Создание схемы будет отдельным этапом.
                              </div>
                            ) : null}
                            {isUrlSource(source) && !hasExtractedSourceText(source) ? (
                              <div className={consoleNotice.infoSmall}>
                                {isPdfSource(source)
                                  ? "Текст PDF ещё не извлечён. Нажмите кнопку справа, чтобы подготовить источник для OpenAI."
                                  : "Текст страницы ещё не извлечён. Нажмите кнопку справа, чтобы подготовить источник для OpenAI."}
                              </div>
                            ) : null}
                          </div>
                          <div className="flex flex-col items-start gap-2 lg:items-end">
                            <div className="text-xs text-slate-500">{formatDateTime(source.created_at)}</div>
                            {isUrlSource(source) ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={fetchingSourceId !== null}
                                onClick={() => handleFetchSourceText(source)}
                                className="gap-2 rounded-none border-[#9aa8ba] bg-[#eef1f5] text-[#10243d] hover:bg-white disabled:opacity-70"
                              >
                                {fetchingSourceId === source.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <FileText className="h-4 w-4" />
                                )}
                                {sourceFetchButtonLabel(source)}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      );
                    })
                  ) : (
                    <EmptyState className="py-4">
                      Источники ещё не добавлены. Добавьте ссылку или ручной текст, чтобы подготовить будущую extraction.
                    </EmptyState>
                  )}
                </div>

                <div className={consoleNotice.info}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="font-semibold">Извлечение данных</div>
                      <p className="mt-1">
                        OpenAI извлекает только черновик паспорта из сохранённых источников. Препарат в каталоге не меняется.
                      </p>
                    </div>
                    <Button
                      type="button"
                      data-testid="knowledge-extract-submit"
                      disabled={!canExtract}
                      onClick={handleExtractSubmit}
                      className="w-fit gap-2 rounded-none bg-[#15395f] text-white hover:bg-[#0f2946] disabled:bg-[#d7dde6] disabled:text-[#42566f] disabled:opacity-100"
                    >
                      {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      Извлечь данные
                    </Button>
                  </div>

                  {!sources.length ? (
                    <div className={consoleNotice.infoSmall}>
                      Сначала добавьте источник: ручной текст, ссылку на страницу или PDF.
                    </div>
                  ) : null}
                  {sources.length && !hasReadySourceText ? (
                    <div className={consoleNotice.infoSmall}>
                      Для URL-источника сначала извлеките текст страницы или PDF. Если PDF состоит из изображений, добавьте ручной текст; OCR будет позже.
                    </div>
                  ) : null}
                  {extractError ? (
                    <div className={consoleNotice.error}>
                      {extractError}
                    </div>
                  ) : null}
                  {extractSuccess ? (
                    <div className={consoleNotice.success}>
                      {extractSuccess}
                    </div>
                  ) : null}

                  <div className={consoleNotice.warning}>
                    Это черновик. Данные не записаны в препарат до подтверждения администратором.
                  </div>

                  {editableDraft ? (
                    <div className={consoleNotice.draftPanel} data-testid="knowledge-extraction-draft">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="text-base font-semibold text-slate-50">
                            {editableDraft.editable_card_title || "Черновик карточки препарата"}
                          </div>
                          <p className="mt-1 text-xs text-slate-400">
                            Паспортные поля сохранены как draft suggestions. Описание и правила сейчас редактируются только в этой карточке.
                          </p>
                        </div>
                        <StatusPill tone="warning">Требует проверки</StatusPill>
                      </div>

                      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        <CompactStat label="Единица измерения" value={formatKnowledgeStockUnit(editableDraft.stock_unit)} />
                        <CompactStat
                          label="Тип расхода"
                          value={formatKnowledgeConsumptionType(
                            editableDraft.default_rate_unit,
                            editableDraft.default_rate_type,
                            editableDraft.stock_unit,
                            `${editableDraft.trade_name || ""} ${editableDraft.manufacturer || ""}`
                          )}
                        />
                        <CompactStat label="Уверенность" value={formatKnowledgeConfidence(editableDraft.confidence)} />
                      </div>

                      <div className="mt-4 space-y-4">
                        <div className={consoleNotice.draftSubCard}>
                          <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Паспортные поля</div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label htmlFor="draft-trade-name">Название</Label>
                              <Input
                                id="draft-trade-name"
                                value={editableDraft.trade_name || ""}
                                onChange={(event) => patchEditableDraft({ trade_name: event.target.value || null })}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="draft-manufacturer">Производитель</Label>
                              <Input
                                id="draft-manufacturer"
                                value={editableDraft.manufacturer || ""}
                                onChange={(event) => patchEditableDraft({ manufacturer: event.target.value || null })}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="draft-product-type">Тип</Label>
                              <select
                                id="draft-product-type"
                                value={selectValue(editableDraft.product_type)}
                                onChange={(event) =>
                                  patchEditableDraft({
                                    product_type: (event.target.value || null) as KnowledgeExtractionDraft["product_type"],
                                  })
                                }
                                className="h-10 w-full border px-3 text-sm"
                              >
                                {PRODUCT_TYPE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="draft-subcategory">Подтип</Label>
                              <Input
                                id="draft-subcategory"
                                value={editableDraft.subcategory || ""}
                                onChange={(event) => patchEditableDraft({ subcategory: event.target.value || null })}
                                placeholder="Например: seed_treatment"
                              />
                              <div className="text-xs text-slate-500">{formatKnowledgeSubcategory(editableDraft.subcategory)}</div>
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="draft-physical-state">Физическое состояние</Label>
                              <select
                                id="draft-physical-state"
                                value={selectValue(editableDraft.physical_state)}
                                onChange={(event) =>
                                  patchEditableDraft({
                                    physical_state: (event.target.value || null) as KnowledgeExtractionDraft["physical_state"],
                                  })
                                }
                                className="h-10 w-full border px-3 text-sm"
                              >
                                {PHYSICAL_STATE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="draft-stock-unit">Единица измерения</Label>
                              <select
                                id="draft-stock-unit"
                                value={selectValue(editableDraft.stock_unit)}
                                onChange={(event) =>
                                  patchEditableDraft({
                                    stock_unit: (event.target.value || null) as KnowledgeExtractionDraft["stock_unit"],
                                  })
                                }
                                className="h-10 w-full border px-3 text-sm"
                              >
                                {STOCK_UNIT_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="draft-rate-type">Тип расхода</Label>
                              <select
                                id="draft-rate-type"
                                value={selectValue(editableDraft.default_rate_type)}
                                onChange={(event) =>
                                  patchEditableDraft({
                                    default_rate_type: (event.target.value || null) as KnowledgeExtractionDraft["default_rate_type"],
                                  })
                                }
                                className="h-10 w-full border px-3 text-sm"
                              >
                                {RATE_TYPE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="draft-confidence">Уверенность</Label>
                              <select
                                id="draft-confidence"
                                value={editableDraft.confidence}
                                onChange={(event) =>
                                  patchEditableDraft({
                                    confidence: event.target.value as KnowledgeExtractionDraft["confidence"],
                                  })
                                }
                                className="h-10 w-full border px-3 text-sm"
                              >
                                {CONFIDENCE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label htmlFor="draft-active-ingredients">Действующие вещества</Label>
                              <Textarea
                                id="draft-active-ingredients"
                                value={activeIngredientsToText(editableDraft.active_ingredients)}
                                onChange={(event) =>
                                  patchEditableDraft({ active_ingredients: textToActiveIngredients(event.target.value) })
                                }
                                placeholder="ДВ | концентрация"
                                className="min-h-[110px]"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="draft-crops">Культуры</Label>
                              <Textarea
                                id="draft-crops"
                                value={listToText(editableDraft.crops)}
                                onChange={(event) => patchEditableDraft({ crops: textToList(event.target.value) })}
                                placeholder="Одна культура на строку"
                                className="min-h-[110px]"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="draft-targets">Объекты применения</Label>
                              <Textarea
                                id="draft-targets"
                                value={listToText(editableDraft.targets)}
                                onChange={(event) => patchEditableDraft({ targets: textToList(event.target.value) })}
                                placeholder="Один объект на строку"
                                className="min-h-[110px]"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="draft-restrictions">Ограничения</Label>
                              <Textarea
                                id="draft-restrictions"
                                value={listToText(editableDraft.restrictions)}
                                onChange={(event) => patchEditableDraft({ restrictions: textToList(event.target.value) })}
                                placeholder="Одно ограничение на строку"
                                className="min-h-[110px]"
                              />
                            </div>
                          </div>
                        </div>

                        <div className={consoleNotice.draftSubCard}>
                          <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Описание препарата</div>
                          <Textarea
                            value={editableDraft.human_description || ""}
                            onChange={(event) => patchEditableDraft({ human_description: event.target.value || null })}
                            placeholder="Короткое описание только на основе источника"
                            className="mt-3 min-h-[96px]"
                          />
                        </div>

                        <div className={consoleNotice.draftSubCard}>
                          <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Основные правила применения</div>
                          <Textarea
                            value={listToText(editableDraft.application_rules)}
                            onChange={(event) => patchEditableDraft({ application_rules: textToList(event.target.value) })}
                            placeholder="Одно правило на строку"
                            className="mt-3 min-h-[120px]"
                          />
                          <div className="mt-2 text-xs leading-5 text-slate-500">
                            Это не официальная инструкция и не рекомендация TravkinFlow. Проверяйте по подтверждённому источнику.
                          </div>
                        </div>

                        <div className={consoleNotice.draftSubCard}>
                          <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Что нужно проверить</div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label htmlFor="draft-admin-warnings">Предупреждения</Label>
                              <Textarea
                                id="draft-admin-warnings"
                                value={listToText(editableDraft.admin_warnings)}
                                onChange={(event) => patchEditableDraft({ admin_warnings: textToList(event.target.value) })}
                                placeholder="Один пункт на строку"
                                className="min-h-[110px]"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="draft-missing-fields">Не найдено в источнике</Label>
                              <Textarea
                                id="draft-missing-fields"
                                value={listToText(editableDraft.missing_fields)}
                                onChange={(event) => patchEditableDraft({ missing_fields: textToList(event.target.value) })}
                                placeholder="Одно поле на строку"
                                className="min-h-[110px]"
                              />
                            </div>
                          </div>
                          {editableDraft.notes.length ? (
                            <div className="mt-3 text-sm leading-6 text-slate-100">
                              <span className="font-semibold">Заметки extraction:</span> {formatDraftList(editableDraft.notes)}
                            </div>
                          ) : null}
                        </div>

                        <div className={consoleNotice.draftSubCard}>
                          <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Источники</div>
                          <div className="mt-3 space-y-2">
                            {sources.length ? (
                              sources.map((source) => (
                                <div key={`draft-source-${source.id}`} className="border border-[#d1d8e2] bg-[#f4f7fb] px-3 py-2 text-sm">
                                  <div className="font-semibold">{source.source_title || source.source_url || "Ручной источник"}</div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    {formatSourceType(source.source_type)} · {formatSourceConfidence(source.source_confidence)}
                                  </div>
                                  {source.source_url ? <div className="mt-1 truncate text-xs text-slate-500">{source.source_url}</div> : null}
                                </div>
                              ))
                            ) : (
                              <div className="text-sm text-slate-500">Источники не добавлены.</div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className={consoleNotice.warning}>
                        Это черновик. Данные не записаны в препарат до подтверждения администратором.
                      </div>

                      <Button disabled variant="outline" className={consoleNotice.disabledAction}>
                        Применить в паспорт — следующий этап
                      </Button>
                    </div>
                  ) : null}
                </div>
              </GlassCard>

              <div className="order-2">
                <div className="text-sm font-semibold text-slate-100">Совпадения в базе</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Сначала проверьте, есть ли препарат или алиас в глобальном каталоге. После этого добавляйте источники для анализа.
                </p>
              </div>

              {matches.length ? (
                <div className={`order-2 ${consoleNotice.danger}`}>
                  Не создавать новый препарат без проверки.
                </div>
              ) : null}

              <div className="order-3 space-y-3" data-testid="knowledge-intake-matches">
                {matches.length ? (
                  matches.map((match) => (
                    <GlassCard key={`${match.product_id}-${match.match_type}`} className="p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="truncate text-base font-semibold text-slate-50">{match.display_name}</div>
                          <div className="mt-1 text-xs text-slate-400">
                            {match.trade_name || "—"} · {match.manufacturer || "производитель не указан"}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <StatusPill tone="accent">{formatConfidence(match.confidence)}</StatusPill>
                          <StatusPill tone={match.metadata_review_required ? "warning" : "success"}>
                            {match.metadata_review_required ? "Нужна проверка метаданных" : "Метаданные OK"}
                          </StatusPill>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-4">
                        <CompactStat
                          label="Тип"
                          value={formatKnowledgeProductType(match.product_type)}
                        />
                        <CompactStat label="Подтип" value={formatKnowledgeSubcategory(match.subcategory)} />
                        <CompactStat label="Единица измерения" value={formatKnowledgeStockUnit(match.stock_unit)} />
                        <CompactStat
                          label="Тип расхода"
                          value={formatKnowledgeConsumptionType(
                            match.default_rate_unit,
                            match.default_rate_type,
                            match.stock_unit,
                            `${match.display_name} ${match.trade_name}`
                          )}
                        />
                        <CompactStat
                          label="Match"
                          value={formatKnowledgeMatchType(match.match_type)}
                        />
                      </div>

                      <div className={consoleNotice.sourceSummary}>
                        {formatKnowledgeMatchReason(match.reason)}
                      </div>
                    </GlassCard>
                  ))
                ) : (
                  <EmptyState>
                    <div className="font-semibold text-slate-100">Совпадений не найдено.</div>
                    <p className="mt-2 leading-6">
                      Это ещё не значит, что препарата нет. Следующий шаг — поиск источников и ручная проверка.
                    </p>
                    <Button disabled variant="outline" className={consoleNotice.disabledAction}>
                      Создать черновик паспорта — скоро
                    </Button>
                  </EmptyState>
                )}
              </div>
            </div>
          )}
        </GlassPanel>
      </div>
    </div>
  );
}
