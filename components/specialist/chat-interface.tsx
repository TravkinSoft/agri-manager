"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Send,
  Loader as Loader2,
  User,
  Bot,
  Mic,
  MicOff,
  Paperclip,
  FileText,
  Image as ImageIcon,
  X,
} from "lucide-react";
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

export interface ComposerAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: "image" | "file";
  imageDataUrl?: string;
  textContent?: string;
}

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ComposerAttachment[];
  draft?: OperationDraft;
  draftStatus?: "draft" | "confirming" | "confirmed" | "cancelled";
  draftConfirmedAt?: string;
  createdOperationId?: string;
  draftConfirmToken?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TEXTAREA_HEIGHT = 176;
const MAX_ATTACHMENTS = 8;
const SUPPORTED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "pdf", "docx", "txt"];
const SUPPORTED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const SUPPORTED_DOCUMENT_EXTENSIONS = ["pdf", "docx", "txt"];
const SCROLL_BOTTOM_THRESHOLD = 84;

const getQuickPrompts = (language: "ru" | "en" | "kz") => {
  const prompts = {
    ru: [
      "Сколько у нас полей?",
      "Какие культуры посажены в этом сезоне?",
      "Покажи распределение культур по сезонам",
      "Какие операции были записаны недавно?",
      "Дай рекомендации по борьбе с сорняками на картофеле",
    ],
    en: [
      "How many fields do we have?",
      "What crops are planted this season?",
      "Show crop distribution by season",
      "What recent operations were recorded?",
      "Give recommendations for potato weed control",
    ],
    kz: [
      "Бізде қанша алаң бар?",
      "Бұл маусымда қандай дақылдар егілген?",
      "Маусымдар бойынша дақылдарды бөлуді көрсет",
      "Соңғы уақытта қандай операциялар тіркелді?",
      "Картопта арамшөпке қарсы күресу бойынша ұсыныстар бер",
    ],
  };
  return prompts[language];
};

