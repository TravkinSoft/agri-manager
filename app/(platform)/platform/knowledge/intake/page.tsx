"use client";

import { FormEvent, useMemo, useState } from "react";
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
  { value: "manufacturer_pdf", label: "PDF / инструкция производителя", requiresUrl: true },
  { value: "registration_database", label: "Регистрационная база", requiresUrl: true },
  { value: "distributor_page", label: "Страница дистрибьютора", requiresUrl: true },
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
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractSuccess, setExtractSuccess] = useState<string | null>(null);

  const recommendation = result?.recommendation || null;
  const recommendationCopy = recommendation ? KNOWLEDGE_RECOMMENDATION_COPY[recommendation] : null;
  const matches = result?.matches || [];
  const sources = result?.sources || [];
  const suggestions = result?.suggestions || [];
  const extractionDraft = useMemo(
    () => result?.extraction || buildExtractionDraftFromSuggestions(suggestions),
    [result?.extraction, suggestions]
  );
  const isManualSource = sourceType === "manual";

  const canSubmit = useMemo(() => inputValue.trim().length > 0 && !submitting, [inputValue, submitting]);
  const canSubmitSource = useMemo(() => {
    if (!result?.run?.id || sourceSubmitting) return false;
    if (isManualSource) return manualText.trim().length > 0;
    return sourceUrl.trim().length > 0;
  }, [isManualSource, manualText, result?.run?.id, sourceSubmitting, sourceUrl]);
  const canExtract = useMemo(
    () => Boolean(result?.run?.id && sources.length > 0 && !extracting),
    [extracting, result?.run?.id, sources.length]
  );

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
              <div className="rounded-lg border border-red-300/25 bg-red-500/10 px-3 py-3 text-sm text-red-100">
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
                <GlassCard className="border-[#E0B100]/20 bg-[#E0B100]/10 p-4">
                  <div className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-[#FDE68A]" />
                    <div>
                      <div className="font-semibold text-[#FDE68A]">{recommendationCopy.label}</div>
                      <p className="mt-1 text-sm leading-6 text-slate-200">{recommendationCopy.message}</p>
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
                      <div className="rounded-lg border border-red-300/25 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                        {sourceError}
                      </div>
                    ) : null}
                    {sourceSuccess ? (
                      <div className="rounded-lg border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                        {sourceSuccess}
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
                    sources.map((source) => (
                      <div
                        key={source.id}
                        className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-3"
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
                              <div className="mt-2 rounded-lg bg-black/20 px-3 py-2 text-xs leading-5 text-slate-300">
                                {source.extracted_text_summary}
                              </div>
                            ) : null}
                          </div>
                          <div className="text-xs text-slate-500">{formatDateTime(source.created_at)}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState className="py-4">
                      Источники ещё не добавлены. Добавьте ссылку или ручной текст, чтобы подготовить будущую extraction.
                    </EmptyState>
                  )}
                </div>

                <div className="mt-4 rounded-lg border border-sky-300/15 bg-sky-400/10 px-3 py-3 text-sm leading-6 text-sky-100">
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
                      className="w-fit gap-2 bg-sky-300 text-slate-950 hover:bg-sky-200"
                    >
                      {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      Извлечь данные
                    </Button>
                  </div>

                  {!sources.length ? (
                    <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-sky-100">
                      Сначала добавьте источник: ручной текст, ссылку на страницу или PDF.
                    </div>
                  ) : null}
                  {extractError ? (
                    <div className="mt-3 rounded-lg border border-red-300/25 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                      {extractError}
                    </div>
                  ) : null}
                  {extractSuccess ? (
                    <div className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                      {extractSuccess}
                    </div>
                  ) : null}

                  <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
                    Это черновик. Данные не записаны в препарат до подтверждения администратором.
                  </div>

                  {extractionDraft ? (
                    <div className="mt-4 rounded-lg border border-white/10 bg-[#020617]/60 p-4" data-testid="knowledge-extraction-draft">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="text-base font-semibold text-slate-50">Черновик паспорта</div>
                          <p className="mt-1 text-xs text-slate-400">Field-level suggestions сохранены в product_metadata_suggestions.</p>
                        </div>
                        <StatusPill tone="warning">Требует проверки</StatusPill>
                      </div>

                      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        <CompactStat label="Название" value={safeText(extractionDraft.trade_name)} />
                        <CompactStat label="Производитель" value={safeText(extractionDraft.manufacturer)} />
                        <CompactStat label="Тип" value={formatKnowledgeProductType(extractionDraft.product_type)} />
                        <CompactStat label="Подтип" value={formatKnowledgeSubcategory(extractionDraft.subcategory)} />
                        <CompactStat label="Физическое состояние" value={formatKnowledgePhysicalState(extractionDraft.physical_state)} />
                        <CompactStat label="Единица измерения" value={formatKnowledgeStockUnit(extractionDraft.stock_unit)} />
                        <CompactStat
                          label="Тип расхода"
                          value={formatKnowledgeConsumptionType(
                            extractionDraft.default_rate_unit,
                            extractionDraft.default_rate_type,
                            extractionDraft.stock_unit,
                            `${extractionDraft.trade_name || ""} ${extractionDraft.manufacturer || ""}`
                          )}
                        />
                        <CompactStat label="Уверенность" value={formatKnowledgeConfidence(extractionDraft.confidence)} />
                      </div>

                      <div className="mt-4 grid gap-3">
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                          <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Действующие вещества</div>
                          <div className="mt-1 text-sm text-slate-100">{formatActiveIngredients(extractionDraft.active_ingredients)}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                          <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Культуры</div>
                          <div className="mt-1 text-sm text-slate-100">{formatDraftList(extractionDraft.crops)}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                          <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Объекты применения / цели</div>
                          <div className="mt-1 text-sm text-slate-100">{formatDraftList(extractionDraft.targets)}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                          <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Ограничения</div>
                          <div className="mt-1 text-sm text-slate-100">{formatDraftList(extractionDraft.restrictions)}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                          <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Заметки</div>
                          <div className="mt-1 text-sm text-slate-100">{formatDraftList(extractionDraft.notes)}</div>
                        </div>
                      </div>

                      <Button disabled variant="outline" className="mt-4 border-white/10 bg-white/5 text-slate-300">
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
                <div className="order-2 rounded-lg border border-red-300/25 bg-red-500/10 px-3 py-3 text-sm font-semibold text-red-100">
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

                      <div className="mt-3 rounded-lg bg-black/20 px-3 py-2 text-xs leading-5 text-slate-300">
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
                    <Button disabled variant="outline" className="mt-4 border-white/10 bg-white/5 text-slate-300">
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
