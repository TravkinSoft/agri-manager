import { readFile, stat } from "fs/promises";
import path from "path";
import type { AssistantIntentName, AssistantUiContext } from "@/lib/assistant/engine/types";

const KB_FILE_NAME = "TRAVKIN_COPILOT_SEMANTIC_KNOWLEDGE_BASE.md";
const KB_FILE_PATH = path.join(process.cwd(), KB_FILE_NAME);

const MAX_SECTIONS = 4;
const MAX_QUESTIONS = 6;
const MAX_SECTION_CHARS = 700;
const MAX_CONTEXT_CHARS = 4600;

type Section = {
  title: string;
  content: string;
};

type SemanticSnapshot = {
  text: string;
  sections: Section[];
  questions: string[];
  loadedAt: string;
};

type BuildSemanticMemoryParams = {
  message: string;
  mode: "erp_data" | "agro_knowledge" | "mixed" | "navigation";
  intentName: AssistantIntentName | null;
  runtimeContext: AssistantUiContext;
};

export type SemanticMemoryContext = {
  source: "file" | "fallback";
  file: string;
  sectionTitles: string[];
  questionExamples: string[];
  contextText: string;
};

const SLANG_ALIAS_MAP: Record<string, string[]> = {
  "картошка": ["картофель", "potato"],
  "картофеля": ["картофель", "potato"],
  "химия": ["сзр", "pesticide"],
  "солярка": ["дизель", "fuel"],
  "горючка": ["гсм", "fuel"],
  "аммиачка": ["селитра", "ammonium nitrate"],
  "диамофос": ["диаммофоска", "dap"],
  "диаммофос": ["диаммофоска", "dap"],
  "овощной": ["овощной склад", "vegetable warehouse"],
  "семенной": ["склад семян", "seed warehouse"],
  "зерновой": ["зерновой склад", "grain warehouse"],
  "гала": ["gala"],
  "сорая": ["soraya"],
  "балтик роуз": ["baltic rose"],
  "азилит": ["azilit"],
  "коломбо": ["colombo"],
  "импала": ["impala"],
};

const INTENT_SECTION_HINTS: Record<AssistantIntentName, string[]> = {
  company_context: ["1.2 Core Operational Principles", "6. ERP -> Tool Map"],
  fields_overview: ["3.1 Поля", "4.1 Fields Summary Template", "6. ERP -> Tool Map"],
  crop_structure_overview: ["3.2 Структура посевов", "4.2 Crop Structure Summary Template", "6. ERP -> Tool Map"],
  inventory_balance: ["3.4 Склады и остатки", "4.4 Warehouse Balance Template", "6. ERP -> Tool Map"],
  warehouse_movements: ["3.4 Склады и остатки", "6. ERP -> Tool Map"],
  weighbridge_tickets: ["3.5 Весовая и талоны", "4.5 Weighbridge Template", "6. ERP -> Tool Map"],
  operations_recent: ["3.6 Операции", "4.6 Operations Template", "6. ERP -> Tool Map"],
  fuel_balance: ["3.7 Материалы, удобрения, СЗР", "4.8 Fuel Balance Template", "6. ERP -> Tool Map"],
  fuel_movements: ["3.7 Материалы, удобрения, СЗР", "6. ERP -> Tool Map"],
  entity_resolution: ["3.1 Поля", "3.4 Склады и остатки", "6. ERP -> Tool Map"],
  navigation_help: ["6. ERP -> Tool Map", "5. Default Decision Tree"],
  create_draft: ["1.2 Core Operational Principles", "6. ERP -> Tool Map"],
  clarification_required: ["5. Default Decision Tree"],
  warehouse_count: ["3.4 Склады и остатки", "4.4 Warehouse Balance Template", "6. ERP -> Tool Map"],
  crop_structure_area: ["3.2 Структура посевов", "4.2 Crop Structure Summary Template", "6. ERP -> Tool Map"],
  field_total_area: ["3.1 Поля", "4.1 Fields Summary Template", "6. ERP -> Tool Map"],
  rotation_history: ["3.1 Поля", "5. Default Decision Tree", "6. ERP -> Tool Map"],
  general_question: ["1.2 Core Operational Principles", "5. Default Decision Tree"],
};

