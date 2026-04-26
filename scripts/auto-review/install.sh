#!/usr/bin/env bash
# install.sh — register the Auto-Reviewer LaunchAgents on the current Mac.
#
# Idempotent: re-running this updates the existing plists with the
# project's current path. No-op if the LaunchAgents are already loaded
# with matching arguments.
#
# Sprint 19 — see docs/architecture/AUTO_REVIEW.md.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$HOME/Library/LaunchAgents"
SOURCE_DIR="$SCRIPT_DIR/launchagents"

mkdir -p "$TARGET_DIR"
mkdir -p "$HOME/Library/Logs"

echo "Installing SyncLink Auto-Reviewer LaunchAgents…"
echo "  Project root: $PROJECT_ROOT"
echo "  Target dir:   $TARGET_DIR"
echo

for src in "$SOURCE_DIR"/*.plist; do
  name="$(basename "$src")"
  dst="$TARGET_DIR/$name"

  sed \
    -e "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" \
    -e "s|__HOME__|$HOME|g" \
    "$src" > "$dst"

  echo "  ► $name"

  if launchctl list | grep -q "${name%.plist}"; then
    launchctl unload "$dst" 2>/dev/null || true
  fi
  launchctl load "$dst"
done

echo
echo "✓ Installed. Verify:  launchctl list | grep synclink"
echo "✓ Logs:                ~/Library/Logs/synclink-auto-review.log"
echo "✓ Kill switch:         touch $PROJECT_ROOT/.auto-review-disabled"
echo
echo "First-run dry test (no LaunchAgent needed):"
echo "  bash $SCRIPT_DIR/run.sh daily-review --dry-run"
