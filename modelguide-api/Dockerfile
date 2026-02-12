# ---- build: full install + compile ----
FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN bun build src/index.ts --outdir dist --target bun
RUN bun build scripts/release.ts --outfile dist/release.js --target bun
RUN bun build scripts/migrate.ts --outfile dist/migrate.js --target bun

# ---- runtime ----
FROM oven/bun:1-alpine AS runtime
WORKDIR /app

# Install wget for healthcheck
RUN apk add --no-cache wget

COPY --from=build /app/dist ./dist
COPY drizzle/ ./drizzle/

# Fail build if no migration SQL files exist
RUN ls ./drizzle/*.sql

USER bun
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["bun", "run", "dist/index.js"]
