"use client";

import { Sparkles } from "lucide-react";
import { useAssistantShell } from "@/components/assistant/assistant-shell-provider";

export function AssistantLauncher() {
  const { enabled, isOpen, open } = useAssistantShell();

  if (!enabled) return null;
  if (isOpen) return null;

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label="Открыть Travkin Copilot"
        title="Travkin Copilot"
        className="tf-manor-control tf-mobile-assistant-launcher fixed bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] right-[max(0.75rem,env(safe-area-inset-right))] z-40 flex h-11 w-11 items-center justify-center rounded-md border border-border bg-primary text-primary-foreground shadow-manor-md md:hidden"
      >
        <Sparkles className="h-4 w-4" />
      </button>
      <div
        className="tf-desktop-assistant-launcher fixed bottom-0 right-0 z-40 hidden h-[30vh] w-8 md:block"
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
          className="absolute inset-y-0 right-0 flex w-6 items-center justify-center border-l border-primary/0 bg-primary/0 text-primary/0 transition duration-150 hover:border-primary/45 hover:bg-primary/10 hover:text-primary"
        >
          <span className="flex h-9 w-5 items-center justify-center rounded-l-full bg-card/0 transition hover:bg-card/75">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>
    </>
  );
}
