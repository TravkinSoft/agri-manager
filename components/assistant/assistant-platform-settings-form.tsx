"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, PlayCircle, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import { DEFAULT_ASSISTANT_PLATFORM_SETTINGS } from "@/lib/assistant/settings-types";
import type { AssistantSessionState } from "@/lib/assistant/engine/types";
import { EMPTY_ASSISTANT_SESSION_STATE } from "@/lib/assistant/engine/session-state";
import { useAuth } from "@/lib/contexts/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

type PromptRuntimeInfo = {
  version: string;
  source: "code_default" | "db_override" | "env_override";
  updated_at: string;
  active_prompt: string;
};

type SettingsResponse = {
  settings: AssistantPlatformSettings;
  prompt?: PromptRuntimeInfo;
  error?: string;
};

type ValidateResponse = {
  runtime: {
    provider: string;
    model: string;
    actualModel?: string | null;
    modelCandidates?: string[];
    fallbackModel?: string | null;
    fallbackReason?: string | null;
    temperature: number;
    reasoningEffort: string;
    enabledTools: string[];
  };
  model: {
    requested_model: string;
    actual_model_used: string | null;
    fallback_model?: string | null;
    fallback_reason?: string | null;
    requested_model_accessible?: boolean | null;
    config_source: "db" | "env" | "default";
    prompt_version: string;
    prompt_source: "code_default" | "db_override" | "env_override";
    prompt_updated_at: string;
    temperature_used: number;
    reasoning_effort: string;
    route_tier: "default" | "heavy";
  };
  checks: {
    openai_api_key_present: boolean;
    backend_key_visible: boolean;
    database_settings_ok: boolean;
    tools_enabled_count: number;
    model_list_ok?: boolean;
    model_list_status?: number | null;
    model_list_error?: string | null;
    model_ping_ok: boolean;
    model_ping_status: number | null;
    model_ping_error: string | null;
  };
  binding: Record<string, string>;
  notes: string[];
  error?: string;
};

type TestMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type TestResponse = {
  answer: string;
  session_state: AssistantSessionState;
  metadata: {
    requested_model: string;
    actual_model_used: string | null;
    config_source: "db" | "env" | "default";
    prompt_version: string;
    prompt_source: "code_default" | "db_override" | "env_override";
    prompt_updated_at: string;
    temperature_used: number;
    reasoning_effort: "low" | "medium" | "high";
    tools_enabled_count: number;
    tools_allowed: string[];
    mode: "erp_data" | "agro_knowledge" | "mixed" | "navigation";
    latency_ms: number;
    token_usage: {
      prompt_tokens: number | null;
      completion_tokens: number | null;
      total_tokens: number | null;
    };
    intent: string | null;
    answer_source: string;
    llm: {
      status: string;
      http_status: number | null;
      error_code: string | null;
      error_message: string | null;
      missing_env: string[];
    };
    test_mode: "read_only";
    navigation_disabled: boolean;
  };
  tool_activity: string[];
  tool_calls: Array<{
    tool: string;
    ok: boolean;
    rows?: number;
    error?: string;
  }>;
  debug?: {
    status_code: number;
    error_source: string;
    error_message: string;
    requested_model: string | null;
    config_source: "db" | "env" | "default" | "fallback";
  };
  error?: string;
};

const ROLE_OPTIONS = [
  { key: "warehouse_operator", label: "Складовщик" },
  { key: "weighman", label: "Весовщик" },
  { key: "specialist", label: "Специалист" },
  { key: "brigadier", label: "Бригадир" },
  { key: "legal_operator", label: "Юрист / бухгалтер" },
  { key: "fuel_operator", label: "Оператор ГСМ" },
  { key: "global_admin", label: "Глобальный администратор" },
  { key: "company_admin", label: "Администратор компании" },
  { key: "agronomist", label: "Агроном" },
  { key: "director", label: "Директор" },
] as const;

const MODEL_OPTIONS = ["gpt-5.4-mini", "gpt-5.5"] as const;
const REASONING_OPTIONS = ["low", "medium", "high"] as const;

