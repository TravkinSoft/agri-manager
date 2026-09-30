'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Plus,
  MessageSquare,
  Loader as Loader2,
  Trash2,
  Folder,
  Pencil,
  FolderOpen,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Chat, ChatProject } from '@/lib/services/chat';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface ChatSidebarProps {
  projects: ChatProject[];
  selectedProjectId: string | null;
  chatsByProject: Record<string, Chat[]>;
  activeChatId: string | null;
  onSelectProject: (projectId: string | null) => void;
  onCreateProject: () => void;
  onRenameProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onDeleteChat: (chatId: string) => void;
  loading?: boolean;
}

export function ChatSidebar({
  projects,
  selectedProjectId,
  chatsByProject,
  activeChatId,
  onSelectProject,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  loading = false,
}: ChatSidebarProps) {
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpandedProjects((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const project of projects) {
        if (typeof next[project.id] === 'undefined') {
          next[project.id] = selectedProjectId === project.id;
        }
      }
      return next;
    });
  }, [projects, selectedProjectId]);

  const totalChatsCount = useMemo(
    () => Object.values(chatsByProject).reduce((sum, list) => sum + list.length, 0),
    [chatsByProject]
  );

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  return (
    <div className="flex flex-col h-full border-r bg-muted">
      <div className="space-y-2 border-b bg-card p-3">
        <Button onClick={onCreateProject} className="w-full" variant="outline" disabled={loading}>
          <Folder className="h-4 w-4 mr-2" />
          Новый проект
        </Button>
        <Button
          onClick={onNewChat}
          className="w-full"
          disabled={loading || !selectedProjectId}
        >
          <Plus className="h-4 w-4 mr-2" />
          Новый чат
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="p-2 space-y-2">
            <div className="px-2 pb-1 flex items-center justify-between">
              <div className="text-xs font-semibold text-muted-foreground">Проекты</div>
              <div className="text-[11px] text-muted-foreground">{totalChatsCount} чатов</div>
            </div>

            {projects.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">Нет проектов</div>
            ) : (
              projects.map((project) => {
                const isActiveProject = selectedProjectId === project.id;
                const projectChats = chatsByProject[project.id] || [];
                const isExpanded = expandedProjects[project.id] ?? isActiveProject;

                return (
                  <div key={project.id} className="rounded-lg border border-transparent">
                    <div
                      className={cn(
                        'group rounded-lg px-2 py-2 transition-colors',
                        isActiveProject
                          ? 'border border-border bg-accent'
                          : 'hover:bg-card'
                      )}
                    >
                      <div className="flex items-start gap-1">
                        <button
                          type="button"
                          className="mt-0.5 text-muted-foreground hover:text-muted-foreground p-0.5"
                          onClick={() => toggleProject(project.id)}
                          title={isExpanded ? 'Свернуть проект' : 'Развернуть проект'}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>

                        <button
                          className="w-full flex items-start gap-2 text-left min-w-0"
                          onClick={() => {
                            onSelectProject(project.id);
                            if (!isExpanded) {
                              toggleProject(project.id);
                            }
                          }}
                        >
                          {isExpanded || isActiveProject ? (
                            <FolderOpen className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                          ) : (
                            <Folder className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate text-muted-foreground">{project.name}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {projectChats.length} чатов · {format(new Date(project.updated_at), 'dd.MM.yyyy HH:mm')}
                            </div>
                          </div>
                        </button>

                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-muted-foreground p-1"
                            onClick={() => onRenameProject(project.id)}
                            title="Переименовать"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-red-600 p-1"
                            onClick={() => onDeleteProject(project.id)}
                            title="Удалить проект"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-1 ml-6 pl-2 border-l border-border space-y-1">
                        {projectChats.length === 0 ? (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">
                            Нет чатов в проекте
                          </div>
                        ) : (
                          projectChats.map((chat) => (
                            <button
                              key={chat.id}
                              onClick={() => {
                                onSelectProject(project.id);
                                onSelectChat(chat.id);
                              }}
                              className={cn(
                                'w-full text-left px-2 py-2 rounded-md transition-colors',
                                activeChatId === chat.id
                                  ? 'border border-border bg-accent shadow-sm'
                                  : 'hover:bg-card'
                              )}
                            >
                              <div className="flex items-start gap-2">
                                <MessageSquare className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm text-muted-foreground truncate">{chat.title}</div>
                                  <div className="text-[11px] text-muted-foreground mt-0.5">
                                    {format(new Date(chat.updated_at), 'dd.MM.yyyy HH:mm')}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-red-600 p-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteChat(chat.id);
                                  }}
                                  title="Удалить чат"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

