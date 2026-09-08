# Android SMS capture app

Kotlin · Jetpack Compose · Room · WorkManager

> **Distribution: direct APK only — not published on the Play Store.**  
> Install via USB / MDM / internal download. SMS permissions are restricted on Play Store for this use case.

## Purpose

Runs on each phone that holds a company e-wallet (Send Wallet) number. Captures incoming provider SMS, queues offline in Room, and syncs to the backend with retry/backoff.

## Permissions

| Permission | Rationale |
|------------|-----------|
| `RECEIVE_SMS` / `READ_SMS` | Read e-wallet deposit notifications on this device |
| `INTERNET` | Sync queue + heartbeat to API |
| `RECEIVE_BOOT_COMPLETED` | Resume sync after reboot |

Rationale is shown in-app and in `res/values/strings.xml`.

## Setup (Android Studio)

1. Open the `android/` folder in Android Studio (Giraffe+ / JDK 17).
2. Sync Gradle.
3. Set API base URL:
   - Emulator → host machine: `http://10.0.2.2:3001`
   - Physical device on LAN: `http://<your-mac-ip>:3001`
4. Paste a device API key from `npm run db:seed` output (or admin-created key).
5. Grant SMS permissions when prompted.
6. Build → Build APK(s) / Run on device.

## Seeded device keys (dev)

After seeding the backend:

- `dev-device-paypulse-key-001`
- `dev-device-easywallet-key-001`

## Sender ID filter

Confirmed handset sender IDs:

| Provider | From |
|----------|------|
| PayPulse / BlueVoucher | `PAYPULSE` |
| FNB eWallet | `362626` |
| EasyWallet | `140295` |

Defaults ship in prefs and are refreshed from `GET /api/capture/config`.

## Offline behaviour

- SMS → Room `pending_sms` immediately
- Inbox backfill (`READ_SMS`) on sync / permission grant / boot catch-up
- WorkManager sync with retry on failure (poison messages stop after 8 attempts)
- Idempotency keys prevent double-ingest on the server
- Heartbeat every ~3 minutes (backend offline window defaults to 5 minutes)

## Status screen (v1.2+)

Ops-focused UI with Ready / Needs attention / Setup banner, SMS·Online·Queue
chips, device identity panel, collapsible connection settings (device API key —
no staff login), and Sync now.
