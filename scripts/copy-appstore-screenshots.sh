#!/usr/bin/env bash
# Copy the most recent Maestro screenshot set to ./screenshots/ with
# the App Store filename convention (01_home.png, etc).
#
# Maestro saves under ~/.maestro/tests/{timestamp}/screenshot_*.png
# We pick the most recent timestamped folder and rename files.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$PROJECT_ROOT/screenshots"
MAESTRO_ROOT="$HOME/.maestro/tests"

if [[ ! -d "$MAESTRO_ROOT" ]]; then
  echo "❌ Maestro test 결과 폴더 없음: $MAESTRO_ROOT"
  exit 1
fi

# Most recent test run folder
LATEST=$(ls -dt "$MAESTRO_ROOT"/*/ 2>/dev/null | head -1)
if [[ -z "$LATEST" ]]; then
  echo "❌ Maestro test 실행 기록 없음"
  exit 1
fi

echo "📂 source: $LATEST"
mkdir -p "$DEST"

# Iterate screenshots in order
for img in "$LATEST"*.png; do
  [[ -e "$img" ]] || continue
  filename=$(basename "$img")
  # Maestro saves as screenshot_<name>.png where <name> matches takeScreenshot value
  target_name="${filename#screenshot_}"
  # Some Maestro versions just save as <name>.png — leave as-is
  echo "  → $target_name"
  cp "$img" "$DEST/$target_name"
done

echo ""
echo "✅ Copied to: $DEST"
ls -la "$DEST"/*.png 2>/dev/null | grep -E "0[1-5]_" || echo "  (no numbered shots found — check Maestro flow takeScreenshot names)"
