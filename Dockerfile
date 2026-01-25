# Curatorr
# Build: docker build -t curatorr .
# Run:   docker compose up -d

# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ ./
RUN npm run build

# Stage 2: Production
FROM python:3.11-slim

LABEL org.opencontainers.image.title="Curatorr"
LABEL org.opencontainers.image.description="Schedule Plex Home collection layouts"
LABEL org.opencontainers.image.source="https://github.com/Shlawpers/Curatorr"

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/*.py ./
COPY --from=frontend-builder /frontend/dist /app/static

RUN mkdir -p /app/data

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PLEX_URL=http://localhost:32400 \
    PLEX_TOKEN="" \
    KOMETA_CONFIG_PATH=/kometa/config \
    APPLY_MODE=dry-run \
    DATABASE_PATH=/app/data/plex_scheduler.db \
    STATIC_DIR=/app/static \
    TZ=UTC

EXPOSE 5100

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:5100/api/config || exit 1

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5100"]
