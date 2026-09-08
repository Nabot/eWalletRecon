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

Use the connection string from the DO control panel, for example:

```env
DATABASE_URL=mysql://doadmin:PASSWORD@HOST:25060/DEFADB?sslaccept=strict
```

Then run migrations against that DB: `npm run db:migrate`.

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
