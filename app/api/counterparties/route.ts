import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import { counterpartyMatchesSearch, isCountryCode } from "@/lib/counterparties/catalog";
import { COUNTERPARTY_SELECT, normalizeCounterpartyRow } from "@/lib/counterparties/rows";
import type { CounterpartyType } from "@/lib/types/counterparty";

const READ_ROLES = [
  "company_admin", "global_admin", "warehouse", "warehouse_operator", "weighman",
  "fuel_operator", "agronomist", "director",
] as const;
const WRITE_ROLES = ["company_admin", "global_admin"] as const;
const TYPE_VALUES = new Set<CounterpartyType>([
  "supplier", "buyer", "carrier", "service", "both", "other",
]);

async function loadCounterparty(supabase: any, id: string, companyId: string) {
  const { data, error } = await supabase
    .from("counterparties")
    .select(COUNTERPARTY_SELECT)
    .eq("id", id)
    .eq("company_id", companyId)
    .single();
  if (error || !data) throw new Error(error?.message || "Контрагент не найден");
  return normalizeCounterpartyRow(data);
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(
      actor,
      String(request.nextUrl.searchParams.get("companyId") || "").trim() || null,
    );
    const type = String(request.nextUrl.searchParams.get("type") || "").trim().toLowerCase();
    const status = String(request.nextUrl.searchParams.get("status") || "").trim().toLowerCase();
    const activeOnly = String(request.nextUrl.searchParams.get("activeOnly") || "true").toLowerCase() !== "false";
    const country = String(request.nextUrl.searchParams.get("country") || "").trim().toUpperCase();
    const search = String(request.nextUrl.searchParams.get("search") || "").trim();
    const supabase = await getUserScopedClientFromRequest(request);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...READ_ROLES],
    });

    let query = supabase.from("counterparties").select(COUNTERPARTY_SELECT).eq("company_id", companyId);
    if (status === "active" || (!status && activeOnly)) {
      query = query.eq("archived", false).eq("is_active", true);
    } else if (status === "archived") {
      query = query.or("archived.eq.true,is_active.eq.false");
    }
    const { data, error } = await query.order("name");
    if (error) throw new Error(error.message);

    const rows = (data || [])
      .map(normalizeCounterpartyRow)
      .filter((row) => !type || type === "all" || row.roles.includes(type) || row.counterparty_type === type || (row.counterparty_type === "both" && ["supplier", "buyer"].includes(type)))
      .filter((row) => !isCountryCode(country) || row.country_code === country)
      .filter((row) => counterpartyMatchesSearch({ legalName: row.legal_name, taxId: row.tax_id, aliases: row.aliases, shortName: row.short_name, query: search }));
    return NextResponse.json({ counterparties: rows });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const body = await request.json();
    const companyId = resolveCompanyForActor(actor, String(body.companyId || "").trim() || null);
    const supabase = await getUserScopedClientFromRequest(request);
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...WRITE_ROLES],
    });

    let row: any;
    const globalCounterpartyId = String(body.globalCounterpartyId || "").trim();
    const type = String(body.type || "supplier").trim().toLowerCase() as CounterpartyType;
    if (!["supplier", "buyer"].includes(type)) {
      return NextResponse.json({ error: "Можно добавить роль поставщика или покупателя" }, { status: 400 });
    }
    if (globalCounterpartyId) {
      const result = await supabase.rpc("link_global_counterparty_role_to_company_v2", {
        p_company_id: companyId,
        p_global_counterparty_id: globalCounterpartyId,
        p_role: type,
      });
      if (result.error || !result.data?.id) throw new Error(result.error?.message || "Не удалось добавить контрагента");
      row = result.data;
    } else {
      const name = String(body.name || "").trim();
      const taxId = String(body.binIin || "").trim();
      const countryCode = String(body.countryCode || "").trim().toUpperCase();
      if (!TYPE_VALUES.has(type)) return NextResponse.json({ error: "Недопустимая роль контрагента" }, { status: 400 });
      if (!name || !taxId || !isCountryCode(countryCode)) {
        return NextResponse.json({ error: "Укажите юридическое название, БИН/ИНН и страну" }, { status: 400 });
      }
      const result = await supabase.rpc("create_local_counterparty_role_v2", {
        p_company_id: companyId,
        p_legal_name: name,
        p_tax_id: taxId,
        p_country_code: countryCode,
        p_role: type,
        p_aliases: Array.isArray(body.aliases) ? body.aliases : [],
      });
      if (result.error || !result.data?.id) throw new Error(result.error?.message || "Не удалось создать контрагента");
      row = result.data;
    }

    return NextResponse.json({ counterparty: await loadCounterparty(supabase, String(row.id), companyId) });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 400 });
  }
}
