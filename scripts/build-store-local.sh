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
# npm 전역 캐시(~/.npm)에 root 소유 파일이 섞여 있어 `npx` 가 EACCES 로 죽는다.
# sudo chown 없이 우회하려고 프로젝트 전용 캐시를 쓴다(빌드 산출물에는 영향 없음).
# `npm run` 이 npm_config_cache 를 ~/.npm 으로 주입하므로 :- 기본값은 안 먹는다 → 무조건 덮어쓴다.
export npm_config_cache="/private/tmp/npmcache_synclink"
cd "$PROJECT_ROOT"

PLATFORM="${1:-}"
shift || true
SKIP_CHECKS=false
# --check-only: 사전점검·드리프트 점검만 돌리고 빌드는 하지 않는다.
# 릴리스 직전 "지금 빌드하면 제대로 나가는가"를 30초에 확인하는 용도.
CHECK_ONLY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-checks) SKIP_CHECKS=true; shift ;;
    --check-only)  CHECK_ONLY=true;  shift ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

if [[ "$PLATFORM" != "android" && "$PLATFORM" != "ios" && "$PLATFORM" != "both" ]]; then
  echo "사용법: $0 <android|ios|both> [--skip-checks] [--check-only]"
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

  # 4) 부팅된 iOS 시뮬레이터. CLAUDE.md 가 금지하는 조합인데 1) 의 pgrep 은
  #    xcodebuild 만 봐서 "떠 있기만 한 시뮬레이터"를 놓친다.
  #    08-10 vc19 빌드가 이것 때문에 죽었다(형제 프로젝트 SyncFortune 이 SF-repro 에서 실행 중).
  local booted
  booted=$(xcrun simctl list devices booted 2>/dev/null | sed -n 's/^ *\(.*(Booted)\)/\1/p' || true)
  if [[ -n "$booted" ]]; then
    echo "[WARN] iOS 시뮬레이터가 부팅돼 있습니다:"
    echo "$booted" | sed 's/^/         /'
    echo "       Android 로컬 빌드와 동시 실행하면 NDK 컴파일 단계에서 죽습니다."
    echo "       종료: xcrun simctl shutdown all && osascript -e 'quit app \"Simulator\"'"
    echo "       ⚠️ 형제 프로젝트의 재현용 시뮬레이터일 수 있으니 끄기 전에 확인하세요."
    exit 1
  fi

  # 5) 스왑. free+inactive 만으로는 압력을 못 읽어서 같이 본다.
  #
  #    ⚠️ 임계값 주의: 08-10 실패 시점이 잔여 688MB 였지만, 시뮬레이터를 끈 직후에도
  #    800MB 였다(macOS 는 스왑을 지연 회수한다) — 즉 **스왑 잔여는 후행 지표**이고
  #    그날의 실제 원인은 시뮬레이터 경쟁이었다. 1GB 로 막으면 멀쩡한 빌드까지 세운다.
  #    그래서 진짜 고갈(512MB)에서만 중단하고, 그 위는 참고용으로 출력만 한다.
  local swap_free
  swap_free=$(sysctl -n vm.swapusage 2>/dev/null | sed -n 's/.*free = \([0-9.]*\)M.*/\1/p')
  if [[ -n "$swap_free" ]]; then
    echo "  스왑 여유: ${swap_free} MB"
    if (( $(echo "$swap_free < 512" | bc -l) )); then
      echo "[WARN] 스왑이 고갈됐습니다. 메모리 수치가 좋아 보여도 NDK 컴파일에서 죽습니다."
      echo "       무거운 앱(시뮬레이터·Chrome·타 프로젝트 dev 서버)을 닫고 다시 실행하세요."
      exit 1
    fi
  fi

  echo "── 점검 통과 ──"
}

