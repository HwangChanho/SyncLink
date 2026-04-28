#!/usr/bin/env bash
# =============================================================================
# bin/qa-full.sh — SyncDay 5-환경 회귀 자동화 스크립트
#
# 사용:
#   ./bin/qa-full.sh <environment>
#   environment: ios-sim | android-sim | android-device | web | all
#
# 예시:
#   ./bin/qa-full.sh ios-sim
#   ./bin/qa-full.sh all
#
# 출력:
#   - 콘솔에 실시간 결과 매트릭스
#   - docs/handoffs/sprint-N/qa/{env}-latest.md 자동 갱신
#
# 전제 조건:
#   - Maestro 설치: brew install maestro
#   - Android SDK PATH 설정 (android-sim / android-device)
#   - Node.js + Playwright 설치 (web)
#   - .env 파일에 TEST_EMAIL / TEST_PASSWORD 설정 (선택)
# =============================================================================

set -euo pipefail

# ─── 경로 설정 ────────────────────────────────────────────────────────────────
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLOWS_DIR="$PROJECT_ROOT/e2e/flows"
REPORT_BASE="$PROJECT_ROOT/docs/handoffs"

# ─── Android SDK PATH 주입 ─────────────────────────────────────────────────────
export PATH="${HOME}/Library/Android/sdk/platform-tools:/opt/homebrew/bin:$PATH"

# ─── 환경별 설정 ──────────────────────────────────────────────────────────────

# iOS Simulator: iPhone 16 non-Pro
IOS_SIM_UDID="5AA67030-E13E-45DA-B4B5-9B45CBC0AFE5"
IOS_SIM_EMAIL="${TEST_EMAIL:-e2e-ios-sim-pro@synclink.test}"
IOS_SIM_PASSWORD="${TEST_PASSWORD:-e2etest1234}"

# Android Emulator: Pixel_6 (emulator-5554)
ANDROID_SIM_SERIAL="emulator-5554"
ANDROID_SIM_EMAIL="${TEST_EMAIL:-e2e-android-sim-pro@synclink.test}"
ANDROID_SIM_PASSWORD="${TEST_PASSWORD:-e2etest1234}"

# Android Real Device: Galaxy Note 8 (Android 9)
ANDROID_DEV_SERIAL="ce071717b880b4730c7e"
ANDROID_DEV_EMAIL="${TEST_EMAIL:-e2e-android-dev-pro@synclink.test}"
ANDROID_DEV_PASSWORD="${TEST_PASSWORD:-e2etest1234}"

# ─── 스프린트 번호 자동 감지 ──────────────────────────────────────────────────
# handoffs 폴더에서 가장 최신 sprint-N 폴더를 감지
LATEST_SPRINT=$(ls -d "$REPORT_BASE"/sprint-* 2>/dev/null | sort -V | tail -1 | xargs basename)
if [[ -z "$LATEST_SPRINT" ]]; then
  LATEST_SPRINT="sprint-30"
fi
QA_DIR="$REPORT_BASE/$LATEST_SPRINT/qa"
mkdir -p "$QA_DIR"

# ─── Maestro flow 목록 (순서 고정) ────────────────────────────────────────────
# 시뮬/실기기 공통 flow (web 제외)
NATIVE_FLOWS=(
  "00_launch.yaml"
  "01_login_dev.yaml"
  "02_tab_navigation.yaml"
  "03_event_create.yaml"
  "04_planner_todo.yaml"
  "05_golden_path.yaml"
)

# Android 실기기 전용 flow (dev login 버튼 없으므로 smoke만)
DEVICE_FLOWS=(
  "20_real_device_smoke.yaml"
)

