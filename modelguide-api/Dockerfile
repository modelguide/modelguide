# ---- deps: prod-only install ----
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---- build: full install + compile ----
FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
RUN bun build src/index.ts --outdir dist --target bun

# ---- runtime ----
FROM oven/bun:1-alpine AS runtime
WORKDIR /app

# Install wget for healthcheck
RUN apk add --no-cache wget

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY drizzle/ ./drizzle/
COPY scripts/ ./scripts/
COPY src/lib/migration-url.ts ./src/lib/migration-url.ts
COPY tsconfig.json ./
COPY package.json ./

# Fail build if no migration SQL files exist
RUN ls ./drizzle/*.sql

USER bun
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["bun", "run", "dist/index.js"]
