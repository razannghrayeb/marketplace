# Deployment Guide

This guide covers deploying the Fashion Aggregator API to various environments, from development to production.

## Overview

The Fashion Aggregator API is a complex system with multiple components:
- Node.js/TypeScript API server
- PostgreSQL database with vector extensions
- OpenSearch for full-text and vector search
- Redis for caching and job queues
- Python FastAPI service for ML predictions
- Cloudflare R2 for image storage

## Code Organization

The codebase follows a modular architecture with services co-located in routes:

```
src/
  routes/
    <module>/
      <module>.routes.ts       # Route definitions
      <module>.controller.ts   # HTTP handlers
      <module>.service.ts      # Business logic (DB, search, queues)
      index.ts                 # Module exports
  lib/
    core/                     # Database & search clients
    image/                    # CLIP embeddings, image processing
    ranker/                   # ML pipeline utilities
    metrics/                  # Prometheus instrumentation
    # Some lib/* folders re-export from routes/* for compatibility
```

Each route module is self-contained with its service logic. See `docs/architecture.md` for details.

## Prerequisites

### Development Environment
- Node.js 18+ with pnpm
- Docker and Docker Compose
- Python 3.8+ with pip
- PostgreSQL client tools
- Git

### Production Environment
- Kubernetes cluster OR Docker Swarm OR VM with Docker
- Load balancer (nginx, Cloudflare, AWS ALB)
- Monitoring stack (Prometheus, Grafana)
- SSL certificates
- Domain name and DNS management

---

## Local Development Setup

### 1. Quick Start with Docker Compose

```bash
# Clone repository
git clone <repository-url>
cd marketplace

# Install dependencies
pnpm install

# Start infrastructure services
docker-compose up -d

# Wait for services to be ready
docker-compose logs -f
```

### 2. Database Setup

```bash
# Create database schema
psql -h localhost -U postgres -d fashion -f db/schema.sql

# Run migrations
psql -h localhost -U postgres -d fashion -f db/migrations/001_recommendation_training.sql

# Seed sample data (optional)
pnpm run seed
```

### 3. Download ML Models

```bash
# Download CLIP model for image embeddings
pnpm run download-clip

# Verify model files
ls -la models/
# Should contain: clip-image-vit-32.onnx
```

### 4. Initialize Search Index

```bash
# Create OpenSearch index with mappings
pnpm run recreate-index

# Index existing products (if any)
pnpm run reindex-embeddings
```

### 5. Start Development Server

```bash
# Start API server with hot reload
pnpm dev

# In another terminal, start ML ranker service
cd src/lib/model
pip install -r requirements.txt
python ranker_api.py
```

### 6. Verify Setup

```bash
# Health check
curl http://localhost:4000/health/live

# Readiness (dependencies)
curl http://localhost:4000/health/ready

# Test search
curl "http://localhost:4000/search?q=red%20sneakers"

# Check ML ranker
curl http://localhost:8000/health
```

---

## Production Deployment

### Option 1: Docker Swarm Deployment

#### 1. Prepare Environment

```bash
# Initialize Docker Swarm
docker swarm init

# Create overlay network
docker network create --driver overlay fashion-network

# Create secrets
echo "your-postgres-password" | docker secret create postgres_password -
echo "your-r2-access-key" | docker secret create r2_access_key -
echo "your-r2-secret" | docker secret create r2_secret -
```