# ─── 색상 코드 ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# =============================================================================
# 함수: Maestro 단일 flow 실행 후 PASS/FAIL 반환
#
# 인자:
#   $1 = maestro 추가 옵션 (예: "--device <UDID>")
#   $2 = flow 파일 경로
#   $3 = TEST_EMAIL
#   $4 = TEST_PASSWORD
#
# 반환:
#   0 = PASS, 1 = FAIL
# =============================================================================
run_flow() {
  local maestro_opts="$1"
  local flow_file="$2"
  local email="$3"
  local password="$4"
  local flow_name
  flow_name=$(basename "$flow_file")

  # maestro 실행 (stdout/stderr를 임시 파일로 캡처)
  local tmp_log
  tmp_log=$(mktemp)

  if TEST_EMAIL="$email" TEST_PASSWORD="$password" \
     maestro $maestro_opts test "$flow_file" \
     > "$tmp_log" 2>&1; then
    echo -e "  ${GREEN}PASS${NC}  $flow_name"
    rm -f "$tmp_log"
    return 0
  else
    local last_err
    last_err=$(grep -E "(FAILED|Error|Exception)" "$tmp_log" | tail -2 | tr '\n' ' ' || true)
    echo -e "  ${RED}FAIL${NC}  $flow_name — ${last_err}"
    rm -f "$tmp_log"
    return 1
  fi
}

# =============================================================================
# 함수: 환경 결과를 마크다운 파일로 저장
#
# 인자:
#   $1 = 환경 이름 (예: ios-sim)
#   $2 = 총 flow 수
#   $3 = PASS 수
#   $4 = FAIL 수
#   $5 = SKIP 수
#   $6 = 결과 매트릭스 문자열 (newline-separated "PASS|FAIL flowname reason")
# =============================================================================
write_report() {
  local env_name="$1"
  local total="$2"
  local passed="$3"
  local failed="$4"
  local skipped="$5"
  local matrix="$6"
  local report_file="$QA_DIR/${env_name}-latest.md"
  local run_time
  run_time=$(date '+%Y-%m-%d %H:%M:%S KST')

  # 판정 계산: failed > 0 이면 FAIL, skipped > 0 이면 PARTIAL, 전부 pass면 PASS
  local verdict="PASS"
  if [[ "$failed" -gt 0 ]]; then
    verdict="FAIL"
  elif [[ "$skipped" -gt 0 ]]; then
    verdict="PARTIAL"
  fi

  cat > "$report_file" <<EOF
# QA 회귀 결과 — ${env_name} / ${LATEST_SPRINT}

**실행 시각**: ${run_time}
**스프린트**: ${LATEST_SPRINT}
**판정**: ${verdict}

---

## 결과 요약

| 구분 | 수 |
|------|----|
| 전체 | ${total} |
| PASS | ${passed} |
| FAIL | ${failed} |
| SKIP | ${skipped} |

---

## Flow 별 결과

| 상태 | Flow |
|------|------|
${matrix}

---

*자동 생성: bin/qa-full.sh*
EOF

  echo ""
  echo -e "  리포트 저장: ${report_file}"
}

# =============================================================================
# 함수: iOS Simulator 회귀 실행
# =============================================================================
run_ios_sim() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  [ios-sim] iPhone 16 non-Pro 회귀"
  echo "  UDID: $IOS_SIM_UDID"
  echo "  EMAIL: $IOS_SIM_EMAIL"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # 시뮬레이터 부팅 확인
  local sim_state
  sim_state=$(xcrun simctl list devices booted 2>/dev/null | grep "$IOS_SIM_UDID" || true)
  if [[ -z "$sim_state" ]]; then
    echo -e "  ${YELLOW}WARN${NC}  시뮬레이터 미부팅 — 부팅 시도"
    xcrun simctl boot "$IOS_SIM_UDID" 2>/dev/null || true
    sleep 5
  fi

  local pass=0 fail=0 skip=0
  local matrix=""

  for flow in "${NATIVE_FLOWS[@]}"; do
    local flow_path="$FLOWS_DIR/$flow"
    if [[ ! -f "$flow_path" ]]; then
      echo -e "  ${YELLOW}SKIP${NC}  $flow (파일 없음)"
      matrix+="| SKIP | $flow |\n"
      ((skip++)) || true
      continue
    fi

    if run_flow "--device $IOS_SIM_UDID" "$flow_path" "$IOS_SIM_EMAIL" "$IOS_SIM_PASSWORD"; then
      matrix+="| PASS | $flow |\n"
      ((pass++)) || true
    else
      matrix+="| FAIL | $flow |\n"
      ((fail++)) || true
    fi
  done

  local total=$(( pass + fail + skip ))
  echo ""
  echo "  결과: ${pass} PASS / ${fail} FAIL / ${skip} SKIP (총 ${total})"
  write_report "ios-sim" "$total" "$pass" "$fail" "$skip" "$(printf "%b" "$matrix")"
}

