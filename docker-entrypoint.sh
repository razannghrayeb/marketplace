#!/bin/sh
# Production entrypoint: Node API + optional in-container YOLO (FastAPI on loopback).
# - SERVICE_ROLE=api: Node only (ML/YOLO live on the peer ML service).
# - SERVICE_ROLE=ml|all: start uvicorn on 127.0.0.1:${YOLO_INTERNAL_PORT:-8001} unless
#   YOLOV8_SERVICE_URL or YOLO_API_URL points at a different host (external YOLO).

set -eu

ROLE=$(printf '%s' "${SERVICE_ROLE:-all}" | tr '[:upper:]' '[:lower:]')
if [ "$ROLE" = "api" ]; then
  exec node /app/dist/index.js
fi

YOLO_PORT=${YOLO_INTERNAL_PORT:-8001}
YOLO_URL="${YOLOV8_SERVICE_URL:-}"
[ -z "$YOLO_URL" ] && YOLO_URL="${YOLO_API_URL:-}"

start_embedded=1
if [ -n "$YOLO_URL" ]; then
  if [ "$YOLO_URL" != "http://127.0.0.1:${YOLO_PORT}" ] && [ "$YOLO_URL" != "http://127.0.0.1:8001" ]; then
    start_embedded=0
  fi
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
    if wget -q -O- --timeout=3 "http://127.0.0.1:${YOLO_PORT}/health" >/dev/null 2>&1; then
      break
    fi
    i=$((i + 1))
    sleep 1
  done
fi

exec node /app/dist/index.js