# ---------------------------------------------------------------------------
# 설정 드리프트 점검: app.json 에 선언한 네이티브 설정이 실제 android/ · ios/ 에
# 반영돼 있는지 확인한다.
#
# 왜 필요한가 (2026-08-10 실제 사고):
#   07-23 에 Play 2026-08 정책 대응으로 app.json 의 targetSdkVersion 을 36 으로
#   올렸는데, android/ 가 06-22 생성분 그대로여서 gradle.properties 는 35 였다.
#   양쪽 다 gitignore 라 diff 에도 안 잡히고, 빌드는 조용히 성공한다.
#   → vc18 이 정책 미달인 35 로 스토어에 나갔다. 8/31 이후엔 업데이트가 막힌다.
#   같은 원인으로 08-09 에 ios/ 가 SDK54 이전 상태라 아카이브가 깨진 적도 있다.
#
# 조용히 잘못 나가는 것보다 빌드를 세우는 게 낫다 → 불일치는 경고가 아니라 중단.
# 급할 때는 --skip-checks 로 건너뛸 수 있다.
# ---------------------------------------------------------------------------
config_drift() {
  echo "── 설정 드리프트 점검 ──"
  local drift=0

  if [[ "$PLATFORM" == "android" || "$PLATFORM" == "both" ]]; then
    if [[ ! -f android/gradle.properties ]]; then
      echo "  android/ 없음 — 빌드 시 생성됨 (점검 생략)"
    else
      # app.json 이 선언한 SDK 레벨 vs gradle.properties 에 실제 기록된 값
      local mismatch
      mismatch=$(node -e "
        const want = (require('./app.json').expo.plugins || [])
          .find(p => Array.isArray(p) && p[0] === 'expo-build-properties');
        const a = (want && want[1] && want[1].android) || {};
        const props = require('fs').readFileSync('android/gradle.properties', 'utf8');
        const got = k => (props.match(new RegExp('^android\\\\.' + k + '=(.+)\$', 'm')) || [])[1];
        for (const k of ['targetSdkVersion', 'compileSdkVersion', 'minSdkVersion']) {
          if (a[k] != null && String(a[k]) !== String(got(k) ?? '')) {
            console.log(k + ': app.json=' + a[k] + ' → android/gradle.properties=' + (got(k) ?? '(없음)'));
          }
        }
      " 2>/dev/null)
      if [[ -n "$mismatch" ]]; then
        echo "[FAIL] app.json 의 Android SDK 설정이 android/ 에 반영되지 않았습니다:"
        echo "$mismatch" | sed 's/^/         /'
        drift=1
      fi

      # app.json 의 위젯 이름마다 provider 클래스가 생성돼야 한다. 빠지면 그 위젯은
      # 갤러리에 아예 안 뜬다(빌드는 성공하므로 스토어 나간 뒤에야 발견된다).
      local missing_widgets
      missing_widgets=$(node -e "
        const p = (require('./app.json').expo.plugins || [])
          .find(x => Array.isArray(x) && x[0] === 'react-native-android-widget');
        const names = ((p && p[1] && p[1].widgets) || []).map(w => w.name);
        const fs = require('fs');
        for (const n of names) {
          if (!fs.existsSync('android/app/src/main/java/io/synclink/app/widget/' + n + '.java')) console.log(n);
        }
      " 2>/dev/null)
      if [[ -n "$missing_widgets" ]]; then
        echo "[FAIL] app.json 에 선언된 위젯의 provider 클래스가 없습니다: $(echo "$missing_widgets" | tr '\n' ' ')"
        drift=1
      fi
    fi
  fi

  if [[ "$PLATFORM" == "ios" || "$PLATFORM" == "both" ]]; then
    if [[ ! -f ios/Podfile.properties.json ]]; then
      echo "  ios/ 없음 — 빌드 시 생성됨 (점검 생략)"
    else
      # newArch 불일치가 08-09 아카이브 실패(yoga 헤더 누락)의 원인이었다.
      local ios_mismatch
      ios_mismatch=$(node -e "
        const expo = require('./app.json').expo;
        const bp = (expo.plugins || []).find(p => Array.isArray(p) && p[0] === 'expo-build-properties');
        const want = (bp && bp[1] && bp[1].ios) || {};
        const got = require('./ios/Podfile.properties.json');
        // Expo 기본값은 newArch 활성 — app.json 에 없으면 true 로 간주한다.
        const wantNewArch = String(expo.newArchEnabled ?? true);
        if (String(got.newArchEnabled ?? '') !== wantNewArch) {
          console.log('newArchEnabled: app.json=' + wantNewArch + ' → ios/Podfile.properties.json=' + (got.newArchEnabled ?? '(없음)'));
        }
        if (want.deploymentTarget && String(got['ios.deploymentTarget'] ?? '') !== String(want.deploymentTarget)) {
          console.log('deploymentTarget: app.json=' + want.deploymentTarget + ' → ios/Podfile.properties.json=' + (got['ios.deploymentTarget'] ?? '(없음)'));
        }
      " 2>/dev/null)
      if [[ -n "$ios_mismatch" ]]; then
        echo "[FAIL] app.json 의 iOS 설정이 ios/ 에 반영되지 않았습니다:"
        echo "$ios_mismatch" | sed 's/^/         /'
        drift=1
      fi
    fi
  fi

  if [[ "$drift" -ne 0 ]]; then
    echo
    echo "  네이티브 디렉토리가 낡았습니다. 재생성 후 다시 빌드하세요:"
    [[ "$PLATFORM" == "ios" || "$PLATFORM" == "both" ]] \
      && echo "    npx expo prebuild -p ios --clean && git checkout ios/ExportOptions.plist" \
      || true
    [[ "$PLATFORM" == "android" || "$PLATFORM" == "both" ]] \
      && echo "    npx expo prebuild -p android --clean" \
      || true
    echo "  (ExportOptions.plist 는 --clean 이 지우므로 iOS 는 반드시 복원할 것)"
    exit 1
  fi
  echo "── 드리프트 없음 ──"
}

$SKIP_CHECKS || preflight
# 드리프트 점검은 --skip-checks 로도 건너뛰지 않는다.
# preflight 는 "지금 이 기기가 빌드할 수 있나"(일시적 사정)라 넘길 만하지만,
# 드리프트는 "나갈 산출물이 맞나"(정확성)라 넘기면 조용히 잘못된 걸 스토어에 올린다.
config_drift

if $CHECK_ONLY; then
  echo
  echo "✅ 점검만 수행했습니다 (--check-only). 빌드는 하지 않았습니다."
  exit 0
fi

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
