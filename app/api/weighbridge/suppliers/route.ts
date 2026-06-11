import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_READ_ROLES,
  WEIGHBRIDGE_WRITE_ROLES,
  asSessionErrorResponse,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";

const GLOBAL_SUPPLIER_PREFIX = "global_supplier:";

function normalizeName(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/[«»"']/g, "")
    .replace(/\b(тоо|llp|ао|ип)\b/gi, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function supplierName(row: any) {
  return String(row?.name || row?.original_name || row?.legal_name || "Поставщик").trim();
}

function localSupplierOption(row: any) {
  return {
    id: String(row.id),
    name: supplierName(row),
    source: "counterparty",
  };
}

function globalSupplierOption(row: any) {
  return {
    id: `${GLOBAL_SUPPLIER_PREFIX}${String(row.id)}`,
    name: supplierName(row),
    source: "global_supplier",
    globalSupplierId: String(row.id),
  };
}

async function loadCompanySuppliers(supabase: any, companyId: string) {
  const { data, error } = await supabase
    .from("counterparties")
    .select("id,name,counterparty_type,is_active,archived")
    .eq("company_id", companyId)
    .eq("archived", false)
    .eq("is_active", true)
    .in("counterparty_type", ["supplier", "both"])
    .order("name");

  if (error) throw error;
  return data || [];
}

async function loadGlobalSuppliers(supabase: any) {
  const { data, error } = await supabase
    .from("global_suppliers")
    .select("id,name,aliases,is_active")
    .order("name");

  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (msg.includes("global_suppliers") || msg.includes("schema cache")) return [];
    throw error;
  }

  return (data || []).filter((row: any) => row.is_active !== false);
}

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });

    const [localRows, globalRows] = await Promise.all([
      loadCompanySuppliers(supabase, companyId),
      loadGlobalSuppliers(supabase),
    ]);

    const localOptions = localRows.map(localSupplierOption);
    const localNames = new Set(localOptions.map((row: { name: string }) => normalizeName(row.name)).filter(Boolean));
    const globalOptions = globalRows
      .filter((row: any) => !localNames.has(normalizeName(supplierName(row))))
      .map(globalSupplierOption);

    return NextResponse.json({
      suppliers: [...localOptions, ...globalOptions].sort((a, b) => a.name.localeCompare(b.name, "ru")),
      localCount: localOptions.length,
      globalCount: globalRows.length,
      addedFromGlobalCount: globalOptions.length,
    });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const optionId = String(body?.supplierId || "").trim();
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });

    if (!optionId) {
      return NextResponse.json({ error: "supplierId is required" }, { status: 400 });
    }

    if (!optionId.startsWith(GLOBAL_SUPPLIER_PREFIX)) {
      const { data: existing, error } = await supabase
        .from("counterparties")
        .select("id,name,counterparty_type,is_active,archived")
        .eq("company_id", companyId)
        .eq("id", optionId)
        .maybeSingle();
      if (error || !existing?.id) {
        return NextResponse.json({ error: error?.message || "Supplier counterparty not found" }, { status: 404 });
      }
      if (existing.is_active === false || existing.archived || !["supplier", "both"].includes(String(existing.counterparty_type || ""))) {
        return NextResponse.json({ error: "Supplier counterparty is not active" }, { status: 400 });
      }
      return NextResponse.json({ supplierId: String(existing.id), supplier: localSupplierOption(existing) });
    }

    const globalSupplierId = optionId.slice(GLOBAL_SUPPLIER_PREFIX.length);
    const { data: globalSupplier, error: globalError } = await supabase
      .from("global_suppliers")
      .select("id,name,aliases,is_active")
      .eq("id", globalSupplierId)
      .maybeSingle();

    if (globalError || !globalSupplier?.id) {
      return NextResponse.json({ error: globalError?.message || "Global supplier not found" }, { status: 404 });
    }
    if (globalSupplier.is_active === false) {
      return NextResponse.json({ error: "Global supplier is inactive" }, { status: 400 });
    }

    const name = supplierName(globalSupplier);
    const normalized = normalizeName(name);
    const localRows = await loadCompanySuppliers(supabase, companyId);
    const existing = localRows.find((row: any) => normalizeName(row.name) === normalized);
    if (existing?.id) {
      return NextResponse.json({ supplierId: String(existing.id), supplier: localSupplierOption(existing) });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("counterparties")
      .insert({
        company_id: companyId,
        name,
        counterparty_type: "supplier",
        is_active: true,
        archived: false,
        notes: `Created from global supplier ${globalSupplier.id}`,
      })
      .select("id,name,counterparty_type,is_active,archived")
      .single();

    if (insertError || !inserted?.id) {
      return NextResponse.json({ error: insertError?.message || "Failed to create supplier counterparty" }, { status: 400 });
    }

    return NextResponse.json({ supplierId: String(inserted.id), supplier: localSupplierOption(inserted), created: true });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