# =============================================================================
# 함수: Android Emulator 회귀 실행
# =============================================================================
run_android_sim() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  [android-sim] Pixel_6 에뮬레이터 회귀"
  echo "  SERIAL: $ANDROID_SIM_SERIAL"
  echo "  EMAIL: $ANDROID_SIM_EMAIL"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # 에뮬레이터 연결 확인
  local emu_state
  emu_state=$(adb -s "$ANDROID_SIM_SERIAL" get-state 2>/dev/null || true)
  if [[ "$emu_state" != "device" ]]; then
    echo -e "  ${YELLOW}WARN${NC}  에뮬레이터 미연결 ($ANDROID_SIM_SERIAL). 계속 시도"
  fi

  local pass=0 fail=0 skip=0
  local matrix=""

  for flow in "${NATIVE_FLOWS[@]}"; do
    local flow_path="$FLOWS_DIR/$flow"
    if [[ ! -f "$flow_path" ]]; then
      echo -e "  ${YELLOW}SKIP${NC}  $flow (파일 없음)"
      matrix+="| SKIP | $flow |\n"
      ((skip++)) || true
      continue
    fi

    if run_flow "--device $ANDROID_SIM_SERIAL" "$flow_path" "$ANDROID_SIM_EMAIL" "$ANDROID_SIM_PASSWORD"; then
      matrix+="| PASS | $flow |\n"
      ((pass++)) || true
    else
      matrix+="| FAIL | $flow |\n"
      ((fail++)) || true
    fi
  done

  local total=$(( pass + fail + skip ))
  echo ""
  echo "  결과: ${pass} PASS / ${fail} FAIL / ${skip} SKIP (총 ${total})"
  write_report "android-sim" "$total" "$pass" "$fail" "$skip" "$(printf "%b" "$matrix")"
}

# =============================================================================
# 함수: Android 실기기 (Galaxy Note 8 / Android 9) 회귀 실행
#
# 주의:
#   - dadb tcp:7001 문제로 실행 실패 가능 (android-device-diagnosis.md 참조)
#   - Dev 로그인 버튼 없어 20_real_device_smoke.yaml 사용
# =============================================================================
run_android_device() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  [android-device] Galaxy Note 8 (Android 9) 회귀"
  echo "  SERIAL: $ANDROID_DEV_SERIAL"
  echo "  EMAIL: $ANDROID_DEV_EMAIL"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  ${YELLOW}WARN${NC}  dadb tcp:7001 문제 진단 중 — android-device-diagnosis.md 참조"

  # adb 연결 확인
  local dev_state
  dev_state=$(adb -s "$ANDROID_DEV_SERIAL" get-state 2>/dev/null || echo "offline")
  if [[ "$dev_state" != "device" ]]; then
    echo -e "  ${RED}FAIL${NC}  기기 미연결 또는 offline (상태: $dev_state)"
    write_report "android-device" "0" "0" "0" "0" "| SKIP | (기기 미연결) |"
    return
  fi

  # dadb 포트 역방향 포워딩 시도
  echo "  dadb 포트 포워딩 시도 (tcp:7001)..."
  adb -s "$ANDROID_DEV_SERIAL" reverse tcp:7001 tcp:7001 2>/dev/null || \
    echo -e "  ${YELLOW}WARN${NC}  reverse 포워딩 실패 (계속 진행)"

  local pass=0 fail=0 skip=0
  local matrix=""

  for flow in "${DEVICE_FLOWS[@]}"; do
    local flow_path="$FLOWS_DIR/$flow"
    if [[ ! -f "$flow_path" ]]; then
      echo -e "  ${YELLOW}SKIP${NC}  $flow (파일 없음)"
      matrix+="| SKIP | $flow |\n"
      ((skip++)) || true
      continue
    fi

    if run_flow "--device $ANDROID_DEV_SERIAL" "$flow_path" "$ANDROID_DEV_EMAIL" "$ANDROID_DEV_PASSWORD"; then
      matrix+="| PASS | $flow |\n"
      ((pass++)) || true
    else
      matrix+="| FAIL | $flow |\n"
      ((fail++)) || true
    fi
  done

  local total=$(( pass + fail + skip ))
  echo ""
  echo "  결과: ${pass} PASS / ${fail} FAIL / ${skip} SKIP (총 ${total})"
  write_report "android-device" "$total" "$pass" "$fail" "$skip" "$(printf "%b" "$matrix")"
}

