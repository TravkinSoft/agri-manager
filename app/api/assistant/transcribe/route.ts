import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const LANGUAGE_MAP: Record<string, string> = {
  ru: "ru",
  kz: "kk",
  en: "en",
};

export async function POST(request: NextRequest) {
  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    const formData = await request.formData();
    const audio = formData.get("audio");
    const locale = String(formData.get("language") || "ru").toLowerCase();
    const lang = LANGUAGE_MAP[locale] || "ru";

    if (!(audio instanceof File)) {
      return NextResponse.json({ error: "Audio file is required" }, { status: 400 });
    }

    const upstreamForm = new FormData();
    upstreamForm.append("file", audio, audio.name || "voice.webm");
    upstreamForm.append("model", "gpt-4o-mini-transcribe");
    upstreamForm.append("language", lang);
    upstreamForm.append("response_format", "json");

    const transcriptionResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
      },
      body: upstreamForm,
    });

    const payload = await transcriptionResponse.json();
    if (!transcriptionResponse.ok) {
      return NextResponse.json(
        { error: payload?.error?.message || "Transcription failed" },
        { status: transcriptionResponse.status }
      );
    }

    const text = String(payload?.text || "").trim();
    return NextResponse.json({ text });
  } catch (error) {
    console.error("Transcribe error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
