# syntax=docker/dockerfile:1.7

# ============================================================================
# Fashion Marketplace API
# Multi-stage build for optimized production image
# ============================================================================

# Stage 0: Download ML models from HuggingFace
# Pass HF_TOKEN during build: docker build --build-arg HF_TOKEN=hf_xxx
# or mount as BuildKit secret: --secret hf_token=/path/to/token.txt
FROM python:3.11-slim AS model-downloader
ARG HF_TOKEN=""
ENV HF_TOKEN=${HF_TOKEN}
RUN pip install --no-cache-dir huggingface_hub
RUN python -c "from huggingface_hub import snapshot_download; import os; token = os.environ.get('HF_TOKEN') or None; snapshot_download(repo_id='razangh/fashion-models', repo_type='model', local_dir='/models', token=token, ignore_patterns=['*.gitattributes', '.gitattributes', 'README.md']); print('Models downloaded successfully to /models')"

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

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Install runtime OS packages required by health checks and native modules
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates && \
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
# Copy models downloaded from HuggingFace (razangh/fashion-models)
COPY --from=model-downloader /models ./models

# Validate models were downloaded (fail early if missing)
RUN if [ ! -f "./models/fashion-clip-image.onnx" ] || [ ! -f "./models/fashion-clip-text.onnx" ]; then \
    echo "❌ ERROR: ML models missing! Model download failed or HF_TOKEN invalid."; \
    exit 1; \
  fi && \
  echo "✅ ML models present: $(ls -lh ./models/*.onnx | wc -l) ONNX files"

# Set ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

# Environment
ENV NODE_ENV=production
ENV PORT=8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health/live || exit 1

EXPOSE 8080

CMD ["node", "dist/index.js"]
