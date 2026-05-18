"use client";

import { AlertTriangle, ChevronDown, ChevronUp, X } from "lucide-react";
import { useAssistantShell } from "@/components/assistant/assistant-shell-provider";
import { useAuth } from "@/lib/contexts/auth-context";
import { cn } from "@/lib/utils";

function showValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  return String(value);
}

function Row({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="max-w-[62%] text-right font-medium text-slate-900">
        {showValue(value)}
      </span>
    </div>
  );
}

export function AssistantDebugMonitor() {
  const { profile } = useAuth();
  const {
    enabled,
    debugMonitorEnabled,
    debugMonitorOpen,
    debugMonitorCollapsed,
    setDebugMonitorCollapsed,
    closeDebugMonitor,
    debugSnapshot,
  } = useAssistantShell();

  const isAllowed =
    profile?.role === "global_admin" ||
    process.env.NEXT_PUBLIC_ASSISTANT_DEBUG === "1";
  if (!enabled || !debugMonitorEnabled || !isAllowed || !debugMonitorOpen) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[70] w-[360px] max-w-[calc(100vw-1rem)]">
      <div className="pointer-events-auto overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b bg-slate-50 px-3 py-2">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              Assistant Debug Monitor
            </div>
            <div className="text-[11px] text-slate-500">
              Технический режим (временный)
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded p-1 text-slate-600 hover:bg-slate-200"
              onClick={() => setDebugMonitorCollapsed(!debugMonitorCollapsed)}
              aria-label={debugMonitorCollapsed ? "Развернуть" : "Свернуть"}
            >
              {debugMonitorCollapsed ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              className="rounded p-1 text-slate-600 hover:bg-slate-200"
              onClick={closeDebugMonitor}
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {!debugMonitorCollapsed ? (
          <div className="max-h-[75vh] space-y-3 overflow-y-auto px-3 py-3">
            {!debugSnapshot ? (
              <div className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
                Нет debug-данных. Отправьте сообщение ассистенту.
              </div>
            ) : (
              <>
                <section className="space-y-1 rounded-md border p-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Модель
                  </div>
                  <Row label="Провайдер" value={debugSnapshot.model.provider} />
                  <Row
                    label="Модель (факт)"
                    value={
                      debugSnapshot.model.actualModel ||
                      debugSnapshot.model.configuredModel
                    }
                  />
                  <Row
                    label="Источник настроек"
                    value={debugSnapshot.model.settingsSource}
                  />
                  <Row label="Температура" value={debugSnapshot.model.temperature} />
                  <Row
                    label="Reasoning"
                    value={debugSnapshot.model.reasoningEffort}
                  />
                  <Row
                    label="Режим запроса"
                    value={debugSnapshot.model.requestMode}
                  />
                </section>

                <section className="space-y-1 rounded-md border p-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Доступ
                  </div>
                  <Row label="Роль" value={debugSnapshot.access.role} />
                  <Row
                    label="Компания"
                    value={
                      debugSnapshot.access.companyName ||
                      debugSnapshot.access.companyId
                    }
                  />
                  <Row
                    label="Источник контекста"
                    value={debugSnapshot.access.companyContextSource}
                  />
                  <Row label="User ID" value={debugSnapshot.access.authUserId} />
                </section>

                <section className="space-y-1 rounded-md border p-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Контекст
                  </div>
                  <Row label="Страница" value={debugSnapshot.runtime.currentPage} />
                  <Row label="Route" value={debugSnapshot.runtime.currentRoute} />
                  <Row label="Объект" value={debugSnapshot.runtime.currentEntity} />
                  <Row
                    label="Выбрано строк"
                    value={debugSnapshot.runtime.selectedRowsCount}
                  />
                  <Row
                    label="Фильтров"
                    value={debugSnapshot.runtime.activeFiltersCount}
                  />
                  <Row label="Сезон" value={debugSnapshot.runtime.season} />
                  <Row label="Locale" value={debugSnapshot.runtime.locale} />
                </section>

                <section className="space-y-1 rounded-md border p-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Engine
                  </div>
                  <Row label="Endpoint" value={debugSnapshot.engine.endpoint} />
                  <Row label="Версия" value={debugSnapshot.engine.engineVersion} />
                  <Row label="Intent" value={debugSnapshot.engine.intent} />
                  <Row label="Grounded" value={debugSnapshot.engine.grounded} />
                  <Row
                    label="Источник ответа"
                    value={debugSnapshot.engine.answerSource}
                  />
                  <Row
                    label="Навигация: intent"
                    value={debugSnapshot.engine.navigationIntentDetected}
                  />
                  <Row
                    label="Навигация: action"
                    value={debugSnapshot.engine.navigationActionCreated}
                  />
                  <Row
                    label="Навигация: executed"
                    value={debugSnapshot.engine.navigationActionExecuted}
                  />
                  <Row
                    label="Навигация: route"
                    value={debugSnapshot.engine.targetRoute}
                  />
                  <Row
                    label="Навигация: router error"
                    value={debugSnapshot.engine.routerError}
                  />
                  <Row label="Tools count" value={debugSnapshot.engine.toolCount} />
                  <Row
                    label="Последняя ошибка tool"
                    value={debugSnapshot.engine.lastToolError}
                  />
                  <div className="pt-1 text-[11px] text-slate-500">Инструменты:</div>
                  <div className="flex flex-wrap gap-1">
                    {debugSnapshot.engine.usedTools.length ? (
                      debugSnapshot.engine.usedTools.map((tool) => (
                        <span
                          key={`${tool.tool}-${tool.error || "ok"}`}
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-[10px]",
                            tool.ok
                              ? "border-green-300 bg-green-50 text-green-700"
                              : "border-red-300 bg-red-50 text-red-700"
                          )}
                        >
                          {tool.tool}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] text-slate-400">—</span>
                    )}
                  </div>
                </section>

                <section className="space-y-1 rounded-md border p-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Память
                  </div>
                  <Row label="Сессия" value={debugSnapshot.memory.sessionId} />
                  <Row
                    label="Последняя культура"
                    value={debugSnapshot.memory.lastCrop}
                  />
                  <Row
                    label="Последний сорт"
                    value={debugSnapshot.memory.lastVariety}
                  />
                  <Row
                    label="Последний склад"
                    value={debugSnapshot.memory.lastWarehouse}
                  />
                  <Row
                    label="Последнее поле"
                    value={debugSnapshot.memory.lastField}
                  />
                  <Row
                    label="Последний intent"
                    value={debugSnapshot.memory.lastIntent}
                  />
                  <Row
                    label="Follow-up активен"
                    value={debugSnapshot.memory.followUpActive}
                  />
                </section>

                <section className="space-y-1 rounded-md border p-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Производительность
                  </div>
                  <Row label="Latency (ms)" value={debugSnapshot.performance.latencyMs} />
                  <Row label="Prompt tokens" value={debugSnapshot.performance.promptTokens} />
                  <Row
                    label="Completion tokens"
                    value={debugSnapshot.performance.completionTokens}
                  />
                  <Row label="Total tokens" value={debugSnapshot.performance.totalTokens} />
                </section>

                <section className="space-y-1 rounded-md border p-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Предупреждения
                  </div>
                  {debugSnapshot.warnings.length ? (
                    <div className="space-y-1">
                      {debugSnapshot.warnings.map((warning) => (
                        <div
                          key={warning}
                          className="flex items-start gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900"
                        >
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{warning}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">Нет</div>
                  )}
                </section>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