#### 2. Docker Compose for Production

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  # API Server
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "4000:4000"
    environment:
      NODE_ENV: production
      PORT: 4000
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/fashion
      OS_NODE: http://opensearch:9200
      REDIS_URL: redis://redis:6379
      RANKER_API_URL: http://ranker:8000
      R2_ACCESS_KEY_ID_FILE: /run/secrets/r2_access_key
      R2_SECRET_ACCESS_KEY_FILE: /run/secrets/r2_secret
    secrets:
      - postgres_password
      - r2_access_key
      - r2_secret
    depends_on:
      - postgres
      - opensearch
      - redis
    networks:
      - fashion-network
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 30s
      restart_policy:
        condition: on-failure

  # ML Ranker Service
  ranker:
    build:
      context: ./src/lib/model
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      RANKER_MODEL_PATH: /app/models/xgb_ranker_model.json
      RANKER_META_PATH: /app/models/ranker_model_metadata.json
    volumes:
      - ranker_models:/app/models
    networks:
      - fashion-network
    deploy:
      replicas: 2

  # Database
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
      POSTGRES_DB: fashion
    secrets:
      - postgres_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - fashion-network
    deploy:
      placement:
        constraints: [node.role == manager]

  # OpenSearch
  opensearch:
    image: opensearchproject/opensearch:latest
    environment:
      - discovery.type=single-node
      - plugins.security.disabled=true
      - "OPENSEARCH_JAVA_OPTS=-Xms2g -Xmx2g"
    volumes:
      - opensearch_data:/usr/share/opensearch/data
    networks:
      - fashion-network
    deploy:
      placement:
        constraints: [node.role == manager]

  # Redis
  redis:
    image: redis:7
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis_data:/data
    networks:
      - fashion-network

  # Nginx Load Balancer
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    configs:
      - source: nginx_config
        target: /etc/nginx/nginx.conf
    volumes:
      - ssl_certs:/etc/ssl/certs
    networks:
      - fashion-network
    depends_on:
      - api

volumes:
  postgres_data:
  opensearch_data:
  redis_data:
  ranker_models:
  ssl_certs:

networks:
  fashion-network:
    driver: overlay
    attachable: true

secrets:
  postgres_password:
    external: true
  r2_access_key:
    external: true
  r2_secret:
    external: true

configs:
  nginx_config:
    file: ./nginx.conf
```

#### 3. Deploy Stack

```bash
# Deploy the stack
docker stack deploy -c docker-compose.prod.yml fashion

# Check deployment status
docker stack services fashion
docker stack ps fashion

# View logs
docker service logs fashion_api
```

### Option 2: Kubernetes Deployment

#### 1. Prepare Kubernetes Manifests

Create `k8s/namespace.yaml`:
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: fashion-aggregator
```

Create `k8s/configmap.yaml`:
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: api-config
  namespace: fashion-aggregator
data:
  NODE_ENV: "production"
  DATABASE_URL: "postgresql://postgres:${POSTGRES_PASSWORD}@postgres-service:5432/fashion"
  OS_NODE: "http://opensearch-service:9200"
  REDIS_URL: "redis://redis-service:6379"
  PORT: "3000"
```

Create `k8s/secrets.yaml`:
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: api-secrets
  namespace: fashion-aggregator
type: Opaque
data:
  DATABASE_URL: <base64-encoded-connection-string>
  R2_ACCESS_KEY_ID: <base64-encoded-key>
  R2_SECRET_ACCESS_KEY: <base64-encoded-secret>
```

Create `k8s/api-deployment.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-deployment
  namespace: fashion-aggregator
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
      - name: api
        image: fashion-aggregator/api:latest
        ports:
        - containerPort: 4000
        envFrom:
        - configMapRef:
            name: api-config
        - secretRef:
            name: api-secrets
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        readinessProbe:
          httpGet:
            path: /health
            port: 4000
          initialDelaySeconds: 30
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /health
            port: 4000
          initialDelaySeconds: 60
          periodSeconds: 30
```

#### 2. Deploy to Kubernetes

```bash
# Apply all manifests
kubectl apply -f k8s/

# Check deployment status
kubectl get pods -n fashion-aggregator
kubectl get services -n fashion-aggregator

# View logs
kubectl logs -f deployment/api-deployment -n fashion-aggregator
```

---

## Environment Configuration

### Environment Variables

