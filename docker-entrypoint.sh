#!/bin/sh
# Production entrypoint: Node + optional in-container YOLO (FastAPI on loopback).
# Starts uvicorn on 127.0.0.1:${YOLO_INTERNAL_PORT:-8001} unless YOLOV8_SERVICE_URL /
# YOLO_API_URL points at a different host (external YOLO only).
#
# Temporarily offload YOLO: set YOLO_DETECTION_DISABLED=1 (docker-compose / .env) — no uvicorn,
# Node treats detection as unavailable (see yolov8Client). For external detector only, use
# YOLOV8_SERVICE_URL=http://yolov8:8001 (and EMBEDDED_YOLO=0 build if you want a slimmer image).

set -eu

yolo_detection_disabled() {
  v=$(printf '%s' "${YOLO_DETECTION_DISABLED:-}" | tr '[:upper:]' '[:lower:]')
  [ "$v" = "1" ] || [ "$v" = "true" ] || [ "$v" = "yes" ]
}

YOLO_PORT=${YOLO_INTERNAL_PORT:-8001}
YOLO_URL="${YOLOV8_SERVICE_URL:-}"
[ -z "$YOLO_URL" ] && YOLO_URL="${YOLO_API_URL:-}"

start_embedded=1
if yolo_detection_disabled; then
  start_embedded=0
  echo "[entrypoint] YOLO_DETECTION_DISABLED set — skipping embedded YOLO (uvicorn)." >&2
fi
if [ -n "$YOLO_URL" ]; then
  if [ "$YOLO_URL" != "http://127.0.0.1:${YOLO_PORT}" ] && [ "$YOLO_URL" != "http://127.0.0.1:8001" ]; then
    start_embedded=0
  fi
fi
# Slim image (EMBEDDED_YOLO=0): no venv — use external YOLOV8_SERVICE_URL / YOLO_API_URL
if [ "$start_embedded" = "1" ] && [ ! -x /app/yolo/venv/bin/uvicorn ]; then
  echo "[entrypoint] No embedded YOLO venv; set YOLOV8_SERVICE_URL or YOLO_API_URL to your detector (e.g. http://yolov8:8001)." >&2
  start_embedded=0
fi

cleanup() {
  if [ -n "${YOLO_PID:-}" ]; then
    kill "$YOLO_PID" 2>/dev/null || true
    wait "$YOLO_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [ "$start_embedded" = "1" ]; then
  export YOLOV8_SERVICE_URL="http://127.0.0.1:${YOLO_PORT}"
  /app/yolo/venv/bin/uvicorn yolov8_api:app \
    --host 127.0.0.1 \
    --port "${YOLO_PORT}" \
    --app-dir /app/yolo \
    --workers 1 &
  YOLO_PID=$!

  i=0
  while [ "$i" -lt 180 ]; do
    if wget -q -O- --timeout=3 "http://127.0.0.1:${YOLO_PORT}/health" 2>/dev/null \
      | grep -Eq '"model_loaded"[[:space:]]*:[[:space:]]*true'; then
      break
    fi
    i=$((i + 1))
    sleep 1
  done
fi

exec node /app/dist/index.js