const TOOL_OPTIONS = [
  "get_current_context",
  "get_routes",
  "get_company_context",
  "get_current_season",
  "search_fields",
  "get_field_card",
  "get_field_timeline",
  "get_field_materials",
  "get_fields",
  "search_warehouses",
  "get_warehouse_stock",
  "search_operations",
  "get_operation_details",
  "get_active_tickets",
  "get_recent_tickets",
  "get_ticket_details",
  "get_crop_structure_summary",
  "search_crops_by_group",
  "get_crop_structure",
  "get_inventory",
  "get_batches",
  "get_warehouse_balances",
  "get_warehouse_movements",
  "get_weighbridge_tickets",
  "get_operations",
  "get_fuel_movements",
  "create_operation_draft",
  "create_field_draft",
  "create_meal_order_draft",
  "create_warehouse_draft",
  "create_transfer_draft",
  "navigate_to_page",
  "open_entity",
  "apply_filter",
] as const;

const QUICK_TEST_PROMPTS = [
  "Кто ты?",
  "Что такое TravkinFlow?",
  "Сколько посевных площадей?",
  "Что по зерновым?",
  "Что такое фитофтора?",
  "Открой весовую",
] as const;

function asMultiline(items: string[]): string {
  return (items || []).join("\n");
}

function fromMultiline(raw: string): string[] {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  );
}

function toMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function newTestThreadId(): string {
  return `assistant-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function buildAuthHeaders(contentType: "json" | "none" = "json") {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) {
    throw new Error("Сессия истекла. Войдите снова.");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${data.session.access_token}`,
  };
  if (contentType === "json") headers["Content-Type"] = "application/json";
  return headers;
}

function reasoningLabel(value: string): string {
  if (value === "low") return "Низкая";
  if (value === "high") return "Высокая";
  return "Средняя";
}

function bindingLabel(value: string): string {
  return value === "used" ? "используется runtime" : "зарезервировано";
}

