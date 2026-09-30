import { NextRequest, NextResponse } from "next/server";
import {
  SessionAuthError,
  getServerActorFromSession,
  resolveCompanyForActor,
  type ServerActorContext,
} from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";
import { assertLandLegalRead, assertLandLegalWrite } from "@/lib/land-legal/access";

export type LandLegalRequestContext = {
  actor: ServerActorContext;
  companyId: string;
  supabase: ReturnType<typeof getServiceClient>;
};

type ResolveOptions = {
  write?: boolean;
  requestedCompanyId?: string | null;
};

export async function resolveLandLegalContext(
  request: NextRequest,
  options?: ResolveOptions
): Promise<LandLegalRequestContext> {
  const actor = await getServerActorFromSession(request);
  const companyId = resolveCompanyForActor(actor, options?.requestedCompanyId || null);
  if (options?.write) {
    assertLandLegalWrite(actor);
  } else {
    assertLandLegalRead(actor);
  }
  return {
    actor,
    companyId,
    supabase: getServiceClient(),
  };
}

export function isMissingRelationError(message: string): boolean {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("relation") &&
    normalized.includes("does not exist") &&
    (normalized.includes("legal_entities") ||
      normalized.includes("cadastral_parcels") ||
      normalized.includes("field_cadastre_links") ||
      normalized.includes("land_documents"))
  );
}

export function isMissingColumnError(message: string): boolean {
  const normalized = String(message || "").toLowerCase();
  return normalized.includes("column") && normalized.includes("does not exist");
}

export function landLegalSchemaHintMessage() {
  return "Модуль 'Кадастр и право' не инициализирован. Примените SQL-миграцию land-legal.";
}

export function landLegalErrorResponse(error: unknown) {
  if (error instanceof SessionAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  if (isMissingRelationError(message) || isMissingColumnError(message)) {
    return NextResponse.json(
      {
        error: landLegalSchemaHintMessage(),
        technical: message,
      },
      { status: 503 }
    );
  }

  return NextResponse.json({ error: message }, { status: 500 });
}

