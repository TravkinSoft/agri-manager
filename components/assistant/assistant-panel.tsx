"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Bot } from "lucide-react";
import { AssistantConversationHost } from "@/components/assistant/assistant-conversation-host";
import { useAssistantShell } from "@/components/assistant/assistant-shell-provider";
import { defaultAssistantPanelEngine } from "@/lib/assistant/panel-engine";

export function AssistantPanel() {
  const {
    enabled,
    isOpen,
    close,
    runtimeContext,
    access,
    debugMonitorEnabled,
    debugMonitorOpen,
    panelWidth,
    setPanelWidth,
  } = useAssistantShell();
  const engine = defaultAssistantPanelEngine;
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [isMobileView, setIsMobileView] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const getViewportWidth = useCallback(() => {
    const maybeWindow =
      typeof globalThis === "object" && "window" in globalThis
        ? (globalThis as typeof globalThis & { window?: Window }).window
        : undefined;
    return typeof maybeWindow?.innerWidth === "number" ? maybeWindow.innerWidth : null;
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

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, isOpen]);

  const clampPanelWidth = useCallback((width: number) => {
    const viewport = getViewportWidth();
    if (!viewport) return Math.min(960, Math.max(360, width));
    const maxByViewport = Math.min(Math.max(640, Math.floor(viewport * 0.5)), Math.max(420, viewport - 260), 1120);
    return Math.min(maxByViewport, Math.max(360, Math.round(width)));
  }, [getViewportWidth]);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isMobileView) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setIsResizing(true);

      const onMove = (moveEvent: PointerEvent) => {
        setPanelWidth(clampPanelWidth((getViewportWidth() || 0) - moveEvent.clientX));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setIsResizing(false);
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    },
    [clampPanelWidth, getViewportWidth, isMobileView, setPanelWidth]
  );

  if (!enabled) return null;
  const seasonLabel = runtimeContext.season || runtimeContext.defaultSeason || "2026";
  const contextLabel = [runtimeContext.companyName, seasonLabel, access.role].filter(Boolean).join(" · ");
  const width = clampPanelWidth(panelWidth);
  const maxWidth = clampPanelWidth(1120);
  const hiddenInteractionProps = !isOpen ? ({ inert: "" } as Record<string, string>) : {};

  return (
    <aside
      {...hiddenInteractionProps}
      ref={contentRef}
      role="dialog"
      aria-label="Travkin Copilot"
      aria-hidden={!isOpen}
      className={
        isMobileView
          ? `fixed inset-x-0 bottom-0 z-50 h-[82vh] rounded-t-2xl border border-[#262D3D] bg-[#10151F] shadow-2xl transition-transform duration-200 ease-out ${
              isOpen ? "translate-y-0" : "translate-y-[calc(100%+24px)]"
            }`
          : `fixed inset-y-0 right-0 z-50 border-l border-[#262D3D] bg-[#10151F] shadow-[0_20px_70px_rgba(0,0,0,0.45)] transition-transform duration-200 ease-out ${
              isOpen ? "translate-x-0" : "translate-x-[calc(100%+24px)]"
            }`
      }
      style={
        isMobileView
          ? undefined
          : {
              width: `${width}px`,
              minWidth: "360px",
              maxWidth: `${maxWidth}px`,
              transitionProperty: isResizing ? "none" : "transform",
            }
      }
    >
      {!isMobileView ? (
        <div
          role="separator"
          aria-orientation="vertical"
          title="Потяните, чтобы изменить ширину"
          onPointerDown={startResize}
          onDoubleClick={() => setPanelWidth(clampPanelWidth(Math.floor((getViewportWidth() || 1280) * 0.5)))}
          className="group absolute -left-6 inset-y-0 z-10 w-12 cursor-col-resize touch-none"
        >
          <div className="mx-auto h-full w-px bg-[#263247] transition group-hover:w-1 group-hover:bg-[#E0B100]" />
          <div className="absolute left-1/2 top-1/2 hidden h-16 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#E0B100]/70 shadow-[0_0_18px_rgba(224,177,0,0.45)] group-hover:block" />
        </div>
      ) : null}

      <div className="flex h-full min-h-0 flex-col">
        <header className="border-b border-[#222C3E] bg-[#0F141E] px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#2A3448] bg-[#141B29] text-[#E0B100]">
                <Bot className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-[#F3F4F6]">Travkin Copilot</h2>
                <p className="sr-only">
                  Панель ассистента TravkinFlow для вопросов, проверки данных ERP и подготовки действий с подтверждением.
                </p>
                <div className="mt-0.5 truncate text-xs text-[#94A3B8]">{contextLabel || "Контекст загружается"}</div>
              </div>
            </div>
          </div>
        </header>

        <div className="assistant-surface min-h-0 flex-1 overflow-hidden bg-[#0D121B] px-3 py-3">
          <AssistantConversationHost engine={engine} />
        </div>
      </div>
    </aside>
  );
}
