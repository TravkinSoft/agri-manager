"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Save, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import { DEFAULT_ASSISTANT_PLATFORM_SETTINGS } from "@/lib/assistant/settings-types";
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

type SettingsResponse = { settings: AssistantPlatformSettings; error?: string };
type ValidateResponse = {
  runtime: {
    provider: string;
    model: string;
    temperature: number;
    reasoningEffort: string;
    enabledTools: string[];
  };
  binding: Record<string, string>;
  notes: string[];
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

const MODEL_OPTIONS = [
  "gpt-5",
  "gpt-5-mini",
  "gpt-5.3",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4o",
  "gpt-4o-mini",
] as const;
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
  "create_transfer_draft",
  "navigate_to_page",
  "open_entity",
  "apply_filter",
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

async function buildAuthHeaders(contentType: "json" | "none" = "json") {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) {
    throw new Error("Сессия истекла. Войдите снова.");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${data.session.access_token}`,
  };
  if (contentType === "json") {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

function reasoningLabel(value: string): string {
  if (value === "low") return "Низкая";
  if (value === "high") return "Высокая";
  return "Средняя";
}

function bindingLabel(value: string): string {
  return value === "used" ? "используется движком" : "зарезервировано (пока не влияет)";
}

export function AssistantPlatformSettingsForm() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [settings, setSettings] = useState<AssistantPlatformSettings>(DEFAULT_ASSISTANT_PLATFORM_SETTINGS);
  const [forbiddenActionsText, setForbiddenActionsText] = useState("");
  const [groundingDomainsText, setGroundingDomainsText] = useState("");
  const [validateResult, setValidateResult] = useState<ValidateResponse | null>(null);

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
      setForbiddenActionsText(asMultiline(saved.forbiddenActions || []));
      setGroundingDomainsText(asMultiline(saved.groundingRules?.requireToolForDomains || []));

      toast({
        title: "Сохранено",
        description: "Глобальные настройки ассистента обновлены.",
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
        description: "Runtime-конфигурация ассистента прочитана успешно.",
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
          Глобальные настройки ассистента (только для global_admin). Пользовательский чат работает через правую панель.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Рантайм</CardTitle>
          <CardDescription>Модель, провайдер и базовые ограничения ответа.</CardDescription>
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
            <Label htmlFor="reasoning">Глубина рассуждения</Label>
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
              <span className="text-sm">Ассистент включен</span>
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
          <CardDescription>Системный промпт, роли, инструменты и запрещенные действия.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="systemPrompt">Системный промпт</Label>
            <Textarea
              id="systemPrompt"
              rows={6}
              value={settings.systemPrompt || ""}
              onChange={(e) => setSettings((prev) => ({ ...prev, systemPrompt: e.target.value }))}
              disabled={loading || saving}
            />
          </div>

          <div className="space-y-2">
            <Label>Разрешенные роли</Label>
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
            <Label>Разрешенные инструменты</Label>
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
              <Label htmlFor="forbiddenActions">Запрещенные действия (по одному на строку)</Label>
              <Textarea
                id="forbiddenActions"
                rows={6}
                value={forbiddenActionsText}
                onChange={(e) => setForbiddenActionsText(e.target.value)}
                disabled={loading || saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="groundingDomains">Домены с обязательным grounding (по одному на строку)</Label>
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
          <CardTitle>Лимиты и подтверждение</CardTitle>
          <CardDescription>Лимиты и правила подтверждения действий пользователем.</CardDescription>
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
              <span className="text-sm">Блокировать ответы без данных из инструментов</span>
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
          <CardDescription>Проверка того, что текущий runtime реально читается assistant engine.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button type="button" variant="outline" onClick={validateSettings} disabled={loading || saving || checking}>
            {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Проверить настройки
          </Button>

          {validateResult ? (
            <div className="space-y-3 rounded border bg-slate-50 p-3 text-sm">
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                <span>Рантайм-конфигурация получена</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  Провайдер: <b>{validateResult.runtime.provider}</b>
                </div>
                <div>
                  Модель: <b>{validateResult.runtime.model}</b>
                </div>
                <div>
                  Температура: <b>{validateResult.runtime.temperature}</b>
                </div>
                <div>
                  Глубина рассуждения: <b>{validateResult.runtime.reasoningEffort}</b>
                </div>
              </div>
              <div>
                Включенные инструменты: <b>{Array.isArray(validateResult.runtime.enabledTools) ? validateResult.runtime.enabledTools.length : 0}</b>
              </div>
              <div className="space-y-1">
                {Object.entries(validateResult.binding || {}).map(([key, value]) => (
                  <div key={key}>
                    {key}: <b>{bindingLabel(value)}</b>
                  </div>
                ))}
              </div>
              {Array.isArray(validateResult.notes) && validateResult.notes.length > 0 ? (
                <div className="space-y-1 text-slate-600">
                  {validateResult.notes.map((note) => (
                    <div key={note}>• {note}</div>
                  ))}
                </div>
              ) : null}
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
