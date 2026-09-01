# Google — Native harvest overview checkpoint

Дата: 2026-09-02.

## Результат этапа

- Добавлена нативная read-only сводка урожая через `GET /api/dashboard/harvest-summary?period=current_day&section=summary`.
- Экран показывает период, принятую массу, завершённые и открытые рейсы, итоги по культурам и полям, влажность и проблемы.
- Доступ в Android включён только для `global_admin`, `company_admin`, `agronomist`; `weighman` и `specialist` остаются вне этого route.
- Для Global Admin без подтверждённого `companyId` кнопка отключена: клиент не угадывает и не подменяет контекст компании.
- Ответ кэшируется в существующем Android Keystore storage и изолируется по `actorId + companyId`.
- Реализованы loading, empty, error, offline/stale и ручное обновление.

## Security и live verification

- Production probe без `Authorization`: `GET https://travkinflow.com/api/dashboard/harvest-summary?period=current_day&section=summary` вернул `401`, без redirect.
- Endpoint использует `resolveWeighbridgeSession` с read roles `global_admin`, `company_admin`, `agronomist`, `director`.
- Native enum не содержит `director`, `warehouse` или другие исключённые роли, поэтому более широкий web ACL не расширяет mobile scope.
- Session resolver применяет server actor, company resolution, user-scoped Supabase client, active profile/role/company ACL и RLS.
- Android отправляет только `GET`; при `401` выполняется один session refresh и повторный `GET`. Write endpoints не подключены.

## Проверки

- `testDebugUnitTest`: 6/6 PASS, failures 0, errors 0.
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
- Size: `64,098,399` bytes.
- SHA-256: `6337E0680F2468684592B02E537BB1CEBDA708C882E2F958CE1ECD061A990E62`.

## Честные ограничения checkpoint

- Secure Supabase build variables в текущем process отсутствовали; login собранного QA APK остаётся fail-closed.
- Device smoke, реальные данные разрешённого аккаунта, process death и offline recovery не проверены из-за отсутствия Android-устройства.
- Endpoint агрегирует полный набор harvest tickets на сервере и пока не имеет компактного mobile DTO/version. При больших объёмах это performance-риск; клиент не маскирует его локальной фиктивной pagination.
- Выбор периода и фильтров пока фиксирован на текущем операционном дне. Это сознательный минимальный read-only slice.
- Сводка не меняет crop structure, талоны, партии, смены или другие бизнес-данные.

## Граница воздействия

- Production deploy: 0.
- Production DB writes: 0.
- Production read-only requests: 1 unauthenticated auth-gate probe.
- Миграции: 0.
- Google Play changes: 0.
- Основная TravkinFlow и старые Google-ветки: не изменялись.
