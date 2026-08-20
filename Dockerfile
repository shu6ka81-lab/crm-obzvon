# syntax=docker/dockerfile:1

# ---------- зависимости ----------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- сборка ----------
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# SESSION_SECRET нужен только в рантайме, но сборка его читать не должна —
# страницы динамические, префетча БД на этапе build нет.
RUN npm run build

# Служебные скрипты собираем в обычный JS: в рантайме не будет ни tsx,
# ни его зависимостей. Каждый файл самодостаточен.
# pglite исключаем — в продакшене работает postgres по DATABASE_URL.
RUN npx esbuild \
      scripts/migrate.ts \
      scripts/ensure-admin.ts \
      scripts/set-password.ts \
      scripts/rebuild-campaigns.ts \
    --bundle --platform=node --format=cjs --target=node24 \
    --outdir=dist-scripts \
    --external:@electric-sql/pglite

# ---------- рантайм ----------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# SQL-миграции и собранные скрипты обслуживания.
# Запускаются как: node dist-scripts/migrate.js
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/dist-scripts ./dist-scripts

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
