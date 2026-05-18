"use client";

import { PersistentChatInterface } from "@/components/specialist/persistent-chat-interface";
import { AssistantChatPane } from "@/components/assistant/assistant-chat-pane";
import type { AssistantPanelEngineConfig } from "@/lib/assistant/panel-engine";
import { defaultAssistantPanelEngine } from "@/lib/assistant/panel-engine";
import { useAssistantShell } from "@/components/assistant/assistant-shell-provider";

export function AssistantConversationHost({
  engine = defaultAssistantPanelEngine,
}: {
  engine?: AssistantPanelEngineConfig;
}) {
  const { runtimeContext, session, access } = useAssistantShell();

  if (engine.surface === "tool_first_panel") {
    return (
      <div className="h-full min-h-0">
        <AssistantChatPane
          runtimeContext={runtimeContext}
          sessionId={session.sessionId}
          access={access}
        />
      </div>
    );
  }

  if (engine.surface !== "legacy_persistent_chat") {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border bg-white text-sm text-slate-500">
        Режим ассистента не сконфигурирован.
      </div>
    );
  }

  return (
    <div className="h-full min-h-0">
      <PersistentChatInterface
        embedded
        runtimeContext={runtimeContext}
        assistantSessionId={session.sessionId}
      />
    </div>
  );
}
