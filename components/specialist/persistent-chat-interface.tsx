'use client';

import { useState, useEffect, useRef } from 'react';
import { ChatSidebar } from './chat-sidebar';
import { ChatInterface } from './chat-interface';
import { useAuth } from '@/lib/contexts/auth-context';
import {
  getChats,
  getChatMessages,
  createChat,
  addChatMessage,
  generateChatTitle,
  updateChatTitle,
  deleteChat,
  updateChatMessageMetadata,
  Chat,
} from '@/lib/services/chat';
import { useToast } from '@/hooks/use-toast';

interface PersistentChatInterfaceProps {
  onMessagesChange?: (chatId: string, messages: any[]) => void;
}

function sanitizeAssistantMessage(content: string, draft?: any): string {
  let cleanContent = content || '';
  cleanContent = cleanContent.replace(/<draft_json>[\s\S]*?<\/draft_json>/gi, '');
  cleanContent = cleanContent.replace(/```(?:json)?[\s\S]*?"draft"[\s\S]*?```/gi, '');
  cleanContent = cleanContent.replace(/\{[\s\S]*?"draft"[\s\S]*?\}/gi, '');
  cleanContent = cleanContent.trim();

  if (!cleanContent && draft) {
    return 'Draft operation prepared. Please review and confirm below.';
  }

  if (!cleanContent) {
    return 'Assistant response restored from history.';
  }

  return cleanContent;
}

export function PersistentChatInterface({ onMessagesChange }: PersistentChatInterfaceProps) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();
  const initializedProfileKey = useRef<string | null>(null);

  const isReadOnly = profile?.role === 'specialist';
  const hasFullAccess = profile?.role === 'admin' || profile?.role === 'agronomist';

  useEffect(() => {
    const profileKey =
      profile?.id && profile?.company_id ? `${profile.id}:${profile.company_id}` : null;

    if (!profileKey) {
      initializedProfileKey.current = null;
      setChats([]);
      setActiveChatId(null);
      setMessages([]);
      setLoading(false);
      return;
    }

    if (initializedProfileKey.current !== profileKey) {
      initializedProfileKey.current = profileKey;
      initializeChats();
    }
  }, [profile?.id, profile?.company_id]);

  useEffect(() => {
    if (activeChatId) {
      loadChatMessages(activeChatId);
    }
  }, [activeChatId]);

  const initializeChats = async () => {
    if (!profile?.id || !profile?.company_id) return;
    try {
      setLoading(true);
      const existingChats = await getChats(profile.id, profile.company_id);

      if (existingChats.length === 0) {
        const newChat = await createChat(profile.id, profile.company_id, 'New Chat');
        setChats([newChat]);
        setActiveChatId(newChat.id);
      } else {
        setChats(existingChats);
        setActiveChatId(existingChats[0].id);
      }
    } catch (error) {
      console.error('Failed to initialize chats:', error);
      toast({
        title: 'Error',
        description: 'Failed to load chat history',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
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
        draft: msg.metadata?.draft,
        draftStatus: msg.metadata?.draft_status === 'confirmed' ? 'confirmed' : msg.metadata?.draft ? 'pending' : undefined,
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

  const handleNewChat = async () => {
    if (!profile?.id || !profile?.company_id) return;
    try {
      const newChat = await createChat(profile.id, profile.company_id, 'New Chat');
      setChats((prev) => [newChat, ...prev]);
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
      const updated = await getChats(profile.id, profile.company_id);
      setChats(updated);

      if (activeChatId === chatId) {
        if (updated.length > 0) {
          setActiveChatId(updated[0].id);
        } else {
          const newChat = await createChat(profile.id, profile.company_id, 'New Chat');
          setChats([newChat]);
          setActiveChatId(newChat.id);
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

  const handleMessageSent = async (userMessage: string, assistantResponse: string, draft?: any) => {
    try {
      if (!profile?.id || !profile?.company_id) {
        throw new Error('Profile is not fully loaded');
      }

      let targetChatId = activeChatId;
      if (!targetChatId) {
        const emergencyChat = await createChat(profile.id, profile.company_id, 'New Chat');
        setChats((prev) => [emergencyChat, ...prev]);
        setActiveChatId(emergencyChat.id);
        targetChatId = emergencyChat.id;
      }

      const cleanedAssistantResponse = sanitizeAssistantMessage(assistantResponse, draft);

      await addChatMessage(targetChatId, 'user', userMessage);
      await addChatMessage(
        targetChatId,
        'assistant',
        cleanedAssistantResponse,
        draft ? { draft, draft_status: 'pending' } : undefined
      );

      const chat = chats.find((c) => c.id === targetChatId);
      if (!chat || chat.title === 'New Chat') {
        const newTitle = await generateChatTitle(userMessage);
        await updateChatTitle(targetChatId, newTitle);
        setChats((prev) =>
          prev.map((c) => (c.id === targetChatId ? { ...c, title: newTitle } : c))
        );
      }

      const updatedChats = await getChats(profile.id, profile.company_id);
      setChats(updatedChats);
      await loadChatMessages(targetChatId);
    } catch (error) {
      console.error('Failed to save messages:', error);
    }
  };

  const handleDraftConfirmed = async (messageId: string | undefined, draft: any) => {
    try {
      if (messageId) {
        await updateChatMessageMetadata(messageId, {
          draft,
          draft_status: 'confirmed',
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
        });
        await loadChatMessages(activeChatId);
      }
    } catch (error) {
      console.error('Failed to mark draft as confirmed:', error);
    }
  };

  return (
    <div className="flex h-[calc(100vh-12rem)] gap-4 overflow-hidden">
      <div className="w-64 flex-shrink-0 min-h-0">
        <ChatSidebar
          chats={chats}
          activeChatId={activeChatId}
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
