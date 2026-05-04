# Default: embedded YOLO (PyTorch venv + entrypoint uvicorn on loopback) so detection always works in one container.
#
# Slim API-only (external detector): docker build --build-arg EMBEDDED_YOLO=0 .
#
# Optional faster local rebuilds: DOCKER_BUILDKIT=1 docker build . (works with plain Dockerfile too)

# ============================================================================
# Fashion Marketplace API
# Multi-stage build for optimized production image
# ============================================================================

# Stage 0: Download ML models from HuggingFace
# Pass HF_TOKEN during build: docker build --build-arg HF_TOKEN=hf_xxx
FROM python:3.11-slim AS model-downloader
ARG HF_TOKEN=""
ENV HF_TOKEN=${HF_TOKEN}
ENV HF_HOME=/root/.cache/huggingface
ENV HF_HUB_DOWNLOAD_TIMEOUT=240
ENV HF_HUB_ETAG_TIMEOUT=60
RUN pip install --no-cache-dir huggingface_hub hf_transfer
ENV HF_HUB_ENABLE_HF_TRANSFER=1
RUN set -eux; \
  attempts=8; \
  for attempt in $(seq 1 ${attempts}); do \
  echo "Downloading models (attempt ${attempt}/${attempts})"; \
  python -c "from huggingface_hub import snapshot_download; import os; token = os.environ.get('HF_TOKEN') or None; snapshot_download(repo_id='razangh/fashion-models', repo_type='model', local_dir='/models', token=token, max_workers=8, allow_patterns=['*.onnx', '*.onnx.data', '*.json', '*.pkl', '*.txt'], ignore_patterns=['*.gitattributes', '.gitattributes', 'README.md']); print('Models downloaded successfully to /models')" && break; \
  if [ "${attempt}" -eq "${attempts}" ]; then \
  echo "Model download failed after ${attempts} attempts"; \
  exit 1; \
  fi; \
  wait_seconds=$((2 ** attempt)); \
  if [ "${wait_seconds}" -gt 60 ]; then wait_seconds=60; fi; \
  echo "Retrying in ${wait_seconds}s..."; \
  sleep "${wait_seconds}"; \
  done

# Pre-download tokenizer vocab files via huggingface_hub (already installed,
# handles auth + redirects). CLIP BPE: openai/clip-vit-base-patch32 (public).
# BLIP WordPiece: google-bert/bert-base-uncased (public, same BERT vocab).
RUN python3 -c "from huggingface_hub import hf_hub_download; import os, shutil; os.makedirs('/models/.cache', exist_ok=True); shutil.copy(hf_hub_download('openai/clip-vit-base-patch32', 'vocab.json'), '/models/.cache/vocab.json'); print('vocab.json ok'); shutil.copy(hf_hub_download('openai/clip-vit-base-patch32', 'merges.txt'), '/models/.cache/merges.txt'); print('merges.txt ok'); shutil.copy(hf_hub_download('google-bert/bert-base-uncased', 'vocab.txt'), '/models/.cache/blip-vocab.txt'); print('blip-vocab.txt ok')"

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install only root workspace dependencies required for API build.
RUN pnpm install --frozen-lockfile --filter .

# Copy source
COPY tsconfig.json tsconfig.base.json ./
COPY src ./src

# Build TypeScript
RUN pnpm build

# Stage 2: Production (CUDA runtime so onnxruntime CUDA EP can load)
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 AS production

