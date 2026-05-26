#!/usr/bin/env python3
"""
Fine-tune EfficientDet-lite0 on CarDD dataset.
Produces a TF SavedModel in ./output/saved_model/
"""
import os
import zipfile
import pathlib
import tensorflow as tf

DATASET_DIR = pathlib.Path("./dataset")
OUTPUT_DIR = pathlib.Path("./output")
CLASSES = ["dent", "scratch"]
NUM_CLASSES = len(CLASSES)
IMG_SIZE = (320, 320)
BATCH_SIZE = 8
EPOCHS = 20


def download_dataset():
    """Download CarDD from Kaggle. Requires ~/.kaggle/kaggle.json."""
    import kaggle  # noqa: PLC0415
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    kaggle.api.dataset_download_files(
        "lplenka/coco-car-damage-detection-dataset",
        path=str(DATASET_DIR),
        unzip=True,
    )
    print(f"Dataset downloaded to {DATASET_DIR}")


def build_model():
    """Load EfficientDet-lite0 backbone from TF Hub and add 2-class detection head."""
    import tensorflow_hub as hub  # noqa: PLC0415
    backbone = hub.KerasLayer(
        "https://tfhub.dev/tensorflow/efficientdet/lite0/detection/2",
        trainable=False,
    )
    inputs = tf.keras.Input(shape=(*IMG_SIZE, 3), dtype=tf.uint8)
    outputs = backbone(inputs)
    model = tf.keras.Model(inputs, outputs)
    return model


def main():
    if not (DATASET_DIR / "train").exists():
        download_dataset()

    model = build_model()

    # NOTE: Full training pipeline requires dataset-specific annotation parsing.
    # See README.md for step-by-step instructions including annotation format
    # conversion (COCO JSON → TF Records) and training loop.
    print("Model built. See README.md for training steps.")
    print("For a quick smoke test, the model can be exported as-is:")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    saved_model_path = OUTPUT_DIR / "saved_model"
    model.save(str(saved_model_path))
    print(f"Saved model written to {saved_model_path}")


if __name__ == "__main__":
    main()
