# syntax=docker/dockerfile:1
# clover-panel 镜像（standalone 单容器，SQLite 数据在 /app/data 卷）

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3 / @node-rs/argon2 等原生模块需要编译工具链；
# node:22-slim 不含 python3/make/g++，缺了会在 npm ci 阶段直接失败（实机验证过）
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 由 schema 生成 migration（改 schema 后需重新构建镜像才会带上新 migration）
RUN npx drizzle-kit generate && npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

# docker CLI：面板经 docker exec 调 DMS 内部 setup 落地账号
# curl：DNS-over-HTTPS 体检（dns-check/dnsbl）必须，缺了会在真机上静默失败
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl docker.io tar \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/admin-cli.cjs ./admin-cli.cjs

EXPOSE 3000
CMD ["node", "server.js"]
