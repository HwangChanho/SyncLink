#!/usr/bin/env bash
# release-ios.sh
# fastlane beta 트리거 (xcodebuild archive + IPA + TestFlight 업로드).
# 사용:
#   ./scripts/release-ios.sh
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"
echo "[fastlane beta] iOS Build → TestFlight..."
fastlane beta
echo "✅ iOS TestFlight 업로드 완료"
