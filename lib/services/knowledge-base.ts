import { supabase } from '@/lib/supabase/client';

export interface KnowledgeBase {
  id: string;
  company_id: string;
  name: string;
  scope_type: 'global' | 'project' | 'assistant';
  scope_project_id: string | null;
  scope_assistant_id: string | null;
  is_default: boolean;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDocument {
  id: string;
  company_id: string;
  knowledge_base_id: string;
  filename: string;
  file_type: string;
  file_size: number;
  file_url: string | null;
  extracted_text: string;
  metadata: Record<string, unknown>;
  status: 'ready' | 'uploaded' | 'failed';
  archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const SUPPORTED_KB_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'pdf', 'docx', 'txt'];

function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

async function getOrCreateGlobalKnowledgeBase(companyId: string, userId?: string): Promise<KnowledgeBase> {
  const { data: existing, error: readError } = await supabase
    .from('knowledge_bases')
    .select('*')
    .eq('company_id', companyId)
    .eq('scope_type', 'global')
    .eq('archived', false)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (readError && readError.code !== 'PGRST116') {
    throw readError;
  }

  if (existing) {
    return existing as KnowledgeBase;
  }

  const { data: created, error: createError } = await supabase
    .from('knowledge_bases')
    .insert({
      company_id: companyId,
      name: 'Global Knowledge Base',
      scope_type: 'global',
      is_default: true,
      created_by: userId || null,
    })
    .select('*')
    .single();

  if (createError) throw createError;
  return created as KnowledgeBase;
}

export async function listGlobalKnowledgeDocuments(companyId: string): Promise<KnowledgeDocument[]> {
  const globalBase = await getOrCreateGlobalKnowledgeBase(companyId);
  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('*')
    .eq('company_id', companyId)
    .eq('knowledge_base_id', globalBase.id)
    .eq('archived', false)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as KnowledgeDocument[];
}

async function extractTextForDocument(file: File): Promise<string> {
  const extension = getExtension(file.name);
  if (extension !== 'txt') return '';
  return (await file.text()).slice(0, 50000);
}

export async function uploadGlobalKnowledgeDocument(
  companyId: string,
  userId: string | undefined,
  file: File
): Promise<KnowledgeDocument> {
  const extension = getExtension(file.name);
  if (!SUPPORTED_KB_EXTENSIONS.includes(extension)) {
    throw new Error(`Unsupported format .${extension || 'unknown'}`);
  }

  const globalBase = await getOrCreateGlobalKnowledgeBase(companyId, userId);
  const extractedText = await extractTextForDocument(file);

  const { data, error } = await supabase
    .from('knowledge_documents')
    .insert({
      company_id: companyId,
      knowledge_base_id: globalBase.id,
      filename: file.name,
      file_type: file.type || extension,
      file_size: file.size,
      extracted_text: extractedText,
      metadata: {
        extension,
        source: 'manual_upload',
        text_extracted: extension === 'txt',
      },
      status: extractedText ? 'ready' : 'uploaded',
      created_by: userId || null,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as KnowledgeDocument;
}

export async function archiveKnowledgeDocument(documentId: string): Promise<void> {
  const { error } = await supabase
    .from('knowledge_documents')
    .update({
      archived: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', documentId);

  if (error) throw error;
}

export const KNOWLEDGE_SUPPORTED_FORMATS = {
  images: ['jpg', 'jpeg', 'png', 'webp'],
  documents: ['pdf', 'docx', 'txt'],
};

