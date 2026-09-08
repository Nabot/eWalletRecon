FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared ./shared
COPY backend ./backend
RUN npm install --workspace=shared --workspace=backend
RUN npm run build -w shared
WORKDIR /app/backend
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/backend/package.json ./backend/
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/backend/node_modules ./backend/node_modules
WORKDIR /app/backend
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
