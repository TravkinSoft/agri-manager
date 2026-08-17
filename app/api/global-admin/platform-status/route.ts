import { NextRequest, NextResponse } from "next/server";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";
import { getMaterialProductTypeFromProduct } from "@/lib/materials/classification";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PESTICIDE_IMPORT_BATCH_ID = "d02207a1-2e0a-52a5-afb0-947c6f58ec51";

type ProductCategoryRow = {
  type?: string | null;
  category?: string | null;
  product_type?: string | null;
  subcategory?: string | null;
  pesticide_category?: string | null;
};

function normalizeRuntimeEnvironment(rawEnvironment: string | undefined): "production" | "preview" | "development" {
  const value = String(rawEnvironment || "").trim().toLowerCase();
  if (value === "production") return "production";
  if (value === "preview") return "preview";
  return "development";
}

function databaseLabelForEnvironment(environment: "production" | "preview" | "development"): "PRODUCTION" | "QA" | "LOCAL" {
  if (environment === "production") return "PRODUCTION";
  if (environment === "preview") return "QA";
  return "LOCAL";
}

function countProductsByCategory(rows: ProductCategoryRow[]) {
  return rows.reduce(
    (counts, row) => {
      const productType = getMaterialProductTypeFromProduct(row);
      if (productType === "pesticide") {
        counts.pesticides += 1;
      } else if (productType === "fertilizer") {
        counts.fertilizers += 1;
      } else if (productType === "additive") {
        counts.additives += 1;
      } else {
        counts.other += 1;
      }
      if (String(row.product_type || "").trim().toLowerCase() === "growth_regulator") {
        counts.growthRegulators += 1;
      }
      counts.total += 1;
      return counts;
    },
    {
      pesticides: 0,
      fertilizers: 0,
      additives: 0,
      growthRegulators: 0,
      other: 0,
      total: 0,
    }
  );
}

function safeBranchName(environment: "production" | "preview" | "development"): string {
  const branch = String(process.env.VERCEL_GIT_COMMIT_REF || "").trim();
  if (branch) return branch;
  return environment === "production" ? "master" : "local";
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
    if (actor.role !== "global_admin") {
      throw new SessionAuthError("Доступ только для глобального администратора", 403);
    }

    // The service client is intentionally created only after session and role validation.
    const supabase = getServiceClient();
    const environment = normalizeRuntimeEnvironment(process.env.VERCEL_ENV);
    const branch = safeBranchName(environment);
    const commit = String(process.env.VERCEL_GIT_COMMIT_SHA || "").trim();

    const [productsResult, importedProductsResult, companiesResult, selectedCompanyResult] = await Promise.all([
      supabase
        .from("products")
        .select("type,category,product_type,subcategory,pesticide_category")
        .is("company_id", null)
        .limit(5000),
      supabase
        .from("glbd_import_batch_rows")
        .select("id", { count: "exact", head: true })
        .eq("import_batch_id", PESTICIDE_IMPORT_BATCH_ID)
        .eq("entity_type", "product"),
      supabase.from("companies").select("id", { count: "exact", head: true }),
      actor.contextCompanyId
        ? supabase.from("companies").select("id,name").eq("id", actor.contextCompanyId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (productsResult.error) throw new Error(productsResult.error.message || "Не удалось загрузить продукты");
    if (importedProductsResult.error) {
      throw new Error(importedProductsResult.error.message || "Не удалось проверить импорт пестицидов");
    }
    if (companiesResult.error) throw new Error(companiesResult.error.message || "Не удалось загрузить компании");
    if (selectedCompanyResult.error) {
      throw new Error(selectedCompanyResult.error.message || "Не удалось загрузить контекст компании");
    }

    const productCounts = countProductsByCategory((productsResult.data || []) as ProductCategoryRow[]);
    const selectedCompany = selectedCompanyResult.data
      ? {
          id: String(selectedCompanyResult.data.id),
          name: String(selectedCompanyResult.data.name || selectedCompanyResult.data.id),
        }
      : null;

    return NextResponse.json(
      {
        runtime: {
          environment,
          branch,
          commit: commit ? commit.slice(0, 12) : null,
          database: databaseLabelForEnvironment(environment),
          season: "2026",
        },
        catalog: {
          products: productCounts,
          pesticideImport: {
            batchId: PESTICIDE_IMPORT_BATCH_ID,
            expected: 852,
            found: Number(importedProductsResult.count || 0),
          },
        },
        companies: {
          total: Number(companiesResult.count || 0),
          selected: selectedCompany,
        },
        generatedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить состояние платформы" },
      { status: 500 }
    );
  }
}
