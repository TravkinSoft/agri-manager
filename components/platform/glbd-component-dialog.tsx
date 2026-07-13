"use client";

import { BookOpen, ExternalLink, Loader2, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type GlbdComponentCardSource = {
  id: string;
  title: string;
  typeLabel: string;
  claimLabels: string[];
  checkedAt: string | null;
  url: string | null;
};

export type GlbdComponentCardData = {
  id: string;
  displayName: string;
  nameEn: string | null;
  typeLabel: string;
  aliases: string[];
  sources: GlbdComponentCardSource[];
};

function formatCheckedAt(value: string | null): string {
  if (!value) return "Дата проверки не указана";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата проверки не указана";
  return `Проверено ${new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)}`;
}

export function GlbdComponentDialog({
  open,
  onOpenChange,
  loading,
  error,
  component,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  component: GlbdComponentCardData | null;
  onRetry: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto rounded-none border-[#8292a6] bg-white !text-[#111827]">
        <DialogHeader>
          <DialogTitle className="pr-8 text-xl text-[#16324f]">
            {component?.displayName || "Карточка компонента"}
          </DialogTitle>
          <DialogDescription className="text-[#536276]">
            {component ? [component.nameEn, component.typeLabel].filter(Boolean).join(" · ") : "Загрузка сведений GLBD"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-[#536276]">
            <Loader2 className="h-5 w-5 animate-spin" />
            Загружаю карточку компонента...
          </div>
        ) : null}

        {!loading && error ? (
          <div className="border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
            <div>{error}</div>
            <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-3 rounded-none">
              <RotateCcw className="mr-2 h-4 w-4" />
              Повторить
            </Button>
          </div>
        ) : null}

        {!loading && !error && component ? (
          <div className="space-y-5">
            {component.aliases.length ? (
              <section aria-labelledby="glbd-aliases-heading">
                <h3 id="glbd-aliases-heading" className="mb-2 text-sm font-semibold text-[#16324f]">
                  Дополнительные названия
                </h3>
                <div className="flex flex-wrap gap-2">
                  {component.aliases.map((alias) => (
                    <Badge key={alias} variant="secondary" className="rounded-none border border-[#b7c2d0] bg-[#eef1f5] !text-[#26384f]">
                      {alias}
                    </Badge>
                  ))}
                </div>
              </section>
            ) : null}

            <section aria-labelledby="glbd-sources-heading">
              <div className="mb-2 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-[#163d68]" />
                <h3 id="glbd-sources-heading" className="text-sm font-semibold text-[#16324f]">
                  Источники
                </h3>
              </div>

              {component.sources.length ? (
                <div className="divide-y divide-[#c3ccd8] border-y border-[#c3ccd8]">
                  {component.sources.map((source) => (
                    <article key={source.id} className="space-y-2 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-[#17243a]">{source.title}</div>
                          <div className="mt-1 text-xs text-[#68788d]">{formatCheckedAt(source.checkedAt)}</div>
                        </div>
                        <Badge variant="outline" className="shrink-0 rounded-none border-[#9aa8ba] !text-[#42566f]">
                          {source.typeLabel}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {source.claimLabels.map((label) => (
                          <span key={label} className="border border-[#c8d1dc] bg-[#f6f8fb] px-2 py-1 text-xs text-[#42566f]">
                            {label}
                          </span>
                        ))}
                      </div>
                      {source.url ? (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#174f84] underline-offset-4 hover:underline"
                        >
                          Открыть источник
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="border border-dashed border-[#b7c2d0] bg-[#f6f8fb] px-4 py-5 text-sm text-[#536276]">
                  Подтверждённые источники пока не добавлены.
                </div>
              )}
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
