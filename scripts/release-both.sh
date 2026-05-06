#!/usr/bin/env bash
# release-both.sh
# iOS (fastlane TestFlight) + Android (EAS preview + adb install) 동시 트리거.
# 두 프로세스 병렬 실행, 양쪽 모두 완료 후 종합 결과 출력.
# 사용:
#   ./scripts/release-both.sh
#   ./scripts/release-both.sh --android-no-install
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

ANDROID_OPTS=""
if [[ "${1:-}" == "--android-no-install" ]]; then
  ANDROID_OPTS="--no-install"
fi

mkdir -p build/release-logs
TS=$(date +%Y%m%d-%H%M%S)
IOS_LOG="build/release-logs/ios-$TS.log"
AND_LOG="build/release-logs/android-$TS.log"

echo "🚀 iOS + Android 동시 빌드 시작"
echo "  iOS log:     $IOS_LOG"
echo "  Android log: $AND_LOG"

./scripts/release-ios.sh > "$IOS_LOG" 2>&1 &
IOS_PID=$!
./scripts/release-android.sh $ANDROID_OPTS > "$AND_LOG" 2>&1 &
AND_PID=$!

echo ""
echo "⏳ 두 빌드 진행 중 (PID iOS=$IOS_PID, Android=$AND_PID)"
echo "   tail -f $IOS_LOG  ← iOS 진행 상황"
echo "   tail -f $AND_LOG  ← Android 진행 상황"
echo ""

IOS_STATUS=0
AND_STATUS=0
wait $IOS_PID || IOS_STATUS=$?
wait $AND_PID || AND_STATUS=$?

echo ""
echo "=== 결과 ==="
[[ $IOS_STATUS -eq 0 ]] && echo "✅ iOS:     TestFlight 업로드 완료" || echo "❌ iOS:     실패 (log: $IOS_LOG)"
[[ $AND_STATUS -eq 0 ]] && echo "✅ Android: 빌드+설치 완료" || echo "❌ Android: 실패 (log: $AND_LOG)"

[[ $IOS_STATUS -ne 0 || $AND_STATUS -ne 0 ]] && exit 1
exit 0
