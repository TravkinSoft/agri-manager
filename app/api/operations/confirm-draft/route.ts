import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { OperationDraft } from '@/lib/types/operation-draft';

type ConfirmDraftRequest = {
  draft: OperationDraft;
  companyId?: string;
  userId?: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getServiceClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase service credentials are not configured');
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function normalizePayload(payload: any): ConfirmDraftRequest {
  // Backward compatibility: old frontend sent draft object directly as request body.
  if (payload && typeof payload === 'object' && payload.operation_type) {
    return { draft: payload as OperationDraft };
  }

  return {
    draft: payload?.draft as OperationDraft,
    companyId: typeof payload?.companyId === 'string' ? payload.companyId : undefined,
    userId: typeof payload?.userId === 'string' ? payload.userId : undefined,
  };
}

function normalizeDate(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toISOString().slice(0, 10);
}

function buildOperationNotes(draft: OperationDraft): string {
  const noteBlocks: string[] = [];
  const metadata: Record<string, unknown> =
    draft.metadata && typeof draft.metadata === 'object' ? draft.metadata : {};
  const baseNotes = String(metadata.comments || draft.notes || '').trim();
  if (baseNotes) {
    noteBlocks.push(baseNotes);
  }

  const metadataRows: string[] = [];
  const fields: Array<{ key: string; label: string }> = [
    { key: 'target', label: 'Target' },
    { key: 'crop', label: 'Crop' },
    { key: 'product', label: 'Product' },
    { key: 'product_id', label: 'Product ID' },
    { key: 'rate_per_ha', label: 'Rate per ha' },
    { key: 'additional_products', label: 'Additional products' },
    { key: 'spray_volume_per_ha', label: 'Spray volume per ha' },
    { key: 'total_mixture_volume', label: 'Total mixture volume' },
    { key: 'total_water_volume', label: 'Total water volume' },
    { key: 'total_product_volume', label: 'Total product volume' },
    { key: 'water_percentage', label: 'Water percentage' },
    { key: 'product_percentage', label: 'Product percentage' },
    { key: 'equipment', label: 'Equipment' },
    { key: 'equipment_id', label: 'Equipment ID' },
    { key: 'responsible', label: 'Responsible' },
    { key: 'responsible_id', label: 'Responsible ID' },
    { key: 'area', label: 'Area' },
    { key: 'total_amount', label: 'Legacy total amount' },
    { key: 'water_rate', label: 'Legacy water per ha' },
    { key: 'total_water', label: 'Legacy total water' },
  ];

  fields.forEach(({ key, label }) => {
    const rawValue = metadata[key];
    if (rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '') {
      metadataRows.push(`${label}: ${String(rawValue).trim()}`);
    }
  });

  if (metadataRows.length > 0) {
    noteBlocks.push(`Draft details:\n${metadataRows.map((row) => `- ${row}`).join('\n')}`);
  }

  if (draft.operation_datetime) {
    noteBlocks.push(`Planned datetime: ${draft.operation_datetime}`);
  }

  if (draft.crop_name) {
    noteBlocks.push(`Crop name: ${draft.crop_name}`);
  }

  return noteBlocks.join('\n\n');
}

async function resolveFieldId(
  supabase: SupabaseClient,
  companyId: string,
  draft: OperationDraft
): Promise<string | null> {
  const metadata: Record<string, unknown> =
    draft.metadata && typeof draft.metadata === "object" ? draft.metadata : {};

  const rawFieldIdCandidates = [
    draft.field_id,
    typeof metadata.field_id === "string" ? metadata.field_id : undefined,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const candidate of rawFieldIdCandidates) {
    if (!isUuid(candidate)) continue;
    const { data: fieldById } = await supabase
      .from("fields")
      .select("id")
      .eq("id", candidate)
      .eq("company_id", companyId)
      .eq("archived", false)
      .maybeSingle();

    if (fieldById?.id) return fieldById.id;
  }

  const rawFieldNameCandidates = [
    draft.field_name,
    typeof metadata.field_name === "string" ? metadata.field_name : undefined,
    rawFieldIdCandidates.find((value) => !isUuid(value)),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const candidate of rawFieldNameCandidates) {
    const { data: fieldsByName } = await supabase
      .from("fields")
      .select("id")
      .eq("company_id", companyId)
      .eq("archived", false)
      .ilike("name", candidate)
      .limit(1);

    if (fieldsByName && fieldsByName.length > 0) {
      return fieldsByName[0].id;
    }
  }

  return null;
}

async function resolveCropStructureId(
  supabase: SupabaseClient,
  companyId: string,
  draft: OperationDraft
): Promise<string | null> {
  const rawCandidate = String(draft.crop_structure_id || "").trim();
  if (!rawCandidate || !isUuid(rawCandidate)) return null;

  const { data: cropStructure } = await supabase
    .from("crop_structure")
    .select("id")
    .eq("id", rawCandidate)
    .eq("company_id", companyId)
    .eq("archived", false)
    .maybeSingle();

  return cropStructure?.id || null;
}

export async function POST(request: NextRequest) {
  try {
    const rawPayload = await request.json();
    const payload = normalizePayload(rawPayload);
    const draft = payload.draft;

    if (!draft || typeof draft !== 'object') {
      return NextResponse.json({ error: 'Draft payload is required' }, { status: 400 });
    }

    if (!draft.operation_type || !draft.date) {
      return NextResponse.json(
        { error: 'Operation type and date are required' },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();
    const safeUserId = payload.userId?.trim();
    const safeCompanyId = payload.companyId?.trim();

    if (!safeUserId || !isUuid(safeUserId)) {
      return NextResponse.json({ error: 'Valid userId is required' }, { status: 400 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, company_id')
      .eq('id', safeUserId)
      .maybeSingle();

    if (!profile?.company_id) {
      return NextResponse.json({ error: 'User profile or company not found' }, { status: 404 });
    }

    const resolvedCompanyId = String(profile.company_id);
    if (safeCompanyId && safeCompanyId !== resolvedCompanyId) {
      return NextResponse.json({ error: 'Company mismatch' }, { status: 403 });
    }

    const validOperationTypes = [
      'planting',
      'harvesting',
      'fertilization',
      'irrigation',
      'spraying',
      'cultivation',
    ];

    if (!validOperationTypes.includes(draft.operation_type)) {
      return NextResponse.json({ error: 'Invalid operation type' }, { status: 400 });
    }

    const normalizedDate = normalizeDate(draft.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    const fieldId = await resolveFieldId(supabase, resolvedCompanyId, draft);

    if (!fieldId) {
      return NextResponse.json({ error: 'Field is required' }, { status: 400 });
    }

    const { data: field } = await supabase
      .from('fields')
      .select('id')
      .eq('id', fieldId)
      .eq('company_id', resolvedCompanyId)
      .eq('archived', false)
      .maybeSingle();

    if (!field) {
      return NextResponse.json(
        { error: 'Field not found in current company or archived' },
        { status: 404 }
      );
    }

    const cropStructureId = await resolveCropStructureId(supabase, resolvedCompanyId, draft);

    const metadata: Record<string, unknown> =
      draft.metadata && typeof draft.metadata === "object" ? draft.metadata : {};
    const rawResponsibleId = String(metadata.responsible_id || "").trim();
    let responsibleUserId: string | null = null;

    if (rawResponsibleId && isUuid(rawResponsibleId)) {
      const { data: responsibleProfile } = await supabase
        .from("profiles")
        .select("id, company_id, status")
        .eq("id", rawResponsibleId)
        .eq("company_id", resolvedCompanyId)
        .maybeSingle();

      if (responsibleProfile?.id && responsibleProfile.status === "active") {
        responsibleUserId = responsibleProfile.id;
      }
    }

    const notePayload = buildOperationNotes(draft);
    const { data: operation, error } = await supabase
      .from('operations')
      .insert({
        user_id: safeUserId,
        company_id: resolvedCompanyId,
        field_id: fieldId,
        crop_structure_id: cropStructureId,
        operation_type: draft.operation_type,
        date: normalizedDate,
        notes: notePayload,
        responsible_user_id: responsibleUserId,
        work_status: "active",
      })
      .select()
      .single();

    if (!error && operation) {
      return NextResponse.json({
        success: true,
        operation,
      });
    }

    if (error) {
      const { data: existingOperation } = await supabase
        .from("operations")
        .select("*")
        .eq("company_id", resolvedCompanyId)
        .eq("field_id", fieldId)
        .eq("operation_type", draft.operation_type)
        .eq("date", normalizedDate)
        .eq("notes", notePayload)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingOperation) {
        return NextResponse.json({
          success: true,
          operation: existingOperation,
          duplicate: true,
        });
      }

      console.error('Database error while confirming draft:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to create operation' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create operation' },
      { status: 500 }
    );
  } catch (error) {
    console.error('Confirm draft error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
