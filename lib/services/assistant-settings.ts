import { supabase } from '@/lib/supabase/client';

export interface AssistantSettings {
  id: string;
  user_id: string;
  system_prompt: string;
  allow_operation_creation: boolean;
  require_confirmation: boolean;
  enable_recommendations: boolean;
  use_warehouse_data: boolean;
  use_inventory_data: boolean;
  region: string;
  farm_type: string;
  main_crops: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeFile {
  id: string;
  user_id: string;
  filename: string;
  file_type: string;
  file_size: number;
  file_url: string;
  extracted_text: string;
  uploaded_at: string;
}

export async function getAssistantSettings(companyId: string): Promise<AssistantSettings | null> {
  const { data, error } = await supabase
    .from('assistant_settings')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function upsertAssistantSettings(
  companyId: string,
  settings: Partial<AssistantSettings>
): Promise<AssistantSettings> {
  const { data, error } = await supabase
    .from('assistant_settings')
    .upsert(
      {
        company_id: companyId,
        ...settings,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'company_id',
      }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getKnowledgeFiles(companyId: string): Promise<KnowledgeFile[]> {
  const { data, error} = await supabase
    .from('assistant_knowledge_files')
    .select('*')
    .eq('company_id', companyId)
    .order('uploaded_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function deleteKnowledgeFile(fileId: string): Promise<void> {
  const { error } = await supabase
    .from('assistant_knowledge_files')
    .delete()
    .eq('id', fileId);

  if (error) throw error;
}

export async function addKnowledgeFile(
  companyId: string,
  filename: string,
  fileType: string,
  fileSize: number,
  fileUrl: string,
  extractedText: string = ''
): Promise<KnowledgeFile> {
  const { data, error } = await supabase
    .from('assistant_knowledge_files')
    .insert({
      company_id: companyId,
      filename,
      file_type: fileType,
      file_size: fileSize,
      file_url: fileUrl,
      extracted_text: extractedText,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
