# Deploy: Vercel (web) + Render (API) + DigitalOcean MySQL

Production shape:

- **Web** → [Vercel](https://vercel.com) (this repo)
- **API** → [Render](https://render.com) Docker web service (`backend/Dockerfile`)
- **DB** → DigitalOcean Managed MySQL (`DATABASE_URL`)

`vercel.json` and `render.yaml` are in the repo root.

## 1. DigitalOcean MySQL

1. Create a database/user if needed (utf8mb4).
2. Copy the connection string. For Prisma, SSL usually looks like:

   ```text
   mysql://USER:PASSWORD@HOST:25060/DBNAME?sslaccept=strict
   ```

3. Under **Trusted Sources**, you must allow Render to connect:
   - Easiest for first bring-up: temporarily allow `0.0.0.0/0` (open), then tighten later.
   - Or add Render’s outbound IPs once the service exists.

## 2. Render (API)

### Option A — Blueprint (recommended)

1. Open [Render Blueprints](https://dashboard.render.com/blueprints).
2. Connect **Nabot/eWalletRecon** and apply `render.yaml`.
3. Choose **Starter** (not Free) so the API does not sleep — Android capture needs it always on.
4. When prompted, set:

   | Key | Example |
   |-----|---------|
   | `DATABASE_URL` | DO MySQL URL with `sslaccept=strict` |
   | `JWT_SECRET` | long random string |
   | `CORS_ORIGIN` | `https://YOUR-PROJECT.vercel.app` (update after Vercel exists) |
   | `PUBLIC_API_BASE_URL` | `https://ewallet-recon-api.onrender.com` (your Render URL) |

5. Wait for deploy. Check `https://YOUR-SERVICE.onrender.com/health`.

### Option B — Dashboard manual

1. **New → Web Service** → repo `Nabot/eWalletRecon`.
2. Runtime **Docker**, Dockerfile path `./backend/Dockerfile`, context `.`.
3. Health check path: `/health`.
4. Same env vars as above.
5. Plan: **Starter**.

### After API is up

```bash
# Migrations already run on container start (Dockerfile).
# From a laptop, migrate only — never seed production:
DATABASE_URL='mysql://USER:PASSWORD@HOST:25060/DB?sslaccept=strict' npm run db:migrate
```

**Do not run `npm run db:seed` against DigitalOcean / Render.** Seed `deleteMany`s wallets, deposits, devices, users, and staff. The script blocks remote hosts unless you deliberately set `ALLOW_DESTRUCTIVE_SEED=I_UNDERSTAND_DELETE_ALL_DATA`.

For a first admin on a fresh empty DB, prefer creating staff via a one-off SQL/`prisma` create (or a future non-destructive bootstrap), not the sample seed.

## 3. Vercel (web)

1. [vercel.com/new](https://vercel.com/new) → import **Nabot/eWalletRecon**.
2. **Root Directory = `web`** (Project → Settings → General).
   - This makes Vercel treat the app as a **Vite static site**, not a Node server.
   - If Root Directory is empty/`.`, Vercel may look for `index.js` in `web/dist` and fail after a successful Vite build.
3. Framework Preset: **Vite** (should auto-detect from `web/vite.config.ts`).
4. `web/vercel.json` sets install/build (uses monorepo workspaces via `cd ..`) and SPA rewrites.
5. Environment variables (Production):

   | Key | Value |
   |-----|--------|
   | `VITE_API_URL` | `https://YOUR-SERVICE.onrender.com` |
   | `VITE_WS_URL` | `wss://YOUR-SERVICE.onrender.com/ws` |

6. Deploy.
7. Copy the Vercel URL → set Render `CORS_ORIGIN` to that exact origin (no trailing slash) → **Manual Deploy** on Render if needed.

## 4. Android

In the capture app:

- API base URL = `https://YOUR-SERVICE.onrender.com`
- Device API key from seed / admin Devices page

## 5. Checklist

- [ ] DO MySQL reachable from Render
- [ ] `GET /health` returns OK
- [ ] Vercel login works
- [ ] Live feed WebSocket connects (no CORS / mixed-content errors)
- [ ] Phone heartbeat shows online on Devices page

## Notes

- **Free Render** spins down after idle — bad for SMS capture. Use **Starter**.
- Vite env vars are **build-time**; change `VITE_*` → redeploy Vercel.
- `CORS_ORIGIN` supports a single origin, or comma-separated list (e.g. production + preview).
