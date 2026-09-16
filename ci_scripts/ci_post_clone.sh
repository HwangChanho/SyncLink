#!/bin/sh
#
# ci_post_clone — Xcode Cloud 가 repo 를 클론한 **직후** 실행된다.
#
# 왜 필요한가:
#   이 repo 는 `ios/` 를 .gitignore 한다(커밋된 건 Info.plist·ExportOptions.plist·스플래시 이미지 6개뿐).
#   즉 **클론 직후에는 Xcode 프로젝트가 없다.** 여기서 `expo prebuild` 로 만들어야 빌드가 가능하다.
#   우리 커스텀 플러그인(위젯 App Group 브릿지 · UIScene · 배포 타겟 하한)도 이 단계에서 주입된다.
#
# 🔴 로컬 빌드(fastlane beta)와 다른 점:
#   로컬은 이미 있는 `ios/` 를 그대로 쓰지만, 여기서는 **매번 새로 생성**된다.
#   그래서 "로컬 생성물 ≠ CI 생성물" 드리프트가 생길 수 있다 — 산출물로 검증할 것.
#
# ⚠️ `prebuild --clean` 은 쓰지 않는다: 커밋해 둔 `ios/ExportOptions.plist` 를 지운다(전례 있음).
#
# Xcode Cloud 환경변수: https://developer.apple.com/documentation/xcode/environment-variable-reference
set -e

echo "▶ ci_post_clone 시작"
echo "  CI_WORKSPACE           = ${CI_WORKSPACE:-(없음)}"
echo "  CI_PRIMARY_REPOSITORY_PATH = ${CI_PRIMARY_REPOSITORY_PATH:-(없음)}"
echo "  CI_BUILD_NUMBER        = ${CI_BUILD_NUMBER:-(없음)}"
echo "  CI_XCODE_SCHEME        = ${CI_XCODE_SCHEME:-(없음)}"

cd "$CI_PRIMARY_REPOSITORY_PATH"

# ── 1) Node — Xcode Cloud 이미지에는 Node 가 없다 ────────────────────────────
if ! command -v node > /dev/null 2>&1; then
  echo "▶ Node 설치(brew)"
  brew install node
fi
echo "  node $(node -v) · npm $(npm -v)"

# ── 2) 의존성 ───────────────────────────────────────────────────────────────
# package-lock.json 이 커밋돼 있으므로 ci 로 잠금 상태 그대로 받는다.
# 🔴 `npm install` 이 아니라 `npm ci` — lock 과 어긋나면 로컬과 다른 빌드가 된다.
echo "▶ npm ci"
npm ci

# ── 3) prebuild — Xcode 프로젝트 생성 ────────────────────────────────────────
# --no-install: CocoaPods 는 아래에서 따로 돌린다(실패 원인을 분리해 로그에서 보이게).
echo "▶ expo prebuild (ios)"
npx expo prebuild --platform ios --no-install

# ── 4) CocoaPods ────────────────────────────────────────────────────────────
if ! command -v pod > /dev/null 2>&1; then
  echo "▶ CocoaPods 설치"
  brew install cocoapods
fi
echo "▶ pod install"
cd ios && pod install && cd ..

# ── 5) 검증 — 플러그인이 실제로 먹었는지 산출물로 본다 ──────────────────────
# 🔑 "돌렸다"가 아니라 "됐다"를 확인한다. 하나라도 어긋나면 여기서 멈추는 편이
#    20분 뒤 아카이브에서 깨지는 것보다 싸다.
echo "▶ 검증"

PLIST="ios/SyncLink/Info.plist"
if /usr/libexec/PlistBuddy -c "Print :UIApplicationSceneManifest" "$PLIST" > /dev/null 2>&1; then
  echo "  ✅ UIApplicationSceneManifest 있음"
else
  echo "  ❌ UIApplicationSceneManifest 없음 — iOS 27 SDK 에서 실행 즉시 죽는다"
  exit 1
fi

if grep -q "class SceneDelegate" ios/SyncLink/AppDelegate.swift; then
  echo "  ✅ SceneDelegate 주입됨"
else
  echo "  ❌ SceneDelegate 없음 (withIosUIScene plugin 미동작)"
  exit 1
fi

LOW=$(grep -oE "IPHONEOS_DEPLOYMENT_TARGET = [0-9.]+" ios/Pods/Pods.xcodeproj/project.pbxproj \
      | awk '{print $3}' | awk '$1+0 < 15.0' | wc -l | tr -d ' ')
if [ "$LOW" -eq 0 ]; then
  echo "  ✅ 배포 타겟 15.0 미만 0건"
else
  echo "  ❌ 배포 타겟 15.0 미만 ${LOW}건 — Xcode 27 이 거부한다"
  exit 1
fi

echo "✅ ci_post_clone 완료"
