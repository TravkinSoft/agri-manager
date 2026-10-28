"use client";

import { useState } from "react";
import { Cable, Download, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import connectorRelease from "@/public/downloads/connector-win7/release.json";

/** Installation/capture entry point only: no polling, serial access or ticket state changes. */
export function ScaleConnectorMenu() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Настройки весовой" title="Настройки весовой">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen(true)}><Cable className="mr-2 h-4 w-4" />Подключение весов</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Подключение весов · Travkin Connector</DialogTitle>
            <DialogDescription>Микросим М0601-БМ-2.1 · кабель RS-232 · компьютер весовой</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="font-semibold">Первое подключение: проверка сигнала</p>
              <p className="mt-1 text-muted-foreground">Версия {connectorRelease.version} записывает данные прибора для настройки. Автоподстановки веса в талоны пока нет. Талоны и ручной ввод работают как прежде.</p>
            </div>
            <ol className="list-decimal space-y-2 pl-5">
              <li>Скачайте и установите программу <strong>на компьютере весовой</strong>.</li>
              <li>Откройте её через «Пуск → TravkinFlow». Выберите COM-порт и параметры связи из настроек прибора или штатной программы.</li>
              <li>Нажмите «Подключить», затем «Сохранить диагностику». Передайте файл для проверки единиц, стабильности и режима брутто/нетто.</li>
            </ol>
            <p className="text-muted-foreground">Требуется Windows 7 SP1 (32/64 бита) и .NET Framework 4.8. На реальном компьютере весовой эта сборка ещё не проверена.</p>
            <Button asChild className="h-auto min-h-10 w-full whitespace-normal py-2 text-center">
              <a href={connectorRelease.installer.url} download><Download className="mr-2 h-4 w-4 shrink-0" />Скачать Travkin Connector для Windows 7</a>
            </Button>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs underline underline-offset-4">
              <a href={connectorRelease.portable.url} download>ZIP без установки</a>
              <a href="https://dotnet.microsoft.com/en-us/download/dotnet-framework/net48" target="_blank" rel="noreferrer">Microsoft .NET Framework 4.8</a>
              <a href="/downloads/connector-win7/instructions.txt" download>Инструкция</a>
            </div>
            <p className="text-xs text-muted-foreground">Установщик без цифровой подписи. Не отключайте защиту Windows и не устанавливайте неизвестные драйверы. Если COM-порт занят, не останавливайте рабочую программу без согласования. Калибровку не трогать.</p>
            <details className="rounded-md border border-border p-2 text-xs">
              <summary className="cursor-pointer">Проверить файл · SHA-256</summary>
              <p className="mt-2 break-all font-mono">{connectorRelease.installer.sha256}</p>
              <p className="mt-1 text-muted-foreground">{connectorRelease.installer.bytes.toLocaleString("ru-RU")} байт · диагностика, не автоматическое взвешивание</p>
            </details>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
