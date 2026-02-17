.PHONY: help quickstart api-install api-dev api-build api-start api-test api-test-unit api-test-integration api-typecheck api-lint api-lint-check api-format sync-connectors ui-install ui-dev ui-test ui-typecheck ui-lint ui-format db-up db-down db-generate db-migrate db-push db-studio db-seed eval-install eval-run eval-validate eval-test eval-typecheck eval-lint clean reset tunnel logs

.DEFAULT_GOAL := help

help: ## Show available commands
	@echo "ModelGuide Development Commands"
	@echo "==============================="
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'

# =============================================================================
# Quick Start
# =============================================================================

quickstart: ## Setup everything and start API + UI (first-time setup)
	@echo "Starting PostgreSQL..."
	docker compose up -d postgres
	@echo "Waiting for PostgreSQL to be ready..."
	@sleep 3
	@echo "Setting up API..."
	cd modelguide-api && cp -n .env.example .env && bun install && bun run db:migrate && bun run db:seed
	@echo "Setting up UI..."
	cd modelguide-ui && cp -n .env.example .env && npm install
	@echo ""
	@echo "Ready! Run in separate terminals:"
	@echo "  make api-dev    # API at http://localhost:3000"
	@echo "  make ui-dev     # Dashboard at http://localhost:3001"

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
# Eval
# =============================================================================

eval-install: ## [Eval] Install dependencies
	cd eval && bun install

eval-run: ## [Eval] Run experiment (EXPERIMENT=name)
	cd eval && bun run eval run --experiment $(EXPERIMENT)

eval-validate: ## [Eval] Validate configs
	cd eval && bun run eval validate

eval-test: ## [Eval] Run tests
	cd eval && bun test

eval-typecheck: ## [Eval] TypeScript type check
	cd eval && bun run typecheck

eval-lint: ## [Eval] Lint with Biome
	cd eval && bun run lint

# =============================================================================
# General
# =============================================================================

clean: ## Remove build artifacts
	rm -rf modelguide-api/dist
	rm -rf modelguide-api/node_modules/.cache

reset: ## Stop containers and remove volumes
	docker compose down -v

tunnel: ## Start ngrok tunnel to dev server
	ngrok http 3000

logs: ## View Docker container logs
	docker compose logs -f postgres
