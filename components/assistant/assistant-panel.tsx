"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
    case "land-legal":
      return "Кадастр и право";
    case "users":
      return "Пользователи";
    case "analytics":
      return "Отчёты";
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
    (runtimeContext.entity ? `${runtimeContext.entity.type} ${runtimeContext.entity.id}` : null);

  if (!enabled) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(next) => (next ? open() : close())}>
      <SheetContent side="right" className="w-[min(980px,calc(100vw-1rem))] max-w-none border-[#262D3D] bg-[#11151E] p-0">
        <div className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b border-[#262D3D] bg-[#121824] px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <SheetTitle className="text-xl text-[#F3F4F6]">Travkin Copilot</SheetTitle>
                <SheetDescription className="text-[#9CA3AF]">
                  Операционный AI-помощник по полям, весовой, складам и операциям.
                </SheetDescription>
              </div>
              {debugMonitorEnabled ? (
                <Button
                  type="button"
                  size="sm"
                  variant={debugMonitorOpen ? "secondary" : "outline"}
                  className="border-[#334058] bg-[#1A1F2B] text-[#E5E7EB] hover:bg-[#202738]"
                  onClick={toggleDebugMonitor}
                >
                  {debugMonitorOpen ? "Debug: вкл" : "Debug"}
                </Button>
              ) : null}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="secondary" className="bg-[#1F2937] text-[#E5E7EB]">
                Компания: {companyLabel}
              </Badge>
              <Badge variant="secondary" className="bg-[#1F2937] text-[#E5E7EB]">
                Страница: {pageLabel(runtimeContext.currentPage)}
              </Badge>
              <Badge variant="secondary" className="bg-[#1F2937] text-[#E5E7EB]">
                Сезон: {runtimeContext.season || "не указан"}
              </Badge>
              {contextEntityLabel ? (
                <Badge variant="secondary" className="bg-[#1F2937] text-[#E5E7EB]">
                  Объект: {contextEntityLabel}
                </Badge>
              ) : null}
            </div>
          </SheetHeader>

          <div className="assistant-surface min-h-0 flex-1 overflow-hidden bg-[#0F141E] px-4 py-4">
            <AssistantConversationHost engine={engine} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
