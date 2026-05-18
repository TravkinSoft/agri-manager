"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AssistantConversationHost } from "@/components/assistant/assistant-conversation-host";
import { useAssistantShell } from "@/components/assistant/assistant-shell-provider";
import { defaultAssistantPanelEngine } from "@/lib/assistant/panel-engine";

function pageLabel(page: string): string {
  const key = String(page || "").toLowerCase();
  switch (key) {
    case "dashboard":
      return "Панель";
    case "warehouses":
      return "Склады";
    case "weighbridge":
      return "Весовая";
    case "fields":
      return "Поля";
    case "crop-structure":
      return "Структура посевов";
    case "fuel":
      return "АЗС / ГСМ";
    case "operations":
      return "Операции";
    default:
      return page || "—";
  }
}

export function AssistantPanel() {
  const {
    enabled,
    isOpen,
    close,
    open,
    runtimeContext,
    debugMonitorEnabled,
    debugMonitorOpen,
    toggleDebugMonitor,
  } = useAssistantShell();
  const engine = defaultAssistantPanelEngine;

  const companyLabel = runtimeContext.companyName || "не определена";
  const contextEntityLabel =
    runtimeContext.entity?.label ||
    (runtimeContext.entity
      ? `${runtimeContext.entity.type} ${runtimeContext.entity.id}`
      : null);

  if (!enabled) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(next) => (next ? open() : close())}>
      <SheetContent
        side="right"
        className="w-[min(980px,calc(100vw-1rem))] max-w-none p-0"
      >
        <div className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <SheetTitle className="text-xl">Assistant</SheetTitle>
                <SheetDescription>
                  Глобальный операционный помощник поверх ERP.
                </SheetDescription>
              </div>
              {debugMonitorEnabled ? (
                <Button
                  type="button"
                  size="sm"
                  variant={debugMonitorOpen ? "secondary" : "outline"}
                  onClick={toggleDebugMonitor}
                >
                  {debugMonitorOpen ? "Debug: вкл" : "Debug"}
                </Button>
              ) : null}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="secondary">Компания: {companyLabel}</Badge>
              <Badge variant="secondary">
                Страница: {pageLabel(runtimeContext.currentPage)}
              </Badge>
              <Badge variant="secondary">
                Сезон: {runtimeContext.season || "не указан"}
              </Badge>
              {contextEntityLabel ? (
                <Badge variant="secondary">Объект: {contextEntityLabel}</Badge>
              ) : null}
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-hidden bg-slate-50 px-4 py-4">
            <AssistantConversationHost engine={engine} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
