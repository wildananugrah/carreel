#!/bin/sh
# Check MinIO storage usage — volume size, per-bucket breakdown, and object count.
# Usage: bash minio/check-storage.sh

MINIO_ALIAS="local"
MINIO_URL="http://localhost:9000"
MINIO_USER="carreel"
MINIO_PASS="carreel_secret"
CONTAINER="carreel-minio"
VOLUME="minio_minio-data"

echo "========================================"
echo " MinIO Storage Report"
echo "========================================"

# 1. Docker volume size (no MinIO dependency — always works)
echo ""
echo "── Docker volume size ──────────────────"
docker run --rm \
  -v "${VOLUME}:/data:ro" \
  alpine sh -c "du -sh /data && echo '' && du -sh /data/* 2>/dev/null || true" 2>/dev/null \
  || echo "  (could not read volume — is Docker running?)"

# 2. Per-bucket usage via mc inside the running MinIO container
echo ""
echo "── Per-bucket usage (via mc) ───────────"
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  docker exec "${CONTAINER}" sh -c "
    mc alias set ${MINIO_ALIAS} ${MINIO_URL} ${MINIO_USER} ${MINIO_PASS} --quiet 2>/dev/null
    mc du ${MINIO_ALIAS} 2>/dev/null || echo '  (mc du not available in this image)'
  "
else
  echo "  Container '${CONTAINER}' is not running."
fi

# 3. Bucket list + object count
echo ""
echo "── Bucket list ─────────────────────────"
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  docker exec "${CONTAINER}" sh -c "
    mc alias set ${MINIO_ALIAS} ${MINIO_URL} ${MINIO_USER} ${MINIO_PASS} --quiet 2>/dev/null
    mc ls ${MINIO_ALIAS} 2>/dev/null || echo '  (could not list buckets)'
  "
fi

echo ""
echo "========================================"
echo " Web console: http://localhost:9001"
echo " Login: ${MINIO_USER} / ${MINIO_PASS}"
echo "========================================"
