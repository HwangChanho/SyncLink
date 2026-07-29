#!/usr/bin/env bash
# release-android-local.sh
# 로컬 (Android Studio + 연결된 device) release variant 빌드. Metro/Gradle
# cache 를 매번 무효화한 뒤 expo run:android --variant release 실행.
#
# 왜 매번 clear: cache 가 살아있으면 코드 변경 (특히 작은 string/length 등
# minify 단계의 inline literal) 이 옛 transform 결과로 그대로 복사되어
# 새 빌드 인데도 옛 동작이 살아남는 회귀가 발생 (Build 86 invite_code 8→6
# fix 가 cache 때문에 첫 빌드엔 안 들어감). cost ≈ +3-5분, gain = 변경
# 신뢰도.
#
# 사용:
#   ./scripts/release-android-local.sh           # device 자동 선택
#   ./scripts/release-android-local.sh --device <serial>
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

DEVICE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --device) DEVICE="$2"; shift 2 ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

echo "[1/4] 기존 expo/metro process 종료"
pkill -f "expo run:android" 2>/dev/null || true
pkill -f "expo start" 2>/dev/null || true
sleep 2

echo "[2/4] Expo cache clear (Metro cache 는 metro 자체가 invalidate 처리 — race 회피)"
# Build-94 — /tmp/metro-* 삭제가 metro server start 와 race 해 ENOTEMPTY
# 로 빌드 fail. metro 의 transformer cache 는 코드 변경 시 자동 invalidate
# 되므로 명시 삭제 안 함. .expo (expo-router 캐시) 만 정리.
rm -rf .expo node_modules/.cache 2>/dev/null || true

echo "[3/4] Gradle clean (Android native build cache)"
( cd android && ./gradlew clean )

echo "[4/4] expo run:android --variant release"
# 🔴 JAVA_HOME 이 없으면 기본 java 가 OpenJDK 26 으로 잡혀 RN Gradle 플러그인이
#    "Error resolving plugin [com.facebook.react.settings] > 26" 로 즉시 죽는다. JDK 21 고정.
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
# SDK 는 Android Studio 기본 경로가 아니라 homebrew commandlinetools 에 설치돼 있다.
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"
if [[ -n "$DEVICE" ]]; then
  export ANDROID_SERIAL="$DEVICE"
fi
npx expo run:android --variant release

echo "✅ Android release 빌드+설치 완료"
