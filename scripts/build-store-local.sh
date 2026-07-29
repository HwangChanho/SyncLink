#!/usr/bin/env bash
# build-store-local.sh
# 스토어 제출용 산출물(Android aab / iOS ipa)을 EAS 클라우드 대신 **로컬**에서 빌드한다.
# EAS Free 크레딧을 쓰지 않는 기본 경로 (2026-07-29 LEAD 결정).
#
# 사용:
#   ./scripts/build-store-local.sh android          # aab
#   ./scripts/build-store-local.sh ios              # ipa
#   ./scripts/build-store-local.sh both             # 순차 (동시 실행 금지 — 메모리)
#   ./scripts/build-store-local.sh android --skip-checks   # 사전점검 생략
#
# 산출물: build/synclink-<platform>-<version>-<build>.{aab,ipa}
#
# ⚠️ preview/기기설치용 빌드는 이 스크립트가 아니라 release-android.sh(EAS preview APK) 또는
#    release-android-local.sh(expo run:android) 를 쓴다. 여기는 **스토어 제출본 전용**.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

PLATFORM="${1:-}"
shift || true
SKIP_CHECKS=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-checks) SKIP_CHECKS=true; shift ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

if [[ "$PLATFORM" != "android" && "$PLATFORM" != "ios" && "$PLATFORM" != "both" ]]; then
  echo "사용법: $0 <android|ios|both> [--skip-checks]"
  exit 1
fi

# npm 캐시 EACCES 회피 — 로컬 npm 캐시가 권한 문제로 깨져 있어 별도 경로를 쓴다.
export npm_config_cache="${npm_config_cache:-/private/tmp/npmcache_sdk54}"

# ---------------------------------------------------------------------------
# 사전 점검: 이 기기(16GB M2)에서 로컬 빌드가 죽는 원인 3가지를 미리 잡는다.
# ---------------------------------------------------------------------------
preflight() {
  echo "── 사전 점검 ──"

  # 1) 형제 프로젝트 빌드와 동시 실행 = OOM. 유휴 Gradle/Kotlin 데몬은 무해하므로
  #    "활성 빌드 툴"만 본다.
  local busy
  busy=$(pgrep -fl "xcodebuild|eas-cli-local-build" 2>/dev/null | grep -v "$$" || true)
  if [[ -n "$busy" ]]; then
    echo "[WARN] 다른 빌드가 실행 중입니다 (형제 프로젝트일 수 있음):"
    echo "$busy" | head -3
    echo "       동시 실행하면 양쪽 다 OOM 으로 죽습니다. 끝난 뒤 다시 실행하세요."
    exit 1
  fi

  # 2) 메모리: 07-21·07-29 실적상 free+inactive 4GB 이상이면 성공, 90MB 수준이면 NDK 컴파일서 kill.
  local free_gb
  free_gb=$(vm_stat | awk '/page size of/{ps=$8} /Pages free/{f=$3} /Pages inactive/{i=$3} END{gsub("\\.","",f); gsub("\\.","",i); printf "%.1f", (f+i)*ps/1024/1024/1024}')
  echo "  메모리 여유(free+inactive): ${free_gb} GB"
  if (( $(echo "$free_gb < 3.5" | bc -l) )); then
    echo "[WARN] 메모리가 부족합니다. Chrome·Notion·타 프로젝트 dev 서버를 닫고 다시 실행하세요."
    exit 1
  fi

  # 3) 디스크: iOS 는 DerivedData 로 수십 GB 를 먹는다.
  local free_disk
  free_disk=$(df -g / | awk 'NR==2{print $4}')
  echo "  디스크 여유: ${free_disk} GB"
  if [[ "$free_disk" -lt 20 ]]; then
    echo "[WARN] 디스크 여유가 20GB 미만입니다. DerivedData/미사용 시뮬 런타임을 정리하세요."
    exit 1
  fi
  echo "── 점검 통과 ──"
}

$SKIP_CHECKS || preflight

VERSION=$(node -p "require('./app.json').expo.version")
mkdir -p build

build_android() {
  # 🔴 JAVA_HOME 이 없으면 기본 java 가 OpenJDK 26 으로 잡혀
  #    "Error resolving plugin [com.facebook.react.settings] > 26" 로 2초 만에 죽는다.
  #    RN Gradle 플러그인이 읽을 수 있는 건 Android Studio 번들 JBR(JDK 21).
  export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
  export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
  export PATH="$JAVA_HOME/bin:$PATH"

  local vc out
  vc=$(node -p "require('./app.json').expo.android.versionCode")
  out="build/synclink-android-${VERSION}-vc${vc}.aab"

  echo "▶ Android 로컬 빌드 (vc ${vc})"
  echo "  JAVA_HOME=$JAVA_HOME"
  java -version 2>&1 | head -1
  npx -y eas-cli@latest build --local -p android --profile production --non-interactive --output="$PROJECT_ROOT/$out"
  echo "✅ $out ($(du -h "$out" | cut -f1))"
}

build_ios() {
  local bn out
  bn=$(node -p "require('./app.json').expo.ios.buildNumber")
  out="build/synclink-ios-${VERSION}-${bn}.ipa"

  echo "▶ iOS 로컬 빌드 (build ${bn})"
  # archive 가 exit 70 으로 죽으면 iOS 플랫폼 미설치 → `xcodebuild -downloadPlatform iOS`.
  # CodeSign "no identity found" 는 형제 EAS 빌드가 login.keychain 을 축출한 것 → Fastfile 의
  # --keychain 고정(93fff06) 확인. 상세는 메모리 reference_codesign_keychain_eas_race.
  npx -y eas-cli@latest build --local -p ios --profile production --non-interactive --output="$PROJECT_ROOT/$out"
  echo "✅ $out ($(du -h "$out" | cut -f1))"
}

case "$PLATFORM" in
  android) build_android ;;
  ios)     build_ios ;;
  both)    build_android; echo; build_ios ;;  # 순차 — 동시 실행은 메모리상 불가
esac

echo
echo "다음 단계: eas submit -p <platform> --path <위 산출물>"
