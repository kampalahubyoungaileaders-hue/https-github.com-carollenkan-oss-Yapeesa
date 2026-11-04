#!/usr/bin/env bash
set -euo pipefail
# Invoke Corepack directly: Render's global package-manager links are read-only.
corepack pnpm install --frozen-lockfile --prod=false
corepack pnpm --filter @yapesa/api typecheck
corepack pnpm --filter @yapesa/web build
