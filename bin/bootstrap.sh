#!/usr/bin/env bash
# SyncDay One-Shot Bootstrap
# 사용: `syncday` (alias) 또는 `bash bin/bootstrap.sh`
# 동작: 환경 점검 + 도구 PATH + 시뮬레이터 기동 + Metro 준비 + Claude Code 호환 상태 확인

set -e
PROJECT_ROOT="${HOME}/Desktop/Projects/syncday/syncday"
cd "$PROJECT_ROOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SyncDay Bootstrap (한 번에 시작)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. PATH 확인 (Android SDK + Homebrew)
export PATH="${HOME}/Library/Android/sdk/platform-tools:/opt/homebrew/bin:$PATH"
echo "[1/6] PATH 설정"

# 2. .env 상태 (회귀용 development인지 출시용 production인지 안내만)
ENV_VAL=$(grep -E "^EXPO_PUBLIC_APP_ENV=" .env 2>/dev/null | cut -d= -f2)
echo "[2/6] .env: EXPO_PUBLIC_APP_ENV=${ENV_VAL:-(없음)}"
if [ "$ENV_VAL" = "development" ]; then
  echo "      ⚠️  회귀 모드 (출시 빌드 전 production 원복 필요)"
fi

# 3. iOS 시뮬레이터 부팅 (이미 부팅됐으면 무시)
if xcrun simctl list devices booted 2>/dev/null | grep -q "iPhone 16 Pro"; then
  echo "[3/6] iOS 시뮬: iPhone 16 Pro 이미 부팅됨"
else
  xcrun simctl boot "iPhone 16 Pro" 2>/dev/null && echo "[3/6] iOS 시뮬: iPhone 16 Pro 부팅" || echo "[3/6] iOS 시뮬: 부팅 실패 (수동 확인 필요)"
fi

# 4. Android 디바이스/에뮬 상태
ANDROID_DEVICES=$(adb devices 2>/dev/null | tail -n +2 | grep -c "device$" || echo 0)
echo "[4/6] Android: ${ANDROID_DEVICES}대 연결됨 (실기/에뮬 합산)"
if [ "$ANDROID_DEVICES" -eq 0 ]; then
  echo "      💡 에뮬 부팅: emulator -avd <name> -no-snapshot &"
fi

# 5. Web dev 서버 (8081 포트)
if curl -s -o /dev/null -w "%{http_code}" http://localhost:8081 2>/dev/null | grep -q "200"; then
  echo "[5/6] Web dev 서버: http://localhost:8081 LIVE"
else
  echo "[5/6] Web dev 서버: 미기동 (qa-web 트리거 시 자동 기동 또는 'npx expo start --web --port 8081 &')"
fi

# 6. Claude Code 멀티 에이전트 시스템 상태
QUEUE_TODO=$(ls docs/queue/todo/ 2>/dev/null | grep -c "TASK-" || echo 0)
QUEUE_IN_PROGRESS=$(ls docs/queue/in_progress/ 2>/dev/null | grep -c "TASK-" || echo 0)
QUEUE_BLOCKED=$(ls docs/queue/blocked/ 2>/dev/null | grep -c "TASK-" || echo 0)
QUEUE_ESCALATED=$(ls docs/queue/escalated/ 2>/dev/null | grep -c "TASK-" || echo 0)
echo "[6/6] 큐: todo=${QUEUE_TODO}, in_progress=${QUEUE_IN_PROGRESS}, blocked=${QUEUE_BLOCKED}, escalated=${QUEUE_ESCALATED}"

# 핵심 핸드오프 1줄 표시
LATEST_SPRINT=$(ls -d docs/handoffs/sprint-* 2>/dev/null | sort -V | tail -1 | xargs basename)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  최신 sprint: ${LATEST_SPRINT}"
echo "  Claude 세션 시작 시 다음 입력:"
echo "    docs/handoffs/${LATEST_SPRINT}/RESUME.md 읽고 진행해"
echo "  또는 빠른 상태:  /qa status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