interface ChatInterfaceProps {
  chatId?: string | null;
  initialMessages?: Message[];
  onMessageSent?: (
    userMessage: string,
    assistantResponse: string,
    draft?: any,
    userMetadata?: Record<string, unknown>
  ) => void;
  onDraftConfirmed?: (messageId: string | undefined, draft: OperationDraft) => Promise<void> | void;
  readOnlyMode?: boolean;
  chatReady?: boolean;
  accessMode?: "full" | "limited";
  userRole?: string | null;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read text file"));
    reader.readAsText(file);
  });
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
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "processing">("idle");
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const { profile } = useAuth();
  const quickPrompts = getQuickPrompts(language);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesBottomRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveformFrameRef = useRef<number | null>(null);
  const waveformDataRef = useRef<Uint8Array | null>(null);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [waveformLevel, setWaveformLevel] = useState(0.15);
  const [waveformTick, setWaveformTick] = useState(0);

  useEffect(() => {
    void loadDraftResources();
  }, [profile?.company_id, language]);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    autoResizeTextarea();
  }, [input]);

  useEffect(() => {
    if (!chatReady) return;
    const focusTimer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(focusTimer);
  }, [chatId, chatReady]);

  useEffect(() => {
    return () => {
      if (waveformFrameRef.current) {
        cancelAnimationFrame(waveformFrameRef.current);
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    setIsAutoScrollEnabled(true);
    requestAnimationFrame(() => {
      messagesBottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
  }, [chatId]);

  const isComposerDisabled = !chatReady || isLoading;

  const loadDraftResources = async () => {
    if (!profile?.company_id) return;
    try {
      const resources = await getAssistantDraftResources(profile.company_id, language);
      setDraftResources(resources);
    } catch (error) {
      console.error("Failed to load assistant draft resources:", error);
    }
  };

  const autoResizeTextarea = () => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
    element.style.overflowY = element.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
  };

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    setIsAutoScrollEnabled(distanceToBottom <= SCROLL_BOTTOM_THRESHOLD);
  };

  const scrollToLatestMessage = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      if (!isAutoScrollEnabled) return;
      messagesBottomRef.current?.scrollIntoView({ behavior, block: "end" });
    },
    [isAutoScrollEnabled]
  );

  useEffect(() => {
    scrollToLatestMessage(isLoading ? "auto" : "smooth");
  }, [messages.length, isLoading, scrollToLatestMessage]);

  const getFieldArea = (fieldId?: string, fieldName?: string): number => {
    if (!fieldId && !fieldName) return 0;
    const byId = fieldId ? draftResources.fields.find((f) => f.id === fieldId) : undefined;
    if (byId?.area) return Number(byId.area);
    const byName = fieldName
      ? draftResources.fields.find((f) => f.name.toLowerCase() === String(fieldName).toLowerCase())
      : undefined;
    return Number(byName?.area || 0);
  };

  const hasWarehouseMaterialHints = (draft: OperationDraft): boolean => {
    const metadata = draft?.metadata && typeof draft.metadata === "object" ? draft.metadata : {};
    const hasMainProduct = String((metadata as any).product || "").trim().length > 0;
    const hasMainRate = Number((metadata as any).rate_per_ha ?? (metadata as any).rate ?? 0) > 0;
    const additional = Array.isArray((metadata as any).additional_products_list)
      ? (metadata as any).additional_products_list
      : [];
    const hasAdditional = additional.some((item: any) => {
      if (!item || typeof item !== "object") return false;
      return String(item.product || "").trim().length > 0 || Number(item.rate_per_ha || 0) > 0;
    });
    return (hasMainProduct && hasMainRate) || hasAdditional;
  };

  const resolveResponsibleIdFromResources = (draft: OperationDraft): string | null => {
    const metadata = draft?.metadata && typeof draft.metadata === "object" ? draft.metadata : {};
    const rawId = String((metadata as any).responsible_id || "").trim();
    if (rawId && UUID_RE.test(rawId)) {
      return rawId;
    }

    const rawResponsible = String((metadata as any).responsible || (metadata as any).performer || "").trim();
    const emailMatch = rawResponsible.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const email = String(emailMatch?.[0] || "").trim().toLowerCase();
    if (!email) return null;

    const specialist = draftResources.specialists.find((row) => {
      if (!UUID_RE.test(String(row.id || ""))) return false;
      const rowEmailMatch = String(row.name || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      return String(rowEmailMatch?.[0] || "").trim().toLowerCase() === email;
    });

    return specialist?.id ? String(specialist.id) : null;
  };

  const prepareAttachment = async (file: File): Promise<ComposerAttachment | null> => {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!SUPPORTED_EXTENSIONS.includes(extension)) {
      toast({
        title: t("error"),
        description: `Тип файла .${extension || "unknown"} не поддерживается`,
        variant: "destructive",
      });
      return null;
    }

    const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(extension);
    const isDocument = SUPPORTED_DOCUMENT_EXTENSIONS.includes(extension);
    if (!isImage && !isDocument) {
      return null;
    }

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const base: ComposerAttachment = {
      id,
      name: file.name,
      size: file.size,
      type: file.type || extension,
      kind: SUPPORTED_IMAGE_EXTENSIONS.includes(extension) ? "image" : "file",
    };

    if (base.kind === "image") {
      const imageDataUrl = await readAsDataUrl(file);
      return { ...base, imageDataUrl };
    }

    if (extension === "txt") {
      const text = await readAsText(file);
      return { ...base, textContent: text.slice(0, 20000) };
    }

    return base;
  };

  const handlePickFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    if (attachments.length >= MAX_ATTACHMENTS) {
      toast({
        title: t("error"),
        description: `Можно прикрепить не более ${MAX_ATTACHMENTS} файлов`,
        variant: "destructive",
      });
      return;
    }

    const next: ComposerAttachment[] = [];
    for (const file of files) {
      if (attachments.length + next.length >= MAX_ATTACHMENTS) break;
      try {
        const prepared = await prepareAttachment(file);
        if (prepared) next.push(prepared);
      } catch (error) {
        toast({
          title: t("error"),
          description: error instanceof Error ? error.message : "Не удалось обработать файл",
          variant: "destructive",
        });
      }
    }

    if (next.length > 0) {
      setAttachments((prev) => [...prev, ...next]);
    }
  };

  const removeAttachment = (attachmentId: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
  };

  const stopWaveform = async () => {
    if (waveformFrameRef.current) {
      cancelAnimationFrame(waveformFrameRef.current);
      waveformFrameRef.current = null;
    }
    analyserRef.current = null;
    waveformDataRef.current = null;
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setWaveformLevel(0.15);
  };

  const startWaveform = (stream: MediaStream) => {
    try {
      const AudioContextCtor =
        typeof window !== "undefined"
          ? ((window as any).AudioContext || (window as any).webkitAudioContext)
          : null;
      if (!AudioContextCtor) return;

      const context = new AudioContextCtor();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);

      audioContextRef.current = context;
      analyserRef.current = analyser;
      waveformDataRef.current = new Uint8Array(analyser.fftSize);

      let lastUpdate = 0;
      const updateWaveform = (timestamp: number) => {
        const currentAnalyser = analyserRef.current;
        const dataArray = waveformDataRef.current;
        if (!currentAnalyser || !dataArray) return;
        currentAnalyser.getByteTimeDomainData(dataArray);

        if (!lastUpdate || timestamp - lastUpdate > 64) {
          let sumSquares = 0;
          for (let i = 0; i < dataArray.length; i += 1) {
            const normalized = (dataArray[i] - 128) / 128;
            sumSquares += normalized * normalized;
          }
          const rms = Math.sqrt(sumSquares / dataArray.length);
          const nextLevel = Math.max(0.08, Math.min(1, rms * 10));
          setWaveformLevel(nextLevel);
          setWaveformTick((prev) => prev + 1);
          lastUpdate = timestamp;
        }

        waveformFrameRef.current = requestAnimationFrame(updateWaveform);
      };

      waveformFrameRef.current = requestAnimationFrame(updateWaveform);
    } catch {
      setWaveformLevel(0.2);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        audioChunksRef.current = [];
        if (blob.size === 0) {
          setRecordingState("idle");
          return;
        }
        await transcribeAudio(blob);
      };
      mediaRecorderRef.current = recorder;
      startWaveform(stream);
      recorder.start();
      setRecordingState("recording");
    } catch (error) {
      toast({
        title: t("error"),
        description: "Не удалось запустить запись микрофона",
        variant: "destructive",
      });
      setRecordingState("idle");
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      setRecordingState("processing");
      recorder.stop();
    } else {
      setRecordingState("idle");
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    void stopWaveform();
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "voice-message.webm");
      formData.append("language", language);

      const response = await fetch("/api/assistant/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Транскрипция не удалась");
      }

      const payload = await response.json();
      const transcript = String(payload.text || "").trim();
      if (transcript) {
        setInput((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript));
      }
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : "Ошибка транскрипции",
        variant: "destructive",
      });
    } finally {
      await stopWaveform();
      setRecordingState("idle");
      textareaRef.current?.focus();
    }
  };

  const sendMessage = async (messageText: string) => {
    if ((!messageText.trim() && attachments.length === 0) || isLoading) return;
    if (!chatReady) {
      toast({
        title: t("error"),
        description: "Chat is still initializing. Please wait a moment.",
        variant: "destructive",
      });
      return;
    }
    if (!profile?.id || !profile?.company_id) {
      toast({
        title: t("error"),
        description: "Your profile is still loading. Please try again in a moment.",
        variant: "destructive",
      });
      return;
    }

    const outgoingAttachments = attachments;
    const userMessage: Message = {
      role: "user",
      content: messageText,
      attachments: outgoingAttachments,
    };

    setIsAutoScrollEnabled(true);
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setAttachments([]);
    setIsLoading(true);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: messageText || "Вложение",
          chatHistory: messages,
          chatId,
          companyId: profile.company_id,
          userId: profile.id,
          locale: language,
          attachments: outgoingAttachments,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to get response");
      }

      const data = await response.json();
      if (process.env.NODE_ENV !== "production" && data.debug) {
        console.info("[assistant-debug]", data.debug);
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
        draftStatus: data.draft ? "draft" : undefined,
      };
      setMessages((prev) => [...prev, assistantMessage]);

      if (onMessageSent) {
        onMessageSent(messageText, data.response, data.draft, {
          attachments: outgoingAttachments,
        });
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
    void sendMessage(input);
  };

  const handleQuickPrompt = (prompt: string) => {
    void sendMessage(prompt);
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
        title: t("error"),
        description: "Cannot confirm draft before profile is loaded",
        variant: "destructive",
      });
      return;
    }

    const currentMessage = messages[messageIndex];
    if (!currentMessage?.draft) return;
    if (currentMessage.draftStatus === "confirmed") {
      toast({
        title: t("success"),
        description: "Операция уже создана по этому черновику.",
      });
      return;
    }
    if (currentMessage.draftStatus === "confirming") {
      return;
    }

    const metadata =
      draft.metadata && typeof draft.metadata === "object"
        ? ({ ...draft.metadata } as Record<string, unknown>)
        : {};
    const resolvedResponsibleId = resolveResponsibleIdFromResources(draft);
    if (resolvedResponsibleId) {
      metadata.responsible_id = resolvedResponsibleId;
    }
    const normalizedDraft: OperationDraft = { ...draft, metadata };

    if (hasWarehouseMaterialHints(normalizedDraft) && !UUID_RE.test(String(metadata.responsible_id || "").trim())) {
      toast({
        title: t("error"),
        description: "Выберите ответственного из списка пользователей (обязательно для заявки на склад).",
        variant: "destructive",
      });
      return;
    }

    try {
      setMessages((prev) =>
        prev.map((msg, index) => (index === messageIndex ? { ...msg, draftStatus: "confirming" } : msg))
      );

      const response = await fetch("/api/operations/confirm-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          draft: normalizedDraft,
          companyId: profile.company_id,
          userId: profile.id,
          confirmToken: currentMessage.draftConfirmToken,
          chatMessageId: currentMessage.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create operation");
      }

      const result = await response.json();
      const confirmedAt = result?.confirmedAt ? String(result.confirmedAt) : new Date().toISOString();
      const createdOperationId = result?.operation?.id ? String(result.operation.id) : undefined;
      const confirmToken = result?.confirmToken ? String(result.confirmToken) : currentMessage.draftConfirmToken;

      toast({
        title: t("success"),
        description: result?.duplicate ? "Операция уже была создана ранее." : t("operation_created"),
      });

      let confirmedMessageId: string | undefined;
      setMessages((prev) =>
        prev.map((msg, index) => {
          if (index !== messageIndex) return msg;
          confirmedMessageId = msg.id;
          return {
            ...msg,
            draftStatus: "confirmed",
            draftConfirmedAt: confirmedAt,
            createdOperationId,
            draftConfirmToken: confirmToken,
          };
        })
      );

      if (onDraftConfirmed) {
        const updatedDraft: OperationDraft = {
          ...normalizedDraft,
          metadata: {
            ...(normalizedDraft.metadata || {}),
            confirmation_state: "confirmed",
            confirmed_at: confirmedAt,
            operation_id: createdOperationId,
            confirm_token: confirmToken,
          },
        };
        await onDraftConfirmed(confirmedMessageId, updatedDraft);
      }
    } catch (error) {
      setMessages((prev) =>
        prev.map((msg, index) => (index === messageIndex ? { ...msg, draftStatus: "draft" } : msg))
      );
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : "Failed to create operation",
        variant: "destructive",
      });
    }
  };

  const handleCancelDraft = (messageIndex: number) => {
    setMessages((prev) =>
      prev.map((msg, index) =>
        index === messageIndex
          ? {
              ...msg,
              draftStatus: "cancelled",
            }
          : msg
      )
    );
    toast({
      title: t("operation_cancelled"),
    });
  };

  const visibleMessages = useMemo(() => messages, [messages]);

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
        <span className="text-slate-500">Role: {userRole || "unknown"}</span>
      </div>
      <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
        <CardContent className="flex-1 flex flex-col p-4 min-h-0 overflow-hidden">
          <div
            ref={messagesContainerRef}
            onScroll={handleMessagesScroll}
            className="flex-1 pr-4 min-h-0 overflow-y-auto"
          >
            {visibleMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Bot className="h-16 w-16 text-green-600 mb-4" />
                <h3 className="text-xl font-semibold mb-2">{t("ai_specialist")}</h3>
                <p className="text-muted-foreground mb-6">{t("chat_placeholder")}</p>
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
                {visibleMessages.map((message, index) => (
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
                    <div className={`flex flex-col gap-2 max-w-[82%]`}>
                      {Array.isArray(message.attachments) && message.attachments.length > 0 && (
                        <div className="space-y-2">
                          {message.attachments.map((attachment) => (
                            <div
                              key={attachment.id}
                              className="rounded-lg border bg-white p-2 text-sm"
                            >
                              {attachment.kind === "image" && attachment.imageDataUrl ? (
                                <img
                                  src={attachment.imageDataUrl}
                                  alt={attachment.name}
                                  className="max-h-44 rounded-md border object-cover"
                                />
                              ) : (
                                <div className="flex items-center gap-2 text-slate-700">
                                  <FileText className="h-4 w-4" />
                                  <span className="truncate">{attachment.name}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {(message.role === "user" || String(message.content || "").trim().length > 0) && (
                        <div
                          className={`rounded-lg px-4 py-2 ${
                            message.role === "user"
                              ? "bg-green-600 text-white"
                              : "bg-muted"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        </div>
                      )}
                      {message.draft && !readOnlyMode && (
                        <EnhancedOperationDraftCard
                          draft={message.draft}
                          fieldArea={getFieldArea(message.draft.field_id, message.draft.field_name)}
                          status={message.draftStatus || "draft"}
                          confirmedAt={message.draftConfirmedAt}
                          operationId={message.createdOperationId}
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
            <div ref={messagesBottomRef} className="h-1 w-full" />
          </div>

          <form onSubmit={handleSubmit} className="mt-3 space-y-2">
            {attachments.length > 0 && (
              <div className="rounded-md border bg-slate-50 p-2">
                <div className="mb-1 text-xs text-slate-600">Вложения ({attachments.length})</div>
                <div className="flex flex-wrap gap-2">
                  {attachments.map((attachment) => (
                    <div key={attachment.id} className="relative rounded border bg-white p-2 pr-7 text-xs max-w-[220px]">
                      <button
                        type="button"
                        className="absolute right-1 top-1 text-slate-400 hover:text-red-600"
                        onClick={() => removeAttachment(attachment.id)}
                        title="Удалить"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                      <div className="flex items-center gap-1 text-slate-700">
                        {attachment.kind === "image" ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                        <span className="truncate">{attachment.name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-end gap-2">
              <div className="flex-1 rounded-xl border bg-white px-2 py-2">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={chatReady ? t("chat_placeholder") : "Chat is initializing..."}
                  className="min-h-[44px] resize-none border-0 p-1 shadow-none focus-visible:ring-0"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  disabled={isComposerDisabled}
                />
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isComposerDisabled}
                      title="Прикрепить файл"
                    >
                      <Paperclip className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant={recordingState === "recording" ? "destructive" : "ghost"}
                      size="icon"
                      className="h-8 w-8"
                      onClick={recordingState === "recording" ? stopRecording : startRecording}
                      disabled={isComposerDisabled || recordingState === "processing"}
                      title={
                        recordingState === "recording"
                          ? "Остановить запись"
                          : recordingState === "processing"
                            ? "Обработка..."
                            : "Голосовой ввод"
                      }
                    >
                      {recordingState === "recording" ? (
                        <MicOff className="h-4 w-4" />
                      ) : recordingState === "processing" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Mic className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <div className="text-[11px] text-slate-500 min-w-[220px] text-right">
                    {recordingState === "recording"
                      ? "Идёт запись..."
                      : recordingState === "processing"
                        ? "Распознавание..."
                        : "Enter отправить · Shift+Enter новая строка"}
                  </div>
                  {false && recordingState === "recording" && (
                    <div className="ml-auto flex items-end gap-0.5 h-6 min-w-[120px] justify-end">
                      {Array.from({ length: 15 }).map((_, barIndex) => {
                        const pulseBase = 0.22 + waveformLevel * 0.78;
                        const dynamic =
                          (Math.sin((waveformTick + barIndex * 1.45) / 2.2) + 1) / 2;
                        const height = Math.max(4, Math.round((pulseBase * dynamic + 0.1) * 22));
                        return (
                          <span
                            key={`wave-${barIndex}`}
                            className="w-1 rounded-full bg-red-500/85 transition-all duration-150"
                            style={{ height: `${height}px` }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
                {(recordingState === "recording" || recordingState === "processing") && (
                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                    {recordingState === "recording" ? (
                      <div className="flex items-end gap-1 h-7">
                        {Array.from({ length: 22 }).map((_, barIndex) => {
                          const pulseBase = 0.2 + waveformLevel * 0.8;
                          const dynamic =
                            (Math.sin((waveformTick + barIndex * 1.35) / 2.1) + 1) / 2;
                          const height = Math.max(4, Math.round((pulseBase * dynamic + 0.14) * 26));
                          return (
                            <span
                              key={`rec-wave-${barIndex}`}
                              className="w-1 rounded-full bg-red-500/90 transition-all duration-150"
                              style={{ height: `${height}px` }}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-slate-600">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Р Р°СЃРїРѕР·РЅР°РІР°РЅРёРµ РіРѕР»РѕСЃР°...</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-1 text-[11px] text-slate-500">
                  Форматы: изображения jpg/jpeg/png/webp, документы pdf/docx/txt.
                </div>
              </div>

              <Button
                type="submit"
                size="icon"
                className="h-11 w-11 rounded-xl"
                disabled={isComposerDisabled || (!input.trim() && attachments.length === 0)}
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.txt"
              onChange={handlePickFiles}
            />
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
