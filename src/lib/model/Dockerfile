FROM python:3.10-slim

WORKDIR /app

# Install system dependencies for OpenCV and image processing
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    curl \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1-mesa-glx \
    libglib2.0-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY yolov8_api.py .
COPY ranker_api.py .

# Create models directory
RUN mkdir -p models

# Pre-download YOLOv8n model (will be cached in image)
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

# Copy model files if they exist (optional - can mount at runtime)
COPY models/ ./models/ 2>/dev/null || true

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash appuser
RUN chown -R appuser:appuser /app
USER appuser

# Expose ports for both APIs
EXPOSE 8000 8001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8001/health || exit 1

# Default: run YOLOv8 fashion detection API
CMD ["python", "-m", "uvicorn", "yolov8_api:app", "--host", "0.0.0.0", "--port", "8001"]