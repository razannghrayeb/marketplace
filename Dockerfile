# ============================================================================
# Stage 0: Download ML models from HuggingFace
# ============================================================================
FROM python:3.11-slim AS model-downloader

ARG HF_TOKEN=""
ENV HF_TOKEN=${HF_TOKEN}
ENV HF_HOME=/root/.cache/huggingface
ENV HF_HUB_DOWNLOAD_TIMEOUT=240
ENV HF_HUB_ETAG_TIMEOUT=60
ENV HF_HUB_ENABLE_HF_TRANSFER=1

RUN pip install --no-cache-dir huggingface_hub hf_transfer

RUN set -eux; \
  attempts=8; \
  for attempt in $(seq 1 ${attempts}); do \
  echo "Downloading models attempt ${attempt}/${attempts}"; \
  python -c "from huggingface_hub import snapshot_download; import os; token=os.environ.get('HF_TOKEN') or None; snapshot_download(repo_id='razangh/fashion-models', repo_type='model', local_dir='/models', token=token, max_workers=8, allow_patterns=['*.onnx','*.onnx.data','*.json','*.pkl','*.txt'], ignore_patterns=['*.gitattributes','README.md']); print('Models downloaded')" && break; \
  if [ "${attempt}" -eq "${attempts}" ]; then exit 1; fi; \
  sleep 10; \
  done

RUN python -c "from huggingface_hub import hf_hub_download; import os, shutil; os.makedirs('/models/.cache', exist_ok=True); shutil.copy(hf_hub_download('openai/clip-vit-base-patch32','vocab.json'),'/models/.cache/vocab.json'); shutil.copy(hf_hub_download('openai/clip-vit-base-patch32','merges.txt'),'/models/.cache/merges.txt'); shutil.copy(hf_hub_download('google-bert/bert-base-uncased','vocab.txt'),'/models/.cache/blip-vocab.txt')"


# ============================================================================
# Stage 1: Build Node app
# ============================================================================
FROM node:20-bookworm AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --filter .

COPY tsconfig.json tsconfig.base.json ./
COPY src ./src

RUN pnpm build


# ============================================================================
# Stage 2: Production NVIDIA CUDA Runtime
# ============================================================================
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 AS production

ARG EMBEDDED_YOLO=1
ARG YOLO_TORCH_VARIANT=gpu

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive

# Fix Ubuntu repo networking issue + install runtime packages
RUN set -eux; \
  sed -i 's|http://archive.ubuntu.com|https://archive.ubuntu.com|g' /etc/apt/sources.list || true; \
  sed -i 's|http://security.ubuntu.com|https://security.ubuntu.com|g' /etc/apt/sources.list || true; \
  rm -rf /var/lib/apt/lists/*; \
  apt-get clean; \
  apt-get update -o Acquire::Retries=5; \
  apt-get install -y --no-install-recommends \
  ca-certificates \
  wget \
  curl \
  python3 \
  python3-venv \
  python3-pip \
  libgl1 \
  libglib2.0-0 \
  libsm6 \
  libxext6 \
  libxrender-dev \
  libgomp1; \
  rm -rf /var/lib/apt/lists/*

# Copy Node from official Node image instead of installing via NodeSource apt
COPY --from=builder /usr/local/bin/node /usr/local/bin/node
COPY --from=builder /usr/local/bin/npm /usr/local/bin/npm
COPY --from=builder /usr/local/lib/node_modules /usr/local/lib/node_modules

RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && npm install -g pnpm@9
# Create non-root user
RUN groupadd -g 1001 nodejs \
  && useradd -r -u 1001 -g nodejs nodejs

# Install production Node dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --filter .

# Copy built app
COPY --from=builder /app/dist ./dist

# Copy downloaded models
COPY --from=model-downloader /models ./models

RUN if [ ! -f "./models/fashion-clip-image.onnx" ] || [ ! -f "./models/fashion-clip-text.onnx" ]; then \
  echo "ERROR: ML models missing"; \
  exit 1; \
  fi

# Copy YOLO files
COPY src/lib/model/yolov8_api.py \
  src/lib/model/dual_model_yolo.py \
  src/lib/model/dual-model-yolo.py \
  src/lib/model/image_preprocessor.py \
  /app/yolo/

COPY src/lib/model/proto /app/yolo/proto
COPY src/lib/model/requirements-yolo-extras.txt /app/yolo/requirements-extras.txt

# Install YOLO runtime
RUN set -eux; \
  if [ "$EMBEDDED_YOLO" = "1" ]; then \
  python3 -m venv /app/yolo/venv; \
  /app/yolo/venv/bin/pip install --no-cache-dir --upgrade pip; \
  if [ "$YOLO_TORCH_VARIANT" = "gpu" ]; then \
  /app/yolo/venv/bin/pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cu124 torch torchvision; \
  else \
  /app/yolo/venv/bin/pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchvision; \
  fi; \
  /app/yolo/venv/bin/pip install --no-cache-dir -r /app/yolo/requirements-extras.txt; \
  /app/yolo/venv/bin/python3 -c "import torch; print('torch=', torch.__version__, 'cuda=', torch.version.cuda, 'available=', torch.cuda.is_available())"; \
  else \
  rm -rf /app/yolo; \
  mkdir -p /app/yolo; \
  fi

# Entrypoint
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

RUN mkdir -p /app/public \
  && chown -R nodejs:nodejs /app

USER nodejs

ENV NODE_ENV=production
ENV PORT=8080
ENV HF_HOME=/app/yolo/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/yolo/.cache/huggingface

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT}/health/live || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]