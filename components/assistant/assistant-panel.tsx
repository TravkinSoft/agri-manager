"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
      return "Отчеты";
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
  const [exportChatEnabled, setExportChatEnabled] = useState(false);

  useEffect(() => {
    const stateHandler = (event: Event) => {
      const custom = event as CustomEvent<{ enabled?: boolean }>;
      setExportChatEnabled(Boolean(custom.detail?.enabled));
    };
    window.addEventListener("travkin:assistant-export-state", stateHandler);
    return () => window.removeEventListener("travkin:assistant-export-state", stateHandler);
  }, []);

  if (!enabled) return null;

  const company = runtimeContext.companyName || "Компания не выбрана";
  const page = pageLabel(runtimeContext.currentPage);
  const season = runtimeContext.season || "сезон не указан";

  const onExportChat = () => {
    window.dispatchEvent(new CustomEvent("travkin:assistant-export-trigger"));
  };

  return (
    <Sheet modal={false} open={isOpen} onOpenChange={(next) => (next ? open() : close())}>
      <SheetContent
        side="right"
        showOverlay={false}
        forceMount
        className="travkin-scrollbar w-[min(980px,calc(100vw-1rem))] max-w-none border-[#262D3D] bg-[#11151E] p-0"
      >
        <div className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b border-[#262D3D] bg-[#121824] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle className="truncate text-lg font-semibold text-[#F3F4F6]">Travkin Copilot</SheetTitle>
                <div className="mt-1 truncate text-xs text-[#9CA3AF]">
                  {company} • {page} • {season}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!exportChatEnabled}
                  className="border-[#334058] bg-[#1A1F2B] text-[#E5E7EB] hover:bg-[#202738] disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={onExportChat}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Export Chat
                </Button>
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
            </div>
          </SheetHeader>

          <div className="assistant-surface min-h-0 flex-1 overflow-hidden bg-[#0F141E] px-3 py-3">
            <AssistantConversationHost engine={engine} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
