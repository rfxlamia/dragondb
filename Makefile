# DragonDB — convenience wrapper around package.json scripts (single source of truth).
# Prefer `make <target>`; run `bun run <script>` directly for ad-hoc flags.

BUN ?= bun

.DEFAULT_GOAL := help

.PHONY: help install dev tauri-dev build build-tauri preview typecheck lint lint-fix test test-watch check clean

help: ## Show available targets
	@printf 'DragonDB make targets\n'
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (locked)
	$(BUN) install --frozen-lockfile

dev: ## Run Vite dev server
	$(BUN) run dev

tauri-dev: ## Run full Tauri app in dev mode
	$(BUN) run tauri dev

build: ## Type-check and build frontend
	$(BUN) run build

build-tauri: ## Build distributable app bundles
	$(BUN) run tauri build

preview: ## Preview the production frontend build
	$(BUN) run preview

typecheck: ## Run TypeScript type checking
	$(BUN) run typecheck

lint: ## Lint and format-check with Biome
	$(BUN) run lint

lint-fix: ## Auto-fix lint and formatting with Biome
	$(BUN) run lint:fix

test: ## Run tests once
	$(BUN) run test

test-watch: ## Run tests in watch mode
	$(BUN) run test:watch

check: ## CI gate: typecheck + lint + test
	$(BUN) run check

clean: ## Remove build artifacts (dist/, src-tauri/target/)
	rm -rf dist src-tauri/target
