#!/bin/bash
set -e

REPO_DIR="/root/repo/carreel"
DEPLOY_DIR="/var/www/html/carreel"

START_EPOCH=$(date +%s)
START_HUMAN=$(date '+%Y-%m-%d %H:%M:%S %Z')

echo "============================================"
echo "Deploy started at: $START_HUMAN"
echo "============================================"

echo ""
echo "[$(date '+%H:%M:%S')] Building driver-app database..."
cd "$REPO_DIR/driver-app/database"
bun install
bun run generate
bunx prisma db push

echo ""
echo "[$(date '+%H:%M:%S')] Building driver-app backend..."
cd "$REPO_DIR/driver-app/backend"
bun install
make down; make up;

echo ""
echo "[$(date '+%H:%M:%S')] Building driver-app frontend..."
cd "$REPO_DIR/driver-app/frontend"
bun install
bun run build

echo ""
echo "[$(date '+%H:%M:%S')] Building planner-app backend..."
cd "$REPO_DIR/planner-app/backend"
make down; make up;

echo ""
echo "[$(date '+%H:%M:%S')] Building planner-app frontend..."
cd "$REPO_DIR/planner-app/frontend"
bun install
bun run build

echo ""
echo "[$(date '+%H:%M:%S')] Deploying driver-app..."
cp -r "$REPO_DIR/driver-app/frontend/dist" "$DEPLOY_DIR/driver"

echo ""
echo "[$(date '+%H:%M:%S')] Deploying planner-app..."
cp -r "$REPO_DIR/planner-app/frontend/dist" "$DEPLOY_DIR/planner"

echo ""
echo "[$(date '+%H:%M:%S')] Restarting monitoring stack..."
cd "$REPO_DIR/monitoring" && docker compose restart grafana

END_EPOCH=$(date +%s)
END_HUMAN=$(date '+%Y-%m-%d %H:%M:%S %Z')
ELAPSED=$((END_EPOCH - START_EPOCH))
ELAPSED_MIN=$((ELAPSED / 60))
ELAPSED_SEC=$((ELAPSED % 60))

echo ""
echo "============================================"
echo "Done!"
echo "Started:  $START_HUMAN"
echo "Finished: $END_HUMAN"
echo "Elapsed:  ${ELAPSED_MIN}m ${ELAPSED_SEC}s (${ELAPSED} seconds total)"
echo "============================================"
