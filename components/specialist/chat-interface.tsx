"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Send, Loader as Loader2, User, Bot } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { OperationDraft } from "@/lib/types/operation-draft";
import { EnhancedOperationDraftCard } from "@/components/specialist/enhanced-operation-draft-card";
import { DraftEditorDialog } from "@/components/specialist/draft-editor-dialog";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/contexts/language-context";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  getAssistantDraftResources,
  type AssistantDraftResources,
} from "@/lib/services/assistant-draft";
import { applyDraftCalculations } from "@/lib/utils/draft-calculations";

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  draft?: OperationDraft;
  draftStatus?: "pending" | "confirmed";
}

const getQuickPrompts = (language: 'ru' | 'en' | 'kz') => {
  const prompts = {
    ru: [
      "Сколько у нас полей?",
      "Какие культуры посажены в этом сезоне?",
      "Покажи распределение культур по сезонам",
      "Какие операции были записаны недавно?",
      "Дай рекомендации по борьбе с сорняками на картофеле"
    ],
    en: [
      "How many fields do we have?",
      "What crops are planted this season?",
      "Show crop distribution by season",
      "What recent operations were recorded?",
      "Give recommendations for potato weed control"
    ],
    kz: [
      "Бізде қанша алаң бар?",
      "Бұл маусымда қандай дақылдар егілген?",
      "Маусымдар бойынша дақылдарды бөлуді көрсет",
      "Соңғы уақытта қандай операциялар тіркелді?",
      "Картопта арамшөпке қарсы күресу бойынша ұсыныстар бер"
    ]
  };
  return prompts[language];
};

interface ChatInterfaceProps {
  chatId?: string | null;
  initialMessages?: Message[];
  onMessageSent?: (userMessage: string, assistantResponse: string, draft?: any) => void;
  onDraftConfirmed?: (messageId: string | undefined, draft: OperationDraft) => Promise<void> | void;
  readOnlyMode?: boolean;
  chatReady?: boolean;
  accessMode?: "full" | "limited";
  userRole?: string | null;
}

