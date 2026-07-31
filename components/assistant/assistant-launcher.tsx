"use client";

import { Sparkles } from "lucide-react";
import { useAssistantShell } from "@/components/assistant/assistant-shell-provider";

export function AssistantLauncher() {
  const { enabled, isOpen, open, access } = useAssistantShell();

  const canShowLauncher = enabled || access.status !== "denied" || Boolean(access.message);
  if (!canShowLauncher) return null;
  if (isOpen) return null;

  return (
    <div
      className="fixed bottom-0 right-0 z-40 hidden h-[30vh] w-8 md:block"
      onPointerEnter={open}
      onMouseEnter={open}
      onMouseMove={open}
    >
      <button
        type="button"
        onPointerEnter={open}
        onMouseEnter={open}
        onMouseMove={open}
        onFocus={open}
        onClick={open}
        aria-label="Открыть Travkin Copilot"
        title="Travkin Copilot"
        className="absolute inset-y-0 right-0 flex w-6 items-center justify-center border-l border-[#E0B100]/0 bg-[#E0B100]/0 text-[#E0B100]/0 transition duration-150 hover:border-[#E0B100]/45 hover:bg-[#E0B100]/10 hover:text-[#E0B100]"
      >
        <span className="flex h-9 w-5 items-center justify-center rounded-l-full bg-[#0F141E]/0 transition hover:bg-[#0F141E]/75">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
      </button>
    </div>
  );
}
