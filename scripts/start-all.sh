#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[start-all]${NC} $*"; }
warn() { echo -e "${YELLOW}[start-all]${NC} $*"; }
fail() { echo -e "${RED}[start-all]${NC} $*"; exit 1; }

# ========================
# 1. Prerequisites check
# ========================

command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v bun >/dev/null 2>&1    || fail "bun is required"

# ========================
# 2. Start infrastructure
# ========================

log "Starting PostgreSQL..."
docker compose -f "$ROOT/driver-app/database/docker-compose.yml" up -d

log "Starting MinIO..."
docker compose -f "$ROOT/minio/docker-compose.yml" up -d

log "Starting monitoring stack (Loki, Jaeger, Grafana)..."
docker compose -f "$ROOT/monitoring/docker-compose.yml" up -d

# ========================
# 3. Wait for services
# ========================

log "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
  if docker exec carreel-driver-db pg_isready -U carreel >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 30 ]; then fail "PostgreSQL did not become ready"; fi
  sleep 1
done
log "PostgreSQL is ready"

log "Waiting for MinIO..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:9000/minio/health/live >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 30 ]; then fail "MinIO did not become ready"; fi
  sleep 1
done
log "MinIO is ready"

# ========================
# 4. Database setup
# ========================

log "Pushing Prisma schema to database..."
cd "$ROOT/driver-app/database"
bunx prisma db push --skip-generate 2>&1 | tail -1

log "Generating Prisma clients..."
bunx prisma generate 2>&1 | tail -2

# ========================
# 5. Install dependencies
# ========================

log "Installing dependencies..."
cd "$ROOT/driver-app/backend"   && bun install --frozen-lockfile 2>/dev/null || bun install
cd "$ROOT/driver-app/frontend"  && bun install --frozen-lockfile 2>/dev/null || bun install
cd "$ROOT/planner-app/backend"  && bun install --frozen-lockfile 2>/dev/null || bun install
cd "$ROOT/planner-app/frontend" && bun install --frozen-lockfile 2>/dev/null || bun install
cd "$ROOT/websocket"            && bun install --frozen-lockfile 2>/dev/null || bun install

# ========================
# 6. Seed database
# ========================

log "Seeding database..."
cd "$ROOT"
bun run scripts/seed.ts

# ========================
# 7. Start services
# ========================

log "Starting WebSocket service (port 3003)..."
cd "$ROOT/websocket"
bun run dev &
WS_PID=$!

log "Starting Driver backend (port 3001)..."
cd "$ROOT/driver-app/backend"
bun run dev &
DRIVER_PID=$!

log "Starting Planner backend (port 3002)..."
cd "$ROOT/planner-app/backend"
bun run dev &
PLANNER_PID=$!

sleep 2

log "Starting Driver frontend (port 5173)..."
cd "$ROOT/driver-app/frontend"
bun run dev &
DRIVER_FE_PID=$!

log "Starting Planner frontend (port 5174)..."
cd "$ROOT/planner-app/frontend"
bun run dev &
PLANNER_FE_PID=$!

# ========================
# 8. Print summary
# ========================

echo ""
log "All services started!"
echo ""
echo "  Driver App:    http://localhost:5173"
echo "  Planner App:   http://localhost:5174"
echo "  Driver API:    http://localhost:3001"
echo "  Planner API:   http://localhost:3002"
echo "  WebSocket:     http://localhost:3003"
echo "  MinIO Console: http://localhost:9001  (carreel / carreel_secret)"
echo "  Grafana:       http://localhost:3000  (admin / admin)"
echo "  Jaeger UI:     http://localhost:16686"
echo ""
echo "  Test accounts:"
echo "    Driver:  driver@test.com  / password123"
echo "    Planner: planner@test.com / password123"
echo ""
echo "  Press Ctrl+C to stop all services"

# Trap SIGINT to clean up background processes
cleanup() {
  log "Stopping services..."
  kill $WS_PID $DRIVER_PID $PLANNER_PID $DRIVER_FE_PID $PLANNER_FE_PID 2>/dev/null || true
  wait 2>/dev/null || true
  log "All services stopped"
}
trap cleanup SIGINT SIGTERM

# Wait for any background process to exit
wait
