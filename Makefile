.PHONY: help api-install api-dev api-test

help:
	@echo "Available commands:"
	@echo "  make api-install  Install API dependencies"
	@echo "  make api-dev      Run API server with hot reload (port 8000)"
	@echo "  make api-test     Run API tests"

api-install:
	cd control-panel-api && uv sync

api-dev:
	cd control-panel-api && uv run uvicorn control_panel_api.main:app --reload --host 0.0.0.0 --port 8000

api-test:
	cd control-panel-api && uv run pytest
