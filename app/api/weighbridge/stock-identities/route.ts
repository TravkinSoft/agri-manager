import { NextRequest, NextResponse } from "next/server";
import { WEIGHBRIDGE_WRITE_ROLES, asSessionErrorResponse, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";
import { brandName, localizedName } from "@/lib/i18n/helpers";

const batchClassLabel = (value: string | null | undefined) => {
  const key = String(value || "commodity").toLowerCase();
  if (key === "seed") return "Семенной фонд";
  if (key === "feed") return "Кормовое";
  if (key === "waste") return "Отход";
  if (key === "processing") return "Переработка";
  if (key === "rejected") return "Брак";
  return "Товарное";
};

const formatKg = (value: number) => {
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т`;
  }
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг`;
};

const systemNameOf = (row: any, fallback = "-") => localizedName(row, "ru", ["name", "full_name", "title", "code", "slug"]) || fallback;
const brandNameOf = (row: any, fallback = "-") => brandName(row, ["trade_name", "original_name", "name", "full_name", "title", "normalized_name"]) || fallback;

const firstSnapshot = (rows: any[], idKey: string, nameKey: string) => {
  const map = new Map<string, string>();
  for (const row of rows || []) {
    const id = String(row?.[idKey] || "");
    const name = String(row?.[nameKey] || "").trim();
    if (id && name && !map.has(id)) map.set(id, name);
  }
  return map;
};

export async function GET(request: NextRequest) {
  try {
    const warehouseId = String(request.nextUrl.searchParams.get("warehouseId") || "").trim();

    if (!warehouseId) {
      return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });
    }

    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
    });

    const { data: rows, error } = await supabase
      .from("v_stock_balance_identity")
      .select("company_id,warehouse_id,product_id,variety_id,reproduction_id,batch_id,batch_class,quantity")
      .eq("company_id", companyId)
      .eq("warehouse_id", warehouseId)
      .gt("quantity", 0)
      .order("product_id", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const productIds = Array.from(new Set((rows || []).map((x: any) => String(x.product_id || "")).filter(Boolean)));
    const varietyIds = Array.from(new Set((rows || []).map((x: any) => String(x.variety_id || "")).filter(Boolean)));
    const reproductionIds = Array.from(new Set((rows || []).map((x: any) => String(x.reproduction_id || "")).filter(Boolean)));

    const [
      { data: products },
      { data: cropFallbacks },
      { data: varieties },
      { data: reproductions },
      { data: lineSnapshots },
    ] = await Promise.all([
      productIds.length
        ? supabase.from("products").select("id,name,trade_name,normalized_name,full_name,type,product_type").in("id", productIds)
        : Promise.resolve({ data: [] as any[] }),
      productIds.length
        ? supabase.from("crops").select("id,name,name_ru,name_kz,name_en,slug,full_name").in("id", productIds)
        : Promise.resolve({ data: [] as any[] }),
      varietyIds.length
        ? supabase.from("varieties").select("id,name,full_name").in("id", varietyIds)
        : Promise.resolve({ data: [] as any[] }),
      reproductionIds.length
        ? supabase.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en,code,full_name").in("id", reproductionIds)
        : Promise.resolve({ data: [] as any[] }),
      productIds.length || varietyIds.length || reproductionIds.length
        ? supabase
            .from("ticket_lines")
            .select("product_id,product_name_snapshot,variety_id,variety_name_snapshot,reproduction_id,reproduction_name_snapshot")
            .eq("company_id", companyId)
            .not("ticket_id", "is", null)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const productMap = new Map((products || []).map((x: any) => [String(x.id), brandNameOf(x, "")]));
    const productTypeMap = new Map((products || []).map((x: any) => [String(x.id), String(x.product_type || x.type || "").toLowerCase()]));
    for (const crop of cropFallbacks || []) {
      const id = String((crop as any).id || "");
      if (id && !productMap.get(id)) productMap.set(id, systemNameOf(crop, ""));
    }
    const varietyMap = new Map((varieties || []).map((x: any) => [String(x.id), brandNameOf(x, "")]));
    const reproductionMap = new Map((reproductions || []).map((x: any) => [String(x.id), systemNameOf(x, "")]));
    const productSnapshotMap = firstSnapshot(lineSnapshots || [], "product_id", "product_name_snapshot");
    const varietySnapshotMap = firstSnapshot(lineSnapshots || [], "variety_id", "variety_name_snapshot");
    const reproductionSnapshotMap = firstSnapshot(lineSnapshots || [], "reproduction_id", "reproduction_name_snapshot");

    const items = (rows || [])
      .map((row: any) => {
        const quantity = Number(row.quantity || 0);
        const productId = String(row.product_id || "");
        const varietyId = row.variety_id ? String(row.variety_id) : null;
        const reproductionId = row.reproduction_id ? String(row.reproduction_id) : null;
        const batchId = row.batch_id ? String(row.batch_id) : null;
        const batchClass = String(row.batch_class || "commodity");
        const productName = productMap.get(productId) || productSnapshotMap.get(productId) || "Номенклатура";
        const varietyName = varietyId ? (varietyMap.get(varietyId) || varietySnapshotMap.get(varietyId) || "-") : "-";
        const reproductionName = reproductionId ? (reproductionMap.get(reproductionId) || reproductionSnapshotMap.get(reproductionId) || "-") : "-";
        const classLabel = batchClassLabel(batchClass);
        const key = [productId, varietyId || "", reproductionId || "", batchId || "", batchClass].join("|");

        return {
          key,
          warehouse_id: String(row.warehouse_id || ""),
          product_id: productId,
          product_name: productName,
          product_type: productTypeMap.get(productId) || "",
          variety_id: varietyId,
          variety_name: varietyName,
          reproduction_id: reproductionId,
          reproduction_name: reproductionName,
          batch_id: batchId,
          batch_class: batchClass,
          batch_class_label: classLabel,
          quantity,
          label: `${productName} / ${varietyName} / ${reproductionName} / ${classLabel} — ${formatKg(quantity)}`,
        };
      })
      .sort((a: any, b: any) => String(a.label).localeCompare(String(b.label), "ru"));

    return NextResponse.json({ items });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
