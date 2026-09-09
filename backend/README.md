# Backend API

Node.js + TypeScript + Express + Prisma + MySQL.

## Setup

```bash
# from repo root
cp backend/.env.example backend/.env
docker compose up -d mysql
npm install
npm run db:migrate
npm run db:seed
npm run dev:backend
```

### DigitalOcean Managed MySQL

Keep production `DATABASE_URL` on the host (Render), not in `backend/.env`.

If you must migrate from a laptop, set the URL **for that shell only**:

```bash
DATABASE_URL='mysql://doadmin:PASSWORD@HOST:25060/DEFADB?sslaccept=strict' npm run db:migrate
```

**Never** run `npm run db:seed` against production. Seed deletes wallets, deposits, devices, and staff. The script refuses remote hosts and `NODE_ENV=production` unless `ALLOW_DESTRUCTIVE_SEED=I_UNDERSTAND_DELETE_ALL_DATA` is set.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Watch mode API |
| `npm test` | Matching engine + SMS parser tests |
| `npm run db:migrate:dev` | Create/apply migrations |
| `npm run db:seed` | **Local only** — sample wallets/users (wipes tables) |
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
