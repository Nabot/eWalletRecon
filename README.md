# WalletRecon

Full-stack system for a Namibian betting company to capture e-wallet deposit SMS, match them to user top-up requests, and credit betting accounts.

## Components

| Package | Description |
|---------|-------------|
| [`backend`](./backend) | Node.js/Express API, matching engine, SMS parsers, WebSocket |
| [`web`](./web) | React staff dashboard |
| [`android`](./android) | Kotlin SMS capture app (direct APK, not Play Store) |
| [`shared`](./shared) | Shared TypeScript types |

## Quick start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- JDK 17+ and Android Studio (for the capture app)

### 1. Start MySQL + API

```bash
cp backend/.env.example backend/.env
docker compose up -d mysql
npm install
npm run db:migrate
npm run db:seed
npm run dev:backend
```

API: `http://localhost:3001` · Health: `GET /health`

For **DigitalOcean Managed MySQL**, set `DATABASE_URL` in `backend/.env` to the panel connection string (usually add `?sslaccept=strict`).

### 2. Start dashboard

```bash
cp web/.env.example web/.env
npm run dev:web
```

Dashboard: `http://localhost:5174`

Seeded staff login: `admin@example.com` / `admin123`

### 3. Android capture app

See [`android/README.md`](./android/README.md). Distribute as a **direct APK** (not via Play Store).

## Matching priority

Auto-match to user accounts is **disabled**. Deposits land as pending; staff credit betting accounts outside this system, then mark them credited in the dashboard (audit logged).

## SMS formats

See [`docs/SMS_FORMATS.md`](./docs/SMS_FORMATS.md) for live PayPulse/BlueVoucher, EasyWallet, and FNB samples.

Parsers ship with those formats. **Pay2Cell still needs a real sample.** Provide sender IDs as they appear in the Android notification bar if they differ from BlueVoucher / Bank WHK / FNB.


## Future: provider webhooks

Deposit ingestion is source-agnostic. See `backend/src/services/ingestion/` — SMS and future merchant/webhook adapters both emit `NormalizedDeposit` into the same matching engine.

## Currency

All amounts are **NAD** (Namibian Dollar).
