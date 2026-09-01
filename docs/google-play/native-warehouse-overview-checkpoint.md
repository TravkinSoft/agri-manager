# Google — Native warehouse overview checkpoint

Дата: 2026-09-02.

## Результат этапа

- Добавлен нативный read-only раздел «Склады и объекты» через один подтверждённый `GET /api/warehouses/summaries?includeArchived=false`.
- Экран показывает только поля server contract: название, `place_type`, тип склада, место, вместимость, число материальных позиций, партии и массу урожая, общую/семенную/прочую материальную массу, последнее движение и описание.
- Поддержаны объекты `WAREHOUSE`, `YARD`, `DRYER`, `CLEANER`; неизвестное значение показывается текстом без придумывания нового типа.
- Loading, empty, error, offline/stale cache и ручное обновление реализованы.
- Cache зашифрован существующим Android Keystore storage и изолирован по `actorId + companyId`.
- Из Android route разрешён только для `global_admin`, `company_admin`, `agronomist`, `weighman`. `specialist`, складовщик и все остальные роли route не получают.
- Для Global Admin без подтверждённого company context кнопка отключена; клиент не подставляет компанию самостоятельно.

## Security и live verification

- Production probe без `Authorization`: `GET https://travkinflow.com/api/warehouses/summaries?includeArchived=false` вернул `401`, без redirect.
- Endpoint получает server actor, разрешает company context, создаёт user-scoped Supabase client и применяет `assertActorAccess`.
- Сервер ограничивает warehouse и balance queries по `company_id`; RLS остаётся активным через user-scoped client.
- Web endpoint допускает также warehouse roles и `director`, но этих ролей нет в native `SupportedRole`, поэтому web ACL не расширяет mobile scope.
- `specialist` — разрешённая мобильная роль приложения, но warehouse API её не допускает; раздел скрыт fail-closed.
- Android вызывает только `GET`; write endpoints складов не подключены.

## Проверки

- `testDebugUnitTest`: 7/7 PASS, failures 0, errors 0.
- `lintDebug`: PASS, fatal 0, errors 0, warnings 12.
- `assembleDebug`: PASS.
- `compileReleaseKotlin`: PASS.
- Runtime source gate: WebView/TWA/browser shell совпадений 0.
- Runtime dependency gate: `androidx.webkit`/`androidx.browser` совпадений 0.
- Hardcoded JWT/password gate: совпадений 0.
- Подключённых Android-устройств нет (`adb devices` пуст).

## Debug APK

- Package: `com.travkin.flow.qa`.
- Version: `3 (3.0.0-qa)`.
- minSdk 29, targetSdk 36, compileSdk 36.
- Path: `android/app/build/outputs/apk/debug/app-debug.apk`.
- Size: `64,438,627` bytes.
- SHA-256: `B96CFA54D1760EB7A7EA71189455575749D130B76B88A7526B0DBF5140EC85D0`.

## Честные ограничения checkpoint

- Secure Supabase build variables в текущем process отсутствовали; login QA APK остаётся fail-closed.
- Device smoke, реальные role accounts, process death и offline recovery не проверены из-за отсутствия Android-устройства.
- Детали продуктов/партий и endpoint `/balances` намеренно не подключены: текущий этап ограничен подтверждённой краткой summary.
- Число позиций и массы отображаются как server-computed values; клиент их не пересчитывает по неподтверждённым данным.
- Создание, редактирование, архивирование, движения, инвентаризация и transfer отсутствуют.

## Граница воздействия

- Production deploy: 0.
- Production DB writes: 0.
- Production read-only requests: 1 unauthenticated auth-gate probe.
- Миграции: 0.
- Google Play changes: 0.
- Структура посевов и прочая бизнес-логика: не изменялись.
- Основная TravkinFlow и старые Google-ветки: не изменялись.
