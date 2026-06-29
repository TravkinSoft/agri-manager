import { NextRequest, NextResponse } from "next/server";
import { isIP } from "node:net";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

const URL_SOURCE_TYPES = new Set([
  "manufacturer_page",
  "manufacturer_pdf",
  "registration_database",
  "distributor_page",
]);

const MAX_HTML_BYTES = 1_500_000;
const MAX_EXTRACTED_CHARS = 16_000;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_EXTRACTED_CHARS = 40_000;
const MAX_REDIRECTS = 5;

type SourceKind = "product_leaflet" | "crop_care_program" | "unknown";

type FetchResult = {
  response: Response;
  finalUrl: URL;
};

type ExtractedSourceText = {
  text: string;
  sourceKind: SourceKind;
  finalUrl: string;
};

const DEFAULT_FETCH_HEADERS = {
  Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
  "User-Agent": "TravkinFlow-KnowledgeIntake/0.1 (+https://agri-manager-eight.vercel.app)",
};

const BROWSER_LIKE_FETCH_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
};

const PDF_FETCH_HEADERS = {
  Accept: "application/pdf,text/html;q=0.2,text/plain;q=0.1,*/*;q=0.1",
  "User-Agent": DEFAULT_FETCH_HEADERS["User-Agent"],
};

const PDF_BROWSER_LIKE_FETCH_HEADERS = {
  ...BROWSER_LIKE_FETCH_HEADERS,
  Accept: "application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function jsonAuthError(error: unknown) {
  if (error instanceof SessionAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}

async function requireGlobalAdmin(request: NextRequest) {
  const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
  if (actor.role !== "global_admin") {
    throw new SessionAuthError("Only global admin can fetch knowledge source text", 403);
  }
  return actor;
}

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

function assertSafeFetchUrl(parsed: URL) {
  const hostname = parsed.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (["localhost", "127.0.0.1", "::1"].includes(hostname) || hostname.endsWith(".local")) {
    throw new Error("Нельзя извлекать текст из локальных или внутренних адресов.");
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4 && isPrivateIpv4(hostname)) {
    throw new Error("Нельзя извлекать текст из приватных IP-адресов.");
  }
  if (ipVersion === 6) {
    throw new Error("IPv6/IP literal источники отключены в V0.");
  }
}

function looksLikePdf(parsed: URL, contentType: string) {
  return /application\/pdf/i.test(contentType) || /\.pdf($|\?)/i.test(parsed.pathname);
}

function normalizeExtractedText(value: string, maxChars: number): string {
  return value
    .replace(/\r/g, "\n")
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 2)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

function countSignals(value: string, signals: string[]) {
  return signals.reduce((count, signal) => (value.includes(signal) ? count + 1 : count), 0);
}

function detectPdfSourceKind(value: string): SourceKind {
  const normalized = value.toLocaleLowerCase("ru-RU");
  const productSignals = [
    "действующее вещество",
    "норма расхода",
    "регламент применения",
    "препаративная форма",
    "класс опасности",
    "срок ожидания",
    "л/га",
    "г/л",
    "фунгицид",
    "гербицид",
    "инсектицид",
  ];
  const programSignals = [
    "программа защиты",
    "комплексная программа",
    "схема защиты",
    "система защиты",
    "защита зерновых",
    "зерновых культур",
    "вредные объекты",
    "до посева",
    "начало вегетации",
    "середина вегетации",
    "конец вегетации",
    "bbch",
    "фаза развития",
  ];

  const productScore = countSignals(normalized, productSignals);
  const programScore = countSignals(normalized, programSignals);

  if (programScore >= 3 && programScore >= productScore) return "crop_care_program";
  if (productScore >= 2) return "product_leaflet";
  if (programScore >= 2) return "crop_care_program";
  return "unknown";
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const numeric = Number(code);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : "";
    });
}

function extractReadableText(html: string): string {
  const cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(nav|header|footer|aside|form|button)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return normalizeExtractedText(decodeHtmlEntities(cleaned), MAX_EXTRACTED_CHARS);
}

async function fetchOnce(parsed: URL, headers: Record<string, string>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(parsed.toString(), {
      headers,
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Источник не ответил за 12 секунд.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSourceResponse(parsed: URL, headers: Record<string, string>): Promise<FetchResult> {
  let currentUrl = parsed;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    assertSafeFetchUrl(currentUrl);
    const response = await fetchOnce(currentUrl, headers);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { response, finalUrl: currentUrl };
      const nextUrl = new URL(location, currentUrl);
      if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
        throw new Error("Источник перенаправляет на неподдерживаемый URL.");
      }
      assertSafeFetchUrl(nextUrl);
      currentUrl = nextUrl;
      continue;
    }

    return { response, finalUrl: currentUrl };
  }

  throw new Error("Источник сделал слишком много перенаправлений.");
}

