import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="tf-manor mx-auto min-h-[60vh] w-full max-w-6xl p-4 sm:p-6" aria-busy="true" aria-label="Загрузка раздела">
      <div className="border-b border-border pb-4">
        <Skeleton className="h-10 w-64 max-w-full" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="tf-estate-document min-h-72 p-5" aria-hidden="true">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="mt-6 h-11 w-full" />
          <Skeleton className="mt-3 h-11 w-full" />
          <Skeleton className="mt-8 h-24 w-full" />
        </section>
        <aside className="tf-estate-rail min-h-52 rounded-md p-5" aria-hidden="true">
          <Skeleton className="h-7 w-40 bg-muted" />
          <Skeleton className="mt-5 h-20 w-full bg-muted" />
        </aside>
      </div>
      <span className="sr-only">Раздел загружается</span>
    </main>
  );
}
