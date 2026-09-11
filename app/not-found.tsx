import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="tf-manor grid min-h-screen place-items-center bg-background p-4">
      <section className="tf-estate-document w-full max-w-xl p-6 sm:p-8">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Ошибка 404</div>
        <h1 className="mt-3 text-4xl font-semibold text-foreground">Страница не найдена</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Адрес устарел или этот раздел недоступен в текущем контексте.</p>
        <Button asChild className="mt-6 min-h-11">
          <Link href="/dashboard"><ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />Вернуться в панель</Link>
        </Button>
      </section>
    </main>
  );
}
