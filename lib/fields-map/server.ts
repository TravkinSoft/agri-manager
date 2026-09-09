import { NextRequest, NextResponse } from "next/server";
import {
  SessionAuthError,
  getServerActorFromSession,
  resolveCompanyForActor,
  type ServerActorContext,
} from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";
import {
  assertFieldMapMutation,
  assertFieldMapRead,
  assertFieldMapWrite,
} from "@/lib/fields-map/access";

export type FieldsMapRequestContext = {
  actor: ServerActorContext;
  companyId: string;
  supabase: ReturnType<typeof getServiceClient>;
};

type ResolveOptions = {
  mutation?: boolean;
  write?: boolean;
  requestedCompanyId?: string | null;
};

function assertFieldBoundaryMutationEnabled(): void {
  if (process.env.FIELD_BOUNDARY_WRITE_V1 !== "1") {
    throw new SessionAuthError(
      "Изменения границ полей временно выключены. Включите FIELD_BOUNDARY_WRITE_V1 только для проверенной волны импорта.",
      503
    );
  }
}

export async function resolveFieldsMapContext(
  request: NextRequest,
  options?: ResolveOptions
): Promise<FieldsMapRequestContext> {
  const actor = await getServerActorFromSession(request);
  if (options?.mutation) {
    assertFieldMapMutation(actor);
    assertFieldBoundaryMutationEnabled();
  } else if (options?.write) {
    assertFieldMapWrite(actor);
  } else {
    assertFieldMapRead(actor);
  }
  const companyId = resolveCompanyForActor(actor, options?.requestedCompanyId || null);

  return {
    actor,
    companyId,
    supabase: getServiceClient(),
  };
}

function isMissingRelationError(message: string): boolean {
  const normalized = String(message || "").toLowerCase();
  const referencesFieldMapTables =
    normalized.includes("field_geometries") ||
    normalized.includes("field_map_imports") ||
    normalized.includes("field_engineering_objects") ||
    normalized.includes("confirm_field_map_import_v2") ||
    normalized.includes("get_field_map_snapshot_v1") ||
    normalized.includes("set_field_map_import_state_v2") ||
    normalized.includes("mutate_field_boundary_v1");
  const isMissingTable =
    (normalized.includes("relation") && normalized.includes("does not exist")) ||
    (normalized.includes("function") && normalized.includes("does not exist")) ||
    normalized.includes("could not find the table") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find the function");
  return referencesFieldMapTables && isMissingTable;
}

function isMissingColumnError(message: string): boolean {
  const normalized = String(message || "").toLowerCase();
  return normalized.includes("column") && normalized.includes("does not exist");
}

export function fieldsMapSchemaHintMessage() {
  return "Модуль карты полей не инициализирован. Примените SQL-миграцию field-map.";
}

export function fieldsMapErrorResponse(error: unknown) {
  if (error instanceof SessionAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  if (
    /FIELD_MAP_(?:PREVIEW|STATE)_STALE|FIELD_(?:MAP|BOUNDARY)_[A-Z_]*CAS|FIELD_BOUNDARY_(?:TARGET_OCCUPIED|RESTORE_NOT_ALLOWED|RESTORE_ALREADY_USED|RESTORE_TARGET_MISMATCH)/u.test(message)
  ) {
    return NextResponse.json(
      { error: "Карта изменилась в другой вкладке. Обновите данные и повторите действие.", technical: message },
      { status: 409 }
    );
  }
  if (isMissingRelationError(message) || isMissingColumnError(message)) {
    return NextResponse.json({ error: fieldsMapSchemaHintMessage(), technical: message }, { status: 503 });
  }

  return NextResponse.json({ error: message }, { status: 500 });
}
