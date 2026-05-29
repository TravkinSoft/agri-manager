export type AssistantChatExportRole = "user" | "assistant" | "tool" | "system";

export type AssistantChatExportAction = {
  label: string;
  kind: "navigate" | "prompt";
};

export type AssistantChatExportMessage = {
  role: AssistantChatExportRole;
  content: string;
  createdAt: string;
  actions?: AssistantChatExportAction[];
};

export type AssistantChatExportContext = {
  companyName: string | null;
  season: string | null;
  userName: string | null;
};

export type AssistantChatExportFormat = "markdown" | "pdf" | "docx" | "share_link" | "knowledge_base";

export type AssistantChatExportPayload = {
  format: AssistantChatExportFormat;
  exportedAt?: Date;
  context: AssistantChatExportContext;
  messages: AssistantChatExportMessage[];
};

export type AssistantChatExportResult = {
  fileName: string;
  mimeType: string;
  content: string;
};

const DATE_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const TIME_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function formatDateStamp(value: Date): string {
  return DATE_FORMATTER.format(value);
}

function formatTimeStamp(value: Date): string {
  return TIME_FORMATTER.format(value);
}

function formatFileDate(value: Date): string {
  const date = formatDateStamp(value);
  const time = formatTimeStamp(value).slice(0, 5).replace(":", "");
  return `${date}-${time}`;
}

function formatMessageTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${formatDateStamp(parsed)} ${formatTimeStamp(parsed)}`;
}

function roleTitle(role: AssistantChatExportRole): "User" | "Assistant" {
  return role === "user" ? "User" : "Assistant";
}

export function createAssistantChatExportFileName(value: Date = new Date()): string {
  return `travkin-chat-${formatFileDate(value)}.md`;
}

export function buildAssistantChatMarkdownExport(payload: {
  exportedAt?: Date;
  context: AssistantChatExportContext;
  messages: AssistantChatExportMessage[];
}): string {
  const exportedAt = payload.exportedAt ?? new Date();
  const company = normalizeText(payload.context.companyName) || "Не указано";
  const season = normalizeText(payload.context.season) || "Не указано";
  const user = normalizeText(payload.context.userName) || "Не указано";
  const lines: string[] = [
    "# Travkin Copilot Chat Export",
    "",
    `Дата экспорта: ${formatDateStamp(exportedAt)} ${formatTimeStamp(exportedAt)}`,
    `Компания: ${company}`,
    `Сезон: ${season}`,
    `Пользователь: ${user}`,
    "",
    "---",
    "",
  ];

  payload.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .forEach((message) => {
      lines.push(`## ${roleTitle(message.role)}`);
      lines.push("");
      lines.push(`Timestamp: ${formatMessageTimestamp(message.createdAt)}`);
      lines.push("");
      lines.push(normalizeText(message.content) || "(empty)");

      const navigationActions = (message.actions || []).filter((action) => action.kind === "navigate");
      if (navigationActions.length > 0) {
        lines.push("");
        navigationActions.forEach((action) => {
          const label = normalizeText(action.label);
          if (label) {
            lines.push("[Action]");
            lines.push(label);
          }
        });
      }

      lines.push("");
      lines.push("---");
      lines.push("");
    });

  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildAssistantChatExport(payload: AssistantChatExportPayload): AssistantChatExportResult {
  const exportedAt = payload.exportedAt ?? new Date();

  switch (payload.format) {
    case "markdown":
      return {
        fileName: createAssistantChatExportFileName(exportedAt),
        mimeType: "text/markdown;charset=utf-8",
        content: buildAssistantChatMarkdownExport({
          exportedAt,
          context: payload.context,
          messages: payload.messages,
        }),
      };
    default:
      throw new Error(`Export format not implemented: ${payload.format}`);
  }
}
