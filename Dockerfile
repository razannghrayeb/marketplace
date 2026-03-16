# syntax=docker/dockerfile:1.7

# ============================================================================
# Fashion Marketplace API
# Multi-stage build for optimized production image
# ============================================================================

# Stage 0: Download ML models from HuggingFace
# For CI/CD, pass a BuildKit secret named `hf_token` if the repo is private.
# For local compose, the Dockerfile also falls back to the HF_TOKEN env var.
FROM python:3.11-slim AS model-downloader
ARG HF_TOKEN=""
ENV HF_TOKEN=${HF_TOKEN}
RUN pip install --no-cache-dir huggingface_hub
RUN --mount=type=secret,id=hf_token python - <<'EOF'
from huggingface_hub import snapshot_download
import os
token = None
secret_path = "/run/secrets/hf_token"
if os.path.exists(secret_path):
    with open(secret_path, "r", encoding="utf-8") as fh:
        token = fh.read().strip() or None
if token is None:
    token = os.environ.get("HF_TOKEN") or None
snapshot_download(
    repo_id="razangh/fashion-models",
    repo_type="model",
    local_dir="/models",
    token=token,
    ignore_patterns=["*.gitattributes", ".gitattributes", "README.md"],
)
print("Models downloaded.")
EOF

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
FROM node:20-alpine AS production

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files
COPY --from=builder /app/dist ./dist
RUN mkdir -p ./public
# Copy models downloaded from HuggingFace (razangh/fashion-models)
COPY --from=model-downloader /models ./models

# Set ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

EXPOSE 3000

CMD ["node", "dist/index.js"]
