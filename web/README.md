# Web dashboard

React + TypeScript + Vite + Tailwind + TanStack Query.

## Setup

```bash
cp web/.env.example web/.env
# from repo root after npm install
npm run dev:web
```

Open http://localhost:5174 — login with seeded `admin@example.com` / `admin123`.

## Features

- Live deposit feed (WebSocket + poll)
- Exception queue with assign & credit
- Per-wallet daily/weekly NAD totals
- Device online/offline health
- Immutable audit log viewer
- Role shown in header (ADMIN / OPERATOR)

Vite proxies `/api` and `/ws` to the backend in development.
