"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { pendingOperationIntents, retryOperationIntent, type OperationIntent } from "@/lib/client/operation-intents";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const labels: Record<string,string> = { accept:"Принятие",start:"Начало работы",pause:"Пауза",resume:"Возобновление",progress:"Сменный отчёт",report:"Итоговый отчёт",approve:"Приёмка",reject:"Возврат специалисту",cancel:"Отмена",archive:"Архивирование",unarchive:"Возврат из архива" };
export function PendingOperationIntents({ companyId, onRecovered, onPendingChange }: { companyId?: string | null; onRecovered: (intent: OperationIntent) => unknown; onPendingChange?: (intents: OperationIntent[]) => void }) {
  const [intents, setIntents] = useState<OperationIntent[]>([]);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      const next = data.session && companyId ? pendingOperationIntents(data.session.user.id, companyId) : [];
      setIntents(next); onPendingChange?.(next);
    };
    void refresh();
    window.addEventListener("storage", refresh); window.addEventListener("tf-operation-intents", refresh);
    return () => { active = false; window.removeEventListener("storage", refresh); window.removeEventListener("tf-operation-intents", refresh); };
  }, [companyId, onPendingChange]);
  if (!intents.length) return null;
  return <div role="status" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
    <p>Ответ на отправку ещё не подтверждён. Проверьте результат перед новой сменой.</p>
    {intents.map(intent => <div key={intent.key} className="flex flex-wrap items-center justify-between gap-2">
      <span>{labels[intent.action] || "Действие"} · {new Date(intent.createdAt).toLocaleString("ru-RU")}{intent.payload.completedAreaHa != null ? " · " + intent.payload.completedAreaHa + " га" : ""}</span>
      <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await retryOperationIntent(intent); await onRecovered(intent); toast({ title:"Результат отправки подтверждён" }); }
        catch(error) { toast({ title:"Отправка",description:error instanceof Error ? error.message : "Не удалось проверить",variant:"destructive" }); }
        finally { setBusy(false); const { data } = await supabase.auth.getSession(); setIntents(data.session && companyId ? pendingOperationIntents(data.session.user.id,companyId) : []); }
      }}>Проверить отправку</Button>
    </div>)}
  </div>;
}
