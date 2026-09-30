import { NextRequest, NextResponse } from "next/server";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";
import { matchProductsForIntake } from "@/lib/knowledge/intake-matcher";
import type { KnowledgeIntakeApiInputType, KnowledgeProductMatch } from "@/lib/knowledge/types";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeInputType(value: unknown): KnowledgeIntakeApiInputType | null {
  const next = text(value).toLowerCase();
  if (next === "text" || next === "name") return "text";
  if (next === "url") return "url";
  return null;
}

function toDbInputType(value: KnowledgeIntakeApiInputType): "name" | "url" {
  return value === "text" ? "name" : "url";
}

function normalizeRunForApi(row: any) {
  return {
    ...row,
    input_type: row?.input_type === "name" ? "text" : row?.input_type,
  };
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
    throw new SessionAuthError("Only global admin can use knowledge intake", 403);
  }
  return actor;
}

function matchRows(runId: string, matches: KnowledgeProductMatch[]) {
  return matches.map((match) => ({
    run_id: runId,
    product_id: match.product_id,
    match_type: match.match_type,
    confidence: match.confidence,
    reason: match.reason,
  }));
}

export async function POST(request: NextRequest) {
  const routeStart = Date.now();
  let runId: string | null = null;
  let dbWriteMatchesMs = 0;
  try {
    const body = await request.json().catch(() => ({}));
    const inputType = normalizeInputType(body.input_type);
    const inputValue = text(body.input_value);
    const manufacturer = text(body.manufacturer);

    if (!inputType) {
      return NextResponse.json({ error: "input_type must be text or url" }, { status: 400 });
    }
    if (!inputValue) {
      return NextResponse.json({ error: "input_value is required" }, { status: 400 });
    }
    if (inputType === "url") {
      try {
        new URL(inputValue);
      } catch {
        return NextResponse.json({ error: "input_value must be a valid URL for url intake" }, { status: 400 });
      }
    }

    const actor = await requireGlobalAdmin(request);
    const supabase = getServiceClient();

    const { data: run, error: runError } = await supabase
      .from("knowledge_intake_runs")
      .insert({
        input_type: toDbInputType(inputType),
        input_value: inputValue,
        input_manufacturer: manufacturer || null,
        status: "analyzing",
        entity_type: "product",
        created_by: actor.id,
      })
      .select("*")
      .single();

    if (runError || !run?.id) {
      throw new Error(runError?.message || "Failed to create knowledge intake run");
    }
    runId = run.id;
    const createdRunId = String(run.id);

    const matcherResult = await matchProductsForIntake(supabase, { inputValue, manufacturer: manufacturer || null });
    if (matcherResult.matches.length) {
      const writeStart = Date.now();
      const { error: matchError } = await supabase.from("knowledge_intake_matches").insert(matchRows(createdRunId, matcherResult.matches));
      dbWriteMatchesMs = Date.now() - writeStart;
      if (matchError) throw new Error(matchError.message);
    }

    const nextStatus = matcherResult.matches.length ? "matched" : "needs_review";
    const { data: updatedRun, error: updateError } = await supabase
      .from("knowledge_intake_runs")
      .update({ status: nextStatus })
      .eq("id", createdRunId)
      .select("*")
      .single();

    if (updateError || !updatedRun) {
      throw new Error(updateError?.message || "Failed to update knowledge intake run status");
    }

    const serverTimings = {
      total_route_ms: Date.now() - routeStart,
      db_write_matches_ms: dbWriteMatchesMs,
    };

    console.info("[knowledge-intake] matcher timings", {
      matches: matcherResult.matches.length,
      recommendation: matcherResult.recommendation,
      matcher: matcherResult.timings,
      server: serverTimings,
    });

    return NextResponse.json({
      run: normalizeRunForApi(updatedRun),
      matches: matcherResult.matches,
      recommendation: matcherResult.recommendation,
      matcher_timings: matcherResult.timings,
      server_timings: serverTimings,
    });
  } catch (error) {
    const authError = jsonAuthError(error);
    if (authError) return authError;
    if (runId) {
      try {
        await getServiceClient().from("knowledge_intake_runs").update({ status: "failed" }).eq("id", runId);
      } catch {
        // keep original error
      }
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create intake run" }, { status: 500 });
  }
}