export function ChatInterface({
  chatId = null,
  initialMessages = [],
  onMessageSent,
  onDraftConfirmed,
  readOnlyMode = false,
  chatReady = true,
  accessMode = "limited",
  userRole = null,
}: ChatInterfaceProps = {}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [editingDraft, setEditingDraft] = useState<OperationDraft | null>(null);
  const [editingDraftIndex, setEditingDraftIndex] = useState<number | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [draftResources, setDraftResources] = useState<AssistantDraftResources>({
    fields: [],
    crops: [],
    products: [],
    specialists: [],
    equipment: [],
  });
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const { profile } = useAuth();
  const quickPrompts = getQuickPrompts(language);

  useEffect(() => {
    loadDraftResources();
  }, [profile]);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  const loadDraftResources = async () => {
    if (!profile?.company_id) return;
    try {
      const resources = await getAssistantDraftResources(profile.company_id);
      setDraftResources(resources);
    } catch (error) {
      console.error("Failed to load assistant draft resources:", error);
    }
  };

  const getFieldArea = (fieldId?: string, fieldName?: string): number => {
    if (!fieldId && !fieldName) return 0;
    const byId = fieldId ? draftResources.fields.find((f) => f.id === fieldId) : undefined;
    if (byId?.area) return Number(byId.area);
    const byName = fieldName
      ? draftResources.fields.find((f) => f.name.toLowerCase() === String(fieldName).toLowerCase())
      : undefined;
    return Number(byName?.area || 0);
  };

  const sendMessage = async (messageText: string) => {
    if (!messageText.trim() || isLoading) return;
    if (!chatReady) {
      toast({
        title: t('error'),
        description: 'Chat is still initializing. Please wait a moment.',
        variant: 'destructive',
      });
      return;
    }
    if (!profile?.id || !profile?.company_id) {
      toast({
        title: t('error'),
        description: 'Your profile is still loading. Please try again in a moment.',
        variant: 'destructive',
      });
      return;
    }

    const userMessage: Message = { role: "user", content: messageText };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: messageText,
          chatHistory: messages,
          chatId,
          companyId: profile.company_id,
          userId: profile.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to get response");
      }

      const data = await response.json();
      if (process.env.NODE_ENV !== 'production' && data.debug) {
        console.info('[assistant-debug]', data.debug);
      }

      const assistantMessage: Message = {
        role: "assistant",
        content: data.response,
        draft: data.draft
          ? applyDraftCalculations(
              data.draft,
              getFieldArea(data.draft.field_id, data.draft.field_name)
            )
          : undefined,
        draftStatus: data.draft ? "pending" : undefined,
      };
      setMessages((prev) => [...prev, assistantMessage]);

      if (onMessageSent) {
        onMessageSent(messageText, data.response, data.draft);
      }
    } catch (error) {
      const errorMessage: Message = {
        role: "assistant",
        content: `Error: ${error instanceof Error ? error.message : "Failed to get response"}`,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleQuickPrompt = (prompt: string) => {
    sendMessage(prompt);
  };

  const handleEditDraft = (draft: OperationDraft, messageIndex: number) => {
    setEditingDraft(draft);
    setEditingDraftIndex(messageIndex);
    setIsEditorOpen(true);
  };

  const handleSaveDraft = (updatedDraft: OperationDraft) => {
    if (editingDraftIndex === null) return;
    setMessages((prev) =>
      prev.map((msg, index) =>
        index === editingDraftIndex ? { ...msg, draft: updatedDraft } : msg
      )
    );
    setEditingDraft(null);
    setEditingDraftIndex(null);
  };

  const handleConfirmDraft = async (draft: OperationDraft, messageIndex: number) => {
    if (!profile?.id || !profile?.company_id) {
      toast({
        title: t('error'),
        description: 'Cannot confirm draft before profile is loaded',
        variant: 'destructive',
      });
      return;
    }

    try {
      const response = await fetch('/api/operations/confirm-draft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          draft,
          companyId: profile.company_id,
          userId: profile.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create operation');
      }

      toast({
        title: t('success'),
        description: t('operation_created'),
      });

      let confirmedMessageId: string | undefined;
      setMessages((prev) =>
        prev.map((msg, index) => {
          if (index !== messageIndex) return msg;
          confirmedMessageId = msg.id;
          return { ...msg, draftStatus: "confirmed" };
        })
      );

      if (onDraftConfirmed) {
        await onDraftConfirmed(confirmedMessageId, draft);
      }
    } catch (error) {
      toast({
        title: t('error'),
        description: error instanceof Error ? error.message : 'Failed to create operation',
        variant: 'destructive',
      });
    }
  };

  const handleCancelDraft = (messageIndex: number) => {
    setMessages((prev) =>
      prev.map((msg, index) =>
        index === messageIndex ? { ...msg, draft: undefined } : msg
      )
    );
    toast({
      title: t('operation_cancelled'),
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] overflow-hidden min-h-0">
      <div className="mb-2 flex items-center gap-2 text-xs text-slate-600">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 ${
            accessMode === "full"
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-amber-300 bg-amber-50 text-amber-700"
          }`}
        >
          {accessMode === "full" ? "Full Access" : "Limited Access"}
        </span>
        <span className="text-slate-500">
          Role: {userRole || "unknown"}
        </span>
      </div>
      <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
        <CardContent className="flex-1 flex flex-col p-4 min-h-0 overflow-hidden">
          <ScrollArea className="flex-1 pr-4 min-h-0">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Bot className="h-16 w-16 text-green-600 mb-4" />
                <h3 className="text-xl font-semibold mb-2">{t('ai_specialist')}</h3>
                <p className="text-muted-foreground mb-6">
                  {t('chat_placeholder')}
                </p>
                <div className="flex flex-wrap gap-2 justify-center max-w-2xl">
                  {quickPrompts.map((prompt) => (
                    <Button
                      key={prompt}
                      variant="outline"
                      size="sm"
                      onClick={() => handleQuickPrompt(prompt)}
                      disabled={!chatReady || isLoading}
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex gap-3 ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    {message.role === "assistant" && (
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                          <Bot className="h-5 w-5 text-green-600" />
                        </div>
                      </div>
                    )}
                    <div className={`flex flex-col gap-3 max-w-[80%]`}>
                      <div
                        className={`rounded-lg px-4 py-2 ${
                          message.role === "user"
                            ? "bg-green-600 text-white"
                            : "bg-muted"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      </div>
                      {message.draft && !readOnlyMode && (
                        <EnhancedOperationDraftCard
                          draft={message.draft}
                          fieldArea={getFieldArea(message.draft.field_id, message.draft.field_name)}
                          status={message.draftStatus || "pending"}
                          onEdit={(draftToEdit) => handleEditDraft(draftToEdit, index)}
                          onConfirm={(draftToConfirm) => handleConfirmDraft(draftToConfirm, index)}
                          onCancel={() => handleCancelDraft(index)}
                        />
                      )}
                      {message.draft && readOnlyMode && (
                        <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                          Note: Operation draft creation is not available in read-only mode. Contact an agronomist to create operations.
                        </div>
                      )}
                    </div>
                    {message.role === "user" && (
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center">
                          <User className="h-5 w-5 text-white" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {isLoading && (
                  <div className="flex gap-3 justify-start">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                        <Bot className="h-5 w-5 text-green-600" />
                      </div>
                    </div>
                    <div className="rounded-lg px-4 py-2 bg-muted">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          <form onSubmit={handleSubmit} className="mt-4">
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={chatReady ? t('chat_placeholder') : 'Chat is initializing...'}
                className="min-h-[60px] resize-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                disabled={!chatReady || isLoading}
              />
              <Button
                type="submit"
                size="icon"
                className="h-[60px] w-[60px]"
                disabled={!chatReady || !input.trim() || isLoading}
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <DraftEditorDialog
        open={isEditorOpen}
        onOpenChange={(open) => {
          setIsEditorOpen(open);
          if (!open) {
            setEditingDraft(null);
            setEditingDraftIndex(null);
          }
        }}
        draft={editingDraft}
        fields={draftResources.fields}
        crops={draftResources.crops}
        products={draftResources.products}
        specialists={draftResources.specialists}
        equipment={draftResources.equipment}
        onSave={handleSaveDraft}
      />
    </div>
  );
}
