# Damage Detection Model Training

Trains EfficientDet-lite0 to detect `dent` and `scratch` on car exteriors.
Output model files go into `driver-app/frontend/public/models/efficientdet-lite0/`.

## Prerequisites

- Python 3.10+
- Kaggle API credentials at `~/.kaggle/kaggle.json`
- CUDA-capable GPU (recommended; CPU works but is slow)

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Dataset

[CarDD — Car Damage Detection Dataset](https://github.com/CarDD-USTC/CarDD-USTC)

The `train.py` script downloads it automatically from Kaggle.
CarDD contains COCO-format annotations for dents, scratches, and other damage.
We use only the `dent` and `scratch` classes (class IDs 0 and 1 after filtering).

## Training

```bash
python train.py
```

This builds EfficientDet-lite0, downloads CarDD, and saves a TF SavedModel to
`./output/saved_model/`. Edit `EPOCHS` and `BATCH_SIZE` in `train.py` to tune.

## Conversion to TF.js

```bash
bash convert.sh
```

Produces `model.json` + weight shards (~4.4 MB total) in
`driver-app/frontend/public/models/efficientdet-lite0/`.
After conversion, set `VITE_DAMAGE_DETECTION_ENABLED=true` in
`driver-app/frontend/.env` to activate the feature.

## Retraining with New Data

1. Add annotated images to `./dataset/` in COCO JSON format
2. Re-run `python train.py`
3. Re-run `bash convert.sh`
4. Replace the files in `public/models/efficientdet-lite0/`

No code change required — swapping the model files upgrades the model automatically.
