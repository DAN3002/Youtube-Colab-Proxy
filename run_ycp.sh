#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./run_ycp.sh                 # uses default password "toiyeuVPBank"
#   ./run_ycp.sh mypass          # uses positional password
#   ADMIN_PASSWORD=mypass ./run_ycp.sh   # uses env var if no arg passed

PASSWORD="${1:-${ADMIN_PASSWORD:-toiyeuVPBank}}"

VENV_DIR=".venv"

# ---------------------------------------------------------------------------
# Detect whether `uv` is available; fall back to plain pip/venv otherwise
# ---------------------------------------------------------------------------
if command -v uv &>/dev/null; then
	USE_UV=1
else
	USE_UV=0
	echo "[YCP] 'uv' not found – falling back to pip (install uv for faster setup)"
fi

# Create virtual environment if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
	echo "[YCP] Creating virtual environment..."
	if [ "$USE_UV" -eq 1 ]; then
		uv venv "$VENV_DIR"
	else
		python3 -m venv "$VENV_DIR"
	fi
fi

# Activate the virtual environment
source "$VENV_DIR/bin/activate"

echo "[YCP] Installing in editable mode..."
if [ "$USE_UV" -eq 1 ]; then
	uv pip install -e .
else
	pip install -e .
fi

echo "[YCP] Starting app..."
# Pass password via env var to the Python one-liner and keep process alive
export YCP_PASSWORD="$PASSWORD"
python - <<'PYCODE'
import os, time
import youtube_colab_proxy as ycp

pwd = os.environ.get("YCP_PASSWORD") or "toiyeuVPBank"
url = ycp.start(password=pwd)
print("[YCP] App started at:", url)

# Keep process alive since uvicorn runs in background thread
while True:
	time.sleep(3600)
PYCODE
