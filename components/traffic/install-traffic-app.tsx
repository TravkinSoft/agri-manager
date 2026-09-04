"use client";
import { useEffect, useState } from "react";
import { Download, Smartphone } from "lucide-react";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallTrafficApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const display = window.matchMedia("(display-mode: standalone)");
    const checkInstalled = () =>
      setInstalled(
        display.matches ||
          Boolean(
            (navigator as Navigator & { standalone?: boolean }).standalone,
          ),
      );
    const available = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const complete = () => {
      setInstalled(true);
      setPrompt(null);
    };
    checkInstalled();
    display.addEventListener("change", checkInstalled);
    window.addEventListener("beforeinstallprompt", available);
    window.addEventListener("appinstalled", complete);
    if (window.isSecureContext && "serviceWorker" in navigator) {
      // Specific registration wins over the existing ERP root worker. No
      // unregister-all or cache cleanup: other installed apps remain intact.
      void navigator.serviceWorker
        .register("/ptc-sw.js", {
          scope: "/traffic-operator",
          updateViaCache: "none",
        })
        .then((registration) => registration.update())
        .catch(() =>
          setMessage(
            "Подготовка установки не завершилась. Кабинет доступен в браузере; попробуйте обновить страницу.",
          ),
        );
    }
    return () => {
      display.removeEventListener("change", checkInstalled);
      window.removeEventListener("beforeinstallprompt", available);
      window.removeEventListener("appinstalled", complete);
    };
  }, []);
  async function install() {
    if (!prompt) {
      setInstructions((value) => !value);
      return;
    }
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setPrompt(null);
      if (choice.outcome === "accepted")
        setMessage("Запрос на установку передан браузеру.");
      else setInstructions(true);
    } catch {
      setInstructions(true);
      setMessage("Браузер не открыл установку. Используйте его меню.");
    } finally {
      setBusy(false);
    }
  }
  if (installed) return null;
  return (
    <section
      aria-label="Установка Оборота машин"
      className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4"
    >
      <div className="flex items-start gap-3">
        <Smartphone className="mt-1 shrink-0 text-amber-300" size={22} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-200">
            Оборот машин на главном экране
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Отдельный значок открывает этот кабинет. Для статусов нужен
            интернет.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void install()}
        disabled={busy}
        aria-expanded={instructions}
        className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-amber-300 px-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
      >
        <Download size={18} />
        {busy
          ? "Открываем установку…"
          : prompt
            ? "Установить на телефон"
            : "Как установить на телефон"}
      </button>
      {instructions ? (
        <div className="mt-3 space-y-2 text-sm leading-relaxed text-slate-300">
          <p>
            В Chrome на Android откройте меню ⋮ → «Добавить на главный экран» →
            «Установить», если браузер предлагает этот пункт.
          </p>
          <p className="text-xs text-slate-400">
            Если доступен только ярлык, откройте страницу в обычном Chrome, не
            во встроенном браузере и не в режиме инкогнито. Доступность
            установки определяет браузер. Кабинет можно использовать и без
            установки.
          </p>
        </div>
      ) : null}
      {message ? (
        <p role="status" className="mt-3 text-sm text-amber-200">
          {message}
        </p>
      ) : null}
    </section>
  );
}