export function AssistantPlatformSettingsForm() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [testing, setTesting] = useState(false);

  const [settings, setSettings] = useState<AssistantPlatformSettings>(DEFAULT_ASSISTANT_PLATFORM_SETTINGS);
  const [activePromptInfo, setActivePromptInfo] = useState<PromptRuntimeInfo | null>(null);
  const [forbiddenActionsText, setForbiddenActionsText] = useState("");
  const [groundingDomainsText, setGroundingDomainsText] = useState("");
  const [validateResult, setValidateResult] = useState<ValidateResponse | null>(null);

  const [testInput, setTestInput] = useState("");
  const [testMessages, setTestMessages] = useState<TestMessage[]>([]);
  const [testThreadId, setTestThreadId] = useState<string>(newTestThreadId());
  const [testSessionState, setTestSessionState] = useState<AssistantSessionState>({ ...EMPTY_ASSISTANT_SESSION_STATE });
  const [testMeta, setTestMeta] = useState<TestResponse["metadata"] | null>(null);
  const [testToolActivity, setTestToolActivity] = useState<string[]>([]);
  const [testError, setTestError] = useState<TestResponse["debug"] | null>(null);

  const canSave = useMemo(() => !loading && !saving, [loading, saving]);
  const modelOptions = useMemo(() => {
    const fromSettings = String(settings.model || "").trim();
    return Array.from(new Set([...MODEL_OPTIONS, ...(fromSettings ? [fromSettings] : [])]));
  }, [settings.model]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const headers = await buildAuthHeaders("none");
      const response = await fetch("/api/assistant/settings", { method: "GET", headers, cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as SettingsResponse;
      if (!response.ok) throw new Error(payload?.error || "Не удалось загрузить настройки ассистента.");

      const next = payload.settings || DEFAULT_ASSISTANT_PLATFORM_SETTINGS;
      setSettings(next);
      setActivePromptInfo(payload.prompt || null);
      setForbiddenActionsText(asMultiline(next.forbiddenActions || []));
      setGroundingDomainsText(asMultiline(next.groundingRules?.requireToolForDomains || []));
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось загрузить настройки ассистента.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const saveSettings = async () => {
    try {
      setSaving(true);
      const headers = await buildAuthHeaders("json");
      const payload: AssistantPlatformSettings = {
        ...settings,
        provider: "openai",
        forbiddenActions: fromMultiline(forbiddenActionsText),
        groundingRules: {
          ...settings.groundingRules,
          requireToolForDomains: fromMultiline(groundingDomainsText),
        },
      };

      const response = await fetch("/api/assistant/settings", {
        method: "PUT",
        headers,
        body: JSON.stringify({ settings: payload }),
      });
      const data = (await response.json().catch(() => ({}))) as SettingsResponse;
      if (!response.ok) throw new Error(data?.error || "Не удалось сохранить настройки ассистента.");

      const saved = data.settings || payload;
      setSettings(saved);
      setActivePromptInfo(data.prompt || null);
      setForbiddenActionsText(asMultiline(saved.forbiddenActions || []));
      setGroundingDomainsText(asMultiline(saved.groundingRules?.requireToolForDomains || []));

      toast({
        title: "Сохранено",
        description: "Настройки ассистента обновлены. Тестовый ассистент уже использует новые параметры.",
      });
    } catch (error) {
      toast({
        title: "Ошибка сохранения",
        description: error instanceof Error ? error.message : "Не удалось сохранить настройки ассистента.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const validateSettings = async () => {
    try {
      setChecking(true);
      setValidateResult(null);
      const headers = await buildAuthHeaders("none");
      const response = await fetch("/api/assistant/settings/validate", {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as ValidateResponse;
      if (!response.ok) throw new Error(payload?.error || "Не удалось проверить настройки ассистента.");

      setValidateResult(payload);
      toast({
        title: "Проверка выполнена",
        description: "Backend runtime и model ping проверены.",
      });
    } catch (error) {
      toast({
        title: "Ошибка проверки",
        description: error instanceof Error ? error.message : "Не удалось выполнить проверку настроек.",
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  };

  const newTest = () => {
    setTestThreadId(newTestThreadId());
    setTestMessages([]);
    setTestSessionState({ ...EMPTY_ASSISTANT_SESSION_STATE });
    setTestMeta(null);
    setTestToolActivity([]);
    setTestError(null);
    setTestInput("");
    toast({
      title: "Новый тест",
      description: "Создан новый тестовый контекст. История основного Copilot не затронута.",
    });
  };

  const clearTest = () => {
    setTestMessages([]);
    setTestMeta(null);
    setTestToolActivity([]);
    setTestError(null);
    setTestInput("");
  };

  const runTest = async (prompt?: string) => {
    const message = String(prompt ?? testInput).trim();
    if (!message || testing) return;

    const userMessage: TestMessage = { id: toMessageId(), role: "user", content: message };
    setTestMessages((prev) => [...prev, userMessage]);
    setTestInput("");
    setTesting(true);
    setTestError(null);

    try {
      const headers = await buildAuthHeaders("json");
      const response = await fetch("/api/assistant/test", {
        method: "POST",
        headers,
        body: JSON.stringify({
          message,
          threadId: testThreadId,
          companyId: profile?.company_id || null,
          sessionState: testSessionState,
          runtimeContext: {
            currentPage: "assistant-settings-test",
            currentRoute: "/platform/assistant/settings",
            companyId: profile?.company_id || null,
            season: testSessionState.lastSeason || null,
            locale: "ru",
          },
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as TestResponse;
      if (!response.ok) {
        const errText = payload?.error || "Не удалось выполнить тестовый запрос.";
        setTestError(
          payload?.debug || {
            status_code: response.status,
            error_source: "api",
            error_message: errText,
            requested_model: null,
            config_source: "fallback",
          }
        );
        setTestMessages((prev) => [
          ...prev,
          { id: toMessageId(), role: "assistant", content: "AI Assistant временно недоступен. Проверьте debug ниже." },
        ]);
        return;
      }

      setTestSessionState(payload.session_state || { ...EMPTY_ASSISTANT_SESSION_STATE });
      setTestMeta(payload.metadata || null);
      setTestToolActivity(Array.isArray(payload.tool_activity) ? payload.tool_activity : []);
      setTestMessages((prev) => [
        ...prev,
        { id: toMessageId(), role: "assistant", content: payload.answer || "Пустой ответ от ассистента." },
      ]);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Не удалось выполнить тест.";
      setTestError({
        status_code: 500,
        error_source: "client",
        error_message: messageText,
        requested_model: null,
        config_source: "fallback",
      });
      setTestMessages((prev) => [
        ...prev,
        { id: toMessageId(), role: "assistant", content: "AI Assistant временно недоступен. Проверьте debug ниже." },
      ]);
    } finally {
      setTesting(false);
    }
  };

  const toggleAllowedRole = (role: (typeof ROLE_OPTIONS)[number]["key"], nextChecked: boolean) => {
    setSettings((prev) => {
      const roleSet = new Set(prev.allowedRoles || []);
      if (nextChecked) roleSet.add(role);
      else roleSet.delete(role);
      return {
        ...prev,
        allowedRoles: Array.from(roleSet) as AssistantPlatformSettings["allowedRoles"],
      };
    });
  };

  const toggleAllowedTool = (tool: string, nextChecked: boolean) => {
    setSettings((prev) => {
      const toolSet = new Set(prev.allowedTools || []);
      if (nextChecked) toolSet.add(tool);
      else toolSet.delete(tool);
      return {
        ...prev,
        allowedTools: Array.from(toolSet),
      };
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Настройки ассистента</h1>
        <p className="mt-1 text-sm text-slate-500">
          Глобальные настройки Copilot + встроенный тестовый ассистент для проверки реального backend-runtime.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Рантайм</CardTitle>
          <CardDescription>Модель, температура и базовые runtime-параметры.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="provider">Провайдер</Label>
            <Input id="provider" value="openai" readOnly disabled />
          </div>

          <div className="space-y-2">
            <Label htmlFor="model">Модель</Label>
            <Select value={settings.model} onValueChange={(value) => setSettings((prev) => ({ ...prev, model: value }))} disabled={loading || saving}>
              <SelectTrigger id="model">
                <SelectValue placeholder="Выберите модель" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="temperature">Температура</Label>
            <Input
              id="temperature"
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={String(settings.temperature)}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  temperature: Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : prev.temperature,
                }))
              }
              disabled={loading || saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reasoning">Уровень рассуждения</Label>
            <Select
              value={settings.reasoningEffort}
              onValueChange={(value) =>
                setSettings((prev) => ({
                  ...prev,
                  reasoningEffort: (value || "medium") as AssistantPlatformSettings["reasoningEffort"],
                }))
              }
              disabled={loading || saving}
            >
              <SelectTrigger id="reasoning">
                <SelectValue placeholder="Выберите режим" />
              </SelectTrigger>
              <SelectContent>
                {REASONING_OPTIONS.map((effort) => (
                  <SelectItem key={effort} value={effort}>
                    {reasoningLabel(effort)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-full flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-3">
              <Switch
                checked={settings.enabled}
                onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, enabled: checked }))}
                disabled={loading || saving}
              />
              <span className="text-sm">Ассистент включён</span>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={settings.logging.enabled}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    logging: { ...prev.logging, enabled: checked },
                  }))
                }
                disabled={loading || saving}
              />
              <span className="text-sm">Включить аудит ассистента</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Политика</CardTitle>
          <CardDescription>System prompt, роли, инструменты и ограничения.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2 rounded border bg-slate-50 p-3 text-sm">
            <div className="font-medium">Active core prompt</div>
            <div className="grid gap-2 md:grid-cols-3">
              <div>
                version: <b>{activePromptInfo?.version || "travkin-core-v1"}</b>
              </div>
              <div>
                source: <b>{activePromptInfo?.source || "code_default"}</b>
              </div>
              <div>
                updated_at: <b>{activePromptInfo?.updated_at || "2026-05-28"}</b>
              </div>
            </div>
            <details>
              <summary className="cursor-pointer text-xs font-medium uppercase text-slate-600">
                Preview active prompt
              </summary>
              <Textarea
                className="mt-2"
                rows={10}
                readOnly
                value={activePromptInfo?.active_prompt || "Core prompt preview is unavailable."}
              />
            </details>
          </div>

          <div className="space-y-2">
            <Label htmlFor="systemPrompt">Системный prompt</Label>
            <Textarea
              id="systemPrompt"
              rows={6}
              value={settings.systemPrompt || ""}
              onChange={(e) => setSettings((prev) => ({ ...prev, systemPrompt: e.target.value }))}
              disabled={loading || saving}
            />
          </div>

          <div className="space-y-2">
            <Label>Разрешённые роли</Label>
            <div className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.map((role) => {
                const active = (settings.allowedRoles || []).includes(role.key);
                return (
                  <button key={role.key} type="button" onClick={() => toggleAllowedRole(role.key, !active)} disabled={loading || saving} className="rounded-full">
                    <Badge variant={active ? "default" : "secondary"}>{role.label}</Badge>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <Label>Разрешённые инструменты</Label>
            <div className="grid gap-2 md:grid-cols-2">
              {TOOL_OPTIONS.map((tool) => {
                const checked = (settings.allowedTools || []).includes(tool);
                return (
                  <label key={tool} className="flex cursor-pointer items-center gap-2 rounded border p-2 text-sm">
                    <Checkbox checked={checked} onCheckedChange={(next) => toggleAllowedTool(tool, !!next)} disabled={loading || saving} />
                    <span>{tool}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="forbiddenActions">Запрещённые действия (по одному на строку)</Label>
              <Textarea
                id="forbiddenActions"
                rows={6}
                value={forbiddenActionsText}
                onChange={(e) => setForbiddenActionsText(e.target.value)}
                disabled={loading || saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="groundingDomains">Grounding domains (по одному на строку)</Label>
              <Textarea
                id="groundingDomains"
                rows={6}
                value={groundingDomainsText}
                onChange={(e) => setGroundingDomainsText(e.target.value)}
                disabled={loading || saving}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Лимиты и подтверждения</CardTitle>
          <CardDescription>Ограничения и policy переключатели.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="maxRecentMessages">Максимум последних сообщений</Label>
            <Input
              id="maxRecentMessages"
              type="number"
              min="1"
              value={String(settings.limits.maxRecentMessages)}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  limits: {
                    ...prev.limits,
                    maxRecentMessages: Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : prev.limits.maxRecentMessages,
                  },
                }))
              }
              disabled={loading || saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxSummaryChars">Максимум символов сводки</Label>
            <Input
              id="maxSummaryChars"
              type="number"
              min="500"
              value={String(settings.limits.maxSummaryChars)}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  limits: {
                    ...prev.limits,
                    maxSummaryChars: Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : prev.limits.maxSummaryChars,
                  },
                }))
              }
              disabled={loading || saving}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="maxToolCallsPerQuery">Максимум вызовов инструментов на запрос</Label>
            <Input
              id="maxToolCallsPerQuery"
              type="number"
              min="1"
              value={String(settings.limits.maxToolCallsPerQuery)}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  limits: {
                    ...prev.limits,
                    maxToolCallsPerQuery: Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : prev.limits.maxToolCallsPerQuery,
                  },
                }))
              }
              disabled={loading || saving}
            />
          </div>

          <div className="col-span-full grid gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-3">
              <Switch
                checked={settings.groundingRules.blockUngroundedDataAnswers}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    groundingRules: {
                      ...prev.groundingRules,
                      blockUngroundedDataAnswers: checked,
                    },
                  }))
                }
                disabled={loading || saving}
              />
              <span className="text-sm">Блокировать ответы без tool-grounding</span>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={settings.groundingRules.disallowSeasonMixing}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    groundingRules: {
                      ...prev.groundingRules,
                      disallowSeasonMixing: checked,
                    },
                  }))
                }
                disabled={loading || saving}
              />
              <span className="text-sm">Запретить смешивание сезонов</span>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={settings.actionConfirmation.alwaysRequireHumanConfirmation}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    actionConfirmation: {
                      ...prev.actionConfirmation,
                      alwaysRequireHumanConfirmation: checked,
                    },
                  }))
                }
                disabled={loading || saving}
              />
              <span className="text-sm">Всегда требовать подтверждение человека</span>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={settings.actionConfirmation.allowDraftAutofill}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    actionConfirmation: {
                      ...prev.actionConfirmation,
                      allowDraftAutofill: checked,
                    },
                  }))
                }
                disabled={loading || saving}
              />
              <span className="text-sm">Разрешить автозаполнение черновиков</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Проверить настройки</CardTitle>
          <CardDescription>
            Backend health-check: ключ, модель, ping, доступ к БД и runtime binding.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button type="button" variant="outline" onClick={validateSettings} disabled={loading || saving || checking}>
            {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Проверить настройки
          </Button>

          {validateResult ? (
            <div className="space-y-4 rounded border bg-slate-50 p-3 text-sm">
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                <span>Runtime-конфигурация получена</span>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div>Requested model: <b>{validateResult.model.requested_model}</b></div>
                <div>Actual model used: <b>{validateResult.model.actual_model_used || "—"}</b></div>
                <div>
                  Requested model accessible:{" "}
                  <b>
                    {validateResult.model.requested_model_accessible === null ||
                    validateResult.model.requested_model_accessible === undefined
                      ? "unknown"
                      : validateResult.model.requested_model_accessible
                        ? "yes"
                        : "no"}
                  </b>
                </div>
                <div>Fallback model: <b>{validateResult.model.fallback_model || "—"}</b></div>
                <div className="md:col-span-2">Fallback reason: <b>{validateResult.model.fallback_reason || "—"}</b></div>
                <div>Config source: <b>{validateResult.model.config_source}</b></div>
                <div>Prompt version: <b>{validateResult.model.prompt_version}</b></div>
                <div>Prompt source: <b>{validateResult.model.prompt_source}</b></div>
                <div>Prompt updated: <b>{validateResult.model.prompt_updated_at}</b></div>
                <div>Temperature: <b>{validateResult.model.temperature_used}</b></div>
                <div>Reasoning: <b>{validateResult.model.reasoning_effort}</b></div>
                <div>Tools enabled: <b>{validateResult.checks.tools_enabled_count}</b></div>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div>OPENAI_API_KEY: <b>{validateResult.checks.openai_api_key_present ? "OK" : "Missing"}</b></div>
                <div>Model list: <b>{validateResult.checks.model_list_ok ? "OK" : "Fail"}</b></div>
                <div>Model list status: <b>{validateResult.checks.model_list_status ?? "—"}</b></div>
                <div>Model list error: <b>{validateResult.checks.model_list_error || "—"}</b></div>
                <div>Model ping: <b>{validateResult.checks.model_ping_ok ? "OK" : "Fail"}</b></div>
                <div>Ping status: <b>{validateResult.checks.model_ping_status ?? "—"}</b></div>
                <div>Ping error: <b>{validateResult.checks.model_ping_error || "—"}</b></div>
              </div>

              {validateResult.binding ? (
                <div className="space-y-1">
                  {Object.entries(validateResult.binding).map(([key, value]) => (
                    <div key={key}>
                      {key}: <b>{bindingLabel(value)}</b>
                    </div>
                  ))}
                </div>
              ) : null}

              {Array.isArray(validateResult.notes) && validateResult.notes.length > 0 ? (
                <div className="space-y-1 text-slate-700">
                  {validateResult.notes.map((note) => (
                    <div key={note}>• {note}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Тест ассистента</CardTitle>
          <CardDescription>
            Safe read-only test mode. Навигация и мутации отключены. Запрос идёт через реальный backend endpoint <code>/api/assistant/test</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {QUICK_TEST_PROMPTS.map((prompt) => (
              <Button
                key={prompt}
                type="button"
                variant="outline"
                size="sm"
                disabled={testing}
                onClick={() => void runTest(prompt)}
              >
                {prompt}
              </Button>
            ))}
          </div>

          <div className="flex gap-2">
            <Input
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              placeholder="Введите тестовый запрос…"
              disabled={testing}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runTest();
                }
              }}
            />
            <Button type="button" onClick={() => void runTest()} disabled={testing || !testInput.trim()}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
              Отправить тест
            </Button>
            <Button type="button" variant="outline" onClick={newTest} disabled={testing}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Новый тест
            </Button>
            <Button type="button" variant="outline" onClick={clearTest} disabled={testing}>
              <Trash2 className="mr-2 h-4 w-4" />
              Очистить
            </Button>
          </div>

          <div className="rounded border bg-slate-50 p-3">
            <div className="mb-2 text-xs text-slate-600">
              Thread: <b>{testThreadId}</b>
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {testMessages.length === 0 ? (
                <div className="text-sm text-slate-500">Здесь появится история тестового чата.</div>
              ) : (
                testMessages.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded p-2 text-sm ${
                      item.role === "user" ? "bg-amber-100 text-amber-950" : "bg-white text-slate-900"
                    }`}
                  >
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
                      {item.role === "user" ? "user" : "assistant"}
                    </div>
                    <div className="whitespace-pre-wrap">{item.content}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {testMeta ? (
            <div className="space-y-2 rounded border p-3 text-sm">
              <div className="font-medium">Technical metadata</div>
              <div className="grid gap-2 md:grid-cols-2">
                <div>requested_model: <b>{testMeta.requested_model}</b></div>
                <div>actual_model_used: <b>{testMeta.actual_model_used || "not_called"}</b></div>
                <div>config_source: <b>{testMeta.config_source}</b></div>
                <div>prompt_version: <b>{testMeta.prompt_version}</b></div>
                <div>prompt_source: <b>{testMeta.prompt_source}</b></div>
                <div>prompt_updated_at: <b>{testMeta.prompt_updated_at}</b></div>
                <div>temperature_used: <b>{testMeta.temperature_used}</b></div>
                <div>reasoning_effort: <b>{testMeta.reasoning_effort}</b></div>
                <div>tools_enabled_count: <b>{testMeta.tools_enabled_count}</b></div>
                <div>mode: <b>{testMeta.mode}</b></div>
                <div>intent: <b>{testMeta.intent || "—"}</b></div>
                <div>latency_ms: <b>{testMeta.latency_ms}</b></div>
                <div>token_usage: <b>{testMeta.token_usage.total_tokens ?? "—"}</b></div>
                <div>llm_status: <b>{testMeta.llm.status}</b></div>
                <div>llm_http_status: <b>{testMeta.llm.http_status ?? "—"}</b></div>
              </div>

              {testToolActivity.length > 0 ? (
                <details className="rounded border bg-slate-50 p-2">
                  <summary className="cursor-pointer text-xs font-medium uppercase text-slate-600">Tool activity</summary>
                  <div className="mt-2 space-y-1 text-xs">
                    {testToolActivity.map((entry) => (
                      <div key={entry}>{entry}</div>
                    ))}
                  </div>
                </details>
              ) : null}

              {testMeta.config_source !== "db" ? (
                <div className="rounded bg-amber-50 p-2 text-amber-900">
                  Эта конфигурация частично берётся из ENV/fallback. Для стабильного применения сохраните настройки в БД.
                </div>
              ) : null}
            </div>
          ) : null}

          {testError ? (
            <div className="space-y-1 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <div className="font-medium">Ошибка теста</div>
              <div>status_code: <b>{testError.status_code}</b></div>
              <div>error_source: <b>{testError.error_source}</b></div>
              <div>error_message: <b>{testError.error_message}</b></div>
              <div>requested_model: <b>{testError.requested_model || "—"}</b></div>
              <div>config_source: <b>{testError.config_source}</b></div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={saveSettings} disabled={!canSave}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Сохранить настройки
        </Button>
        <Button type="button" variant="outline" onClick={() => void loadSettings()} disabled={loading || saving}>
          Обновить
        </Button>
      </div>
    </div>
  );
}
