import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * This legacy JSON importer was built before company isolation and atomic
 * imports. Keeping it callable would allow unscoped writes through a service
 * client. The supported field and crop-structure flows use their scoped APIs.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Устаревший импорт отключён. Используйте редактор структуры посевов и импорт контуров карты полей.",
      code: "LEGACY_FARM_IMPORT_DISABLED",
    },
    { status: 410 }
  );
}
