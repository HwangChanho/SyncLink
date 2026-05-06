#!/usr/bin/env bash
# release-android.sh
# EAS preview Android 빌드 트리거 → 완료까지 대기 → APK 다운로드 → adb install.
# 사용:
#   ./scripts/release-android.sh           # 빌드 + 설치 (연결된 device 자동 감지)
#   ./scripts/release-android.sh --no-install  # 빌드만, 설치 생략
#   ./scripts/release-android.sh --device <serial>  # 특정 device serial 지정
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

INSTALL=true
DEVICE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-install) INSTALL=false; shift ;;
    --device)     DEVICE="$2"; shift 2 ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

echo "[1/4] EAS preview 빌드 트리거..."
TRIGGER_OUT=$(eas build --platform android --profile preview --non-interactive --no-wait 2>&1)
echo "$TRIGGER_OUT" | tail -5
BUILD_ID=$(echo "$TRIGGER_OUT" | grep -oE 'builds/[a-f0-9-]+' | head -1 | cut -d/ -f2)
if [[ -z "$BUILD_ID" ]]; then
  echo "[ERROR] 빌드 ID 추출 실패"
  exit 1
fi
echo "Build ID: $BUILD_ID"
echo "Logs: https://expo.dev/accounts/danielhwang/projects/synclink/builds/$BUILD_ID"

echo "[2/4] 빌드 완료 대기 (보통 8-15분)..."
# eas-cli 18.x 에는 build:wait 가 없어서 build:view --json 폴링.
while true; do
  STATUS=$(eas build:view "$BUILD_ID" --json 2>/dev/null \
    | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{const j=JSON.parse(d); console.log(j.status||'unknown')})") || true
  echo "  [$(date +%H:%M:%S)] status=$STATUS"
  case "$STATUS" in
    FINISHED) break ;;
    ERRORED|CANCELED) echo "[ERROR] 빌드 실패: $STATUS"; exit 1 ;;
    *) sleep 30 ;;
  esac
done

echo "[3/4] APK URL 추출 + 다운로드..."
APK_URL=$(eas build:view "$BUILD_ID" --json 2>/dev/null \
  | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{const j=JSON.parse(d); console.log(j.artifacts?.applicationArchiveUrl || '')})") || true

if [[ -z "$APK_URL" ]]; then
  # JSON 파싱 실패 fallback — text view 에서 추출
  APK_URL=$(eas build:view "$BUILD_ID" 2>&1 | grep -oE 'https://[^ ]*\.apk' | head -1)
fi

if [[ -z "$APK_URL" ]]; then
  echo "[ERROR] APK URL 추출 실패. 수동 확인: https://expo.dev/accounts/danielhwang/projects/synclink/builds/$BUILD_ID"
  exit 1
fi

mkdir -p build
APK_PATH="build/synclink-preview-$BUILD_ID.apk"
echo "다운로드: $APK_URL"
curl -L -o "$APK_PATH" "$APK_URL"
echo "저장: $APK_PATH ($(du -h "$APK_PATH" | cut -f1))"

if [[ "$INSTALL" == "false" ]]; then
  echo "[4/4] --no-install — adb install 생략. APK: $APK_PATH"
  exit 0
fi

echo "[4/4] adb install..."
if [[ -n "$DEVICE" ]]; then
  adb -s "$DEVICE" install -r "$APK_PATH"
else
  DEVICE_COUNT=$(adb devices | grep -c "device$" || true)
  if [[ "$DEVICE_COUNT" -eq 0 ]]; then
    echo "[WARN] 연결된 Android device 없음. APK 만 빌드됨: $APK_PATH"
    exit 0
  fi
  adb install -r "$APK_PATH"
fi

echo "✅ Android preview 빌드 + 설치 완료"
