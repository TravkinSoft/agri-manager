"use client";

import { Bug, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssistantShell } from "@/components/assistant/assistant-shell-provider";

export function AssistantLauncher() {
  const { enabled, isOpen, open, debugMonitorEnabled, debugMonitorOpen, toggleDebugMonitor } = useAssistantShell();

  if (!enabled) return null;
  if (isOpen) return null;

  return (
    <div className="pointer-events-none fixed inset-y-0 right-0 z-40 hidden items-center md:flex">
      {debugMonitorEnabled ? (
        <Button
          type="button"
          variant={debugMonitorOpen ? "secondary" : "outline"}
          size="sm"
          onClick={toggleDebugMonitor}
          className="pointer-events-auto absolute bottom-6 right-4 rounded-full border-[#334058] bg-[#151C28] text-[#E5E7EB] hover:bg-[#202738]"
        >
          <Bug className="mr-1.5 h-3.5 w-3.5" />
          Debug
        </Button>
      ) : null}

      <button
        type="button"
        onPointerEnter={open}
        onMouseEnter={open}
        onMouseMove={open}
        onFocus={open}
        onClick={open}
        aria-label="Открыть Travkin Copilot"
        title="Travkin Copilot"
        className="pointer-events-auto flex h-40 w-8 items-center justify-center rounded-l-2xl border border-r-0 border-[#2A3448] bg-[#0F141E]/85 text-[#E0B100] shadow-[0_18px_42px_rgba(0,0,0,0.28)] backdrop-blur transition hover:w-10 hover:border-[#E0B100]/60 hover:bg-[#151C28]"
      >
        <span className="flex -rotate-90 items-center gap-2 whitespace-nowrap text-xs font-semibold tracking-wide">
          <Sparkles className="h-3.5 w-3.5" />
          Copilot
        </span>
      </button>
    </div>
  );
}
