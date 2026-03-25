#!/bin/bash
set -e

REPO_DIR="/root/repo/carreel"
DEPLOY_DIR="/var/www/html/carreel"

echo "Building planner-app frontend..."
cd "$REPO_DIR/planner-app/frontend"
bun install
bun run build

echo "Deploying driver-app..."
cp -r "$REPO_DIR/driver-app/frontend/dist" "$DEPLOY_DIR/driver"

echo "Deploying planner-app..."
cp -r "$REPO_DIR/planner-app/frontend/dist" "$DEPLOY_DIR/planner"

echo "Done!"