#### Core Configuration
```env
# Environment
NODE_ENV=production
PORT=3000
CORS_ORIGIN=https://your-domain.com

# Database
DATABASE_URL=postgresql://postgres:secure-password@postgres-host:5432/fashion
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_STORAGE_BUCKET=product-images

# OpenSearch
OS_NODE=https://opensearch-host:9200
OS_INDEX=products
OS_USERNAME=admin
OS_PASSWORD=secure-password

# Redis
REDIS_URL=redis://redis-host:6379
REDIS_PASSWORD=secure-password
REDIS_CLUSTER=true

# Cloudflare R2
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret
R2_BUCKET=fashion-images
R2_PUBLIC_BASE_URL=https://your-domain.r2.dev

# ML Services
RANKER_API_URL=http://ranker-service:8000
RANKER_TIMEOUT_MS=5000
ENABLE_ML_RANKING=true

# Feature Flags
ENABLE_CLIP_SEARCH=true
ENABLE_PRICE_ALERTS=true
ENABLE_QUALITY_ANALYSIS=true
ENABLE_RECOMMENDATIONS=true

# Monitoring
SENTRY_DSN=https://your-sentry-dsn
LOG_LEVEL=info
ENABLE_REQUEST_LOGGING=true
```

#### Security Configuration
```env
# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS=true

# CORS
CORS_ORIGIN=https://your-frontend.com,https://your-admin.com
CORS_METHODS=GET,POST,PUT,DELETE
CORS_ALLOW_HEADERS=Content-Type,Authorization

# Security Headers
HELMET_CSP_ENABLED=true
HELMET_HSTS_ENABLED=true
```

### Dockerfile

Create `Dockerfile`:
```dockerfile
# Build stage
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
COPY pnpm-lock.yaml ./
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Production stage
FROM node:18-alpine AS production

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    make \
    g++ \
    libc6-compat

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml ./
RUN npm install -g pnpm

# Install production dependencies
RUN pnpm install --frozen-lockfile --production

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/models ./models

# Copy ML requirements and install
COPY src/lib/model/requirements.txt ./
RUN pip3 install -r requirements.txt

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001
USER nextjs

EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

CMD ["node", "dist/index.js"]
```

### ML Ranker Dockerfile

Create `src/lib/model/Dockerfile`:
```dockerfile
FROM python:3.9-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY ranker_api.py .
COPY *.json ./models/

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "ranker_api:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## Database Migration and Scaling

### Database Setup in Production

#### 1. PostgreSQL Configuration
```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Create dedicated user
CREATE USER fashion_api WITH PASSWORD 'secure-password';
GRANT CONNECT ON DATABASE fashion TO fashion_api;
GRANT USAGE ON SCHEMA public TO fashion_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fashion_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO fashion_api;

-- Configure connection pooling
ALTER SYSTEM SET max_connections = '200';
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
ALTER SYSTEM SET track_activity_query_size = '2048';
```

#### 2. Performance Tuning
```sql
-- Optimize for read-heavy workload
ALTER SYSTEM SET effective_cache_size = '8GB';
ALTER SYSTEM SET shared_buffers = '2GB';
ALTER SYSTEM SET work_mem = '16MB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';

-- Vector search optimization
ALTER SYSTEM SET max_parallel_workers_per_gather = '4';
ALTER SYSTEM SET effective_io_concurrency = '200';
```

#### 3. Backup Configuration
```bash
# Automated backup script
#!/bin/bash
BACKUP_DIR="/backups/postgres"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup
pg_dump -h postgres-host -U postgres fashion > "$BACKUP_DIR/fashion_$DATE.sql"

# Compress backup
gzip "$BACKUP_DIR/fashion_$DATE.sql"

# Clean old backups (keep 30 days)
find "$BACKUP_DIR" -name "*.gz" -mtime +30 -delete

# Upload to cloud storage (optional)
aws s3 cp "$BACKUP_DIR/fashion_$DATE.sql.gz" s3://your-backup-bucket/
```

### OpenSearch Configuration

#### 1. Cluster Configuration
```yaml
# opensearch.yml
cluster.name: fashion-search
node.name: node-1
network.host: 0.0.0.0
discovery.type: single-node

# Memory settings
indices.memory.index_buffer_size: 20%
indices.fielddata.cache.size: 40%

