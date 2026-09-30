"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { HumanPesticideCardData } from "@/lib/glbd/human-pesticide-card";

export type FullPesticideCardData = HumanPesticideCardData;

function MultilineValue({ value }: { value: string }) {
  return (
    <span className="block whitespace-pre-line break-words text-[15px] leading-6 text-foreground">
      {value}
    </span>
  );
}

export function FullPesticideCardDialog({
  open,
  onOpenChange,
  loading,
  error,
  card,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  card: FullPesticideCardData | null;
  onRetry: () => void;
  adminMode?: boolean;
  onEdit?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-4xl overflow-y-auto rounded-md border border-border bg-card p-0 text-foreground shadow-manor-md sm:w-full">
        <DialogHeader className="border-b border-border bg-card px-4 py-4 text-left sm:px-6">
          <DialogTitle className="pr-8 text-xl font-semibold leading-tight tracking-normal text-foreground sm:text-2xl">
            {card?.product.tradeName || "Карточка пестицида"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Агрономическая карточка глобального препарата
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 py-5 sm:px-6">
          {loading ? (
            <div className="flex min-h-52 items-center justify-center text-sm text-muted-foreground">
              Загрузка карточки...
            </div>
          ) : null}

          {!loading && error ? (
            <div className="border border-border bg-card p-4 text-sm text-foreground">
              <p>{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
                className="mt-3 rounded-none border-border bg-card text-foreground"
              >
                Повторить
              </Button>
            </div>
          ) : null}

          {!loading && !error && card ? (
            <div>
              <div className="overflow-x-auto border-l border-t border-border">
                <table className="w-full table-fixed border-collapse bg-card">
                  <tbody>
                    {card.rows.map((row) => (
                      <tr key={row.label}>
                        <th
                          scope="row"
                          className="w-[36%] border-b border-r border-border bg-card px-3 py-3 text-left align-top text-sm font-semibold leading-5 tracking-normal text-foreground sm:w-[31%] sm:px-4"
                        >
                          {row.label}
                        </th>
                        <td className="border-b border-r border-border bg-card px-3 py-3 align-top sm:px-4">
                          <MultilineValue value={row.value} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <section className="mt-6" aria-labelledby="pesticide-description">
                <h3 id="pesticide-description" className="text-base font-semibold tracking-normal text-foreground">
                  Описание
                </h3>
                {card.description ? (
                  <p className="mt-2 whitespace-pre-line text-[15px] leading-6 text-foreground">
                    {card.description}
                  </p>
                ) : null}
                {card.usageNotice ? (
                  <p className="mt-2 text-[15px] leading-6 text-foreground">
                    {card.usageNotice}
                  </p>
                ) : null}
              </section>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
