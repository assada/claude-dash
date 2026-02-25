FROM node:22-alpine AS base
RUN apk add --no-cache bash

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Build
FROM base AS builder
WORKDIR /app
ARG DATABASE_PROVIDER=postgresql
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bash prisma/setup.sh
RUN npx next build

# Production
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./
COPY --from=builder /app/docker-entrypoint.sh ./

RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

EXPOSE 3000

USER nextjs

ENTRYPOINT ["bash", "docker-entrypoint.sh"]
