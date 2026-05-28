import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";

function htmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function printableHtml(input: {
  fieldName: string;
  fieldArea: number;
  seasonYear: string | number;
  planned: number;
  remaining: number;
  rows: Array<{ crop: string; variety: string; reproduction: string; area: number }>;
  history: Array<{ year: string | number; items: string[] }>;
}) {
  const rowsHtml =
    input.rows.length > 0
      ? input.rows
          .map(
            (row, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${htmlEscape(row.crop)}</td>
        <td>${htmlEscape(row.variety)}</td>
        <td>${htmlEscape(row.reproduction)}</td>
        <td style="text-align:right">${row.area.toFixed(2)}</td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="5">Нет данных</td></tr>`;

  const historyHtml = input.history
    .map((line) => `<li><strong>${line.year}</strong>: ${htmlEscape(line.items.length ? line.items.join(", ") : "-")}</li>`)
    .join("");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Карточка поля — ${htmlEscape(input.fieldName)}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; margin: 0; }
    h1 { margin: 0 0 8px 0; font-size: 22px; }
    h2 { margin: 22px 0 10px 0; font-size: 16px; }
    .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
    .box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
    .label { color: #64748b; font-size: 12px; }
    .value { font-size: 14px; margin-top: 2px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px; font-size: 13px; }
    th { background: #f8fafc; text-align: left; }
    ul { margin: 8px 0 0 18px; padding: 0; }
    li { margin: 6px 0; font-size: 13px; }
    @media print { .no-print { display:none !important; } }
  </style>
</head>
<body>
  <h1>Карточка поля</h1>
  <div class="meta">
    <div class="box"><div class="label">Поле</div><div class="value">${htmlEscape(input.fieldName)}</div></div>
    <div class="box"><div class="label">Сезон</div><div class="value">${htmlEscape(String(input.seasonYear))}</div></div>
    <div class="box"><div class="label">Площадь поля, га</div><div class="value">${input.fieldArea.toFixed(2)}</div></div>
    <div class="box"><div class="label">Запланировано / Остаток, га</div><div class="value">${input.planned.toFixed(2)} / ${input.remaining.toFixed(2)}</div></div>
  </div>

  <h2>Текущая структура</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Культура</th>
        <th>Сорт</th>
        <th>Репродукция</th>
        <th>Площадь, га</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <h2>История севооборота (5 лет)</h2>
  <ul>${historyHtml || "<li>-</li>"}</ul>

  <script>
    window.addEventListener('load', () => {
      setTimeout(() => window.print(), 120);
    });
  </script>
</body>
</html>`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: fieldId } = await params;
    const seasonId = String(request.nextUrl.searchParams.get("seasonId") || "").trim();
    if (!fieldId || !seasonId) {
      return NextResponse.json({ error: "field id and seasonId required" }, { status: 400 });
    }
    const actor = await getServerActorFromSession(request);

    const supabase = getServiceClient();
    const { data: field, error: fieldError } = await supabase
      .from("fields")
      .select("id,name,area,company_id")
      .eq("id", fieldId)
      .maybeSingle();
    if (fieldError || !field?.id) {
      return NextResponse.json({ error: fieldError?.message || "Field not found" }, { status: 404 });
    }

    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId: field.company_id,
      allowedRoles: ["admin", "company_admin", "global_admin", "agronomist", "specialist"],
    });

    const [{ data: season }, { data: rows }, { data: crops }, { data: varieties }, { data: reproductions }, { data: seasons }] =
      await Promise.all([
        supabase.from("seasons").select("id,year").eq("id", seasonId).maybeSingle(),
        supabase
          .from("crop_structure")
          .select("crop_id,variety_id,reproduction_id,notes,area")
          .eq("company_id", field.company_id)
          .eq("field_id", fieldId)
          .eq("season_id", seasonId)
          .eq("archived", false),
        supabase.from("crops").select("id,name,name_ru,name_en,company_id").is("company_id", null).eq("archived", false),
        supabase.from("varieties").select("id,name,company_id").is("company_id", null).eq("archived", false),
        supabase.from("seed_reproductions").select("id,name,company_id").is("company_id", null).eq("archived", false),
        supabase
          .from("seasons")
          .select("id,year")
          .eq("company_id", field.company_id)
          .eq("archived", false)
          .order("year", { ascending: false })
          .limit(6),
      ]);

    const cropMap = new Map((crops || []).map((x: any) => [x.id, x.name_ru || x.name_en || x.name || "-"]));
    const varMap = new Map((varieties || []).map((x: any) => [x.id, x.name || "-"]));
    const repMap = new Map((reproductions || []).map((x: any) => [x.id, x.name || "-"]));

    const historyIds = (seasons || []).filter((s: any) => s.id !== seasonId).map((s: any) => s.id);
    const { data: historyRows } = historyIds.length
      ? await supabase
          .from("crop_structure")
          .select("season_id,crop_id,area")
          .eq("company_id", field.company_id)
          .eq("field_id", fieldId)
          .in("season_id", historyIds)
          .eq("archived", false)
      : { data: [] as any[] };

    const historyBySeason = new Map<string, string[]>();
    for (const row of historyRows || []) {
      const list = historyBySeason.get(row.season_id) || [];
      list.push(`${cropMap.get(row.crop_id) || "-"} (${Number(row.area || 0).toFixed(1)} га)`);
      historyBySeason.set(row.season_id, list);
    }

    const planned = (rows || []).reduce((sum: number, row: any) => sum + Number(row.area || 0), 0);
    const remaining = Number(field.area || 0) - planned;

    const html = printableHtml({
      fieldName: field.name || "-",
      fieldArea: Number(field.area || 0),
      seasonYear: season?.year || "-",
      planned,
      remaining,
      rows: (rows || []).map((row: any) => ({
        crop: cropMap.get(row.crop_id) || "-",
        variety: row.variety_id ? varMap.get(row.variety_id) || "-" : "-",
        reproduction: row.reproduction_id ? repMap.get(row.reproduction_id) || "-" : "-",
        area: Number(row.area || 0),
      })),
      history: ((seasons || []) as any[])
        .filter((s: any) => s.id !== seasonId)
        .slice(0, 5)
        .map((s: any) => ({
          year: s.year,
          items: historyBySeason.get(s.id) || ["-"],
        })),
    });

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
