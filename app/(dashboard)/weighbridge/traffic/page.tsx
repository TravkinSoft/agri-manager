"use client";

import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { TrafficBoard } from "@/components/traffic/traffic-board";
import { useTraffic } from "@/components/traffic/use-traffic";
import { useAuth } from "@/lib/contexts/auth-context";

export default function WeighmanTrafficPage() {
  const { profile, loading: authLoading } = useAuth();
  const live = useTraffic(false);

  if (authLoading || live.loading) {
    return (
      <div role="status" className="flex min-h-[50vh] items-center justify-center text-amber-800">
        <Loader2 className="animate-spin" aria-hidden />
        <span className="sr-only">Загрузка машин</span>
      </div>
    );
  }
  if (profile?.role !== "weighman") {
    return <PageHeader title="Оборот машин" description="Доступ только весовщику" />;
  }
  return (
    <div className="mx-auto w-full max-w-5xl px-2 pb-4 sm:px-3">
      <PageHeader title="Оборот машин" description="Загруженные машины по пути на весовую" />
      {live.data ? (
        <TrafficBoard
          key={live.scopeKey}
          snapshot={live.data}
          stale={live.stale}
          error={live.error}
          refresh={live.refresh}
          onCommitted={live.applyCommitted}
        />
      ) : (
        <div role="alert" className="py-10 text-amber-800">
          {live.error || "Не удалось открыть оборот машин"}
        </div>
      )}
    </div>
  );
}
