#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./run_ycp.sh                 # uses default password "toiyeuVPBank"
#   ./run_ycp.sh mypass          # uses positional password
#   ADMIN_PASSWORD=mypass ./run_ycp.sh   # uses env var if no arg passed

PASSWORD="${1:-${ADMIN_PASSWORD:-toiyeuVPBank}}"

echo "[YCP] Installing in editable mode..."
pip install -e .

echo "[YCP] Starting app..."
# Pass password via env var to the Python one-liner and keep process alive
export YCP_PASSWORD="$PASSWORD"
python - <<'PYCODE'
import os, time
import youtube_colab_proxy as ycp

pwd = os.environ.get("YCP_PASSWORD") or "toiyeuVPBank"
url = ycp.start(password=pwd)
print("[YCP] App started at:", url)

# Keep process alive since Flask runs in background thread
while True:
	time.sleep(3600)
PYCODE 
