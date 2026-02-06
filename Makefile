.PHONY: help api-install api-dev api-build api-start api-test api-test-unit api-test-integration api-typecheck api-lint api-lint-check api-format sync-connectors ui-install ui-dev ui-test ui-typecheck ui-lint ui-format db-up db-down db-generate db-migrate db-push db-studio db-seed clean reset logs

.DEFAULT_GOAL := help

help: ## Show available commands
	@echo "ModelGuide Development Commands"
	@echo "==============================="
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'

# =============================================================================
# API
# =============================================================================

api-install: ## [API] Install dependencies
	cd modelguide-api && bun install

api-dev: ## [API] Start dev server with hot reload
	cd modelguide-api && bun run dev

api-build: ## [API] Build for production
	cd modelguide-api && bun run build

api-start: ## [API] Run production build
	cd modelguide-api && bun run start

api-test: ## [API] Run all tests
	cd modelguide-api && bun test

api-test-unit: ## [API] Run unit tests
	cd modelguide-api && bun run test:unit

api-test-integration: ## [API] Run integration tests (requires Docker)
	cd modelguide-api && bun run test:integration

api-typecheck: ## [API] Run TypeScript type checking
	cd modelguide-api && bun run typecheck

api-lint: ## [API] Run linter (with auto-fix)
	cd modelguide-api && bun run lint

api-lint-check: ## [API] Run linter (check only)
	cd modelguide-api && bun run lint:check

api-format: ## [API] Format code
	cd modelguide-api && bun run format

sync-connectors: ## [API] Sync connector catalog from code to database
	cd modelguide-api && bun run sync:connectors

# =============================================================================
# UI
# =============================================================================

ui-install: ## [UI] Install dependencies
	cd modelguide-ui && npm ci

ui-dev: ## [UI] Start dev server
	cd modelguide-ui && npm run dev

ui-test: ## [UI] Run tests
	cd modelguide-ui && npm run test:ci

ui-typecheck: ## [UI] Run TypeScript type checking
	cd modelguide-ui && npm run typecheck

ui-lint: ## [UI] Run linter
	cd modelguide-ui && npm run lint

ui-format: ## [UI] Format code
	cd modelguide-ui && npm run format

# =============================================================================
# Database
# =============================================================================

db-up: ## [DB] Start PostgreSQL container
	docker compose up -d postgres

db-down: ## [DB] Stop PostgreSQL container
	docker compose down

db-generate: ## [DB] Generate database migrations
	cd modelguide-api && bun run db:generate

db-migrate: ## [DB] Run database migrations
	cd modelguide-api && bun run db:migrate

db-push: ## [DB] Push schema changes (dev only)
	cd modelguide-api && bun run db:push

db-studio: ## [DB] Open Drizzle Studio
	cd modelguide-api && bun run db:studio

db-seed: ## [DB] Seed database with test data
	cd modelguide-api && bun run db:seed

# =============================================================================
# General
# =============================================================================

clean: ## Remove build artifacts
	rm -rf modelguide-api/dist
	rm -rf modelguide-api/node_modules/.cache

reset: ## Stop containers and remove volumes
	docker compose down -v

logs: ## View Docker container logs
	docker compose logs -f postgres
