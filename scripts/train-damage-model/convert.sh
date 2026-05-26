#!/usr/bin/env bash
# Convert TF SavedModel → TF.js Graph Model
# Run this after train.py produces ./output/saved_model/
set -e

SAVED_MODEL_DIR="./output/saved_model"
TFJS_OUTPUT_DIR="../../driver-app/frontend/public/models/efficientdet-lite0"

if [ ! -d "$SAVED_MODEL_DIR" ]; then
  echo "ERROR: $SAVED_MODEL_DIR not found. Run train.py first."
  exit 1
fi

echo "Converting SavedModel → TF.js..."
tensorflowjs_converter \
  --input_format=tf_saved_model \
  --output_format=tfjs_graph_model \
  --signature_name=serving_default \
  --saved_model_tags=serve \
  "$SAVED_MODEL_DIR" \
  "$TFJS_OUTPUT_DIR"

echo "Model files written to $TFJS_OUTPUT_DIR"
ls -lh "$TFJS_OUTPUT_DIR"