const PAGE_HINTS: Record<string, string[]> = {
  "weighbridge": ["3.5 Весовая и талоны", "4.5 Weighbridge Template"],
  "warehouses": ["3.4 Склады и остатки", "4.4 Warehouse Balance Template"],
  "crop-structure": ["3.2 Структура посевов", "4.2 Crop Structure Summary Template"],
  "fields": ["3.1 Поля", "4.1 Fields Summary Template"],
  "operations": ["3.6 Операции", "4.6 Operations Template"],
  "land-legal": ["3.10 Кадастр и право", "4.9 Legal Coverage Template"],
  "analytics": ["3.11 Отчеты и аналитика", "6. ERP -> Tool Map"],
};

let snapshotCache: {
  mtimeMs: number;
  source: "file" | "fallback";
  snapshot: SemanticSnapshot;
} | null = null;

function cleanString(value: unknown): string | null {
  const text = String(value || "").trim();
  return text.length > 0 ? text : null;
}

function normalize(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[.,!?;:()"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((token) => token.length > 2);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function parseSections(markdown: string): Section[] {
  const regex = /^##\s+(.+)$/gm;
  const matches = Array.from(markdown.matchAll(regex));
  if (!matches.length) return [];

  const sections: Section[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    const title = cleanString(current[1]) || `section-${i + 1}`;
    const start = (current.index || 0) + current[0].length;
    const end = next?.index ?? markdown.length;
    const content = cleanString(markdown.slice(start, end)) || "";
    sections.push({ title, content });
  }
  return sections;
}

function parseQuestions(markdown: string): string[] {
  const regex = /^Q\d{3}\.\s*(.+)$/gm;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const line = cleanString(match[1]);
    if (line) out.push(line);
  }
  return out;
}

function buildFallbackSnapshot(): SemanticSnapshot {
  const text = [
    "Core principles: Operation != Issue; Issue != Consumption; READY does not deduct stock; ISSUED deducts stock; Field card shows fact only.",
    "Default routing: if season missing use 2026, if warehouse missing for balance query search all warehouses.",
    "Critical entities: Field, Crop Structure, Operation, Material Request, Issue, Fact, Harvest, Warehouse, Batch, Ledger.",
  ].join("\n");

  return {
    text,
    sections: [
      { title: "1.2 Core Operational Principles", content: text },
      { title: "5. Default Decision Tree", content: "Use safe defaults first, clarify only when ambiguity affects correctness." },
      { title: "6. ERP -> Tool Map", content: "ERP data questions must go through backend tools and company scope." },
    ],
    questions: [],
    loadedAt: new Date().toISOString(),
  };
}

async function loadSemanticSnapshot(): Promise<{ source: "file" | "fallback"; snapshot: SemanticSnapshot }> {
  try {
    const fileStat = await stat(KB_FILE_PATH);
    if (snapshotCache && snapshotCache.mtimeMs === fileStat.mtimeMs) {
      return { source: snapshotCache.source, snapshot: snapshotCache.snapshot };
    }

    const markdown = await readFile(KB_FILE_PATH, "utf8");
    const snapshot: SemanticSnapshot = {
      text: markdown,
      sections: parseSections(markdown),
      questions: parseQuestions(markdown),
      loadedAt: new Date().toISOString(),
    };

    snapshotCache = {
      mtimeMs: fileStat.mtimeMs,
      source: "file",
      snapshot,
    };
    return { source: "file", snapshot };
  } catch {
    const snapshot = buildFallbackSnapshot();
    snapshotCache = {
      mtimeMs: -1,
      source: "fallback",
      snapshot,
    };
    return { source: "fallback", snapshot };
  }
}

function scoreSection(params: {
  section: Section;
  tokens: string[];
  hints: string[];
  mode: BuildSemanticMemoryParams["mode"];
}): number {
  const { section, tokens, hints, mode } = params;
  const title = normalize(section.title);
  const body = normalize(section.content.slice(0, 2600));
  let score = 0;

  for (const token of tokens) {
    if (title.includes(token)) score += 5;
    if (body.includes(token)) score += 2;
  }

  for (const hint of hints) {
    const normHint = normalize(hint);
    if (!normHint) continue;
    if (title.includes(normHint)) score += 8;
    else if (body.includes(normHint)) score += 3;
  }

  if (mode === "agro_knowledge" && (title.includes("агроном") || title.includes("mixed"))) score += 3;
  if (mode === "navigation" && title.includes("tool map")) score += 3;

  return score;
}

function trimSectionContent(content: string): string {
  const text = cleanString(content) || "";
  if (text.length <= MAX_SECTION_CHARS) return text;
  return `${text.slice(0, MAX_SECTION_CHARS - 3)}...`;
}

