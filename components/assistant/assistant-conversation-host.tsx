"use client";

import { useEffect, useState } from "react";
import { PersistentChatInterface } from "@/components/specialist/persistent-chat-interface";
import { AssistantChatPane } from "@/components/assistant/assistant-chat-pane";
import type { AssistantPanelEngineConfig } from "@/lib/assistant/panel-engine";
import { defaultAssistantPanelEngine } from "@/lib/assistant/panel-engine";
import { useAssistantShell } from "@/components/assistant/assistant-shell-provider";
import { TfAssistHarvestPane } from "@/components/assistant/tf-assist-harvest-pane";

export function AssistantConversationHost({
  engine = defaultAssistantPanelEngine,
}: {
  engine?: AssistantPanelEngineConfig;
}) {
  const { runtimeContext, session, access } = useAssistantShell();
  const [tfAssistState, setTfAssistState] = useState<"loading" | "enabled" | "unavailable">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tf-assist/health", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => {
        if (!cancelled) setTfAssistState(body?.enabled === true ? "enabled" : "unavailable");
      })
      .catch(() => { if (!cancelled) setTfAssistState("unavailable"); });
    return () => { cancelled = true; };
  }, []);

  if (
    tfAssistState === "enabled" &&
    access.status === "ready" &&
    access.role === "global_admin" &&
    access.active &&
    !access.isImpersonating &&
    !access.roleIsLegacyAlias
  ) return <TfAssistHarvestPane />;

  const isTfAssistCandidate = access.role === "global_admin" && !access.isImpersonating && !access.roleIsLegacyAlias;
  if (isTfAssistCandidate) {
    return <div className="flex h-full items-center justify-center rounded-lg border border-border bg-card px-4 text-center text-sm text-muted-foreground">
      {tfAssistState === "loading" || access.status === "loading"
        ? "Загружаем защищённый режим TF Assist…"
        : "TF Assist временно недоступен. Обновите страницу и повторите запрос."}
    </div>;
  }

  if (engine.surface === "tool_first_panel") {
    return (
      <div className="h-full min-h-0">
        <AssistantChatPane runtimeContext={runtimeContext} sessionId={session.sessionId} access={access} />
      </div>
    );
  }

  if (engine.surface !== "legacy_persistent_chat") {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground">
        Режим ассистента не сконфигурирован.
      </div>
    );
  }

  return (
    <div className="h-full min-h-0">
      <PersistentChatInterface embedded runtimeContext={runtimeContext} assistantSessionId={session.sessionId} />
    </div>
  );
}