# =============================================================================
# 함수: Web 회귀 실행 (Playwright)
# =============================================================================
run_web() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  [web] Playwright (HEADLESS=1) 회귀"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local pass=0 fail=0 skip=0
  local matrix=""

  # web dev 서버 확인
  if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:8081 2>/dev/null | grep -q "200"; then
    echo -e "  ${YELLOW}WARN${NC}  http://localhost:8081 미응답 — web-test 결과 부정확할 수 있음"
  fi

  # web-test.mjs 실행
  local web_test="$PROJECT_ROOT/web-test.mjs"
  if [[ ! -f "$web_test" ]]; then
    echo -e "  ${YELLOW}SKIP${NC}  web-test.mjs 없음"
    matrix+="| SKIP | web-test.mjs |\n"
    ((skip++)) || true
  else
    local tmp_log
    tmp_log=$(mktemp)
    if HEADLESS=1 node "$web_test" > "$tmp_log" 2>&1; then
      echo -e "  ${GREEN}PASS${NC}  web-test.mjs"
      matrix+="| PASS | web-test.mjs |\n"
      ((pass++)) || true
    else
      local err
      err=$(grep -E "(FAIL|Error)" "$tmp_log" | head -3 | tr '\n' ' ' || true)
      echo -e "  ${RED}FAIL${NC}  web-test.mjs — $err"
      matrix+="| FAIL | web-test.mjs |\n"
      ((fail++)) || true
    fi
    rm -f "$tmp_log"
  fi

  # web-group-event-test.mjs 실행
  local group_test="$PROJECT_ROOT/web-group-event-test.mjs"
  if [[ ! -f "$group_test" ]]; then
    echo -e "  ${YELLOW}SKIP${NC}  web-group-event-test.mjs 없음"
    matrix+="| SKIP | web-group-event-test.mjs |\n"
    ((skip++)) || true
  else
    local tmp_log2
    tmp_log2=$(mktemp)
    if HEADLESS=1 node "$group_test" > "$tmp_log2" 2>&1; then
      echo -e "  ${GREEN}PASS${NC}  web-group-event-test.mjs"
      matrix+="| PASS | web-group-event-test.mjs |\n"
      ((pass++)) || true
    else
      local err2
      err2=$(grep -E "(FAIL|Error)" "$tmp_log2" | head -3 | tr '\n' ' ' || true)
      echo -e "  ${RED}FAIL${NC}  web-group-event-test.mjs — $err2"
      matrix+="| FAIL | web-group-event-test.mjs |\n"
      ((fail++)) || true
    fi
    rm -f "$tmp_log2"
  fi

  local total=$(( pass + fail + skip ))
  echo ""
  echo "  결과: ${pass} PASS / ${fail} FAIL / ${skip} SKIP (총 ${total})"
  write_report "web" "$total" "$pass" "$fail" "$skip" "$(printf "%b" "$matrix")"
}

# =============================================================================
# 메인 실행 로직
# =============================================================================
ENV="${1:-}"

if [[ -z "$ENV" ]]; then
  echo "사용법: $0 <environment>"
  echo "  environment: ios-sim | android-sim | android-device | web | all"
  exit 1
fi

START_TIME=$(date '+%Y-%m-%d %H:%M:%S')
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SyncDay QA Full Regression"
echo "  환경: $ENV | 스프린트: $LATEST_SPRINT"
echo "  시작: $START_TIME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

case "$ENV" in
  ios-sim)
    run_ios_sim
    ;;
  android-sim)
    run_android_sim
    ;;
  android-device)
    run_android_device
    ;;
  web)
    run_web
    ;;
  all)
    run_ios_sim
    run_android_sim
    run_android_device
    run_web
    ;;
  *)
    echo "알 수 없는 환경: $ENV"
    echo "사용 가능: ios-sim | android-sim | android-device | web | all"
    exit 1
    ;;
esac

END_TIME=$(date '+%Y-%m-%d %H:%M:%S')
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  완료: $END_TIME"
echo "  리포트: $QA_DIR/"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