function pickSections(params: {
  sections: Section[];
  tokens: string[];
  intentName: AssistantIntentName | null;
  currentPage: string;
  mode: BuildSemanticMemoryParams["mode"];
}): Section[] {
  const { sections, tokens, intentName, currentPage, mode } = params;

  const hints = uniqueStrings([
    "1.2 Core Operational Principles",
    "6. ERP -> Tool Map",
    ...(intentName ? INTENT_SECTION_HINTS[intentName] || [] : []),
    ...(PAGE_HINTS[normalize(currentPage)] || []),
  ]);

  const scored = sections
    .map((section) => ({
      section,
      score: scoreSection({ section, tokens, hints, mode }),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const mandatory = sections.filter((section) => {
    const title = normalize(section.title);
    return title.includes("1.2 core operational principles") || title.includes("6. erp -> tool map");
  });

  const selected: Section[] = [];
  for (const section of mandatory) {
    if (!selected.some((item) => item.title === section.title)) {
      selected.push(section);
    }
  }

  for (const row of scored) {
    if (selected.length >= MAX_SECTIONS) break;
    if (!selected.some((item) => item.title === row.section.title)) {
      selected.push(row.section);
    }
  }

  return selected.slice(0, MAX_SECTIONS);
}

function pickQuestions(questions: string[], tokens: string[]): string[] {
  if (!questions.length || !tokens.length) return [];
  const scored = questions
    .map((question) => {
      const text = normalize(question);
      const score = tokens.reduce((acc, token) => acc + (text.includes(token) ? 1 : 0), 0);
      return { question, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_QUESTIONS)
    .map((row) => row.question);

  return uniqueStrings(scored);
}

export function applySemanticExpansions(input: string): string {
  const source = cleanString(input) || "";
  if (!source) return "";

  const normText = ` ${normalize(source)} `;
  const expansions = new Set<string>();

  for (const [alias, mapped] of Object.entries(SLANG_ALIAS_MAP)) {
    if (normText.includes(` ${normalize(alias)} `)) {
      mapped.forEach((entry) => {
        const normalizedEntry = normalize(entry);
        if (normalizedEntry && !normText.includes(` ${normalizedEntry} `)) {
          expansions.add(entry);
        }
      });
    }
  }

  if (!expansions.size) return source;
  return `${source} ${Array.from(expansions).join(" ")}`.trim();
}

export async function buildSemanticMemoryContext(
  params: BuildSemanticMemoryParams
): Promise<SemanticMemoryContext> {
  const { source, snapshot } = await loadSemanticSnapshot();
  const expandedMessage = applySemanticExpansions(params.message);
  const tokens = uniqueStrings([
    ...tokenize(expandedMessage),
    ...tokenize(params.runtimeContext.currentPage || ""),
    ...(params.runtimeContext.season ? [normalize(params.runtimeContext.season)] : []),
  ]);

  const selectedSections = pickSections({
    sections: snapshot.sections,
    tokens,
    intentName: params.intentName,
    currentPage: params.runtimeContext.currentPage || "",
    mode: params.mode,
  });
  const questionExamples = pickQuestions(snapshot.questions, tokens);

  const sectionBlocks = selectedSections.map((section) => {
    return `[${section.title}]\n${trimSectionContent(section.content)}`;
  });

  const lines: string[] = [];
  lines.push(`Semantic memory source: ${KB_FILE_NAME}`);
  lines.push(
    `Context: page=${params.runtimeContext.currentPage || "-"}, season=${params.runtimeContext.season || "-"}, intent=${
      params.intentName || "-"
    }, mode=${params.mode}`
  );
  if (sectionBlocks.length) {
    lines.push("Relevant knowledge sections:");
    lines.push(sectionBlocks.join("\n\n"));
  }
  if (questionExamples.length) {
    lines.push("Relevant user question patterns:");
    lines.push(questionExamples.slice(0, MAX_QUESTIONS).map((q) => `- ${q}`).join("\n"));
  }

  const raw = lines.join("\n\n").trim();
  const contextText = raw.length > MAX_CONTEXT_CHARS ? `${raw.slice(0, MAX_CONTEXT_CHARS - 3)}...` : raw;

  return {
    source,
    file: KB_FILE_NAME,
    sectionTitles: selectedSections.map((section) => section.title),
    questionExamples: questionExamples.slice(0, MAX_QUESTIONS),
    contextText,
  };
}
