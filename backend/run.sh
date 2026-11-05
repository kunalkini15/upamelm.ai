#!/usr/bin/env bash
set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$MODULE_DIR/.venv"
BACKEND_PORT="${BACKEND_PORT:-8010}"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  python3 -m venv "$VENV_DIR"
fi

if ! "$VENV_DIR/bin/python" -c "import fastapi, uvicorn, backend" >/dev/null 2>&1; then
  "$VENV_DIR/bin/python" -m pip install --disable-pip-version-check -q -e "$MODULE_DIR"
fi

exec "$VENV_DIR/bin/python" -m uvicorn backend.main:app --host 0.0.0.0 --port "$BACKEND_PORT" --app-dir "$MODULE_DIR/src" "$@"
