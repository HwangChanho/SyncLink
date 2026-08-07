# scripts/ai-eval — AI 비서 자동 테스트 환경

`assistant-chat` Edge Function 의 시나리오 기반 회귀 + 인터랙티브 playground.

## 사전 조건

- `.env` 의 `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- QA seed 계정 (`e2e-ios-sim-pro@synclink.test` / `$E2E_PASSWORD`) 가 Supabase 에
  존재 — `node scripts/qa-seed-accounts.mjs` 으로 idempotent 생성
- `npm install` 후 `@supabase/supabase-js` + `dotenv` (이미 deps)

## 자동 회귀

```bash
# 전체
npm run ai:eval

# 특정 이름 필터
npm run ai:eval -- --only "분석"

# createEvent 같은 mutate 시나리오 skip
npm run ai:eval -- --skipMutate

# 모든 응답 상세 출력
npm run ai:eval -- --verbose
```

`scenarios.json` 에 시나리오 정의. 각 항목:

| 필드             | 의미                                                       |
|------------------|----------------------------------------------------------|
| `name`           | 시나리오 라벨 (필터에 사용)                                  |
| `user`           | 보낼 prompt                                                |
| `expect.tools`   | 필수로 호출되어야 할 tool 이름 배열                          |
| `expect.toolsExclude` | 호출되면 안 되는 tool                                |
| `expect.containsAny`  | text 에 키워드 중 하나 이상 포함                       |
| `expect.maxTextLength`| text 글자 수 상한                                    |
| `skipMutate`     | `--skipMutate` 옵션 시 제외                                |

## 인터랙티브 Playground

```bash
npm run ai:chat
> 이번 주 일정 알려줘
> 그 중에 가장 긴 거 하나만
> /clear     # history 초기화
> /quit      # 종료
```

history 자동 유지 (multi-turn). `/clear` 로 reset.

## 주의

- production Edge Function 호출 — Anthropic 토큰 소비 (Haiku/Sonnet)
- mutate tool (`createEvent`, `updateEvent`, `deleteEvent`, `createTodo`) 은
  QA 계정에 실제 데이터 변경. 필요 시 `node scripts/qa-seed-accounts.mjs`
  로 reset
- assistant-chat 의 quota 도 동일 적용 — `_shared/quota.ts` 의 일일 cap
  초과 시 fail
