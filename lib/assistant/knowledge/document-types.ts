export const KNOWLEDGE_DOCUMENT_EXTENSIONS = ["pdf", "docx", "txt", "xlsx"] as const;

export type KnowledgeDocumentExtension = (typeof KNOWLEDGE_DOCUMENT_EXTENSIONS)[number];

export function getKnowledgeExtension(filename: string): string {
  return String(filename || "").split(".").pop()?.toLowerCase() || "";
}

export function isSupportedKnowledgeExtension(extension: string): extension is KnowledgeDocumentExtension {
  return (KNOWLEDGE_DOCUMENT_EXTENSIONS as readonly string[]).includes(extension);
}
