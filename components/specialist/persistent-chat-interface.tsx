'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatSidebar } from './chat-sidebar';
import { ChatInterface } from './chat-interface';
import { useAuth } from '@/lib/contexts/auth-context';
import type { AssistantRuntimeUiContext } from "@/lib/assistant/shell";
import {
  getProjects,
  createProject,
  renameProject,
  deleteProject,
  getChats,
  getChatMessages,
  createChat,
  addChatMessage,
  generateChatTitle,
  updateChatTitle,
  deleteChat,
  updateChatMessageMetadata,
  Chat,
  ChatProject,
} from '@/lib/services/chat';
import { useToast } from '@/hooks/use-toast';

interface PersistentChatInterfaceProps {
  onMessagesChange?: (chatId: string, messages: any[]) => void;
  embedded?: boolean;
  runtimeContext?: AssistantRuntimeUiContext;
  assistantSessionId?: string;
}

function sanitizeAssistantMessage(content: string, draft?: any): string {
  let cleanContent = content || '';
  cleanContent = cleanContent.replace(/<draft_json>[\s\S]*?<\/draft_json>/gi, '');
  cleanContent = cleanContent.replace(/```(?:json)?[\s\S]*?"draft"[\s\S]*?```/gi, '');
  cleanContent = cleanContent.replace(/\{[\s\S]*?"draft"[\s\S]*?\}/gi, '');
  cleanContent = cleanContent.trim();

  if (!cleanContent && draft) {
    return '';
  }

  if (!cleanContent) {
    return 'Assistant response restored from history.';
  }

  return cleanContent;
}

