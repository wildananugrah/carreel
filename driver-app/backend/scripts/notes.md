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

bun run scripts/compare-body-damages.ts /Users/bellinnn/Documents/projects/carreel/tests/video/body2.mp4 \
  --runs 2 \
  --make Wuling --model "Air EV" --color "Pink" \
  --license-plate "B 1261 SNO"

bun run scripts/compare-body-damages.ts /Users/bellinnn/Documents/projects/carreel/tests/video/body6-left.mp4 \
  --runs 2 \
  --make Wuling --model "Air EV" --color "Pink" \
  --license-plate "B 1261 SNO"

bun run scripts/compare-body-damages.ts /Users/bellinnn/Documents/projects/carreel/tests/video/body7-right.mp4 \
  --runs 2 \
  --make Wuling --model "Air EV" --color "Pink" \
  --license-plate "B 1261 SNO"

bun run scripts/compare-body-damages.ts /Users/bellinnn/Documents/projects/carreel/tests/video/body8.mp4 \
  --runs 2 \
  --make Toyota --model "Yaris" --color "White" \
  --license-plate "B 1570 DKO"

bun run scripts/compare-body-damages.ts /Users/bellinnn/Documents/projects/carreel/tests/video/body9.mp4 \
  --runs 1 \
  --make Daihatsu --model "Siegra" --color "Black" \
  --license-plate "B 1824 WIQ" \
  --verbose

bun run scripts/compare-body-damages.ts /Users/bellinnn/Documents/projects/carreel/tests/video/body10.mp4 \
  --runs 5 \
  --make Toyota --model "Corolla" --color "Cream" \
  --license-plate "B 1563 KBC"

bun run scripts/compare-body-damages.ts /Users/bellinnn/Documents/projects/carreel/tests/video/body11.mp4 \
  --runs 1 \
  --make Toyota --model "Corolla" --color "Cream" \
  --license-plate "B 1563 KBC"

bun run scripts/compare-body-damages.ts /Users/bellinnn/Documents/projects/carreel/tests/video/body12.webm \
  --runs 1 \
  --make Toyota --model "Innova" --color "White" \
  --license-plate "B 1241 WYE"

# Mirror production exactly (Pass 1 + Pass 2 + side guard)
bun run scripts/compare-body-damages.ts /path/to/video.mp4 --with-verification

# compare speedometer
# Basic — 5 runs
bun run scripts/compare-speedometer.ts tests/images/dashboard.jpg
bun run scripts/compare-speedometer.ts /Users/bellinnn/Documents/projects/carreel/tests/images/speedometer4.jpeg

# With vehicle context (enables mismatch detection)
bun run scripts/compare-speedometer.ts tests/images/dashboard.jpg \
  --runs 10 \
  --make Toyota --model Yaris --license-plate "B 1570 DKO"

# See full JSON per run
bun run scripts/compare-speedometer.ts tests/images/dashboard.jpg --verbose
