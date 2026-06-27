import { NextRequest, NextResponse } from "next/server";
import {
  SessionAuthError,
  getServerActorFromSession,
  resolveCompanyForActor,
  type ServerActorContext,
} from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";
import { assertFieldMapRead, assertFieldMapWrite } from "@/lib/fields-map/access";

export type FieldsMapRequestContext = {
  actor: ServerActorContext;
  companyId: string;
  supabase: ReturnType<typeof getServiceClient>;
};

type ResolveOptions = {
  write?: boolean;
  requestedCompanyId?: string | null;
};

export async function resolveFieldsMapContext(
  request: NextRequest,
  options?: ResolveOptions
): Promise<FieldsMapRequestContext> {
  const actor = await getServerActorFromSession(request);
  if (options?.write) {
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
    normalized.includes("field_engineering_objects");
  const isMissingTable =
    (normalized.includes("relation") && normalized.includes("does not exist")) ||
    normalized.includes("could not find the table") ||
    normalized.includes("schema cache");
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
  if (isMissingRelationError(message) || isMissingColumnError(message)) {
    return NextResponse.json({ error: fieldsMapSchemaHintMessage(), technical: message }, { status: 503 });
  }

  return NextResponse.json({ error: message }, { status: 500 });
}
