# TravkinFlow Google Play store assets

Status: production-source checkpoint. These files are not uploaded to Google Play by this repository.

## Authoritative inputs

- Wordmark: `public/brand/v1/travkinflow-logo-154a0d68.png`.
- Store icon: `android/app/src/main/res/drawable/travkinflow_icon.png`.
- Brand colors already used by TravkinFlow: deep neutral `#0F1115` and gold `#E0B100`.

The official mark is composited pixel-for-pixel. It is never regenerated, traced or reinterpreted.

## Deterministic export

Run from PowerShell:

```powershell
./docs/google-play/store-assets/generate-store-assets.ps1
```

Outputs:

- `feature-graphic-1024x500.png`: 1024 × 500, opaque 24-bit PNG, 169,702 bytes, SHA-256 `3515E7C9BABE68A30A0610BD6ABC286C8DF84F38238BC3A07122EE9816940266`.
- `play-store-icon-512.png`: byte-identical copy of the approved 512 × 512 Android icon source, 285,283 bytes, SHA-256 `81B73BE1E9755DE816FB5E97E546620E5450A52E67886203C9BC2568AF8C996A`.

The generator validates dimensions and rejects alpha in the feature graphic. It does not require network access or an image-generation model.

## Screenshot set after QA login

Capture from the exact signed RC installed on an API 36 phone profile. Use synthetic QA records only, 1080 × 1920 portrait, no device frame and no post-rendered fake UI.

Required sequence:

1. Operational overview — headline metrics and current shift state.
2. Tickets — several synthetic tickets with distinct statuses.
3. Ticket detail — weights and status chronology without personal identifiers.
4. Weather — KATO-selected forecast with a synthetic locality.

Optional sequence, up to eight total:

5. Harvest summary for an allowed role.
6. Warehouse/object balances for an allowed role.
7. Read-only Weighbridge workspace after QA backend smoke.
8. Notifications or Profile with synthetic identity data.

Before capture: use 100% font/display scale, portrait orientation, light status-bar clock, full battery, no notification icons, stable network, no Production data. Keep the native app bar and system status/navigation regions visible consistently across the set. Review every pixel for email, UUID, company name, vehicle plate, weight and notification leakage before upload.
