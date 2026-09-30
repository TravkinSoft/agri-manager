export type AssistantSurfaceKind = "legacy_persistent_chat" | "tool_first_panel";

export type AssistantPanelEngineConfig = {
  id: string;
  surface: AssistantSurfaceKind;
  supports: {
    runtimeContext: boolean;
    navigationActions: boolean;
    actionCenter: boolean;
    voiceMode: boolean;
    notifications: boolean;
  };
};

export const defaultAssistantPanelEngine: AssistantPanelEngineConfig = {
  id: "assistant-engine-v2",
  surface: "tool_first_panel",
  supports: {
    runtimeContext: true,
    navigationActions: true,
    actionCenter: true,
    voiceMode: false,
    notifications: false,
  },
};
