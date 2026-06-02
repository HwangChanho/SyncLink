#!/usr/bin/env bash
# sim-verify.sh — UI 변경 시뮬 캡처 검증 헬퍼.
#
# "수정했다고 했는데 화면엔 반영/표시 안 됨" 반복 방지용. 시뮬 부팅 → (옵션)
# 딥링크 진입 → 스크린샷 → (옵션) 요소 크롭 까지 한 번에. 결과 PNG 경로를 출력하면
# 그걸 Read 로 육안 확인한다.
#
# 사용법:
#   scripts/sim-verify.sh                         # 부팅된 시뮬 현재 화면 캡처
#   scripts/sim-verify.sh --route chat            # synclink://chat 진입 후 캡처
#   scripts/sim-verify.sh --route chat --crop "2360 920 200 280"
#                                                 # 크롭(top left h w)까지
#   scripts/sim-verify.sh --boot <UDID>           # 특정 시뮬 부팅부터
#
# 주의: 조건부 UI(Free 전용 등)는 올바른 계정 상태로 봐야 한다(체크리스트 §2).
#       상태를 임시 변경했다면 검증 후 반드시 복원.

set -euo pipefail

ROUTE=""
CROP=""
BOOT_UDID=""
OUT="/tmp/sim-verify-$(date +%H%M%S).png"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --route) ROUTE="$2"; shift 2 ;;
    --crop)  CROP="$2";  shift 2 ;;
    --boot)  BOOT_UDID="$2"; shift 2 ;;
    --out)   OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

# 0. 부팅 요청 시
if [[ -n "$BOOT_UDID" ]]; then
  echo "→ booting $BOOT_UDID"
  xcrun simctl boot "$BOOT_UDID" 2>/dev/null || true
  open -a Simulator
  sleep 4
fi

# 1. 부팅된 시뮬 확인
BOOTED=$(xcrun simctl list devices booted 2>/dev/null | grep -c Booted || true)
if [[ "$BOOTED" -eq 0 ]]; then
  echo "✗ 부팅된 시뮬레이터가 없습니다. --boot <UDID> 로 부팅하세요."
  echo "  사용 가능: $(xcrun simctl list devices available | grep -iE 'iPhone 1[5-7]' | head -1 | sed -E 's/.*\(([0-9A-F-]+)\).*/\1/')"
  exit 1
fi

# 2. 딥링크 진입 (좌표 탭보다 안정적)
if [[ -n "$ROUTE" ]]; then
  echo "→ openurl synclink://$ROUTE"
  xcrun simctl openurl booted "synclink://$ROUTE" || true
  sleep 5
fi

# 3. 캡처
xcrun simctl io booted screenshot "$OUT" >/dev/null 2>&1
echo "✓ screenshot: $OUT"

# 4. 크롭 (top left h w)
if [[ -n "$CROP" ]]; then
  read -r TOP LEFT H W <<< "$CROP"
  CROP_OUT="${OUT%.png}-crop.png"
  cp "$OUT" "$CROP_OUT"
  sips -c "$H" "$W" --cropOffset "$TOP" "$LEFT" "$CROP_OUT" >/dev/null 2>&1
  echo "✓ crop: $CROP_OUT  (Read 로 육안 확인)"
fi

echo ""
echo "다음: 위 PNG 를 Read 로 열어 의도한 요소가 실제로 보이는지 확인 (체크리스트 §2)."
