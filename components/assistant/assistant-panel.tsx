"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Bot, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AssistantConversationHost } from "@/components/assistant/assistant-conversation-host";
import { useAssistantShell } from "@/components/assistant/assistant-shell-provider";
import { defaultAssistantPanelEngine } from "@/lib/assistant/panel-engine";

export function AssistantPanel() {
  const {
    enabled,
    isOpen,
    close,
    open,
    runtimeContext,
    access,
    debugMonitorEnabled,
    debugMonitorOpen,
    toggleDebugMonitor,
    panelWidth,
    setPanelWidth,
  } = useAssistantShell();
  const engine = defaultAssistantPanelEngine;
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [exportChatEnabled, setExportChatEnabled] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);

  useEffect(() => {
    const stateHandler = (event: Event) => {
      const custom = event as CustomEvent<{ enabled?: boolean }>;
      setExportChatEnabled(Boolean(custom.detail?.enabled));
    };
    window.addEventListener("travkin:assistant-export-state", stateHandler);
    return () => window.removeEventListener("travkin:assistant-export-state", stateHandler);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobileView(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (contentRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [close, isOpen]);

  const clampPanelWidth = useCallback((width: number) => {
    if (typeof window === "undefined") return Math.min(920, Math.max(360, width));
    const maxByViewport = Math.max(380, Math.floor(window.innerWidth * 0.5));
    return Math.min(maxByViewport, 920, Math.max(360, Math.round(width)));
  }, []);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isMobileView) return;
      event.preventDefault();
      const onMove = (moveEvent: PointerEvent) => {
        setPanelWidth(clampPanelWidth(window.innerWidth - moveEvent.clientX));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    },
    [clampPanelWidth, isMobileView, setPanelWidth]
  );

  if (!enabled) return null;

  const onExportChat = () => {
    window.dispatchEvent(new CustomEvent("travkin:assistant-export-trigger"));
  };
  const seasonLabel = runtimeContext.season || runtimeContext.defaultSeason || "2026";
  const contextLabel = [runtimeContext.companyName, seasonLabel, access.role].filter(Boolean).join(" · ");

  return (
    <Sheet modal={false} open={isOpen} onOpenChange={(next) => (next ? open() : close())}>
      <SheetContent
        ref={contentRef}
        forceMount
        side={isMobileView ? "bottom" : "right"}
        showOverlay={false}
        showClose={false}
        onPointerDownOutside={() => close()}
        onInteractOutside={() => close()}
        onEscapeKeyDown={() => close()}
        className={
          isMobileView
            ? "travkin-scrollbar h-[82vh] w-full max-w-none rounded-t-2xl border-[#262D3D] bg-[#11151E] p-0"
            : "travkin-scrollbar max-w-[50vw] border-[#262D3D] bg-[#11151E] p-0 shadow-2xl"
        }
        style={
          isMobileView
            ? undefined
            : {
                width: `${clampPanelWidth(panelWidth)}px`,
                minWidth: "360px",
              }
        }
      >
        {!isMobileView ? (
          <div
            role="separator"
            aria-orientation="vertical"
            title="Потяните, чтобы изменить ширину"
            onPointerDown={startResize}
            onDoubleClick={() => setPanelWidth(520)}
            className="group absolute inset-y-0 left-0 z-10 w-3 cursor-col-resize"
          >
            <div className="mx-auto h-full w-px bg-[#263247] transition group-hover:bg-[#E0B100]" />
          </div>
        ) : null}
        <div className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b border-[#262D3D] bg-[#10151F] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center text-[#E0B100]">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <SheetTitle className="truncate text-lg font-semibold text-[#F3F4F6]">Travkin Copilot</SheetTitle>
                  <div className="mt-0.5 truncate text-xs text-[#94A3B8]">{contextLabel || "Контекст загружается"}</div>
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
                  Export
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
