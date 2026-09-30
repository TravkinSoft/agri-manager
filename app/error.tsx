"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="tf-manor grid min-h-[60vh] place-items-center p-4">
      <section role="alert" className="tf-estate-document w-full max-w-xl p-6 sm:p-8">
        <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden="true" />
        <h1 className="mt-4 text-3xl font-semibold text-foreground">Раздел не открылся</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Данные не изменены. Повторите загрузку; если ошибка останется, передайте администратору время и название раздела.
        </p>
        <Button className="mt-6 min-h-11" onClick={reset}>
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />Повторить
        </Button>
      </section>
    </main>
  );
}
