import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import {
  COUNTERPARTY_COUNTRY_LABELS,
  counterpartyMatchesSearch,
} from "@/lib/counterparties/catalog";
import { COUNTERPARTY_SELECT, normalizeCounterpartyRow } from "@/lib/counterparties/rows";
import type { CounterpartySearchResult } from "@/lib/types/counterparty";

const SEARCH_ROLES = ["global_admin", "company_admin", "warehouse", "warehouse_operator"] as const;

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(
      actor,
      String(request.nextUrl.searchParams.get("companyId") || "").trim() || null,
    );
    const query = String(request.nextUrl.searchParams.get("q") || "").trim();
    const supabase = await getUserScopedClientFromRequest(request);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...SEARCH_ROLES],
    });

    const [companyResult, globalResult] = await Promise.all([
      supabase
        .from("counterparties")
        .select(COUNTERPARTY_SELECT)
        .eq("company_id", companyId)
        .eq("counterparty_type", "supplier")
        .eq("archived", false)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("global_counterparties")
        .select("id,legal_name,tax_id,country_code")
        .eq("archived", false)
        .eq("is_active", true)
        .order("legal_name"),
    ]);
    if (companyResult.error) throw new Error(companyResult.error.message);
    if (globalResult.error) throw new Error(globalResult.error.message);

    const results: CounterpartySearchResult[] = [];
    const linkedGlobalIds = new Set<string>();
    for (const raw of companyResult.data || []) {
      const row = normalizeCounterpartyRow(raw);
      if (!counterpartyMatchesSearch({ legalName: row.legal_name, taxId: row.tax_id, query })) continue;
      if (row.global_counterparty_id) linkedGlobalIds.add(row.global_counterparty_id);
      results.push({
        key: `company:${row.id}`,
        company_counterparty_id: row.id,
        global_counterparty_id: row.global_counterparty_id,
        legal_name: row.legal_name,
        tax_id: row.tax_id,
        country_code: row.country_code,
        country_name: row.country_name,
        source: "company",
      });
    }
    for (const row of globalResult.data || []) {
      const globalId = String(row.id);
      if (linkedGlobalIds.has(globalId)) continue;
      if (!counterpartyMatchesSearch({ legalName: row.legal_name, taxId: row.tax_id, query })) continue;
      const countryCode: "KZ" | "RU" | null = row.country_code === "KZ" || row.country_code === "RU"
        ? row.country_code
        : null;
      results.push({
        key: `global:${globalId}`,
        company_counterparty_id: null,
        global_counterparty_id: globalId,
        legal_name: String(row.legal_name),
        tax_id: String(row.tax_id),
        country_code: countryCode,
        country_name: countryCode ? COUNTERPARTY_COUNTRY_LABELS[countryCode] : null,
        source: "global",
      });
    }

    return NextResponse.json({ results: results.slice(0, 80) });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Search failed" }, { status: 500 });
  }
}
