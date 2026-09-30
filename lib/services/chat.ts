import { supabase } from '@/lib/supabase/client';

export interface ChatProject {
  id: string;
  user_id: string;
  company_id: string;
  name: string;
  color: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Chat {
  id: string;
  user_id: string;
  company_id: string;
  project_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: any;
  created_at: string;
}

export async function getProjects(userId: string, companyId: string): Promise<ChatProject[]> {
  const { data, error } = await supabase
    .from('chat_projects')
    .select('*')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('archived', false)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createProject(
  userId: string,
  companyId: string,
  name: string
): Promise<ChatProject> {
  const safeName = name.trim() || 'Новый проект';
  const { data, error } = await supabase
    .from('chat_projects')
    .insert({
      user_id: userId,
      company_id: companyId,
      name: safeName,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  const safeName = name.trim();
  if (!safeName) return;
  const { error } = await supabase
    .from('chat_projects')
    .update({
      name: safeName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId);

  if (error) throw error;
}

export async function deleteProject(projectId: string): Promise<void> {
  const { error } = await supabase
    .from('chat_projects')
    .update({
      archived: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId);

  if (error) throw error;
}

export async function getChats(
  userId: string,
  companyId: string,
  projectId?: string | null
): Promise<Chat[]> {
  let query = supabase
    .from('chats')
    .select('*')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false });

  if (projectId) {
    query = query.eq('project_id', projectId);
  } else {
    query = query.is('project_id', null);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

export async function getChat(chatId: string): Promise<Chat | null> {
  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .eq('id', chatId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createChat(
  userId: string,
  companyId: string,
  title: string = 'New Chat',
  projectId?: string | null
): Promise<Chat> {
  if (!companyId) {
    throw new Error('companyId is required to create a chat');
  }

  const { data, error } = await supabase
    .from('chats')
    .insert({
      user_id: userId,
      company_id: companyId,
      project_id: projectId || null,
      title,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateChatTitle(chatId: string, title: string): Promise<void> {
  const { error } = await supabase
    .from('chats')
    .update({
      title,
      updated_at: new Date().toISOString(),
    })
    .eq('id', chatId);

  if (error) throw error;
}

export async function updateChatTimestamp(chatId: string): Promise<void> {
  const { error } = await supabase
    .from('chats')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', chatId);

  if (error) throw error;
}

export async function moveChatToProject(chatId: string, projectId: string | null): Promise<void> {
  const { error } = await supabase
    .from('chats')
    .update({
      project_id: projectId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', chatId);

  if (error) throw error;
}

export async function deleteChat(chatId: string): Promise<void> {
  const { error } = await supabase
    .from('chats')
    .delete()
    .eq('id', chatId);

  if (error) throw error;
}

export async function getChatMessages(chatId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function addChatMessage(
  chatId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata?: any
): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      chat_id: chatId,
      role,
      content,
      metadata,
    })
    .select()
    .single();

  if (error) throw error;

  await updateChatTimestamp(chatId);

  return data;
}

export async function updateChatMessageMetadata(
  messageId: string,
  metadata: any
): Promise<void> {
  const { error } = await supabase
    .from('chat_messages')
    .update({ metadata })
    .eq('id', messageId);

  if (error) throw error;
}

export async function generateChatTitle(firstMessage: string): Promise<string> {
  const cleaned = firstMessage.trim().toLowerCase();

  if (cleaned.includes('опрыскивание') || cleaned.includes('spraying')) {
    const fieldMatch = cleaned.match(/поле\s+(\d+|[а-яё]+)/i) || cleaned.match(/field\s+(\w+)/i);
    const cropMatch = cleaned.match(/(картофель|картошк|пшениц|ячмен|кукуруз|подсолнечник)/i);

    if (fieldMatch && cropMatch) {
      return `Опрыскивание ${cropMatch[1]} поле ${fieldMatch[1]}`;
    } else if (fieldMatch) {
      return `Опрыскивание поле ${fieldMatch[1]}`;
    }
    return 'Опрыскивание';
  }

  if (cleaned.includes('посев') || cleaned.includes('planting')) {
    return 'Планирование посева';
  }

  if (cleaned.includes('урожай') || cleaned.includes('harvest')) {
    return 'Уборка урожая';
  }

  if (cleaned.includes('структура') || cleaned.includes('распределение') || cleaned.includes('distribution')) {
    return 'Анализ структуры посевов';
  }

  if (cleaned.includes('сколько') || cleaned.includes('how many')) {
    if (cleaned.includes('пол') || cleaned.includes('field')) {
      return 'Информация о полях';
    }
    if (cleaned.includes('га') || cleaned.includes('гектар') || cleaned.includes('hectare')) {
      return 'Площадь хозяйства';
    }
  }

  if (cleaned.includes('операци') || cleaned.includes('operation')) {
    return 'История операций';
  }

  const words = firstMessage.split(' ').slice(0, 5).join(' ');
  return words.length > 40 ? words.substring(0, 40) + '...' : words;
}
