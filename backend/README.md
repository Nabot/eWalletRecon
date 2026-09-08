# Backend API

Node.js + TypeScript + Express + Prisma + PostgreSQL.

## Setup

```bash
# from repo root
cp backend/.env.example backend/.env
docker compose up -d postgres
npm install
cd backend
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Watch mode API |
| `npm test` | Matching engine + SMS parser tests |
| `npm run db:migrate:dev` | Create/apply migrations |
| `npm run db:seed` | Sample wallets, users, top-ups, staff |
| `npm run db:studio` | Prisma Studio |

## Auth

- **Staff**: `POST /api/auth/login` → JWT (`Authorization: Bearer …`)
- **Capture devices**: `X-Api-Key` on `/api/capture/*`

Seeded staff: `admin@example.com` / `admin123`

## Key endpoints

- `POST /api/capture/sms` — device SMS batch ingest
- `POST /api/capture/heartbeat`
- `GET /api/deposits`, `GET /api/exceptions`
- `POST /api/deposits/:id/resolve` — manual credit
- `POST /api/admin/reparse` — ADMIN re-run parsers on stored `rawMessage`
- `GET /api/reports/wallet-totals?period=day|week`
- `GET /api/audit`
- `WS /ws?token=<jwt>` — live deposit/device events

## Ingestion seam (webhooks)

See `src/services/ingestion/ingest.ts`. SMS and future merchant webhooks both call `ingestDeposit()`; matching engine is source-agnostic. `ingestFromWebhook()` is a stub for provider APIs.

## SMS parsers

**Placeholder formats only.** Supply real SMS templates and sender IDs before production. Parsers live under `src/services/parsers/`.
