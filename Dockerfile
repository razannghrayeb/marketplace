#
# Default: embedded YOLO (PyTorch venv + entrypoint uvicorn on loopback) so detection always works in one container.
#
# Slim API-only (external detector): docker build --build-arg EMBEDDED_YOLO=0 .
#
# Optional faster local rebuilds: DOCKER_BUILDKIT=1 docker build . (works with plain Dockerfile too)

# ============================================================================
# Fashion Marketplace API
# Multi-stage build for optimized production image
# ============================================================================

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.json tsconfig.base.json ./
COPY src ./src

# Build TypeScript
RUN pnpm build

# Stage 2: Production
FROM node:20-bookworm-slim AS production

# 1 = install PyTorch + YOLO venv in this image (~1.5GB+). 0 = slim API image; set YOLO_API_URL to external detector.
ARG EMBEDDED_YOLO=1

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

# Runtime OS packages: full stack only when embedding YOLO
RUN set -eux; \
  apt-get update; \
  if [ "$EMBEDDED_YOLO" = "1" ]; then \
  apt-get install -y --no-install-recommends \
  wget ca-certificates \
  python3 python3-venv python3-pip \
  libgl1 libglib2.0-0 libsm6 libxext6 libxrender-dev libgomp1; \
  else \
  apt-get install -y --no-install-recommends wget ca-certificates; \
  fi; \
  rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -g 1001 nodejs && \
  useradd -r -u 1001 -g nodejs nodejs

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files
COPY --from=builder /app/dist ./dist
RUN mkdir -p ./public
# Copy models from local repository context (faster and deterministic for CI builds)
COPY models ./models

# Validate required model artifacts are present (fail early if missing)
RUN if [ ! -f "./models/fashion-clip-image.onnx" ] || [ ! -f "./models/fashion-clip-text.onnx" ]; then \
  echo "❌ ERROR: ML models missing under /app/models in build context."; \
  exit 1; \
  fi && \
  echo "✅ ML models present: $(ls -lh ./models/*.onnx | wc -l) ONNX files"

# YOLO app sources (small); venv is created only when EMBEDDED_YOLO=1
COPY src/lib/model/yolov8_api.py \
  src/lib/model/dual_model_yolo.py \
  src/lib/model/dual-model-yolo.py \
  src/lib/model/image_preprocessor.py \
  /app/yolo/
COPY src/lib/model/requirements-yolo-extras.txt /app/yolo/requirements-extras.txt

# CPU torch wheels from PyTorch index (smaller + faster than default CUDA-capable PyPI wheels)
RUN set -eux; \
  if [ "$EMBEDDED_YOLO" = "1" ]; then \
  python3 -m venv /app/yolo/venv && \
  /app/yolo/venv/bin/pip install --no-cache-dir --upgrade pip && \
  /app/yolo/venv/bin/pip install --no-cache-dir \
  --index-url https://download.pytorch.org/whl/cpu \
  torch torchvision && \
  /app/yolo/venv/bin/pip install --no-cache-dir -r /app/yolo/requirements-extras.txt && \
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
