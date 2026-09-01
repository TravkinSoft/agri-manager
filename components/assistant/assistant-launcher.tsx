"use client";

import { Sparkles } from "lucide-react";
import { useAssistantShell } from "@/components/assistant/assistant-shell-provider";

export function AssistantLauncher({ visualV2 = false }: { visualV2?: boolean }) {
  const { enabled, isOpen, open } = useAssistantShell();

  if (!enabled) return null;
  if (isOpen) return null;

  if (visualV2) {
    return (
      <button
        type="button"
        onClick={open}
        aria-label="Открыть Travkin Copilot"
        title="Travkin Copilot"
        data-copilot-launcher="separate"
        className="tf-focus-ring tf-motion fixed bottom-[calc(env(safe-area-inset-bottom)+6.25rem)] right-4 z-40 flex min-h-11 items-center gap-2 rounded-[var(--tf-radius-pill)] border border-[color:var(--tf-accent-bright)] bg-[var(--tf-accent-primary)] px-3.5 py-2 text-sm font-semibold text-[color:var(--tf-accent-on-primary)] shadow-[var(--tf-shadow-floating)] hover:-translate-y-0.5 md:bottom-5 md:right-5"
      >
        <Sparkles aria-hidden="true" className="h-4 w-4" />
        <span>Copilot</span>
      </button>
    );
  }

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