# Index settings for better performance
index.number_of_shards: 3
index.number_of_replicas: 1
index.refresh_interval: 30s
```

#### 2. Index Templates
```json
{
  "index_patterns": ["products*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "index": {
        "knn": true,
        "knn.algo_param.ef_search": 512
      }
    },
    "mappings": {
      "properties": {
        "title": {
          "type": "text",
          "analyzer": "standard"
        },
        "description": {
          "type": "text",
          "analyzer": "english"
        },
        "embedding": {
          "type": "knn_vector",
          "dimension": 512,
          "method": {
            "name": "hnsw",
            "space_type": "cosinesimil",
            "engine": "lucene"
          }
        }
      }
    }
  }
}
```

---

## Load Balancing and CDN

### Nginx Configuration

Create `nginx.conf`:
```nginx
upstream api_backend {
    least_conn;
    server api-1:4000 max_fails=3 fail_timeout=30s;
    server api-2:4000 max_fails=3 fail_timeout=30s;
    server api-3:4000 max_fails=3 fail_timeout=30s;
}

upstream ranker_backend {
    server ranker-1:8000 max_fails=2 fail_timeout=15s;
    server ranker-2:8000 max_fails=2 fail_timeout=15s;
}

# Rate limiting
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=search:10m rate=5r/s;

server {
    listen 80;
    server_name api.your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.your-domain.com;
    
    ssl_certificate /etc/ssl/certs/your-domain.crt;
    ssl_certificate_key /etc/ssl/private/your-domain.key;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000";
    
    # API routes
    location / {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://api_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts
        proxy_connect_timeout 5s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }
    
    # Search endpoints with tighter limits
    location /search {
        limit_req zone=search burst=10 nodelay;
        proxy_pass http://api_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Longer timeout for ML operations
        proxy_read_timeout 60s;
    }
    
    # Health checks
    location /health {
        access_log off;
        proxy_pass http://api_backend;
    }
}

