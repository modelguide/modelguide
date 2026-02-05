.PHONY: help install dev build start db-up db-down db-generate db-migrate db-push db-studio clean reset logs

.DEFAULT_GOAL := help

help: ## Show available commands
	@echo "ModelGuide Development Commands"
	@echo "==============================="
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	cd modelguide-api && bun install

dev: ## Start dev server with hot reload
	cd modelguide-api && bun run dev

build: ## Build for production
	cd modelguide-api && bun run build

start: ## Run production build
	cd modelguide-api && bun run start

db-up: ## Start PostgreSQL container
	docker compose up -d postgres

db-down: ## Stop PostgreSQL container
	docker compose down

db-generate: ## Generate database migrations
	cd modelguide-api && bun run db:generate

db-migrate: ## Run database migrations
	cd modelguide-api && bun run db:migrate

db-push: ## Push schema changes (dev only)
	cd modelguide-api && bun run db:push

db-studio: ## Open Drizzle Studio
	cd modelguide-api && bun run db:studio

clean: ## Remove build artifacts
	rm -rf modelguide-api/dist
	rm -rf modelguide-api/node_modules/.cache

reset: ## Stop containers and remove volumes
	docker compose down -v

logs: ## View Docker container logs
	docker compose logs -f postgres
