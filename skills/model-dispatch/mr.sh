#!/usr/bin/env bash
# Model Dispatch launcher for macOS / Linux
# 用法: ./mr.sh health
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/lib/cli.mjs" "$@"
