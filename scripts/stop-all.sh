#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Stopping infrastructure..."
docker compose -f "$ROOT/driver-app/database/docker-compose.yml" down 2>/dev/null || true
docker compose -f "$ROOT/minio/docker-compose.yml" down 2>/dev/null || true
docker compose -f "$ROOT/monitoring/docker-compose.yml" down 2>/dev/null || true

echo "All infrastructure stopped."
