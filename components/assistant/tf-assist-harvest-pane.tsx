"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { supabase } from "@/lib/supabase/client";
import type { Answer, Choice, Question } from "@/lib/tf-assist/contracts";

type Entry = { question: string; answer: Answer };
const KIND = { fact: "Факт", calculation: "Расчёт", forecast: "Прогноз" };

export function TfAssistHarvestPane() {
  const { profile, user } = useAuth();
  const companyId = profile?.context_company_id || "";
  const scope = `${user?.id || ""}:${companyId}`;
  const [history, setHistory] = useState<Entry[]>([]),
    [message, setMessage] = useState("");
  const [seasonId, setSeasonId] = useState(""),
    [sourceId, setSourceId] = useState("");
  const [harvestedHa, setHarvestedHa] = useState(""),
    [remainingHa, setRemainingHa] = useState("");
  const [seasons, setSeasons] = useState<Choice[]>([]),
    [sources, setSources] = useState<Choice[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [historyScope, setHistoryScope] = useState(scope);
  const abort = useRef<AbortController | null>(null),
    currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    abort.current?.abort();
    setHistory([]);
    setSeasonId("");
    setSourceId("");
    setSeasons([]);
    setSources([]);
    setHarvestedHa("");
    setRemainingHa("");
    setMessage("");
    setError("");
    setBusy(false);
    setHistoryScope(scope);
    return () => abort.current?.abort();
  }, [scope]);
  const permitted =
    profile?.role === "global_admin" &&
    profile.status === "active" &&
    !profile.is_impersonating &&
    !profile.role_is_legacy_alias;
  if (!permitted)
    return (
      <p className="p-5 text-sm text-muted-foreground">
        TF Assist доступен только Global Admin.
      </p>
    );
  if (!companyId)
    return (
      <p className="p-5 text-sm">
        Выберите компанию в верхней панели, затем задайте вопрос об уборке.
      </p>
    );

  async function send(text = message, selected?: string) {
    if (!text.trim() || busy || !companyId) return;
    const sentScope = scope,
      controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("Войдите в кабинет заново.");
      const body: Question = {
        companyId,
        message: text,
        ...(seasonId ? { seasonId } : {}),
        ...(selected || sourceId ? { sourceId: selected || sourceId } : {}),
        ...(harvestedHa ? { harvestedHa } : {}),
        ...(remainingHa ? { remainingHa } : {}),
      };
      const response = await fetch("/api/tf-assist/query", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
      const result = await response.json();
      if (controller.signal.aborted || currentScope.current !== sentScope)
        return;
      if (!response.ok) throw new Error(result.error || "Ответ недоступен.");
      const answer = result as Answer;
      if (answer.companyId !== companyId)
        throw new Error("Компания ответа не совпала. Повторите вопрос.");
      setHistory((h) => [...h.slice(-9), { question: text, answer }]);
      if (answer.seasons) setSeasons(answer.seasons);
      if (answer.choices) setSources(answer.choices);
      if (answer.seasonId) setSeasonId(answer.seasonId);
      if (answer.sourceId) setSourceId(answer.sourceId);
      setMessage("");
    } catch (e) {
      if (!controller.signal.aborted && currentScope.current === sentScope)
        setError(e instanceof Error ? e.message : "Ответ недоступен.");
    } finally {
      if (currentScope.current === sentScope) setBusy(false);
    }
  }

  return (
    <section
      aria-label="TF Assist — уборка"
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <header className="border-b p-4">
        <h2 className="font-semibold">TF Assist · Уборка</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Поступления, партии, урожайность и техника выбранной компании
        </p>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
        {historyScope === scope && history.length === 0 && (
          <div className="space-y-3 text-sm">
            <p>Выберите вопрос или напишите свой.</p>
            <div className="flex flex-wrap gap-2">
              {[
                "Что сейчас убираем?",
                "Остаток урожая на складе",
                "Какая техника в ремонте?",
              ].map((q) => (
                <button
                  className="rounded-xl border px-3 py-2 text-left hover:bg-muted"
                  key={q}
                  disabled={busy}
                  onClick={() => void send(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {historyScope === scope &&
          history.map((entry, i) => (
            <article key={i} className="space-y-3 text-sm">
              <p className="ml-8 rounded-xl bg-muted p-3">{entry.question}</p>
              <div className="space-y-3 rounded-xl border p-3">
                <p className="font-medium">{entry.answer.conclusion}</p>
                {entry.answer.metrics.map((metric, n) => (
                  <div key={n} className="border-t pt-2">
                    <div className="flex items-start justify-between gap-3">
                      <span>{metric.label}</span>
                      <strong className="text-right tabular-nums">
                        {metric.value}
                      </strong>
                    </div>
                    <details className="mt-1 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">
                        {KIND[metric.kind]} · источники (
                        {metric.evidence.length})
                      </summary>
                      {metric.formula && (
                        <p className="mt-2">{metric.formula}</p>
                      )}
                      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto break-all">
                        {metric.evidence.map((e, j) => (
                          <li key={j}>
                            {e.table} / {e.id} · {e.status}
                            {e.occurredAt ? ` · ${e.occurredAt}` : ""}
                            {e.value ? ` · ${e.value}` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                ))}
                {entry.answer.warnings.map((warning, n) => (
                  <p key={n} className="text-xs text-muted-foreground">
                    {warning}
                  </p>
                ))}
                <details className="text-xs text-muted-foreground">
                  <summary>Время чтения и проверка источников</summary>
                  <p className="break-all">
                    {entry.answer.readInterval.from} —{" "}
                    {entry.answer.readInterval.to}
                  </p>
                  <p className="break-all">
                    Компания: {entry.answer.companyId} · запрос:{" "}
                    {entry.answer.requestId}
                  </p>
                  {entry.answer.sourceAudit.map((a) => (
                    <p key={a.table}>
                      {a.table}: {a.state} · {a.schema}
                    </p>
                  ))}
                </details>
              </div>
            </article>
          ))}
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive p-3 text-sm"
          >
            {error}
          </p>
        )}
        {busy && (
          <p role="status" className="text-sm text-muted-foreground">
            Проверяю источники и расчёт…
          </p>
        )}
      </div>
      <form
        className="space-y-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {seasons.length > 0 && (
          <select
            aria-label="Сезон"
            className="w-full rounded border bg-background p-2 text-sm"
            value={seasonId}
            onChange={(e) => {
              setSeasonId(e.target.value);
              setSourceId("");
              setSources([]);
            }}
          >
            <option value="">Выберите сезон</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        {sources.length > 0 && (
          <select
            aria-label="Источник урожая"
            className="w-full rounded border bg-background p-2 text-sm"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            <option value="">Выберите поле, сорт и репродукцию</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Площадь для расчёта урожайности
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label>
              Убрано, га
              <input
                aria-label="Убрано, га"
                inputMode="decimal"
                className="mt-1 w-full rounded border bg-background p-2"
                value={harvestedHa}
                onChange={(e) => setHarvestedHa(e.target.value)}
              />
            </label>
            <label>
              Осталось, га
              <input
                aria-label="Осталось, га"
                inputMode="decimal"
                className="mt-1 w-full rounded border bg-background p-2"
                value={remainingHa}
                onChange={(e) => setRemainingHa(e.target.value)}
              />
            </label>
          </div>
        </details>
        <div className="flex items-end gap-2">
          <textarea
            aria-label="Вопрос об уборке"
            rows={2}
            maxLength={2000}
            className="min-w-0 flex-1 resize-none rounded-xl border bg-background p-3 text-sm"
            placeholder="Поле 9, Сорая, примерно 7 га — какая урожайность?"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy || !message.trim()}
            className="rounded-xl bg-primary px-3 py-3 text-sm text-primary-foreground disabled:opacity-40"
          >
            Спросить
          </button>
        </div>
      </form>
    </section>
  );
}
