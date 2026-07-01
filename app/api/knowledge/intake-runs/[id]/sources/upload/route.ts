import { NextRequest, NextResponse } from "next/server";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 40_000;
const UPLOADED_SOURCE_TYPE = "uploaded_file";

type SourceKind = "product_leaflet" | "crop_care_program" | "unknown";

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
    throw new SessionAuthError("Only global admin can upload knowledge intake documents", 403);
  }
  return actor;
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

function detectSourceKind(value: string): SourceKind {
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

function looksLikePdf(fileName: string, contentType: string) {
  return /application\/pdf/i.test(contentType) || /\.pdf$/i.test(fileName);
}

function looksLikeText(fileName: string, contentType: string) {
  return /^text\/plain/i.test(contentType) || /\.txt$/i.test(fileName);
}

async function extractPdfText(arrayBuffer: ArrayBuffer) {
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = pdfParseModule.default || pdfParseModule;
  const parsedPdf = await pdfParse(Buffer.from(arrayBuffer));
  const extractedText = normalizeExtractedText(parsedPdf.text || "", MAX_EXTRACTED_CHARS);
  if (extractedText.length < 80) {
    throw new Error("Текст не найден. Возможно, PDF состоит из изображений. OCR будет позже.");
  }
  return extractedText;
}

function extractPlainText(arrayBuffer: ArrayBuffer) {
  const extractedText = normalizeExtractedText(new TextDecoder("utf-8").decode(arrayBuffer), MAX_EXTRACTED_CHARS);
  if (extractedText.length < 20) {
    throw new Error("В TXT-файле недостаточно текста для анализа.");
  }
  return extractedText;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireGlobalAdmin(request);

    const runId = text(params?.id);
    if (!runId) return NextResponse.json({ error: "run_id is required" }, { status: 400 });

    const formData = await request.formData();
    const file = formData.get("file");
    const sourceTitle = text(formData.get("source_title"));

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const fileName = text(file.name) || "uploaded-document";
    const contentType = text(file.type);

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Документ слишком большой. Максимум: 10 MB." }, { status: 400 });
    }
    if (!looksLikePdf(fileName, contentType) && !looksLikeText(fileName, contentType)) {
      return NextResponse.json(
        { error: "DOCX будет отдельным безопасным этапом. Сейчас поддержаны PDF и TXT." },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();
    const { data: run, error: runError } = await supabase
      .from("knowledge_intake_runs")
      .select("id,status")
      .eq("id", runId)
      .maybeSingle();

    if (runError) throw new Error(runError.message);
    if (!run) {
      return NextResponse.json(
        { error: "Проверка устарела или была удалена. Запустите проверку препарата заново." },
        { status: 404 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const extractedText = looksLikePdf(fileName, contentType)
      ? await extractPdfText(arrayBuffer)
      : extractPlainText(arrayBuffer);
    const sourceKind = looksLikePdf(fileName, contentType) ? detectSourceKind(extractedText) : "unknown";

    const { data: source, error: sourceError } = await supabase
      .from("knowledge_intake_sources")
      .insert({
        run_id: runId,
        source_type: UPLOADED_SOURCE_TYPE,
        source_url: null,
        source_title: sourceTitle || fileName,
        source_confidence: "medium",
        extracted_text_summary: extractedText,
      })
      .select("*")
      .single();

    if (sourceError || !source) {
      throw new Error(sourceError?.message || "Failed to save uploaded knowledge source");
    }

    const { count, error: countError } = await supabase
      .from("knowledge_intake_matches")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runId);
    if (countError) throw new Error(countError.message);

    const nextStatus = (count || 0) > 0 ? "matched" : "needs_review";
    const { data: updatedRun, error: updateError } = await supabase
      .from("knowledge_intake_runs")
      .update({ status: nextStatus })
      .eq("id", runId)
      .select("*")
      .single();

    if (updateError || !updatedRun) {
      throw new Error(updateError?.message || "Failed to update knowledge intake run");
    }

    return NextResponse.json({
      source,
      run: updatedRun,
      extracted_text_length: extractedText.length,
      source_kind: sourceKind,
    });
  } catch (error) {
    const authError = jsonAuthError(error);
    if (authError) return authError;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload knowledge source document" },
      { status: 500 }
    );
  }
}