# ML Ranker service
server {
    listen 8000;
    server_name ranker.your-domain.com;
    
    location / {
        proxy_pass http://ranker_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # ML service timeouts
        proxy_connect_timeout 3s;
        proxy_send_timeout 10s;
        proxy_read_timeout 10s;
    }
}
```

### Cloudflare Configuration

#### 1. DNS Settings
```
api.your-domain.com    CNAME   your-server.domain.com
images.your-domain.com CNAME   your-r2-bucket.r2.dev
```

#### 2. Page Rules
```
api.your-domain.com/*
- Cache Level: Bypass
- Security Level: High
- Browser Integrity Check: On

images.your-domain.com/*
- Cache Level: Cache Everything
- Edge Cache TTL: 1 month
- Browser Cache TTL: 1 week
```

---

## Monitoring and Observability

### Health Checks

Implement comprehensive health checks:

```typescript
// src/routes/health/health.service.ts
export async function getDetailedHealth() {
  const checks = await Promise.allSettled([
    checkDatabase(),
    checkOpenSearch(),
    checkRedis(),
    checkRankerService(),
    checkR2Storage()
  ]);
  
  return {
    status: checks.every(c => c.status === 'fulfilled') ? 'healthy' : 'degraded',
    checks: {
      database: checks[0],
      opensearch: checks[1],
      redis: checks[2],
      ranker: checks[3],
      storage: checks[4]
    },
    timestamp: new Date().toISOString()
  };
}
```

### Metrics and Logging

#### 1. Prometheus Metrics
```typescript
// src/middleware/metrics.ts
import { Counter, Histogram, register } from 'prom-client';

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code']
});

const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

export const metricsMiddleware = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path;
    
    httpRequestDuration
      .labels(req.method, route, res.statusCode)
      .observe(duration);
      
    httpRequestTotal
      .labels(req.method, route, res.statusCode)
      .inc();
  });
  
  next();
};
```

#### 2. Structured Logging
```typescript
// src/lib/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty'
  } : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      headers: req.headers,
      remoteAddress: req.remoteAddress,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
      headers: res.headers,
    }),
    err: (err) => ({
      type: err.constructor.name,
      message: err.message,
      stack: err.stack,
    }),
  },
});
```

### Alerts Configuration

#### 1. Docker Swarm with Alertmanager
```yaml
# alertmanager.yml
global:
  smtp_smarthost: 'smtp.gmail.com:587'
  smtp_from: 'alerts@your-domain.com'

route:
  group_by: ['alertname']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'web.hook'

receivers:
- name: 'web.hook'
  email_configs:
  - to: 'team@your-domain.com'
    subject: 'Fashion API Alert: {{ .GroupLabels.alertname }}'
    body: |
      {{ range .Alerts }}
      Alert: {{ .Annotations.summary }}
      Description: {{ .Annotations.description }}
      {{ end }}
```

#### 2. Grafana Dashboards
Import dashboard configurations for:
- API response times and error rates
- Database query performance
- OpenSearch cluster health
- ML model performance metrics
- Business metrics (searches, recommendations)

---

## Backup and Disaster Recovery

### Backup Strategy

#### 1. Database Backups
```bash
#!/bin/bash
# backup-db.sh
set -e

BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/postgres"

# Full backup
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_DIR/full_$BACKUP_DATE.sql.gz"

# Incremental backup using WAL-E or similar
# wal-e backup-push /var/lib/postgresql/data

# Upload to cloud storage
aws s3 cp "$BACKUP_DIR/full_$BACKUP_DATE.sql.gz" "s3://your-backup-bucket/postgres/"

# Cleanup old backups
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete
```

#### 2. OpenSearch Snapshots
```bash
#!/bin/bash
# backup-opensearch.sh

SNAPSHOT_NAME="snapshot_$(date +%Y%m%d_%H%M%S)"

# Create snapshot
curl -X PUT "opensearch-host:9200/_snapshot/s3-repository/$SNAPSHOT_NAME" \
     -H "Content-Type: application/json" \
     -d '{
       "indices": "products",
       "ignore_unavailable": true,
       "include_global_state": false
     }'
```

### Disaster Recovery Plan

#### 1. RTO/RPO Targets
- **Recovery Time Objective (RTO)**: 4 hours
- **Recovery Point Objective (RPO)**: 1 hour

#### 2. Recovery Procedures
```bash
# Database Recovery
psql -h new-postgres-host -U postgres -c "CREATE DATABASE fashion;"
gunzip -c latest_backup.sql.gz | psql -h new-postgres-host -U postgres -d fashion

# OpenSearch Recovery
curl -X POST "new-opensearch-host:9200/_snapshot/s3-repository/latest_snapshot/_restore" \
     -H "Content-Type: application/json" \
     -d '{"indices": "products"}'

# Redeploy services
docker stack deploy -c docker-compose.prod.yml fashion
```

---

## Security Considerations

### SSL/TLS Configuration
```nginx
# Strong SSL configuration
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;

# OCSP stapling
ssl_stapling on;
ssl_stapling_verify on;
resolver 8.8.8.8 8.8.4.4 valid=300s;
```

### Network Security
- Use private networks for inter-service communication
- Implement WAF rules for API protection
- Regular security updates for all components
- Monitor for suspicious activities

### Data Protection
- Encrypt sensitive data at rest
- Use secrets management (Vault, AWS Secrets Manager)
- Implement proper access controls
- Regular security audits

---

## Maintenance

### Routine Maintenance Tasks
```bash
# Weekly maintenance script
#!/bin/bash

# Update search index
curl -X POST "api-host:4000/admin/opensearch/reindex"

# Retrain ML models
python src/lib/model/train_xgb_classifier.py

# Clean old logs
find /var/log -name "*.log" -mtime +30 -delete

# Update price baselines
curl -X POST "api-host:4000/api/compare/compute-baselines"

# Vacuum database
psql -h postgres-host -U postgres -d fashion -c "VACUUM ANALYZE;"
```

### Performance Monitoring
- Monitor API response times
- Track database query performance
- Monitor ML model prediction latency
- Alert on error rate increases

This deployment guide provides a comprehensive foundation for deploying the Fashion Aggregator API in production environments. Adjust configurations based on your specific infrastructure and requirements.

