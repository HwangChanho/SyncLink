#!/bin/bash
# tail-errors.sh
#
# error_logs 테이블에서 최근 N개 에러를 즉시 조회해 사람이 읽기 좋게 출력한다.
# LEAD가 원인 파악 시 첫 번째로 실행하는 스크립트.
#
# Usage:
#   ./scripts/tail-errors.sh           # 최근 20개 (기본)
#   ./scripts/tail-errors.sh 50        # 최근 50개
#
# 사전 조건:
#   .env 파일에 SUPABASE_SERVICE_ROLE_KEY=... 가 설정되어 있어야 함.
#   (Supabase Dashboard > Project Settings > API > service_role key 복사)
#
# 왜 service_role 키인가:
#   error_logs 테이블은 SELECT RLS 정책이 없어 authenticated/anon로는 조회 불가.
#   오직 service_role 만 조회 가능 → 이 키는 절대 앱 코드에 노출 금지.

set -e

LIMIT=${1:-20}

# ─── 환경변수 로드 ────────────────────────────────────────────
# .env 를 source하면 SUPABASE_SERVICE_ROLE_KEY 를 읽어올 수 있음
if [ -f .env ]; then
  # "export" 없이 KEY=VALUE 라인만 있는 .env 포맷 대응
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "SUPABASE_SERVICE_ROLE_KEY가 .env에 없습니다."
  echo "  Supabase Dashboard > Project Settings > API > service_role key 복사해서"
  echo "  .env에 SUPABASE_SERVICE_ROLE_KEY=... 추가하세요."
  exit 1
fi

# ─── Supabase REST API 호출 ──────────────────────────────────
# PostgREST를 통해 order=created_at.desc 정렬 후 상위 LIMIT 개 반환
curl -s "https://uhubhqcymxajdonmkthm.supabase.co/rest/v1/error_logs?order=created_at.desc&limit=$LIMIT" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  | python3 -c "
import sys, json
try:
    rows = json.load(sys.stdin)
except json.JSONDecodeError as e:
    print(f'응답을 JSON으로 파싱 실패: {e}')
    sys.exit(1)

if isinstance(rows, dict) and 'message' in rows:
    # PostgREST 오류 응답 (예: 권한 없음)
    print(f'에러: {rows.get(\"message\")}')
    sys.exit(1)

if not rows:
    print('에러 로그가 없습니다. (error_logs 테이블이 비어있거나 INSERT가 아직 발생하지 않음)')
    sys.exit(0)

for r in rows:
    print('---')
    platform = r.get('platform') or 'unknown'
    print(f\"{r['created_at']} | {r['severity']} | {r['context']} | {platform}\")
    print(f\"  {r['message']}\")
    details = r.get('details')
    if details and isinstance(details, dict):
        stack = details.get('stack')
        if stack:
            # stack의 첫 3줄만 요약 출력 (전체는 DB에서 직접 조회)
            stack_lines = stack.split('\\n')[:3]
            for line in stack_lines:
                print(f'    {line}')
"