export function PersistentChatInterface({
  onMessagesChange,
  embedded = false,
  runtimeContext,
  assistantSessionId,
}: PersistentChatInterfaceProps) {
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [chatsByProject, setChatsByProject] = useState<Record<string, Chat[]>>({});
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();
  const initializedProfileKey = useRef<string | null>(null);
  const chatSelectionStorageKey = useMemo(() => {
    if (!profile?.id || !profile?.company_id) return null;
    return `assistant-chat-selection:${profile.id}:${profile.company_id}`;
  }, [profile?.id, profile?.company_id]);

  const isReadOnly = profile?.role === 'specialist';
  const hasFullAccess =
    profile?.role === 'company_admin' ||
    profile?.role === 'global_admin' ||
    profile?.role === 'agronomist';

  const selectedProjectChats = useMemo(
    () => (selectedProjectId ? chatsByProject[selectedProjectId] || [] : []),
    [selectedProjectId, chatsByProject]
  );

  useEffect(() => {
    const profileKey =
      profile?.id && profile?.company_id ? `${profile.id}:${profile.company_id}` : null;

    if (!profileKey) {
      initializedProfileKey.current = null;
      setProjects([]);
      setSelectedProjectId(null);
      setChatsByProject({});
      setActiveChatId(null);
      setMessages([]);
      setLoading(false);
      return;
    }

    if (initializedProfileKey.current !== profileKey) {
      initializedProfileKey.current = profileKey;
      void initializeProjectsAndChats();
    }
  }, [profile?.id, profile?.company_id]);

  useEffect(() => {
    if (!chatSelectionStorageKey) return;
    const payload = {
      selectedProjectId,
      activeChatId,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(chatSelectionStorageKey, JSON.stringify(payload));
  }, [chatSelectionStorageKey, selectedProjectId, activeChatId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setActiveChatId(null);
      setMessages([]);
      return;
    }

    if (selectedProjectChats.length === 0) {
      setActiveChatId(null);
      setMessages([]);
      return;
    }

    if (!activeChatId || !selectedProjectChats.some((chat) => chat.id === activeChatId)) {
      setActiveChatId(selectedProjectChats[0].id);
    }
  }, [selectedProjectId, selectedProjectChats, activeChatId]);

  useEffect(() => {
    if (activeChatId) {
      void loadChatMessages(activeChatId);
    }
  }, [activeChatId]);

  const loadChatsForAllProjects = async (
    projectList: ChatProject[],
    companyId: string,
    userId: string
  ): Promise<Record<string, Chat[]>> => {
    if (projectList.length === 0) return {};

    const entries = await Promise.all(
      projectList.map(async (project) => {
        const chats = await getChats(userId, companyId, project.id);
        return [project.id, chats] as const;
      })
    );

    return Object.fromEntries(entries);
  };

  const initializeProjectsAndChats = async () => {
    if (!profile?.id || !profile?.company_id) return;
    try {
      setLoading(true);
      let existingProjects = await getProjects(profile.id, profile.company_id);

      if (existingProjects.length === 0) {
        const defaultProject = await createProject(
          profile.id,
          profile.company_id,
          'Общие консультации'
        );
        existingProjects = [defaultProject];
      }

      const groupedChats = await loadChatsForAllProjects(
        existingProjects,
        profile.company_id,
        profile.id
      );

      setProjects(existingProjects);
      setChatsByProject(groupedChats);
      let savedProjectId: string | null = null;
      let savedChatId: string | null = null;
      if (chatSelectionStorageKey) {
        try {
          const raw = localStorage.getItem(chatSelectionStorageKey);
          if (raw) {
            const saved = JSON.parse(raw) as { selectedProjectId?: string; activeChatId?: string };
            savedProjectId = saved.selectedProjectId ? String(saved.selectedProjectId) : null;
            savedChatId = saved.activeChatId ? String(saved.activeChatId) : null;
          }
        } catch {
          // ignore malformed local storage
        }
      }

      const firstProjectId = existingProjects[0]?.id || null;
      const nextProjectId =
        savedProjectId && existingProjects.some((project) => project.id === savedProjectId)
          ? savedProjectId
          : firstProjectId;
      const nextProjectChats = nextProjectId ? groupedChats[nextProjectId] || [] : [];
      const nextChatId =
        savedChatId && nextProjectChats.some((chat) => chat.id === savedChatId)
          ? savedChatId
          : nextProjectChats[0]?.id || null;

      setSelectedProjectId(nextProjectId);
      setActiveChatId(nextChatId);
    } catch (error) {
      console.error('Failed to initialize projects/chats:', error);
      toast({
        title: 'Error',
        description: 'Failed to load projects',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async () => {
    if (!profile?.id || !profile?.company_id) return;
    const name = window.prompt('Название проекта', 'Новый проект');
    if (!name || !name.trim()) return;
    try {
      const project = await createProject(profile.id, profile.company_id, name.trim());
      setProjects((prev) => [project, ...prev]);
      setChatsByProject((prev) => ({ ...prev, [project.id]: [] }));
      setSelectedProjectId(project.id);
      setActiveChatId(null);
      setMessages([]);
    } catch (error) {
      console.error('Failed to create project:', error);
      toast({
        title: 'Error',
        description: 'Failed to create project',
        variant: 'destructive',
      });
    }
  };

  const handleRenameProject = async (projectId: string) => {
    const current = projects.find((p) => p.id === projectId);
    const name = window.prompt('Переименовать проект', current?.name || '');
    if (!name || !name.trim()) return;
    try {
      await renameProject(projectId, name.trim());
      setProjects((prev) =>
        prev.map((project) =>
          project.id === projectId
            ? { ...project, name: name.trim(), updated_at: new Date().toISOString() }
            : project
        )
      );
    } catch (error) {
      console.error('Failed to rename project:', error);
      toast({
        title: 'Error',
        description: 'Failed to rename project',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    const confirmed = window.confirm(
      'Удалить проект? Чаты проекта останутся в истории, но сам проект будет скрыт.'
    );
    if (!confirmed) return;
    try {
      await deleteProject(projectId);
      const updatedProjects = projects.filter((project) => project.id !== projectId);
      setProjects(updatedProjects);
      setChatsByProject((prev) => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      if (selectedProjectId === projectId) {
        const nextProjectId = updatedProjects[0]?.id || null;
        setSelectedProjectId(nextProjectId);
        setActiveChatId(nextProjectId ? chatsByProject[nextProjectId]?.[0]?.id || null : null);
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete project',
        variant: 'destructive',
      });
    }
  };

  const handleNewChat = async () => {
    if (!profile?.id || !profile?.company_id || !selectedProjectId) return;
    try {
      const newChat = await createChat(profile.id, profile.company_id, 'New Chat', selectedProjectId);
      setChatsByProject((prev) => ({
        ...prev,
        [selectedProjectId]: [newChat, ...(prev[selectedProjectId] || [])],
      }));
      setActiveChatId(newChat.id);
      setMessages([]);
    } catch (error) {
      console.error('Failed to create chat:', error);
      toast({
        title: 'Error',
        description: 'Failed to create new chat',
        variant: 'destructive',
      });
    }
  };

  const handleSelectChat = (chatId: string) => {
    setMessages([]);
    setActiveChatId(chatId);
  };

  const handleDeleteChat = async (chatId: string) => {
    if (!profile?.id || !profile?.company_id) return;
    const confirmed = window.confirm('Удалить этот чат? Действие нельзя отменить.');
    if (!confirmed) return;

    try {
      await deleteChat(chatId);

      const chatProjectId =
        Object.entries(chatsByProject).find(([, list]) => list.some((chat) => chat.id === chatId))?.[0] ||
        selectedProjectId;
      if (!chatProjectId) return;

      const updatedChats = await getChats(profile.id, profile.company_id, chatProjectId);
      setChatsByProject((prev) => ({ ...prev, [chatProjectId]: updatedChats }));

      if (activeChatId === chatId) {
        if (chatProjectId === selectedProjectId && updatedChats.length > 0) {
          setActiveChatId(updatedChats[0].id);
        } else {
          setActiveChatId(null);
          setMessages([]);
        }
      }
    } catch (error) {
      console.error('Failed to delete chat:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete chat',
        variant: 'destructive',
      });
    }
  };

  const loadChatMessages = async (chatId: string) => {
    try {
      setMessagesLoading(true);
      const chatMessages = await getChatMessages(chatId);
      const formattedMessages = chatMessages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content:
          msg.role === 'assistant'
            ? sanitizeAssistantMessage(msg.content, msg.metadata?.draft)
            : msg.content,
        attachments: Array.isArray(msg.metadata?.attachments) ? msg.metadata.attachments : [],
        draft: msg.metadata?.draft,
        draftStatus:
          msg.metadata?.draft_status === 'confirmed'
            ? 'confirmed'
            : msg.metadata?.draft_status === 'cancelled'
              ? 'cancelled'
              : msg.metadata?.draft?.metadata?.confirmation_state === 'confirmed'
                ? 'confirmed'
                : msg.metadata?.draft
                  ? 'draft'
                  : undefined,
        draftConfirmedAt: msg.metadata?.confirmed_at,
        createdOperationId: msg.metadata?.operation_id,
        draftConfirmToken: msg.metadata?.confirm_token,
      }));
      setMessages(formattedMessages);
      if (onMessagesChange) {
        onMessagesChange(chatId, formattedMessages);
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  };

  const handleMessageSent = async (
    userMessage: string,
    assistantResponse: string,
    draft?: any,
    userMetadata?: Record<string, unknown>
  ) => {
    try {
      if (!profile?.id || !profile?.company_id) {
        throw new Error('Profile is not fully loaded');
      }
      if (!selectedProjectId) {
        throw new Error('Project is not selected');
      }

      let targetChatId = activeChatId;
      if (!targetChatId) {
        const emergencyChat = await createChat(profile.id, profile.company_id, 'New Chat', selectedProjectId);
        setChatsByProject((prev) => ({
          ...prev,
          [selectedProjectId]: [emergencyChat, ...(prev[selectedProjectId] || [])],
        }));
        setActiveChatId(emergencyChat.id);
        targetChatId = emergencyChat.id;
      }

      const cleanedAssistantResponse = sanitizeAssistantMessage(assistantResponse, draft);

      await addChatMessage(targetChatId, 'user', userMessage, userMetadata || undefined);
      await addChatMessage(
        targetChatId,
        'assistant',
        cleanedAssistantResponse,
        draft ? { draft, draft_status: 'draft' } : undefined
      );

      const projectChats = chatsByProject[selectedProjectId] || [];
      const chat = projectChats.find((c) => c.id === targetChatId);
      if (!chat || chat.title === 'New Chat') {
        const newTitle = await generateChatTitle(userMessage);
        await updateChatTitle(targetChatId, newTitle);
      }

      const updatedProjectChats = await getChats(profile.id, profile.company_id, selectedProjectId);
      setChatsByProject((prev) => ({ ...prev, [selectedProjectId]: updatedProjectChats }));
      await loadChatMessages(targetChatId);
    } catch (error) {
      console.error('Failed to save messages:', error);
    }
  };

  const handleDraftConfirmed = async (messageId: string | undefined, draft: any) => {
    try {
      const confirmedAt = String(draft?.metadata?.confirmed_at || new Date().toISOString());
      const operationId = draft?.metadata?.operation_id ? String(draft.metadata.operation_id) : null;
      const confirmToken = draft?.metadata?.confirm_token ? String(draft.metadata.confirm_token) : null;

      if (messageId) {
        await updateChatMessageMetadata(messageId, {
          draft,
          draft_status: 'confirmed',
          confirmed_at: confirmedAt,
          operation_id: operationId,
          confirm_token: confirmToken,
        });
        return;
      }

      if (!activeChatId) return;
      const chatMessages = await getChatMessages(activeChatId);
      const fallbackMessage = [...chatMessages]
        .reverse()
        .find((msg) => msg.role === 'assistant' && msg.metadata?.draft_status !== 'confirmed' && msg.metadata?.draft);

      if (fallbackMessage?.id) {
        await updateChatMessageMetadata(fallbackMessage.id, {
          ...fallbackMessage.metadata,
          draft,
          draft_status: 'confirmed',
          confirmed_at: confirmedAt,
          operation_id: operationId,
          confirm_token: confirmToken,
        });
        await loadChatMessages(activeChatId);
      }
    } catch (error) {
      console.error('Failed to mark draft as confirmed:', error);
    }
  };

  return (
    <div className={embedded ? "flex h-full gap-4 overflow-hidden" : "flex h-[calc(100vh-12rem)] gap-4 overflow-hidden"}>
      <div className="w-80 flex-shrink-0 min-h-0">
        <ChatSidebar
          projects={projects}
          selectedProjectId={selectedProjectId}
          chatsByProject={chatsByProject}
          activeChatId={activeChatId}
          onSelectProject={setSelectedProjectId}
          onCreateProject={handleCreateProject}
          onRenameProject={handleRenameProject}
          onDeleteProject={handleDeleteProject}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onDeleteChat={handleDeleteChat}
          loading={loading}
        />
      </div>
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
        <ChatInterface
          key={activeChatId || 'empty-chat'}
          chatId={activeChatId}
          initialMessages={messages}
          runtimeContext={runtimeContext}
          assistantSessionId={assistantSessionId}
          onMessageSent={handleMessageSent}
          onDraftConfirmed={handleDraftConfirmed}
          readOnlyMode={isReadOnly}
          chatReady={!loading && !messagesLoading && !!activeChatId && !!profile?.id && !!profile?.company_id}
          accessMode={hasFullAccess ? 'full' : 'limited'}
          userRole={profile?.role || null}
        />
      </div>
    </div>
  );
}
