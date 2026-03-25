#!/bin/bash
set -e

REPO_DIR="/root/repo/carreel"
DEPLOY_DIR="/var/www/html/carreel"

echo "Building driver-app database..."
cd "$REPO_DIR/driver-app/database"
bun install
bun run generate
bunx prisma db push

echo "Building driver-app backend..."
cd "$REPO_DIR/driver-app/backend"
bun install
make down; make up;

echo "Building driver-app frontend..."
cd "$REPO_DIR/driver-app/frontend"
bun install
bun run build

echo "Building planner-app backend..."
cd "$REPO_DIR/planner-app/backend"
make down; make up;

echo "Done!"
