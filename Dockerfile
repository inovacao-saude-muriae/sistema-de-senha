# syntax=docker/dockerfile:1

FROM node:20-bullseye-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bullseye-slim AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
# Forçar Prisma a usar OpenSSL 3 (já disponível no Bullseye/Bookworm)
ENV PRISMA_QUERY_ENGINE_LIBRARY_TYPE=openssl-3.x

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY . .

RUN npx prisma generate
RUN npm run build

FROM node:20-bullseye-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PRISMA_QUERY_ENGINE_LIBRARY_TYPE=openssl-3.x

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["npm", "start"]
