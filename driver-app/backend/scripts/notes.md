bun run scripts/extract-body-damages.ts /Users/bellinnn/Documents/projects/carreel/tests/video/test-video1.mp4 --no-side-guard

bun run scripts/extract-body-damages.ts /Users/bellinnn/Documents/projects/carreel/tests/video/test-video2.mp4 --no-side-guard

bun run scripts/extract-body-damages.ts /Users/bellinnn/Documents/projects/carreel/tests/video/body2.mp4 --no-side-guard 

# Default — 5 runs, no verification, side guard enabled
bun run scripts/compare-body-damages.ts /path/to/video.mp4

# 10 runs with full vehicle context (matches what production passes)
bun run scripts/compare-body-damages.ts /Users/bellinnn/Documents/projects/carreel/tests/video/test-video2.mp4 \
  --runs 10 \
  --make Volvo --model "740 GLE" --color "Hitam" \
  --license-plate "B 1691 SES"

bun run scripts/compare-body-damages.ts /Users/bellinnn/Documents/projects/carreel/tests/video/body5.mp4 \
  --runs 2 \
  --make Wuling --model "Air EV" --color "Pink" \
  --license-plate "B 1261 SNO"

# Mirror production exactly (Pass 1 + Pass 2 + side guard)
bun run scripts/compare-body-damages.ts /path/to/video.mp4 --with-verification