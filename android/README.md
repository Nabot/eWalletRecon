# Android SMS capture app

Kotlin · Jetpack Compose · Room · WorkManager · Encrypted prefs

> **Distribution: direct APK only — not published on the Play Store.**  
> Install via USB / MDM / internal download. SMS permissions are restricted on Play Store for this use case.

## Purpose

Runs on each phone that holds a company e-wallet (Send Wallet) number. Captures incoming provider SMS, queues offline in Room, and syncs to the backend with retry/backoff.

## Configure once (v1.3+)

1. **Admin** opens web **Devices** → Register device → **Create & show QR** (key shown once).
2. Install the APK (`dev` or `prod` flavor).
3. On the phone: **Scan provision QR** (or paste key) → **Save & lock**.
4. After a successful heartbeat + config fetch, the connection is **sealed** (encrypted at rest). Ops only see status.
5. Replacing a phone: **Reset connection…** (type `RESET`) on the old/new handset, then provision a **new** device key from admin. Never reuse keys.

### Flavors

| Flavor | Default API base | Cleartext | Edit URL in UI |
|--------|------------------|-----------|----------------|
| `dev` | `http://10.0.2.2:3001` | yes | yes |
| `prod` | `https://api.example.com` (override with `-Pewallet.apiBase=…`) | no | no (QR/MDM may still supply base) |

```bash
./gradlew :app:assembleDevDebug
./gradlew :app:assembleProdRelease -Pewallet.apiBase=https://recon.example.com
```

Set backend `PUBLIC_API_BASE_URL` to the URL phones can reach (LAN IP for lab devices, public HTTPS in prod) so the QR embeds the right host.

### MDM

Managed configuration keys: `api_base`, `api_key` (see `res/xml/app_restrictions.xml`). Applied when the connection is not yet locked.

### Deep link

`ewallet-capture://provision?payload=<urlsafe-base64-json>`

## Permissions

| Permission | Rationale |
|------------|-----------|
| `RECEIVE_SMS` / `READ_SMS` | Read e-wallet deposit notifications on this device |
| `INTERNET` | Sync queue + heartbeat to API |
| `RECEIVE_BOOT_COMPLETED` | Resume sync after reboot |
| `CAMERA` | Scan one-time provision QR |

## Setup (Android Studio)

1. Open the `android/` folder in Android Studio (Giraffe+ / JDK 17).
2. Sync Gradle; select **devDebug**.
3. Run on emulator/device; grant SMS.
4. Create a device in the web dashboard and scan the QR (or paste the key).

## Seeded device keys (dev only)

After seeding the backend (legacy plaintext keys — prefer QR from admin create):

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

## Status screen

Ops-focused UI with Ready / Needs attention / Setup banner, SMS·Online·Queue chips, device identity, locked connection panel, and Sync now.
