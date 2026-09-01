# Google — Native Android V1 foundation checkpoint

Дата: 2026-09-02.

## Результат этапа

- Рабочая ветка `codex/google-market-native-v1` создана от live-проверенного `origin/master` `9b64a4d74964da6a728586a803251d604436233d`.
- Архитектура зафиксирована до кода отдельным коммитом `d0eee94a5259bb70fd69b854efbb934ade985a76`.
- Java browser shell удалён из native-ветки. Runtime — Kotlin + Jetpack Compose.
- Удалены runtime dependency `androidx.webkit`, bridge, browser route policy и browser notification shim.
- Реализованы login, Supabase access/refresh session, Android Keystore AES-GCM storage, server actor validation и logout.
- Mobile role policy fail-closed принимает только Global Admin, Company Admin, Агронома, Весовщика и Специалиста.
- Первый реальный read-only экран использует `GET /api/weighbridge/bootstrap?summary=true` и показывает смену, рейсы, массу, активные/проблемные/несинхронизированные талоны.
- Read cache зашифрован, изолирован по actor/company и явно помечается stale/offline.
- Manifest оставляет только сеть; notification/camera/storage permissions не запрашиваются до реализации соответствующих функций.

## Проверки

- `testDebugUnitTest`: 3/3 PASS, failures 0, errors 0, skipped 0.
- `lintDebug`: PASS, fatal 0, errors 0. Осталось 12 non-blocking warnings: совместимые pinned dependencies и существующие launcher-icon замечания.
- `assembleDebug`: PASS.
- `compileReleaseKotlin`: PASS.
- Runtime source gate: 0 совпадений по `WebView`, `androidx.webkit`, `loadUrl`, `TrustedWebActivity`, `bubblewrap`.
- Runtime dependency gate: ни `androidx.webkit`, ни `androidx.browser` не присутствуют в `debugRuntimeClasspath`.
- Hardcoded secret pattern gate: 0 совпадений.
- Debug manifest: `INTERNET`, `ACCESS_NETWORK_STATE`; cleartext traffic disabled; backup/data transfer для app data отключены.

## Debug APK

- Package: `com.travkin.flow.qa`.
- Version: `3 (3.0.0-qa)`.
- minSdk 29, targetSdk 36, compileSdk 36.
- Path: `android/app/build/outputs/apk/debug/app-debug.apk`.
- Size: `64,098,399` bytes.
- SHA-256: `AB1EF1AEC2A4822739372ECD053633FAB95ECA945A503BCCE84B65BFB9CC71E4`.

APK является QA artifact и не предназначен для Play upload.

## Честные ограничения checkpoint

- `TRAVKINFLOW_SUPABASE_URL` и `TRAVKINFLOW_SUPABASE_ANON_KEY` отсутствовали в build process. APK компилируется, но login fail-closed до безопасной QA-сборки с этими build-time значениями.
- Подключённого Android-устройства/эмулятора нет (`adb devices` пуст), поэтому device login/process-death/offline/App Links smoke ещё не выполнен.
- Полный рабочий сценарий Весовщика с PIN и write-командами не реализован: нужен отдельный native operator-session/idempotency E2E gate.
- Камера/файлы, FCM, Room/WorkManager write queue и дополнительные role screens остаются следующими этапами.
- Signed release AAB не создавался; Google Play не изменялся.

## Граница воздействия

- Production deploy: 0.
- Production DB writes: 0.
- Миграции: 0.
- Google Play uploads/releases/publication: 0.
- Старые ветки `codex/google-market-v1` и `codex/google-market-release-v3`: не изменялись, не сливались и не удалялись.

## Следующий безопасный этап

1. Получить Supabase URL/publishable key из утверждённого secure build environment без записи в Git/чат.
2. Собрать QA APK и пройти физический device smoke для Агронома и Весовщика.
3. Добавить native ticket list/details read-only с cursor/error contract.
4. Только после этого проектировать и включать PIN/write workflow Весовщика за server feature flag.