# 1 = install PyTorch + YOLO venv in this image (~1.5GB+). 0 = slim API image; set YOLO_API_URL to external detector.
ARG EMBEDDED_YOLO=1
# Torch wheel source for embedded YOLO:
# - gpu (default): installs default PyPI wheels (CUDA-enabled on Linux).
# - cpu: smaller image, no CUDA.
ARG YOLO_TORCH_VARIANT=gpu

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
RUN set -eux; \
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do \
  if [ -f "$f" ]; then sed -i 's|http://|https://|g' "$f"; fi; \
  done; \
  apt_update_max_attempts=5; \
  apt_update_attempt=0; \
  until apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 update || [ $apt_update_attempt -ge $apt_update_max_attempts ]; do \
  apt_update_attempt=$((apt_update_attempt + 1)); \
  echo "apt-get update failed, retrying ($apt_update_attempt/$apt_update_max_attempts)..."; \
  sleep $((2 ** apt_update_attempt)); \
  done; \
  apt-get -o Acquire::Retries=5 install -y --no-install-recommends curl ca-certificates gnupg; \
  mkdir -p /etc/apt/keyrings; \
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list; \
  apt_update_attempt=0; \
  until apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 update || [ $apt_update_attempt -ge $apt_update_max_attempts ]; do \
  apt_update_attempt=$((apt_update_attempt + 1)); \
  echo "apt-get update failed, retrying ($apt_update_attempt/$apt_update_max_attempts)..."; \
  sleep $((2 ** apt_update_attempt)); \
  done; \
  apt-get -o Acquire::Retries=5 install -y --no-install-recommends nodejs; \
  corepack enable; \
  corepack prepare pnpm@9 --activate; \
  rm -rf /var/lib/apt/lists/*

# Runtime OS packages: full stack only when embedding YOLO
# Add retry logic for apt-get to handle transient network issues
# Note: X11 libraries (libgl1-mesa, libsm6, libxext6, libxrender1) removed as not needed for headless API
RUN set -eux; \
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do \
  if [ -f "$f" ]; then sed -i 's|http://|https://|g' "$f"; fi; \
  done; \
  apt_update_max_attempts=5; \
  apt_update_attempt=0; \
  until apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 update || [ $apt_update_attempt -ge $apt_update_max_attempts ]; do \
  apt_update_attempt=$((apt_update_attempt + 1)); \
  echo "apt-get update failed, retrying ($apt_update_attempt/$apt_update_max_attempts)..."; \
  sleep $((2 ** apt_update_attempt)); \
  done; \
  if [ "$EMBEDDED_YOLO" = "1" ]; then \
  apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
  wget \
  python3 python3-venv python3-pip \
  libglib2.0-0 libgomp1; \
  else \
  apt-get -o Acquire::Retries=5 install -y --no-install-recommends wget; \
  fi; \
  rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -g 1001 nodejs && \
  useradd -r -u 1001 -g nodejs nodejs

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install only root production dependencies for runtime.
RUN pnpm install --frozen-lockfile --prod --filter .

# Copy built files
COPY --from=builder /app/dist ./dist
RUN mkdir -p ./public
# Copy models downloaded from HuggingFace (razangh/fashion-models)
COPY --from=model-downloader /models ./models

# Validate models were downloaded (fail early if missing)
RUN if [ ! -f "./models/fashion-clip-image.onnx" ] || [ ! -f "./models/fashion-clip-text.onnx" ]; then \
  echo "❌ ERROR: ML models missing! Model download failed or HF_TOKEN invalid."; \
  exit 1; \
  fi && \
  echo "✅ ML models present: $(ls -lh ./models/*.onnx | wc -l) ONNX files"

# YOLO app sources (small); venv is created only when EMBEDDED_YOLO=1
COPY src/lib/model/yolov8_api.py \
  src/lib/model/dual_model_yolo.py \
  src/lib/model/dual-model-yolo.py \
  src/lib/model/image_preprocessor.py \
  /app/yolo/
COPY src/lib/model/proto /app/yolo/proto
COPY src/lib/model/requirements-yolo-extras.txt /app/yolo/requirements-extras.txt

# GPU torch wheels by default; set YOLO_TORCH_VARIANT=cpu to force CPU build.
RUN set -eux; \
  if [ "$EMBEDDED_YOLO" = "1" ]; then \
  python3 -m venv /app/yolo/venv && \
  /app/yolo/venv/bin/pip install --no-cache-dir --upgrade pip && \
  if [ "$YOLO_TORCH_VARIANT" = "gpu" ]; then \
  /app/yolo/venv/bin/pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cu124 torch torchvision; \
  else \
  /app/yolo/venv/bin/pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchvision; \
  fi && \
  /app/yolo/venv/bin/pip install --no-cache-dir -r /app/yolo/requirements-extras.txt && \
  /app/yolo/venv/bin/python3 -c "import torch; print('YOLO torch build:', torch.__version__, 'cuda=', torch.version.cuda, 'cuda_available=', torch.cuda.is_available())" && \
  \
  # Pre-download YOLO detector weights during the image build so deploys don't
  # pay the cold-start download cost on every revision.
  export HF_HOME=/app/yolo/.cache/huggingface; \
  export TRANSFORMERS_CACHE=/app/yolo/.cache/huggingface; \
  /app/yolo/venv/bin/python3 -c "import sys; sys.path.insert(0,'/app/yolo'); from yolov8_api import get_detector; get_detector(); print('✅ YOLO dual-detector warmed (weights cached)')" ; \
  else \
  rm -rf /app/yolo && mkdir -p /app/yolo; \
  fi

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Set ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

# Environment
ENV NODE_ENV=production
ENV PORT=8080
ENV HF_HOME=/app/yolo/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/yolo/.cache/huggingface

# YOLO may load PyTorch/HF weights on first boot; Node starts only after entrypoint waits on YOLO health.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://0.0.0.0:${PORT}/health/live || exit 1

EXPOSE 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]
