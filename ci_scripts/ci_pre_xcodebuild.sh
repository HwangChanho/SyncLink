#!/bin/sh
#
# ci_pre_xcodebuild — Xcode Cloud 가 **빌드를 시작하기 직전** 실행된다.
#
# 하는 일: 버전 3중 동기화. 로컬에서는 `fastlane/Fastfile` 이 하던 일이다.
#
# 🔴 왜 필요한가(로컬에서 실제로 데인 것):
#   Info.plist 가 옛 버전인 채로 남아 App Store Connect 가 **엉뚱한 train 으로 받아들인 사고**가 있었다
#   (1.1.7 로 잡힘). `app.json` 의 `expo.version` 을 단일 출처로 삼아 전부 맞춘다.
#   prebuild 가 app.json 에서 생성하므로 대개 맞지만, **맞는지 확인까지 해야** 같은 사고를 막는다.
#
# ⚠️ 빌드 번호는 Xcode Cloud 가 `CI_BUILD_NUMBER` 로 준다. 로컬 fastlane 은
#    `latest_testflight_build_number + 1` 을 쓰는데, **두 경로가 같은 번호를 쓰면 업로드가 거부된다.**
#    워크플로에서 시작 번호를 로컬 최신(현재 189)보다 크게 잡아 둘 것.
set -e

echo "▶ ci_pre_xcodebuild 시작"
cd "$CI_PRIMARY_REPOSITORY_PATH"

APP_VERSION=$(node -e "console.log(require('./app.json').expo.version)")
echo "  app.json version = $APP_VERSION"
echo "  CI_BUILD_NUMBER  = ${CI_BUILD_NUMBER:-(없음)}"

# ── 마케팅 버전 3곳 동기화 ──────────────────────────────────────────────────
sed -i '' "s|MARKETING_VERSION = [0-9.]*;|MARKETING_VERSION = ${APP_VERSION};|g" \
  ios/SyncLink.xcodeproj/project.pbxproj
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${APP_VERSION}" ios/SyncLink/Info.plist
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${APP_VERSION}" targets/widget/Info.plist 2>/dev/null || true

# ── 빌드 번호 ───────────────────────────────────────────────────────────────
if [ -n "$CI_BUILD_NUMBER" ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${CI_BUILD_NUMBER}" ios/SyncLink/Info.plist
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${CI_BUILD_NUMBER}" targets/widget/Info.plist 2>/dev/null || true
  echo "  빌드 번호 → ${CI_BUILD_NUMBER}"
fi

# ── 검증: 세 곳이 실제로 같은지 ─────────────────────────────────────────────
XCODE_V=$(grep 'MARKETING_VERSION' ios/SyncLink.xcodeproj/project.pbxproj | head -1 | sed 's/.*= //;s/;//;s/[[:space:]]//g')
PLIST_V=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" ios/SyncLink/Info.plist)
if [ "$APP_VERSION" != "$XCODE_V" ] || [ "$APP_VERSION" != "$PLIST_V" ]; then
  echo "  ❌ 버전 불일치 — app=$APP_VERSION xcode=$XCODE_V plist=$PLIST_V"
  exit 1
fi
echo "  ✅ 버전 일치: $APP_VERSION"

# ── OTA 런타임 확인 ─────────────────────────────────────────────────────────
# 🔴 로컬에서 이 값이 **1.4.2 로 굳어 있던 사고**가 있었다(Fastfile 이 동기화를 안 해서).
#    prebuild 는 app.json 의 runtimeVersion 정책대로 넣으므로 맞아야 정상이다.
EXPO_PLIST="ios/SyncLink/Supporting/Expo.plist"
if [ -f "$EXPO_PLIST" ]; then
  RUNTIME=$(/usr/libexec/PlistBuddy -c "Print :EXUpdatesRuntimeVersion" "$EXPO_PLIST" 2>/dev/null || echo "(없음)")
  echo "  OTA 런타임 = $RUNTIME (app.json 정책 기준 $APP_VERSION 이어야 한다)"
  if [ "$RUNTIME" != "$APP_VERSION" ]; then
    echo "  ⚠️ OTA 런타임이 버전과 다르다 — OTA 업데이트가 이 빌드에 닿지 않을 수 있다"
  fi
fi

echo "✅ ci_pre_xcodebuild 완료"