async function extractPdfText(response: Response, finalUrl: URL): Promise<ExtractedSourceText> {
  const contentType = response.headers.get("content-type") || "";
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (!looksLikePdf(finalUrl, contentType)) {
    throw new Error("PDF-источник должен быть прямой ссылкой на PDF-файл.");
  }
  if (contentLength > MAX_PDF_BYTES) {
    throw new Error("PDF слишком большой для V0 parser. Максимум: 10 MB.");
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_PDF_BYTES) {
    throw new Error("PDF слишком большой для V0 parser. Максимум: 10 MB.");
  }

  const pdfParseModule = await import("pdf-parse");
  const pdfParse = pdfParseModule.default || pdfParseModule;
  const parsedPdf = await pdfParse(Buffer.from(arrayBuffer));
  const extractedText = normalizeExtractedText(parsedPdf.text || "", MAX_PDF_EXTRACTED_CHARS);

  if (extractedText.length < 80) {
    throw new Error("Текст не найден. Возможно, PDF состоит из изображений. OCR будет позже.");
  }

  return {
    text: extractedText,
    sourceKind: detectPdfSourceKind(extractedText),
    finalUrl: finalUrl.toString(),
  };
}

async function extractHtmlText(response: Response, finalUrl: URL): Promise<ExtractedSourceText> {
  const contentType = response.headers.get("content-type") || "";
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_HTML_BYTES) {
    throw new Error("Источник слишком большой для V0 text fetcher.");
  }
  if (looksLikePdf(finalUrl, contentType)) {
    throw new Error("Это PDF-ссылка. Выберите тип источника «PDF производителя» и повторите извлечение.");
  }
  if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
    throw new Error("Источник не похож на HTML/text страницу. PDF/OCR будут отдельным этапом.");
  }

  const raw = await response.text();
  if (raw.length > MAX_HTML_BYTES) {
    throw new Error("Источник слишком большой для V0 text fetcher.");
  }

  const extractedText = contentType.includes("text/plain")
    ? normalizeExtractedText(raw, MAX_EXTRACTED_CHARS)
    : extractReadableText(raw);
  if (extractedText.length < 80) {
    throw new Error("Не удалось извлечь достаточно текста со страницы. Добавьте ручной текст источника.");
  }

  return {
    text: extractedText,
    sourceKind: "unknown",
    finalUrl: finalUrl.toString(),
  };
}

async function fetchSourceText(sourceUrl: string, sourceType: string): Promise<ExtractedSourceText> {
  const parsed = parseHttpUrl(sourceUrl);
  if (!parsed) throw new Error("source_url must be a valid http(s) URL");
  assertSafeFetchUrl(parsed);

  const isPdfSource = sourceType === "manufacturer_pdf";
  const firstFetch = await fetchSourceResponse(parsed, isPdfSource ? PDF_FETCH_HEADERS : DEFAULT_FETCH_HEADERS);
  const fetchResult =
    firstFetch.response.status === 403
      ? await fetchSourceResponse(parsed, isPdfSource ? PDF_BROWSER_LIKE_FETCH_HEADERS : BROWSER_LIKE_FETCH_HEADERS)
      : firstFetch;
  const { response, finalUrl } = fetchResult;

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("Сайт производителя блокирует автоматическое чтение. Добавьте ручной текст или PDF позже.");
    }
    throw new Error(`Источник вернул HTTP ${response.status}`);
  }

  return isPdfSource ? extractPdfText(response, finalUrl) : extractHtmlText(response, finalUrl);
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; sourceId: string } }
) {
  try {
    await requireGlobalAdmin(request);

    const runId = text(params?.id);
    const sourceId = text(params?.sourceId);
    if (!runId || !sourceId) {
      return NextResponse.json({ error: "run_id and source_id are required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data: source, error: sourceError } = await supabase
      .from("knowledge_intake_sources")
      .select("*")
      .eq("id", sourceId)
      .eq("run_id", runId)
      .maybeSingle();

    if (sourceError) throw new Error(sourceError.message);
    if (!source) return NextResponse.json({ error: "Knowledge intake source not found" }, { status: 404 });

    const sourceType = text(source.source_type);
    const sourceUrl = text(source.source_url);
    if (!URL_SOURCE_TYPES.has(sourceType)) {
      return NextResponse.json({ error: "Текст можно извлекать только из URL-источников." }, { status: 400 });
    }
    if (!sourceUrl) {
      return NextResponse.json({ error: "У источника нет URL." }, { status: 400 });
    }

    const extracted = await fetchSourceText(sourceUrl, sourceType);

    const { data: updatedSource, error: updateError } = await supabase
      .from("knowledge_intake_sources")
      .update({ extracted_text_summary: extracted.text })
      .eq("id", sourceId)
      .eq("run_id", runId)
      .select("*")
      .single();

    if (updateError || !updatedSource) {
      throw new Error(updateError?.message || "Failed to save extracted source text");
    }

    const { error: runError } = await supabase
      .from("knowledge_intake_runs")
      .update({ status: "needs_review" })
      .eq("id", runId)
      .neq("status", "matched");
    if (runError) throw new Error(runError.message);

    return NextResponse.json({
      source: updatedSource,
      extracted_text_length: extracted.text.length,
      source_kind: extracted.sourceKind,
      final_url: extracted.finalUrl,
    });
  } catch (error) {
    const authError = jsonAuthError(error);
    if (authError) return authError;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch source text" },
      { status: 500 }
    );
  }
}
