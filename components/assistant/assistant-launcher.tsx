"use client";

import { Bot, Bug, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAssistantShell } from "@/components/assistant/assistant-shell-provider";

export function AssistantLauncher() {
  const {
    enabled,
    isOpen,
    toggle,
    debugMonitorEnabled,
    debugMonitorOpen,
    toggleDebugMonitor,
  } = useAssistantShell();

  if (!enabled) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
      {debugMonitorEnabled ? (
        <Button
          type="button"
          variant={debugMonitorOpen ? "secondary" : "outline"}
          size="sm"
          onClick={toggleDebugMonitor}
          className="pointer-events-auto rounded-full"
        >
          <Bug className="mr-1.5 h-3.5 w-3.5" />
          Debug
        </Button>
      ) : null}

      <Button
        type="button"
        onClick={toggle}
        className={cn(
          "pointer-events-auto h-12 rounded-full px-4 shadow-lg transition-all",
          isOpen
            ? "bg-slate-800 text-white hover:bg-slate-700"
            : "bg-green-600 text-white hover:bg-green-500"
        )}
      >
        {isOpen ? (
          <Bot className="mr-2 h-4 w-4" />
        ) : (
          <MessageSquare className="mr-2 h-4 w-4" />
        )}
        {isOpen ? "Помощник" : "AI-помощник"}
      </Button>
    </div>
  );
}
