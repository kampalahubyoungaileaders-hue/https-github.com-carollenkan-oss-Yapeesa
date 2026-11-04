#!/usr/bin/env bash
set -euo pipefail
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile --prod=false
pnpm --filter @yapesa/api typecheck
pnpm --filter @yapesa/web build
