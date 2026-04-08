'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, MessageSquare, Loader as Loader2, Trash2 } from 'lucide-react';
import { Chat } from '@/lib/services/chat';
import { useLanguage } from '@/lib/contexts/language-context';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface ChatSidebarProps {
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onDeleteChat: (chatId: string) => void;
  loading?: boolean;
}

export function ChatSidebar({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  loading = false,
}: ChatSidebarProps) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col h-full border-r bg-slate-50">
      <div className="p-4 border-b bg-white">
        <Button
          onClick={onNewChat}
          className="w-full"
          disabled={loading}
        >
          <Plus className="h-4 w-4 mr-2" />
          {t('create')}
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <MessageSquare className="h-12 w-12 text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">{t('no_data')}</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {chats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                className={cn(
                  'w-full text-left px-3 py-2.5 rounded-lg transition-colors',
                  'hover:bg-white',
                  activeChatId === chat.id
                    ? 'bg-white shadow-sm border border-green-200'
                    : 'bg-transparent'
                )}
              >
                <div className="flex items-start gap-2">
                  <MessageSquare className="h-4 w-4 mt-0.5 flex-shrink-0 text-slate-400" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-slate-900 truncate">
                      {chat.title}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {format(new Date(chat.updated_at), 'dd.MM.yyyy HH:mm')}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-slate-400 hover:text-red-600 p-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteChat(chat.id);
                    }}
                    title="Delete chat"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
