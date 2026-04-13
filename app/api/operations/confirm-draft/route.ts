import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { OperationDraft } from '@/lib/types/operation-draft';
import { createHash } from 'crypto';

type ConfirmDraftRequest = {
  draft: OperationDraft;
  companyId?: string;
  userId?: string;
  confirmToken?: string;
  chatMessageId?: string;
};

type ResolvedMaterial = {
  productId: string;
  productName: string;
  category: string;
  unit: string;
  requiredQuantity: number;
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
    confirmToken: typeof payload?.confirmToken === 'string' ? payload.confirmToken : undefined,
    chatMessageId: typeof payload?.chatMessageId === 'string' ? payload.chatMessageId : undefined,
  };
}

function normalizeDate(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toISOString().slice(0, 10);
}

function toNumber(raw: unknown): number {
  const matched = String(raw ?? '').replace(',', '.').match(/-?\d+(\.\d+)?/);
  const num = Number(matched?.[0] ?? NaN);
  return Number.isFinite(num) ? num : 0;
}

function normalizeText(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

async function findProductByIdOrName(
  supabase: SupabaseClient,
  companyId: string,
  productIdRaw: unknown,
  productNameRaw: unknown
): Promise<{ id: string; name: string; type: string; unit: string | null } | null> {
  const productId = String(productIdRaw || "").trim();
  const productName = String(productNameRaw || "").trim();

  if (productId && isUuid(productId)) {
    const { data: byId } = await supabase
      .from("products")
      .select("id, name, type, unit")
      .eq("id", productId)
      .eq("company_id", companyId)
      .eq("archived", false)
      .maybeSingle();
    if (byId?.id) return byId as any;
  }

  if (productName) {
    const { data: byNameExact } = await supabase
      .from("products")
      .select("id, name, type, unit")
      .eq("company_id", companyId)
      .eq("archived", false)
      .ilike("name", productName)
      .limit(1);

    if (byNameExact && byNameExact.length > 0) return byNameExact[0] as any;

    const normalizedName = productName
      .replace(/[«»"'`]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (normalizedName) {
      const { data: byNameLike } = await supabase
        .from("products")
        .select("id, name, type, unit")
        .eq("company_id", companyId)
        .eq("archived", false)
        .ilike("name", `%${normalizedName}%`)
        .limit(1);

      if (byNameLike && byNameLike.length > 0) return byNameLike[0] as any;
    }
  }

  return null;
}

function hasWarehouseMaterialHints(draft: OperationDraft): boolean {
  const metadata: Record<string, unknown> =
    draft.metadata && typeof draft.metadata === "object" ? draft.metadata : {};

  const hasMainProduct = String(metadata.product || "").trim().length > 0;
  const hasMainRate = toNumber(metadata.rate_per_ha ?? metadata.rate) > 0;
  const additional = Array.isArray(metadata.additional_products_list)
    ? metadata.additional_products_list
    : [];
  const hasAdditional = additional.some((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return String(row.product || "").trim().length > 0 || toNumber(row.rate_per_ha) > 0;
  });

  return hasMainProduct || hasMainRate || hasAdditional;
}

async function resolveDraftMaterials(
  supabase: SupabaseClient,
  companyId: string,
  draft: OperationDraft,
  fieldArea: number
): Promise<ResolvedMaterial[]> {
  const metadata: Record<string, unknown> =
    draft.metadata && typeof draft.metadata === "object" ? draft.metadata : {};

  const materials: ResolvedMaterial[] = [];

  const mainRatePerHa = toNumber(metadata.rate_per_ha ?? metadata.rate);
  if (mainRatePerHa > 0) {
    const mainProduct = await findProductByIdOrName(
      supabase,
      companyId,
      metadata.product_id,
      metadata.product
    );
    if (mainProduct?.id) {
      materials.push({
        productId: String(mainProduct.id),
        productName: String(mainProduct.name),
        category: String(mainProduct.type || "unknown"),
        unit: String(mainProduct.unit || "kg"),
        requiredQuantity: fieldArea * mainRatePerHa,
      });
    }
  }

  const rawAdditional = Array.isArray(metadata.additional_products_list)
    ? metadata.additional_products_list
    : [];

  for (const row of rawAdditional) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const ratePerHa = toNumber(item.rate_per_ha);
    if (ratePerHa <= 0) continue;

    const product = await findProductByIdOrName(
      supabase,
      companyId,
      item.product_id,
      item.product
    );
    if (!product?.id) continue;

    materials.push({
      productId: String(product.id),
      productName: String(product.name),
      category: String(product.type || "unknown"),
      unit: String(product.unit || "kg"),
      requiredQuantity: fieldArea * ratePerHa,
    });
  }

  const mergedByProduct = new Map<string, ResolvedMaterial>();
  for (const material of materials) {
    const existing = mergedByProduct.get(material.productId);
    if (existing) {
      existing.requiredQuantity += material.requiredQuantity;
    } else {
      mergedByProduct.set(material.productId, { ...material });
    }
  }

  return Array.from(mergedByProduct.values()).filter((m) => m.requiredQuantity > 0);
}

async function ensureWarehouseIssueRequest(params: {
  supabase: SupabaseClient;
  companyId: string;
  operationId: string;
  fieldId: string;
  draft: OperationDraft;
  recipientUserId: string | null;
  confirmToken: string;
  fieldArea: number;
  preResolvedMaterials?: ResolvedMaterial[];
}): Promise<{ requestId: string | null; created: boolean; skippedReason?: string }> {
  const {
    supabase,
    companyId,
    operationId,
    fieldId,
    draft,
    recipientUserId,
    confirmToken,
    fieldArea,
    preResolvedMaterials,
  } = params;

  if (!recipientUserId) {
    return { requestId: null, created: false, skippedReason: "recipient_not_set" };
  }

  const materials =
    preResolvedMaterials && preResolvedMaterials.length >= 0
      ? preResolvedMaterials
      : await resolveDraftMaterials(supabase, companyId, draft, fieldArea);
  if (materials.length === 0) {
    return { requestId: null, created: false, skippedReason: "no_materials" };
  }

  const { data: existingRequest } = await supabase
    .from("warehouse_issue_requests")
    .select("id")
    .eq("operation_id", operationId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (existingRequest?.id) {
    return { requestId: String(existingRequest.id), created: false };
  }

  const metadata: Record<string, unknown> =
    draft.metadata && typeof draft.metadata === "object" ? draft.metadata : {};
  const comment = String(metadata.comments || draft.notes || "").trim() || null;
  const plannedDatetime = String(draft.operation_datetime || "").trim() || null;

  const { data: requestRow, error: requestError } = await supabase
    .from("warehouse_issue_requests")
    .insert({
      company_id: companyId,
      operation_id: operationId,
      field_id: fieldId,
      recipient_user_id: recipientUserId,
      planned_datetime: plannedDatetime,
      comment,
      status: "new",
      confirm_token: confirmToken,
    })
    .select("id")
    .single();

  if (requestError || !requestRow?.id) {
    throw new Error(requestError?.message || "Failed to create warehouse issue request");
  }

  const itemsPayload = materials.map((item) => ({
    request_id: requestRow.id,
    company_id: companyId,
    product_id: item.productId,
    product_category: item.category,
    required_quantity: Number(item.requiredQuantity.toFixed(4)),
    unit: item.unit || "kg",
  }));

  const { error: itemsError } = await supabase
    .from("warehouse_issue_request_items")
    .insert(itemsPayload);

  if (itemsError) {
    throw new Error(itemsError.message || "Failed to create warehouse issue request items");
  }

  return { requestId: String(requestRow.id), created: true };
}

function buildDraftConfirmToken(params: {
  draft: OperationDraft;
  companyId: string;
  userId: string;
  fieldId: string;
  cropStructureId: string | null;
  responsibleUserId: string | null;
  normalizedDate: string;
}): string {
  const { draft, companyId, userId, fieldId, cropStructureId, responsibleUserId, normalizedDate } = params;
  const metadata: Record<string, unknown> =
    draft.metadata && typeof draft.metadata === 'object' ? draft.metadata : {};

  const payload = {
    companyId,
    userId,
    fieldId,
    cropStructureId: cropStructureId || null,
    responsibleUserId: responsibleUserId || null,
    operationType: normalizeText(draft.operation_type),
    date: normalizedDate,
    datetime: normalizeText(draft.operation_datetime),
    cropId: normalizeText(draft.crop_id),
    cropName: normalizeText(draft.crop_name || metadata.crop),
    target: normalizeText(metadata.target),
    productId: normalizeText(metadata.product_id),
    product: normalizeText(metadata.product),
    ratePerHa: toNumber(metadata.rate_per_ha ?? metadata.rate),
    sprayVolumePerHa: toNumber(metadata.spray_volume_per_ha ?? metadata.water_rate),
    additionalProducts: normalizeText(metadata.additional_products),
    notes: normalizeText(metadata.comments || draft.notes),
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

function hasConfirmTokenInNotes(notes: unknown, token: string): boolean {
  const text = String(notes || '');
  return text.includes(`[draft_confirm_token:${token}]`);
}

async function persistDraftConfirmedState(
  supabase: SupabaseClient,
  chatMessageId: string | undefined,
  draft: OperationDraft,
  confirmToken: string,
  operationId: string | null,
  confirmedAt: string
): Promise<void> {
  const safeMessageId = String(chatMessageId || '').trim();
  if (!safeMessageId || !isUuid(safeMessageId)) return;

  const { data: chatMessage } = await supabase
    .from('chat_messages')
    .select('id, metadata')
    .eq('id', safeMessageId)
    .maybeSingle();

  if (!chatMessage?.id) return;

  const existingMetadata =
    chatMessage.metadata && typeof chatMessage.metadata === 'object'
      ? (chatMessage.metadata as Record<string, unknown>)
      : {};

  const draftMetadata =
    draft.metadata && typeof draft.metadata === 'object'
      ? (draft.metadata as Record<string, unknown>)
      : {};

  const updatedDraft: OperationDraft = {
    ...draft,
    metadata: {
      ...draftMetadata,
      confirmation_state: 'confirmed',
      confirmed_at: confirmedAt,
      operation_id: operationId,
      confirm_token: confirmToken,
    },
  };

  const nextMetadata = {
    ...existingMetadata,
    draft: updatedDraft,
    draft_status: 'confirmed',
    confirmed_at: confirmedAt,
    operation_id: operationId,
    confirm_token: confirmToken,
  };

  await supabase
    .from('chat_messages')
    .update({ metadata: nextMetadata })
    .eq('id', safeMessageId);
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
      .select('id, area')
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
    const rawResponsibleText = String(metadata.responsible || metadata.performer || "").trim();
    let responsibleUserId: string | null = null;
    let responsibleRoleError: string | null = null;

    if (rawResponsibleId && isUuid(rawResponsibleId)) {
      const { data: responsibleProfile } = await supabase
        .from("profiles")
        .select("id, company_id, status, role, email, full_name")
        .eq("id", rawResponsibleId)
        .eq("company_id", resolvedCompanyId)
        .maybeSingle();

      if (responsibleProfile?.id && responsibleProfile.status === "active" && responsibleProfile.role === "specialist") {
        responsibleUserId = responsibleProfile.id;
        metadata.responsible = String((responsibleProfile as any).full_name || metadata.responsible || "");
      } else if (responsibleProfile?.id && responsibleProfile.status === "active" && responsibleProfile.role !== "specialist") {
        responsibleRoleError = "Нельзя назначить задачу на этого пользователя: он не специалист.";
      }
    }

    if (!responsibleUserId && !responsibleRoleError && rawResponsibleText) {
      const emailMatch = rawResponsibleText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      const normalizedEmail = String(emailMatch?.[0] || "").trim().toLowerCase();
      if (normalizedEmail) {
        const { data: responsibleProfileByEmail } = await supabase
          .from("profiles")
          .select("id, company_id, status, role, email, full_name")
          .eq("company_id", resolvedCompanyId)
          .eq("status", "active")
          .ilike("email", normalizedEmail)
          .limit(1)
          .maybeSingle();

        if (responsibleProfileByEmail?.id && responsibleProfileByEmail.role === "specialist") {
          responsibleUserId = String(responsibleProfileByEmail.id);
          metadata.responsible_id = responsibleUserId;
          metadata.responsible = String((responsibleProfileByEmail as any).full_name || responsibleProfileByEmail.email || normalizedEmail);
        } else if (responsibleProfileByEmail?.id) {
          responsibleRoleError = "Такого специалиста нет. Этот пользователь есть в системе, но его роль не подходит для выполнения полевых задач.";
        }
      }
    }

    if (!responsibleUserId && !responsibleRoleError && rawResponsibleText && !rawResponsibleText.includes("@")) {
      const normalizedFullName = rawResponsibleText.replace(/\s+/g, " ").trim();
      const { data: responsibleProfileByName } = await supabase
        .from("profiles")
        .select("id, company_id, status, role, email, full_name")
        .eq("company_id", resolvedCompanyId)
        .eq("status", "active")
        .ilike("full_name", normalizedFullName)
        .limit(1)
        .maybeSingle();

      if (responsibleProfileByName?.id && responsibleProfileByName.role === "specialist") {
        responsibleUserId = String(responsibleProfileByName.id);
        metadata.responsible_id = responsibleUserId;
        metadata.responsible = String((responsibleProfileByName as any).full_name || normalizedFullName);
      } else if (responsibleProfileByName?.id) {
        responsibleRoleError = "Нельзя назначить задачу на этого пользователя: он не специалист.";
      }
    }

    if (responsibleRoleError) {
      return NextResponse.json({ error: responsibleRoleError }, { status: 400 });
    }

    const fieldArea = toNumber(field?.area);
    const preResolvedMaterials = await resolveDraftMaterials(
      supabase,
      resolvedCompanyId,
      draft,
      fieldArea
    );

    const hasMaterialHints = hasWarehouseMaterialHints(draft);

    if (preResolvedMaterials.length > 0 && !responsibleUserId) {
      return NextResponse.json(
        { error: "Responsible recipient is required to create warehouse issue request. Select a responsible user from the company users list." },
        { status: 400 }
      );
    }

    if (hasMaterialHints && preResolvedMaterials.length === 0) {
      return NextResponse.json(
        { error: "Warehouse materials in draft are not mapped to product catalog" },
        { status: 400 }
      );
    }

    const notePayload = buildOperationNotes(draft);
    const confirmedAt = new Date().toISOString();
    const serverConfirmToken = buildDraftConfirmToken({
      draft,
      companyId: resolvedCompanyId,
      userId: safeUserId,
      fieldId,
      cropStructureId,
      responsibleUserId,
      normalizedDate,
    });
    const effectiveConfirmToken = String(payload.confirmToken || serverConfirmToken).trim() || serverConfirmToken;

    const { data: existingByToken } = await supabase
      .from("operations")
      .select("*")
      .eq("company_id", resolvedCompanyId)
      .eq("field_id", fieldId)
      .eq("operation_type", draft.operation_type)
      .eq("date", normalizedDate)
      .ilike("notes", `%[draft_confirm_token:${effectiveConfirmToken}]%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingByToken) {
      const ensuredRequest = await ensureWarehouseIssueRequest({
        supabase,
        companyId: resolvedCompanyId,
        operationId: String(existingByToken.id),
        fieldId,
        draft,
        recipientUserId: responsibleUserId,
        confirmToken: effectiveConfirmToken,
        fieldArea,
        preResolvedMaterials,
      });
      const warehouseRequestId = ensuredRequest.requestId;

      await persistDraftConfirmedState(
        supabase,
        payload.chatMessageId,
        draft,
        effectiveConfirmToken,
        String(existingByToken.id || ''),
        confirmedAt
      );
      return NextResponse.json({
        success: true,
        operation: existingByToken,
        duplicate: true,
        alreadyConfirmed: true,
        confirmToken: effectiveConfirmToken,
        confirmedAt,
        warehouseRequestId,
      });
    }

    const notePayloadWithToken = `${notePayload}\n\n[draft_confirm_token:${effectiveConfirmToken}]`;
    const { data: operation, error } = await supabase
      .from('operations')
      .insert({
        user_id: safeUserId,
        company_id: resolvedCompanyId,
        field_id: fieldId,
        crop_structure_id: cropStructureId,
        operation_type: draft.operation_type,
        date: normalizedDate,
        notes: notePayloadWithToken,
        responsible_user_id: responsibleUserId,
        work_status: "active",
      })
      .select()
      .single();

    if (!error && operation) {
      try {
        const ensuredRequest = await ensureWarehouseIssueRequest({
          supabase,
          companyId: resolvedCompanyId,
          operationId: String(operation.id),
          fieldId,
          draft,
          recipientUserId: responsibleUserId,
          confirmToken: effectiveConfirmToken,
          fieldArea,
          preResolvedMaterials,
        });
        const warehouseRequestId = ensuredRequest.requestId;

        await persistDraftConfirmedState(
          supabase,
          payload.chatMessageId,
          draft,
          effectiveConfirmToken,
          String(operation.id || ''),
          confirmedAt
        );
        return NextResponse.json({
          success: true,
          operation,
          confirmToken: effectiveConfirmToken,
          confirmedAt,
          warehouseRequestId,
          warehouseRequestSkippedReason: ensuredRequest.skippedReason || null,
        });
      } catch (warehouseRequestError) {
        console.error("Warehouse request create failed:", warehouseRequestError);
        await supabase
          .from("operations")
          .delete()
          .eq("id", operation.id)
          .eq("company_id", resolvedCompanyId);
        return NextResponse.json(
          { error: warehouseRequestError instanceof Error ? warehouseRequestError.message : "Failed to create warehouse issue request" },
          { status: 500 }
        );
      }
    }

    if (error) {
      const { data: existingOperation } = await supabase
        .from("operations")
        .select("*")
        .eq("company_id", resolvedCompanyId)
        .eq("field_id", fieldId)
        .eq("operation_type", draft.operation_type)
        .eq("date", normalizedDate)
        .ilike("notes", `%[draft_confirm_token:${effectiveConfirmToken}]%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingOperation) {
        const ensuredRequest = await ensureWarehouseIssueRequest({
          supabase,
          companyId: resolvedCompanyId,
          operationId: String(existingOperation.id),
          fieldId,
          draft,
          recipientUserId: responsibleUserId,
          confirmToken: effectiveConfirmToken,
          fieldArea,
          preResolvedMaterials,
        });
        const warehouseRequestId = ensuredRequest.requestId;

        await persistDraftConfirmedState(
          supabase,
          payload.chatMessageId,
          draft,
          effectiveConfirmToken,
          String(existingOperation.id || ''),
          confirmedAt
        );
        return NextResponse.json({
          success: true,
          operation: existingOperation,
          duplicate: true,
          alreadyConfirmed: hasConfirmTokenInNotes(existingOperation.notes, effectiveConfirmToken),
          confirmToken: effectiveConfirmToken,
          confirmedAt,
          warehouseRequestId,
          warehouseRequestSkippedReason: ensuredRequest.skippedReason || null,
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
