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

echo "Building planner-app backend..."
cd "$REPO_DIR/planner-app/backend"
bun install
make down; make up;

echo "Done!"
