import { NextRequest, NextResponse } from "next/server";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

const URL_SOURCE_TYPE_VALUES = [
  "manufacturer_page",
  "manufacturer_pdf",
  "registration_database",
  "distributor_page",
] as const;
const MANUAL_SOURCE_TYPE = "manual";
const URL_SOURCE_TYPES = new Set<string>(URL_SOURCE_TYPE_VALUES);
const V0_SOURCE_TYPES = new Set<string>([...URL_SOURCE_TYPE_VALUES, MANUAL_SOURCE_TYPE]);

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
    throw new SessionAuthError("Only global admin can manage knowledge intake sources", 403);
  }
  return actor;
}

function sourceConfidence(sourceType: string): "low" | "medium" | "high" {
  if (sourceType === "manufacturer_pdf" || sourceType === "registration_database") return "high";
  if (sourceType === "manufacturer_page" || sourceType === "manual") return "medium";
  return "low";
}

function validateSourceUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireGlobalAdmin(request);

    const runId = text(params?.id);
    if (!runId) return NextResponse.json({ error: "run_id is required" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const sourceType = text(body.source_type);
    const sourceUrl = text(body.source_url);
    const sourceTitle = text(body.source_title);
    const manualText = text(body.manual_text);

    if (!sourceType) {
      return NextResponse.json({ error: "source_type is required" }, { status: 400 });
    }
    if (sourceType === "uploaded_file") {
      return NextResponse.json({ error: "uploaded_file source intake is not available in V0" }, { status: 400 });
    }
    if (!V0_SOURCE_TYPES.has(sourceType)) {
      return NextResponse.json({ error: "Unsupported source_type for V0 source intake" }, { status: 400 });
    }
    if (URL_SOURCE_TYPES.has(sourceType)) {
      if (!sourceUrl) {
        return NextResponse.json({ error: "source_url is required for URL-based source types" }, { status: 400 });
      }
      if (!validateSourceUrl(sourceUrl)) {
        return NextResponse.json({ error: "source_url must be a valid http(s) URL" }, { status: 400 });
      }
    }
    if (sourceType === MANUAL_SOURCE_TYPE && !manualText) {
      return NextResponse.json({ error: "manual_text is required for manual source" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data: run, error: runError } = await supabase
      .from("knowledge_intake_runs")
      .select("id,status")
      .eq("id", runId)
      .maybeSingle();

    if (runError) throw new Error(runError.message);
    if (!run) return NextResponse.json({ error: "Knowledge intake run not found" }, { status: 404 });

    const { data: source, error: sourceError } = await supabase
      .from("knowledge_intake_sources")
      .insert({
        run_id: runId,
        source_type: sourceType,
        source_url: URL_SOURCE_TYPES.has(sourceType) ? sourceUrl : null,
        source_title: sourceTitle || null,
        source_confidence: sourceConfidence(sourceType),
        extracted_text_summary: sourceType === MANUAL_SOURCE_TYPE ? manualText : null,
      })
      .select("*")
      .single();

    if (sourceError || !source) {
      throw new Error(sourceError?.message || "Failed to save knowledge intake source");
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

    return NextResponse.json({ source, run: updatedRun });
  } catch (error) {
    const authError = jsonAuthError(error);
    if (authError) return authError;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save intake source" }, { status: 500 });
  }
}
