#!/bin/sh
set -e

mc alias set carreel http://minio:9000 carreel carreel_secret

mc mb --ignore-existing carreel/carreel-images
mc mb --ignore-existing carreel/carreel-videos
mc mb --ignore-existing carreel/carreel-thumbnails

echo "Buckets created successfully."
