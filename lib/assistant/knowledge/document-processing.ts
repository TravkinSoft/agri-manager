import ExcelJS from "exceljs";
import { getKnowledgeExtension, isSupportedKnowledgeExtension } from "@/lib/assistant/knowledge/document-types";

export type ExtractedKnowledgeDocument = {
  text: string;
  metadata: Record<string, unknown>;
};

export type KnowledgeChunk = {
  index: number;
  content: string;
  metadata: Record<string, unknown>;
};

const MAX_TEXT_CHARS = 500_000;
const MAX_CHUNK_CHARS = 1_800;
const CHUNK_OVERLAP_CHARS = 180;

function cleanText(value: string): string {
  return String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function extractTxt(buffer: Buffer): Promise<ExtractedKnowledgeDocument> {
  return {
    text: cleanText(buffer.toString("utf8")).slice(0, MAX_TEXT_CHARS),
    metadata: { extractor: "text/plain" },
  };
}

async function extractPdf(buffer: Buffer): Promise<ExtractedKnowledgeDocument> {
  const mod = await import("pdf-parse/lib/pdf-parse.js");
  const parsePdf = (mod.default || mod) as (input: Buffer) => Promise<{ text?: string; numpages?: number; info?: unknown }>;
  const parsed = await parsePdf(buffer);
  return {
    text: cleanText(parsed.text || "").slice(0, MAX_TEXT_CHARS),
    metadata: {
      extractor: "pdf-parse",
      pages: Number.isFinite(Number(parsed.numpages)) ? Number(parsed.numpages) : null,
    },
  };
}

async function extractDocx(buffer: Buffer): Promise<ExtractedKnowledgeDocument> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) return { text: "", metadata: { extractor: "docx-xml", warning: "word/document.xml not found" } };

  const withBreaks = documentXml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n");
  const text = decodeXmlEntities(withBreaks.replace(/<[^>]+>/g, " "));
  return {
    text: cleanText(text).slice(0, MAX_TEXT_CHARS),
    metadata: { extractor: "docx-xml" },
  };
}

async function extractXlsx(buffer: Buffer): Promise<ExtractedKnowledgeDocument> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sections: string[] = [];
  const sheets: Array<{ name: string; rows: number }> = [];

  workbook.worksheets.forEach((sheet) => {
    const rows: string[] = [];
    sheet.eachRow((row, rowNumber) => {
      const values = row.values as unknown[];
      const cells = values
        .slice(1)
        .map((value) => {
          if (value == null) return "";
          if (typeof value === "object") {
            const record = value as Record<string, unknown>;
            return String(record.text || record.result || record.richText || JSON.stringify(value));
          }
          return String(value);
        })
        .map((value) => value.trim())
        .filter(Boolean);
      if (cells.length) rows.push(`${rowNumber}: ${cells.join(" | ")}`);
    });
    sheets.push({ name: sheet.name, rows: rows.length });
    if (rows.length) sections.push(`Sheet: ${sheet.name}\n${rows.join("\n")}`);
  });

  return {
    text: cleanText(sections.join("\n\n")).slice(0, MAX_TEXT_CHARS),
    metadata: { extractor: "exceljs", sheets },
  };
}

export async function extractKnowledgeDocument(params: {
  filename: string;
  mimeType?: string | null;
  buffer: Buffer;
}): Promise<ExtractedKnowledgeDocument> {
  const extension = getKnowledgeExtension(params.filename);
  if (!isSupportedKnowledgeExtension(extension)) {
    throw new Error(`Unsupported knowledge document format .${extension || "unknown"}`);
  }

  if (extension === "txt") return extractTxt(params.buffer);
  if (extension === "pdf") return extractPdf(params.buffer);
  if (extension === "docx") return extractDocx(params.buffer);
  if (extension === "xlsx") return extractXlsx(params.buffer);

  return { text: "", metadata: { extractor: "none", mimeType: params.mimeType || null } };
}

function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= MAX_CHUNK_CHARS) return [paragraph];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < paragraph.length) {
    const end = Math.min(paragraph.length, cursor + MAX_CHUNK_CHARS);
    chunks.push(paragraph.slice(cursor, end).trim());
    if (end >= paragraph.length) break;
    cursor = Math.max(0, end - CHUNK_OVERLAP_CHARS);
  }
  return chunks.filter(Boolean);
}

export function chunkKnowledgeText(text: string): KnowledgeChunk[] {
  const paragraphs = cleanText(text)
    .split(/\n{2,}/)
    .flatMap((paragraph) => splitLongParagraph(paragraph.trim()))
    .filter(Boolean);

  const chunks: KnowledgeChunk[] = [];
  let current = "";
  let startParagraph = 0;

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= MAX_CHUNK_CHARS) {
      if (!current) startParagraph = paragraphIndex;
      current = next;
      return;
    }

    if (current) {
      chunks.push({
        index: chunks.length,
        content: current,
        metadata: { paragraph_start: startParagraph, paragraph_end: paragraphIndex - 1 },
      });
    }
    startParagraph = paragraphIndex;
    current = paragraph;
  });

  if (current) {
    chunks.push({
      index: chunks.length,
      content: current,
      metadata: { paragraph_start: startParagraph, paragraph_end: paragraphs.length - 1 },
    });
  }

  return chunks;
}
